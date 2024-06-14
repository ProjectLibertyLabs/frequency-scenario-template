import { options } from '@frequency-chain/api-augment';
import { ApiRx, WsProvider, ApiPromise, Keyring, HttpProvider } from '@polkadot/api';
import { firstValueFrom } from 'rxjs';
import { KeyringPair } from '@polkadot/keyring/types';
import { env } from './env.js';

// eslint-disable-next-line import/no-mutable-exports
export let keyring: Keyring;

export async function connect(providerUrl?: string | string[] | undefined): Promise<ApiRx> {
  const provider = new WsProvider(providerUrl || env.providerUrl);
  const apiObservable = ApiRx.create({ provider, ...options });
  return firstValueFrom(apiObservable);
}

export async function connectPromise(providerUrl?: string): Promise<ApiPromise> {
  const url = providerUrl ?? env.providerUrl;
  const provider: HttpProvider | WsProvider = url?.startsWith('http') ? new HttpProvider(url) : new WsProvider(url);
  const api = await ApiPromise.create({ provider, ...options });
  await api.isReady;
  return api;
}

export function apiCreateKeys(uri: string): KeyringPair {
  if (!keyring) {
    keyring = new Keyring({ type: 'sr25519' });
  }

  const keys = keyring.addFromUri(uri);

  return keys;
}
