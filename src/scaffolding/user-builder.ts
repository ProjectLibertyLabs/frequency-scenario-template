import { MessageSourceId, ProviderId, SchemaId } from '@frequency-chain/api-augment/interfaces';
import { KeyringPair } from '@polkadot/keyring/types';
import { AnyNumber } from '@polkadot/types/types';
import { firstValueFrom, lastValueFrom } from 'rxjs';
import { User } from './user';
import { Extrinsic, ExtrinsicHelper } from './extrinsicHelpers';
import { generateDelegationPayload, signPayloadSr25519 } from './helpers';

interface IUserBuilder {
  keys?: KeyringPair;
  msaId?: MessageSourceId | AnyNumber;
  providerName?: string;
  delegation?: {
    delegate: User;
    schemaIds: (SchemaId | AnyNumber)[];
  };
}

export class UserBuilder {
  private values: IUserBuilder = {};

  constructor(input?: IUserBuilder) {
    this.values = input ?? {};
  }

  public withKeypair(keys: KeyringPair) {
    return new UserBuilder({ ...this.values, keys });
  }

  public withMsaId(msaId: MessageSourceId | AnyNumber) {
    return new UserBuilder({ ...this.values, msaId });
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

  public async build(): Promise<User> {
    if (!this.values.keys) {
      throw new Error('Cannot create a User without a keypair');
    }

    let event: any;
    let msaId: MessageSourceId;

    const id = await firstValueFrom(ExtrinsicHelper.api.query.msa.publicKeyToMsaId(this.values.keys.publicKey));
    if (id.isEmpty) {
      if (this.values.delegation === undefined) {
        [event] = await ExtrinsicHelper.createMsa(this.values.keys).fundAndSend();
        if (!ExtrinsicHelper.api.events.msa.MsaCreated.is(event)) {
          throw new Error('MSA not created');
        }
      } else {
        const payload = await generateDelegationPayload({ authorizedMsaId: this.values.delegation.delegate.providerId, schemaIds: this.values.delegation.schemaIds });
        const signature = signPayloadSr25519(this.values.keys, ExtrinsicHelper.api.createType('PalletMsaAddProvider', payload));
        const [result, eventMap] = await ExtrinsicHelper.createSponsoredAccountWithDelegation(
          this.values.keys,
          this.values.delegation.delegate.keypair,
          signature,
          payload,
        ).fundAndSend();
        if (!ExtrinsicHelper.api.events.msa.MsaCreated.is(result)) {
          throw new Error(`Delegated MSA not created`);
        }

        if (eventMap['msa.DelegationGranted'] === undefined) {
          throw new Error(`MSA account created, but delegation not granted to provider ${this.values.delegation.delegate.providerId.toString()}`);
        }
      }

      msaId = event.data.msa_id;
    }
    // If an MSA already exists, we'll simply return it (after adding/verifying any requested delegation)
    else {
      msaId = id.unwrap();
      if (this.values.delegation) {
        const payload = await generateDelegationPayload({ authorizedMsaId: this.values.delegation.delegate.providerId, schemaIds: this.values.delegation.schemaIds });
        const signature = signPayloadSr25519(this.values.keys, ExtrinsicHelper.api.createType('PalletMsaAddProvider', payload));
        const [result] = await ExtrinsicHelper.grantDelegation(this.values.keys, this.values.delegation.delegate.keypair, signature, payload).fundAndSend();
        if (!result || !ExtrinsicHelper.api.events.msa.DelegationGranted.is(result)) {
          throw new Error(`Delegation not granted for MSA ${id.toString()} to Provider ${this.values.delegation.delegate.providerId.toString()}`);
        }
      }
    }

    let providerId: ProviderId | undefined;
    if (this.values.providerName !== undefined) {
      const providerRegistryEntry = await firstValueFrom(ExtrinsicHelper.api.query.msa.providerToRegistryEntry(msaId));
      if (providerRegistryEntry.isEmpty) {
        [event] = await ExtrinsicHelper.createProvider(this.values.keys, this.values.providerName).fundAndSend();
        if (!event || !ExtrinsicHelper.api.events.msa.ProviderCreated.is(event)) {
          throw new Error(`Unable to register MSA ${msaId.toString()} as a provider`);
        }
        providerId = event.data.providerId;
      } else {
        providerId = msaId;
      }
    }

    return new User(this.values.keys, msaId, providerId);
  }
}
