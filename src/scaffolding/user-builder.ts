import { MessageSourceId, SchemaId } from '@frequency-chain/api-augment/interfaces';
import { KeyringPair } from '@polkadot/keyring/types';
import { AnyNumber } from '@polkadot/types/types';
import log from 'loglevel';
import { sign } from 'crypto';
import { IUser, User } from './user';
import { Extrinsic, ExtrinsicHelper } from './extrinsicHelpers';
import { EXISTENTIAL_DEPOSIT, generateAddKeyPayload, generateClaimHandlePayload, generateDelegationPayload, getDefaultFundingSource, signPayloadSr25519 } from './helpers';
import { createKeys } from './apiConnection';

interface IUserBuilder {
  uri?: string;
  allKeys?: KeyringPair[];
  msaId?: MessageSourceId | AnyNumber;
  providerName?: string;
  delegation?: {
    delegate: User;
    schemaIds: (SchemaId | AnyNumber)[];
  };
  initialFundingLevel?: bigint;
  paymentMethod?: 'token' | 'capacity' | 'provider' | KeyringPair;
  handle?: string;
}

export class UserBuilder {
  private values: IUserBuilder = {};

  constructor(input?: IUserBuilder) {
    this.values = input ?? {};
  }

  public get defaultKeypair(): KeyringPair {
    return this.values.allKeys![0];
  }

  public withKeyUri(uri: string) {
    if (this.values.allKeys) {
      console.log('Overriding keys with new key URI');
    }
    const input = { ...this.values, uri };
    delete input.allKeys;
    return new UserBuilder(input);
  }

  public withKeypair(keys: KeyringPair) {
    if (this.values.uri) {
      console.log('Overriding key URI with keypair');
    }
    const input = { ...this.values };
    delete input.uri;
    return new UserBuilder({ ...input, allKeys: [...(input.allKeys ?? []), keys] });
  }

  public withMsaId(msaId: MessageSourceId | AnyNumber) {
    return new UserBuilder({ ...this.values, msaId });
  }

  public withHandle(handle: string) {
    return new UserBuilder({ ...this.values, handle });
  }

  public withDelegation(delegate: User, schemaIds: (SchemaId | AnyNumber)[]) {
    if (!delegate.isProvider) {
      throw new Error('Delegate must be a registered provider');
    }
    return new UserBuilder({ ...this.values, delegation: { delegate, schemaIds } });
  }

  public asProvider(providerName: string) {
    return new UserBuilder({ ...this.values, providerName });
  }

  public withFundingSource(keys?: KeyringPair) {
    const fundingSource = keys ?? getDefaultFundingSource().keys;
    return new UserBuilder({ ...this.values, paymentMethod: fundingSource });
  }

  public withInitialFundingLevel(amount: bigint) {
    return new UserBuilder({ ...this.values, initialFundingLevel: amount });
  }

  public withCapacityPayment() {
    return new UserBuilder({ ...this.values, paymentMethod: 'capacity' });
  }

  public withTokenPayment() {
    return new UserBuilder({ ...this.values, paymentMethod: 'token' });
  }

  public withProviderPayment() {
    return new UserBuilder({ ...this.values, paymentMethod: 'provider' });
  }

  public async executeUserOp(op: Extrinsic, error?: any) {
    try {
      const [target, eventMap] = await (async () => {
        switch (this.values.paymentMethod) {
          case 'token':
            return op.signAndSend();

          case 'capacity':
            return op.payWithCapacity();

          case 'provider':
            return [];

          default:
            return op.fundAndSend(this.values.paymentMethod);
        }
      })();

      if (!!op.targetEvent && !op.targetEvent?.is(target)) {
        throw error ?? new Error(`Extrinsic result does not match ${op.targetEvent?.meta.name}`);
      }
      return [target, eventMap];
    } catch (e) {
      console.log(JSON.stringify(e));
      throw error ?? e;
    }
  }

  public async build(): Promise<User> {
    if (!this.values.allKeys && this.values.uri) {
      this.values.allKeys = [];
      this.values.allKeys.push(createKeys(this.values.uri));
    }

    if (!this.values.allKeys) {
      throw new Error('Cannot create a User without a keypair or valid URI');
    }

    const fundingSource = (() => {
      switch (this.values.paymentMethod) {
        case 'capacity':
        case 'token':
        case 'provider':
          return getDefaultFundingSource().keys;

        default:
          return this.values.paymentMethod ?? getDefaultFundingSource().keys;
      }
    })();

    const accountInfo = await ExtrinsicHelper.getAccountInfo(this.defaultKeypair.address);
    const freeBalance = BigInt(accountInfo.data.free.toString());
    const fundingLevel = EXISTENTIAL_DEPOSIT + (this.values.initialFundingLevel ?? 0n);
    const fundingAmount = fundingLevel > freeBalance ? fundingLevel - freeBalance : fundingLevel;

    if (fundingAmount > 0n && this.values.paymentMethod !== 'provider') {
      try {
        log.info(`Funding account ${this.defaultKeypair.address} with ${fundingAmount > EXISTENTIAL_DEPOSIT ? fundingAmount : 'existential deposit'}`);
        await ExtrinsicHelper.transferFunds(fundingSource, this.defaultKeypair, fundingAmount).signAndSend();
      } catch (e) {
        throw new Error(`Unable to transfer initial token amount ${fundingAmount.toString()}:
            ${JSON.stringify(e)}`);
      }
    }

    let event: any;
    let msaId: MessageSourceId;

    const id = await ExtrinsicHelper.apiPromise.query.msa.publicKeyToMsaId(this.defaultKeypair.publicKey);
    if (id.isNone) {
      if (this.values.delegation === undefined) {
        log.info(`Creating a new user for account ${this.defaultKeypair.address}`);
        const op = ExtrinsicHelper.createMsa(this.defaultKeypair);
        [event] = await this.executeUserOp(op, new Error(`Failed to create MSA for account ${this.defaultKeypair.address}`));
        if (!ExtrinsicHelper.api.events.msa.MsaCreated.is(event)) {
          throw new Error('MSA not created');
        }
        msaId = event.data.msaId;
        log.info(`Created MSA ${msaId.toString()} for account ${this.defaultKeypair.address}`);
      } else {
        log.info(`Creating a new delegated user for ${this.defaultKeypair.address} to provider ${this.values.delegation.delegate.providerId}`);
        const payload = await generateDelegationPayload({ authorizedMsaId: this.values.delegation.delegate.providerId, schemaIds: this.values.delegation.schemaIds });
        const signature = signPayloadSr25519(this.defaultKeypair, ExtrinsicHelper.api.createType('PalletMsaAddProvider', payload));
        const op = ExtrinsicHelper.createSponsoredAccountWithDelegation(this.defaultKeypair, this.values.delegation.delegate.keypair, signature, payload);
        const [result, eventMap] = await (this.values.paymentMethod === 'provider'
          ? this.values.delegation.delegate.executeOp(op)
          : this.executeUserOp(
              op,
              new Error(`Failed to create a delegated MSA for account ${this.defaultKeypair.address} to provider ${this.values.delegation?.delegate.providerId?.toString()}`),
            ));
        if (!ExtrinsicHelper.api.events.msa.MsaCreated.is(result)) {
          throw new Error(`Delegated MSA not created`);
        }

        if (eventMap['msa.DelegationGranted'] === undefined) {
          throw new Error(`MSA account created, but delegation not granted to provider ${this.values.delegation.delegate.providerId?.toString()}`);
        }

        msaId = result.data.msaId;
      }
    }
    // If an MSA already exists, we'll simply return it (after adding/verifying any requested delegation)
    else {
      msaId = id.unwrap();
      log.info(`Retrieved existing MSA ${msaId.toString()} for account ${this.defaultKeypair.address}`);
      if (this.values.delegation) {
        const payload = await generateDelegationPayload({ authorizedMsaId: this.values.delegation.delegate.providerId, schemaIds: this.values.delegation.schemaIds });
        const signature = signPayloadSr25519(this.defaultKeypair, ExtrinsicHelper.api.createType('PalletMsaAddProvider', payload));
        const op = ExtrinsicHelper.grantDelegation(this.defaultKeypair, this.values.delegation.delegate.keypair, signature, payload);
        await this.executeUserOp(op, new Error(`Failed to grant delegation for MSA ${msaId.toString()} to provider ${this.values.delegation.delegate.providerId?.toString()}`));
      }
    }

    if (this.values.handle) {
      const payload = await generateClaimHandlePayload(this.values.handle);
      const signature = signPayloadSr25519(this.defaultKeypair, ExtrinsicHelper.api.createType('CommonPrimitivesHandlesClaimHandlePayload', payload));
      const op =
        this.values.paymentMethod === 'provider'
          ? ExtrinsicHelper.claimHandleWithProvider(this.defaultKeypair, this.values.delegation?.delegate.keypair!, signature, payload)
          : ExtrinsicHelper.claimHandle(this.defaultKeypair, payload);
      const [result, eventMap] = await (this.values.paymentMethod === 'provider' ? op.payWithCapacity() : op.fundAndSend());
      if (!ExtrinsicHelper.api.events.handles.HandleClaimed.is(result)) {
        throw new Error(`Handle not claimed`);
      }
    }

    if ((this.values.allKeys?.length ?? 1) > 1) {
      this.values.allKeys?.slice(1)?.forEach(async (keys) => {
        // Check if key is already registered to this or another MSA
        const keyId = await ExtrinsicHelper.apiPromise.query.msa.publicKeyToMsaId(keys.publicKey);
        if (keyId.isSome) {
          if (keyId.unwrap().toString() === msaId.toString()) {
            log.info(`Key ${keys.publicKey} already present in MSA ${msaId.toString()}`);
          } else {
            log.error(`Skipping key ${keys.publicKey}; already belongs to MSA ${keyId.toString()}`);
          }
          return;
        }
        const payload = await generateAddKeyPayload({
          msaId,
          newPublicKey: keys.publicKey,
        });
        const addKeyData = ExtrinsicHelper.api.registry.createType('PalletMsaAddKeyData', payload);
        const ownerSig = signPayloadSr25519(this.defaultKeypair!, addKeyData);
        const newSig = signPayloadSr25519(keys, addKeyData);
        const op = ExtrinsicHelper.addPublicKeyToMsa(keys, ownerSig, newSig, payload);
        await this.executeUserOp(op, new Error(`Failed to authorize new key for MSA ${msaId.toString()}`));
        log.info(`Authorized new key ${keys.address} for MSA ${msaId.toString()}`);
      });
    }

    const userParams: IUser = {
      ...this.values,
      msaId,
      allKeys: this.values.allKeys!,
    };

    const providerRegistryEntryOption = await ExtrinsicHelper.apiPromise.query.msa.providerToRegistryEntry(msaId);
    if (providerRegistryEntryOption.isNone) {
      if (this.values.providerName) {
        const op = ExtrinsicHelper.createProvider(this.defaultKeypair, this.values.providerName);
        const [result] = await this.executeUserOp(op);
        if (!ExtrinsicHelper.api.events.msa.ProviderCreated.is(result)) {
          throw new Error(`failed to register ${this.values.providerName} as provider`);
        }

        userParams.providerId = result.data.providerId;
        log.info(`Registered MSA ${msaId.toString()} as provider '${this.values.providerName}`);
      }
    } else {
      userParams.providerId = msaId;
      const { providerName } = providerRegistryEntryOption.unwrap();
      if (providerName.toUtf8() !== this.values.providerName) {
        log.warn(`Overriding requested Provider name ${this.values.providerName} with existing name ${providerName.toUtf8()}`);
      }
      userParams.providerName = providerName.toUtf8();
      log.info(`Detected existing provider registration for MSA ${msaId.toString()} as '${userParams.providerName}'`);
    }

    return new User(userParams);
  }
}
