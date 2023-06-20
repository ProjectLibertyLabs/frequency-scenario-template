/* eslint-disable no-underscore-dangle */
import { MessageSourceId, SchemaId } from '@frequency-chain/api-augment/interfaces';
import { KeyringPair } from '@polkadot/keyring/types';
import { createKeys } from './helpers';
import { ExtrinsicHelper } from './extrinsicHelpers';

export class User {
  private _msaId: MessageSourceId;

  private _keypair: KeyringPair;

  constructor(keypair?: KeyringPair) {
    this._keypair = keypair ?? createKeys();
  }

  public get msaId() {
    return this._msaId;
  }

  public get keypair() {
    return this._keypair;
  }

  public async createMsa(): Promise<void> {
    const [result] = await ExtrinsicHelper.createMsa(this.keypair).signAndSend();
    if (!ExtrinsicHelper.api.events.msa.MsaCreated.is(result)) {
      throw new Error('failed to create MSA');
    }
    this._msaId = result.data.msaId;
  }

  public async registerAsProvider(name: string) {
    const [result] = await ExtrinsicHelper.createProvider(this.keypair, name).signAndSend();
    if (!ExtrinsicHelper.api.events.msa.ProviderCreated.is(result)) {
      throw new Error(`failed to register ${name} as provider`);
    }
  }

  public async grantDelegation(provider: User, schema: SchemaId) {
    const [result] = await ExtrinsicHelper.grantDelegation(this.keypair, provider.keypair, signature, payload).signAndSend();
  }
}
