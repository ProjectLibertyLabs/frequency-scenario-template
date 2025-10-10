import { FrameSystemEventRecord } from '@polkadot/types/lookup';
import { Vec } from '@polkadot/types-codec';
import { AugmentedSubmittable, SubmittableExtrinsic } from '@polkadot/api/types';
import { IMethod, ISubmittableResult } from '@polkadot/types/types';
import { Call, EventRecord } from '@polkadot/types/interfaces';
import { KeyringPair } from '@polkadot/keyring/types';
import { EventError, ExtrinsicHelper } from './extrinsicHelpers.js';

export type ChainEventHandler = (events: Vec<FrameSystemEventRecord> | EventRecord[]) => void;

interface PromiseTracker {
  resolve?: () => void;
  reject?: (reason?: any) => void;
  promise?: Promise<void>;
  numPending: number;
}

const batchesTracker: PromiseTracker = { numPending: 0 };

const defaultEventHandler = (events: EventRecord[]) => {
  events.forEach((eventRecord) => {
    const { event } = eventRecord;
    if (ExtrinsicHelper.apiPromise.events.utility.BatchCompleted.is(event) || ExtrinsicHelper.apiPromise.events.system.ExtrinsicFailed.is(event)) {
      batchesTracker.numPending -= 1;
      if (batchesTracker.numPending < 1) {
        batchesTracker.numPending = 0;
        (batchesTracker?.resolve ?? (() => {}))();
      }
    }
  });
};

async function batchAndWaitForExtrinsics(
  payorKeys: KeyringPair,
  extrinsics: SubmittableExtrinsic<'promise', ISubmittableResult>[],
  handlers: ChainEventHandler[],
  batchAll: AugmentedSubmittable<(calls: Vec<Call> | (Call | IMethod | string | Uint8Array)[]) => SubmittableExtrinsic<'promise'>, [Vec<Call>]>,
) {
  // TODO: use Promise.withResolvers in Node.js >= 22.x
  batchesTracker.promise = new Promise((resolve, reject) => {
    batchesTracker.resolve = resolve;
    batchesTracker.reject = reject;
    batchesTracker.numPending = 0;
  });

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
    // We don't want to exceed the size limit for the future pool
    // TODO: retrieve a sane value for this
    if (batchesTracker.numPending < 100) {
      const xToPost = extrinsics.splice(0, maxBatch);
      batchesTracker.numPending += 1;
      try {
        const unsub = await batchAll(xToPost).signAndSend(payorKeys, { nonce: nonce++ }, (x) => {
          const { status, events } = x;
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

          defaultEventHandler(events);
          handlers.forEach((handler) => handler(events));
        });
      } catch (err: any) {
        throw new Error('Error submitting batch to the chain', { cause: err });
      }
    } else {
      await batchesTracker.promise;
      batchesTracker.promise = new Promise((resolve, reject) => {
        batchesTracker.resolve = resolve;
        batchesTracker.reject = reject;
      });
    }
  }

  await batchesTracker.promise;
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
  handlers: ChainEventHandler[],
) {
  return batchAndWaitForExtrinsics(payorKeys, extrinsics, handlers, ExtrinsicHelper.apiPromise.tx.frequencyTxPayment.payWithCapacityBatchAll);
}
