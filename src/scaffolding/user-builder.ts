import { MessageSourceId, ProviderId, SchemaId } from '@frequency-chain/api-augment/interfaces';
import { KeyringPair } from '@polkadot/keyring/types';
import { AnyNumber } from '@polkadot/types/types';
import { firstValueFrom } from 'rxjs';
import * as log from 'loglevel';
import { IUser, User } from './user';
import { Extrinsic, ExtrinsicHelper } from './extrinsicHelpers';
import { EXISTENTIAL_DEPOSIT, generateAddKeyPayload, generateDelegationPayload, getDefaultFundingSource, signPayloadSr25519 } from './helpers';
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
  fundingSource?: KeyringPair;
  initialFundingLevel?: bigint;
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
    return new UserBuilder({ ...this.values, fundingSource });
  }

  public withInitialFundingLevel(amount: bigint) {
    return new UserBuilder({ ...this.values, initialFundingLevel: amount });
  }

  public async executeUserOp(op: Extrinsic, error?: any) {
    try {
      const [target, eventMap] = await (this.values.fundingSource ? op.fundAndSend(this.values.fundingSource) : op.signAndSend());
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

    const fundingSource = this.values.fundingSource ?? getDefaultFundingSource().keys;
    const accountInfo = await ExtrinsicHelper.getAccountInfo(this.defaultKeypair.address);
    const freeBalance = BigInt(accountInfo.data.free.toString()) - EXISTENTIAL_DEPOSIT;
    const fundingLevel = EXISTENTIAL_DEPOSIT + (this.values.initialFundingLevel ?? 0n);
    const fundingAmount = fundingLevel - freeBalance;

    if (fundingAmount > 0) {
      try {
        log.info(`Funding account ${this.defaultKeypair.address} with ${fundingAmount}`);
        await ExtrinsicHelper.transferFunds(fundingSource, this.defaultKeypair, fundingAmount).signAndSend();
      } catch (e) {
        throw new Error(`Unable to transfer initial token amount ${fundingAmount.toString()}:
            ${JSON.stringify(e)}`);
      }

      // Once we've funded the account, remove the funding source so that the created User will self-fund
      delete this.values.fundingSource;
    }

    let event: any;
    let msaId: MessageSourceId;

    const id = await firstValueFrom(ExtrinsicHelper.api.query.msa.publicKeyToMsaId(this.defaultKeypair.publicKey));
    if (id.isEmpty) {
      if (this.values.delegation === undefined) {
        const op = ExtrinsicHelper.createMsa(this.defaultKeypair);
        [event] = await this.executeUserOp(op, new Error(`Failed to create MSA for account ${this.defaultKeypair.address}`));
        if (!ExtrinsicHelper.api.events.msa.MsaCreated.is(event)) {
          throw new Error('MSA not created');
        }
        msaId = event.data.msaId;
        log.info(`Created MSA ${msaId.toString()} for account ${this.defaultKeypair.address}`);
      } else {
        const payload = await generateDelegationPayload({ authorizedMsaId: this.values.delegation.delegate.providerId, schemaIds: this.values.delegation.schemaIds });
        const signature = signPayloadSr25519(this.defaultKeypair, ExtrinsicHelper.api.createType('PalletMsaAddProvider', payload));
        const op = ExtrinsicHelper.createSponsoredAccountWithDelegation(this.defaultKeypair, this.values.delegation.delegate.keypair, signature, payload);
        const [result, eventMap] = await this.executeUserOp(
          op,
          new Error(`Failed to create a delegated MSA for account ${this.defaultKeypair.address} to provider ${this.values.delegation.delegate.providerId?.toString()}`),
        );
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

    // if (this.values.handle) {
    // }

    if ((this.values.allKeys?.length ?? 1) > 1) {
      this.values.allKeys?.slice(1)?.forEach(async (keys) => {
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

    const providerRegistryEntryOption = await firstValueFrom(ExtrinsicHelper.api.query.msa.providerToRegistryEntry(msaId));
    if (providerRegistryEntryOption.isNone) {
      if (this.values.providerName) {
        const op = ExtrinsicHelper.createProvider(this.defaultKeypair, this.values.providerName);
        const [result] = await this.executeUserOp(op);
        // if (!ExtrinsicHelper.api.events.msa.ProviderCreated.is(result)) {
        //   throw new Error(`failed to register ${this.values.providerName} as provider`);
        // }

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
