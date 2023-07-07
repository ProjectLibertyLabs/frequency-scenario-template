/* eslint-disable no-underscore-dangle */
import { MessageSourceId, ProviderId, SchemaId } from '@frequency-chain/api-augment/interfaces';
import { KeyringPair } from '@polkadot/keyring/types';
import { AnyNumber } from '@polkadot/types/types';
import { firstValueFrom } from 'rxjs';
import { generateAddKeyPayload, generateDelegationPayload, getDefaultFundingSource, signPayloadSr25519 } from './helpers';
import { Extrinsic, ExtrinsicHelper } from './extrinsicHelpers';

export interface IUser {
  msaId: MessageSourceId;
  providerId?: ProviderId;
  providerName?: string;
  allKeys: KeyringPair[];
  fundingSource?: KeyringPair;
}
export class User implements IUser {
  public msaId: MessageSourceId;

  public providerId?: ProviderId;

  public providerName?: string;

  public allKeys: KeyringPair[] = [];

  public fundingSource?: KeyringPair;

  public paysWithCapacity: boolean = false;

  constructor({ allKeys, msaId, providerId, providerName, fundingSource }: IUser) {
    this.allKeys = allKeys;
    this.msaId = msaId;
    this.providerId = providerId;
    this.providerName = providerName;
    this.fundingSource = fundingSource;
  }

  public get isProvider(): boolean {
    return this.providerId !== undefined;
  }

  public get keypair(): KeyringPair {
    return this.allKeys[0];
  }

  private executeOp(op: Extrinsic) {
    return this.paysWithCapacity ? op.payWithCapacity() : this.fundingSource ? op.fundAndSend(this.fundingSource) : op.signAndSend();
  }

  public async addKeypair(keys: KeyringPair) {
    const payload = await generateAddKeyPayload({
      msaId: this.msaId,
      newPublicKey: keys.publicKey,
    });
    const addKeyData = ExtrinsicHelper.api.registry.createType('PalletMsaAddKeyData', payload);
    const ownerSig = signPayloadSr25519(this.allKeys[0], addKeyData);
    const newSig = signPayloadSr25519(keys, addKeyData);
    const op = ExtrinsicHelper.addPublicKeyToMsa(keys, ownerSig, newSig, payload);
    const [result] = await this.executeOp(op);
    if (result === undefined) {
      throw new Error(`failed to authorize new keypair for MSA ${this.msaId.toString()}`);
    }
  }

  public async stakeToProvider(provider: ProviderId, amount: bigint) {
    const op = ExtrinsicHelper.stake(this.keypair, provider, amount);
    return this.executeOp(op);
  }

  public async registerAsProvider(name: string) {
    const providerRegistryEntryOption = await firstValueFrom(ExtrinsicHelper.api.query.msa.providerToRegistryEntry(this.msaId));
    if (providerRegistryEntryOption.isNone) {
      const op = ExtrinsicHelper.createProvider(this.keypair, name);
      const [result] = await this.executeOp(op);
      if (!ExtrinsicHelper.api.events.msa.ProviderCreated.is(result)) {
        throw new Error(`failed to register ${name} as provider`);
      }

      const { providerId } = result.data;
      this.providerId = providerId;
      this.providerName = name;
    } else {
      const { providerName } = providerRegistryEntryOption.unwrap();
      this.providerName = providerName.toString();
      if (providerName.toString() !== name) {
        console.log(`Overriding requested Provider name ${name} with existing name ${this.providerName}`);
      }
    }
  }

  public async grantDelegation(provider: User, schemaIds: SchemaId[] | AnyNumber[]) {
    const payload = await generateDelegationPayload({ authorizedMsaId: provider.msaId, schemaIds });
    const addProviderData = ExtrinsicHelper.api.registry.createType('PalletMsaAddProvider', payload);
    const signature = signPayloadSr25519(this.keypair, addProviderData);
    const op = ExtrinsicHelper.grantDelegation(this.keypair, provider.keypair, signature, payload);
    const [result] = await this.executeOp(op);
    if (!ExtrinsicHelper.api.events.msa.DelegationGranted.is(result)) {
      throw new Error(`failed to grant delegation for user ${this.msaId} to provider ${provider.msaId}`);
    }
  }

  public async createMsaAsDelegatedAccount(provider: User, schemaIds?: SchemaId[]) {
    if (!provider.isProvider) {
      throw new Error(`User ${provider.providerId?.toString()} is not a provider`);
    }

    if (this.msaId !== undefined) {
      throw new Error('Cannot create a sponsored account for a user that already has an MSA');
    }

    const payload = await generateDelegationPayload({ authorizedMsaId: provider.providerId, schemaIds });
    const signature = signPayloadSr25519(this.keypair, ExtrinsicHelper.api.createType('PalletMsaAddProvider', payload));
    const op = ExtrinsicHelper.createSponsoredAccountWithDelegation(this.keypair, provider.keypair, signature, payload);
    const [result, eventMap] = await this.executeOp(op);
    if (!ExtrinsicHelper.api.events.msa.MsaCreated.is(result)) {
      throw new Error(`Delegated MSA not created`);
    }

    if (eventMap['msa.DelegationGranted'] === undefined) {
      throw new Error(`MSA account created, but delegation not granted to provider ${this.providerId?.toString()}`);
    }
  }
}
