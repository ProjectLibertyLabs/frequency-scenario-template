import { MessageSourceId } from '@frequency-chain/api-augment/interfaces';
import { SubmittableExtrinsic } from '@polkadot/api/types';
import { KeyringPair } from '@polkadot/keyring/types';
import { ISubmittableResult } from '@polkadot/types/types';
import { GraphKeyPair } from '@projectlibertylabs/graph-sdk';

export type ChainUser = {
  uri: string;
  keypair: KeyringPair;
  msaId?: MessageSourceId;
  handle?: string;
  graphKeyPair?: GraphKeyPair;
  create?: () => SubmittableExtrinsic<'promise', ISubmittableResult>;
  claimHandle?: () => SubmittableExtrinsic<'promise', ISubmittableResult>;
  addGraphKey?: () => SubmittableExtrinsic<'promise', ISubmittableResult>;
  graphUpdates?: (() => SubmittableExtrinsic<'promise', ISubmittableResult>)[];
};
