import {IntentId, MessageSourceId} from '@frequency-chain/api-augment/interfaces';
import { KeyringPair } from '@polkadot/keyring/types';
import { AnyNumber } from '@polkadot/types/types';
import log from 'loglevel';
import { firstValueFrom } from 'rxjs';
import { IUser, User } from './user.js';
import { Extrinsic, ExtrinsicHelper } from './extrinsicHelpers.js';
import {
  generateAddKeyPayload,
  generateClaimHandlePayload,
  generateDelegationPayload,
  getDefaultFundingSource,
  getExistentialDeposit,
  signPayloadSr25519
} from './helpers.js';
import { apiCreateKeys } from './apiConnection.js';
import {Builder} from "#app/scaffolding/builder";

interface IUserBuilder {
  keyUris?: string[];
  allKeys?: KeyringPair[];
  id?: MessageSourceId | AnyNumber;
  providerName?: string;
  delegation?: {
    delegate: User;
    intentIds: (IntentId | AnyNumber)[];
  };
  initialFundingLevel?: bigint;
  paymentMethod?: 'token' | 'capacity' | 'provider' | KeyringPair;
  handle?: string;
}

export class UserBuilder extends Builder<IUserBuilder, typeof User> {
  public resolve(): Promise<User | undefined> {
      throw new Error('Method not implemented.');
  }
  public get defaultKeypair(): KeyringPair {
    return this.values.allKeys![0];
  }

  readonly withKeyUri = this.arrayPropertyAppender('keyUris');
  readonly withKeypair = this.arrayPropertyAppender('allKeys');
  readonly withMsaId = this.propertySetter('id');
  readonly withHandle = this.propertySetter('handle');

  public withDelegation(delegate: User, intentIds: (IntentId | AnyNumber)[]): UserBuilder {
    if (!delegate.isProvider) {
      throw new Error('Delegate must be a registered provider');
    }
    return this.withProperty('delegation', { delegate, intentIds });
  }

  public asProvider(providerName: string): UserBuilder {
    return this.withProperty('providerName', providerName);
  }

  public withFundingSource(keys?: KeyringPair): UserBuilder {
    const fundingSource = keys ?? getDefaultFundingSource().keys;
    return this.withProperty('paymentMethod', fundingSource);
  }

  public withInitialFundingLevel(amount: bigint): UserBuilder {
    return this.withProperty('initialFundingLevel', amount);
  }

  public withCapacityPayment(): UserBuilder {
    return this.withProperty('paymentMethod', 'capacity');
  }

  public withTokenPayment(): UserBuilder {
    return this.withProperty('paymentMethod', 'token');
  }

  public withProviderPayment(): UserBuilder {
    return this.withProperty('paymentMethod', 'provider');
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
      console.dir(e, { depth: null });
      throw error ?? e;
    }
  }

  public async build(): Promise<User> {
    if (!this.values.allKeys) {
      this.values.allKeys = [];
    }
    if (this.values.keyUris) {
      this.values.allKeys.push(...this.values.keyUris.map((key) => apiCreateKeys(key)));
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
    const fundingLevel = getExistentialDeposit() + (this.values.initialFundingLevel ?? 0n);
    const fundingAmount = fundingLevel > freeBalance ? fundingLevel - freeBalance : fundingLevel;

    if (fundingAmount > 0n && this.values.paymentMethod !== 'provider') {
      try {
        log.info(`Funding account ${this.defaultKeypair.address} with ${fundingAmount > getExistentialDeposit() ? fundingAmount : 'existential deposit'}`);
        await ExtrinsicHelper.transferFunds(fundingSource, this.defaultKeypair, fundingAmount).signAndSend();
      } catch (e: any) {
        throw new Error(
          `Unable to transfer initial token amount ${fundingAmount.toString()}:
            ${e?.toString() || e?.message || JSON.stringify(e)}`,
          { cause: e },
        );
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
        const payload = await generateDelegationPayload({ authorizedMsaId: this.values.delegation.delegate.providerId, intentIds: this.values.delegation.intentIds });
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
        const payload = await generateDelegationPayload({ authorizedMsaId: this.values.delegation.delegate.providerId, intentIds: this.values.delegation.intentIds });
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
          ? ExtrinsicHelper.claimHandleWithProvider(this.defaultKeypair, this.values.delegation!.delegate.keypair!, signature, payload)
          : ExtrinsicHelper.claimHandle(this.defaultKeypair, payload);
      const [result] = await (this.values.paymentMethod === 'provider' ? op.payWithCapacity() : op.fundAndSend());
      if (!ExtrinsicHelper.api.events.handles.HandleClaimed.is(result)) {
        throw new Error(`Handle not claimed`);
      }
    }

    if ((this.values.allKeys?.length ?? 1) > 1) {
      await Promise.all(this.values.allKeys?.slice(1)?.map(async (keys) => {
        // Check if the key is already registered to this or another MSA
        const keyId = await ExtrinsicHelper.apiPromise.query.msa.publicKeyToMsaId(keys.publicKey);
        if (keyId.isSome) {
          if (keyId.unwrap().toString() === msaId.toString()) {
            log.info(`Key ${keys.publicKey} already present in MSA ${msaId.toString()}`);
          } else {
            log.error(`Skipping key ${keys.address}; already belongs to MSA ${keyId.toString()}`);
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
      }));
    }

    const userParams: IUser = {
      ...this.values,
      msaId,
      allKeys: this.values.allKeys!,
    };

    const providerRegistryEntryOption = await firstValueFrom(ExtrinsicHelper.api.query.msa.providerToRegistryEntryV2(msaId));
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
      const { defaultName } = providerRegistryEntryOption.unwrap();
      if (defaultName.toUtf8() !== this.values.providerName) {
        log.warn(`Overriding requested Provider name ${this.values.providerName} with existing name ${defaultName.toUtf8()}`);
      }
      userParams.providerName = defaultName.toUtf8();
      log.info(`Detected existing provider registration for MSA ${msaId.toString()} as '${userParams.providerName}'`);
    }

    return new User(userParams);
  }
}
