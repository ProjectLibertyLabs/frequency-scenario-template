import { FrameSystemEventRecord } from '@polkadot/types/lookup';
import { Vec } from '@polkadot/types-codec';
import { AugmentedSubmittable, SubmittableExtrinsic, VoidFn } from '@polkadot/api/types';
import { IMethod, ISubmittableResult } from '@polkadot/types/types';
import { Call } from '@polkadot/types/interfaces';
import { KeyringPair } from '@polkadot/keyring/types';
import { EventError, ExtrinsicHelper } from './extrinsicHelpers';

export type ChainEventHandler = (events: Vec<FrameSystemEventRecord>) => void;

export interface PromiseTracker {
  resolve?: () => void;
  reject?: (reason?: any) => void;
  promise?: Promise<void>;
  numPending: number;
}

const batchesTracker: PromiseTracker = { numPending: 0 };
let unsubEvents: VoidFn = () => {};

function watchAndHandleChainEvents(handlers: ChainEventHandler[]): Promise<VoidFn> {
  return ExtrinsicHelper.apiPromise.query.system.events((events: Vec<FrameSystemEventRecord>) => {
    events.forEach((eventRecord) => {
      const { event } = eventRecord;
      if (ExtrinsicHelper.apiPromise.events.utility.BatchCompleted.is(event)) {
        batchesTracker.numPending -= 1;
        if (batchesTracker.numPending < 1) {
          batchesTracker.numPending = 0;
          (batchesTracker?.resolve ?? (() => {}))();
        }
      }
    });
    handlers.forEach((handler) => handler(events));
  });
}

async function batchAndWaitForExtrinsics(
  payorKeys: KeyringPair,
  extrinsics: SubmittableExtrinsic<'promise', ISubmittableResult>[],
  handlers: ChainEventHandler[],
  batchAll: AugmentedSubmittable<(calls: Vec<Call> | (Call | IMethod | string | Uint8Array)[]) => SubmittableExtrinsic<'promise'>, [Vec<Call>]>,
) {
  batchesTracker.promise = new Promise((resolve, reject) => {
    batchesTracker.resolve = resolve;
    batchesTracker.reject = reject;
    batchesTracker.numPending = 0;
  });
  unsubEvents = await watchAndHandleChainEvents(handlers);

  const unsubBlocks = await ExtrinsicHelper.apiPromise.rpc.chain.subscribeFinalizedHeads(() => {
    const count = extrinsics.length + batchesTracker.numPending;
    console.log(`Extrinsincs remaining: ${count}`);
    if (count === 0) {
      unsubBlocks();
    }
  });

  const maxBatch = ExtrinsicHelper.apiPromise.consts.frequencyTxPayment.maximumCapacityBatchLength.toNumber();
  let nonce = (await ExtrinsicHelper.apiPromise.query.system.account(payorKeys.publicKey)).nonce.toNumber();

  while (extrinsics.length > 0) {
    if (batchesTracker.numPending < 100) {
      // so we don't DOS the node
      const xToPost = extrinsics.splice(0, maxBatch);
      batchesTracker.numPending += 1;
      // eslint-disable-next-line no-await-in-loop, no-plusplus
      const unsub = await batchAll(xToPost).signAndSend(payorKeys, { nonce: nonce++ }, (x) => {
        const { status } = x;
        if (x.dispatchError) {
          unsub();
          (batchesTracker.reject ?? (() => {}))(new EventError(x.dispatchError));
        } else if (status.isInvalid) {
          unsub();
          console.error(x.toHuman());
          (batchesTracker?.reject ?? (() => {}))(new Error('Extrinsic failed: Invalid'));
        } else if (x.isFinalized) {
          unsub();
        }
      });
    } else {
      // eslint-disable-next-line no-await-in-loop
      await batchesTracker.promise;
      batchesTracker.promise = new Promise((resolve, reject) => {
        batchesTracker.resolve = resolve;
        batchesTracker.reject = reject;
      });
    }
  }

  await batchesTracker.promise;
  unsubEvents();
}

export async function batchWithUtilityAndWaitForExtrinsics(
  payorKeys: KeyringPair,
  extrinsics: SubmittableExtrinsic<'promise', ISubmittableResult>[],
  handlers: ChainEventHandler[],
) {
  return batchAndWaitForExtrinsics(payorKeys, extrinsics, handlers, ExtrinsicHelper.apiPromise.tx.utility.batchAll);
}

export async function batchWithCapacityAndWaitForExtrinsics(
  payorKeys: KeyringPair,
  extrinsics: SubmittableExtrinsic<'promise', ISubmittableResult>[],
  handlers: ((events: Vec<FrameSystemEventRecord>) => void)[],
) {
  return batchAndWaitForExtrinsics(payorKeys, extrinsics, handlers, ExtrinsicHelper.apiPromise.tx.frequencyTxPayment.payWithCapacityBatchAll);
}
