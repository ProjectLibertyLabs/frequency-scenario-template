/* eslint-disable no-underscore-dangle */
import { MessageSourceId, ProviderId, SchemaId } from '@frequency-chain/api-augment/interfaces';
import { KeyringPair } from '@polkadot/keyring/types';
import { AnyNumber } from '@polkadot/types/types';
import { Bytes } from '@polkadot/types';
import { createKeys, generateAddKeyPayload, generateDelegationPayload, signPayloadSr25519, getBlockNumber } from './helpers';
import { ExtrinsicHelper } from './extrinsicHelpers';

export class User {
  public msaId: MessageSourceId;

  public providerId: ProviderId;

  private _keypair: KeyringPair;

  private _allKeys: KeyringPair[] = [];

  public handle: string;

  constructor(keypair?: KeyringPair, msaId?: MessageSourceId, providerId?: ProviderId) {
    this._keypair = keypair ?? createKeys();
    this._allKeys.push(this._keypair);
    if (msaId !== undefined) {
      this.msaId = msaId;
    }

    if (providerId !== undefined) {
      this.providerId = providerId;
    }
  }

  public get keypair() {
    return this._keypair;
  }

  public get hasMSA(): boolean {
    return this.msaId !== undefined;
  }

  public get isProvider(): boolean {
    return this.providerId !== undefined;
  }

  public async createMsa(): Promise<void> {
    const [result] = await ExtrinsicHelper.createMsa(this.keypair).signAndSend();
    if (!ExtrinsicHelper.api.events.msa.MsaCreated.is(result)) {
      throw new Error('failed to create MSA');
    }
    this.msaId = result.data.msaId;
  }

  public async addPublicKeyToMsa(keys: KeyringPair) {
    const payload = await generateAddKeyPayload({
      msaId: this.msaId,
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
    this.providerId = providerId;
  }

  public async claimHandle(name: string) {
    const handle_vec = new Bytes(ExtrinsicHelper.api.registry, name);
    let currentBlock = await getBlockNumber();
    const payload = {
      baseHandle: handle_vec,
      expiration: currentBlock + 10,
   }
    const claimHandlePayload = ExtrinsicHelper.api.registry.createType("CommonPrimitivesHandlesClaimHandlePayload", payload);
    await ExtrinsicHelper.claimHandle(this.keypair, claimHandlePayload).payWithCapacity();
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

    if (this.msaId !== undefined) {
      throw new Error('Cannot create a sponsored account for a user that already has an MSA');
    }

    const payload = await generateDelegationPayload({ authorizedMsaId: provider.providerId, schemaIds });
    const signature = signPayloadSr25519(this.keypair, ExtrinsicHelper.api.createType('PalletMsaAddProvider', payload));
    const [result, eventMap] = await ExtrinsicHelper.createSponsoredAccountWithDelegation(this.keypair, provider.keypair, signature, payload).fundAndSend();
    if (!ExtrinsicHelper.api.events.msa.MsaCreated.is(result)) {
      throw new Error(`Delegated MSA not created`);
    }

    if (eventMap['msa.DelegationGranted'] === undefined) {
      throw new Error(`MSA account created, but delegation not granted to provider ${this.providerId.toString()}`);
    }
  }
}
