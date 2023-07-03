/* eslint-disable no-underscore-dangle */
import { MessageSourceId, ProviderId, SchemaId } from '@frequency-chain/api-augment/interfaces';
import { KeyringPair } from '@polkadot/keyring/types';
import { AnyNumber } from '@polkadot/types/types';
import { createKeys, generateAddKeyPayload, generateDelegationPayload, signPayloadSr25519 } from './helpers';
import { ExtrinsicHelper } from './extrinsicHelpers';

export class User {
  private _msaId: MessageSourceId;

  private _providerId: ProviderId;

  private _keypair: KeyringPair;

  private _allKeys: KeyringPair[] = [];

  constructor(keypair?: KeyringPair) {
    this._keypair = keypair ?? createKeys();
    this._allKeys.push(this._keypair);
  }

  public get msaId() {
    return this._msaId;
  }

  public get providerId() {
    return this._providerId;
  }

  public get keypair() {
    return this._keypair;
  }

  public get isProvider(): boolean {
    return this._providerId !== undefined;
  }

  public async createMsa(): Promise<void> {
    const [result] = await ExtrinsicHelper.createMsa(this.keypair).signAndSend();
    if (!ExtrinsicHelper.api.events.msa.MsaCreated.is(result)) {
      throw new Error('failed to create MSA');
    }
    this._msaId = result.data.msaId;
  }

  public async addPublicKeyToMsa(keys: KeyringPair) {
    const payload = await generateAddKeyPayload({
      msaId: this._msaId,
      newPublicKey: keys.publicKey,
    });
    const addKeyData = ExtrinsicHelper.api.registry.createType('PalletMsaAddKeyData', payload);
    const ownerSig = signPayloadSr25519(this._allKeys[0], addKeyData);
    const newSig = signPayloadSr25519(keys, addKeyData);
    const [result] = await ExtrinsicHelper.addPublicKeyToMsa(keys, ownerSig, newSig, payload).fundAndSend();
    if (result === undefined) {
      throw new Error(`failed to authorize new keypair for MSA ${this.msaId.toString()}`);
    }
  }

  public async registerAsProvider(name: string) {
    const [result] = await ExtrinsicHelper.createProvider(this.keypair, name).signAndSend();
    if (!ExtrinsicHelper.api.events.msa.ProviderCreated.is(result)) {
      throw new Error(`failed to register ${name} as provider`);
    }

    const { providerId } = result.data;
    this._providerId = providerId;
  }

  public async grantDelegation(provider: User, schemaIds: SchemaId[] | AnyNumber[]) {
    const payload = await generateDelegationPayload({ authorizedMsaId: provider.msaId, schemaIds });
    const addProviderData = ExtrinsicHelper.api.registry.createType('PalletMsaAddProvider', payload);
    const signature = signPayloadSr25519(this._keypair, addProviderData);
    const [result] = await ExtrinsicHelper.grantDelegation(this.keypair, provider.keypair, signature, payload).signAndSend();
    if (!ExtrinsicHelper.api.events.msa.DelegationGranted.is(result)) {
      throw new Error(`failed to grant delegation for user ${this.msaId} to provider ${provider.msaId}`);
    }
  }

  public async createMsaAsDelegatedAccount(provider: User, schemaIds?: SchemaId[]) {
    if (!provider.isProvider) {
      throw new Error(`User ${provider.providerId.toString()} is not a provider`);
    }

    if (this._msaId !== undefined) {
      throw new Error('Cannot create a sponsored account for a user that already has an MSA');
    }

    const payload = await generateDelegationPayload({ authorizedMsaId: provider.providerId, schemaIds });
    const signature = signPayloadSr25519(this.keypair, ExtrinsicHelper.api.createType('PalletMsaAddProvider', payload));
    const [result, eventMap] = await ExtrinsicHelper.createSponsoredAccountWithDelegation(this.keypair, provider.keypair, signature, payload).fundAndSend();
    if (!ExtrinsicHelper.api.events.msa.MsaCreated.is(result)) {
      throw new Error(`Delegated MSA not created`);
    }

    if (eventMap['msa.DelegationGranted'] === undefined) {
      throw new Error(`MSA account created, but delegation not granted to provider ${this._providerId.toString()}`);
    }
  }
}
