import { FrameSystemEventRecord } from '@polkadot/types/lookup';
import { Vec } from '@polkadot/types';
import { AugmentedSubmittable, SubmittableExtrinsic, VoidFn } from '@polkadot/api/types';
import { AnyTuple, IMethod, ISubmittableResult } from '@polkadot/types/types';
import { ChainUser } from '#app/scenarios/provision-msas';
import { Call } from '@polkadot/types/interfaces';
import { EventError, ExtrinsicHelper } from './extrinsicHelpers';

export interface PromiseTracker {
  resolve?: () => void;
  reject?: (reason?: any) => void;
  promise?: Promise<void>;
  numPending: number;
}

const maxBatch = ExtrinsicHelper.apiPromise.consts.frequencyTxPayment.maximumCapacityBatchLength.toNumber();
const batchesTracker: PromiseTracker = { numPending: 0 };
let unsubEvents: VoidFn = () => {};

function watchAndHandleChainEvents(handlers: ((eventRecord: FrameSystemEventRecord) => void)[]): Promise<VoidFn> {
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
      handlers.forEach((handler) => handler(eventRecord));
    });
  });
}

async function batchAndWaitForExtrinsics(
  provider: ChainUser,
  extrinsics: SubmittableExtrinsic<'promise', ISubmittableResult>[],
  handlers: ((eventRecord: FrameSystemEventRecord) => void)[],
  batchAll: AugmentedSubmittable<(calls: Vec<Call> | (Call | IMethod | string | Uint8Array)[]) => SubmittableExtrinsic<'promise'>, [Vec<Call>]>,
) {
  unsubEvents = await watchAndHandleChainEvents(handlers);

  batchesTracker.promise = new Promise((resolve, reject) => {
    batchesTracker.resolve = resolve;
    batchesTracker.reject = reject;
    batchesTracker.numPending = 0;
  });

  let nonce = (await ExtrinsicHelper.apiPromise.query.system.account(provider.keypair.publicKey)).nonce.toNumber();

  while (extrinsics.length > 0) {
    if (batchesTracker.numPending < 100) {
      // so we don't DOS the node
      const xToPost = extrinsics.splice(0, maxBatch);
      batchesTracker.numPending += 1;
      // eslint-disable-next-line no-await-in-loop, no-plusplus
      const unsub = await batchAll(xToPost).signAndSend(provider.keypair, { nonce: nonce++ }, (x) => {
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

async function batchWithUtilityAndWaitForExtrinsics(
  provider: ChainUser,
  extrinsics: SubmittableExtrinsic<'promise', ISubmittableResult>[],
  handlers: ((eventRecord: FrameSystemEventRecord) => void)[],
) {
  return batchAndWaitForExtrinsics(provider, extrinsics, handlers, ExtrinsicHelper.apiPromise.tx.utility.batchAll);
}

async function batchWithCapacityAndWaitForExtrinsics(
  provider: ChainUser,
  extrinsics: SubmittableExtrinsic<'promise', ISubmittableResult>[],
  handlers: ((eventRecord: FrameSystemEventRecord) => void)[],
) {
  return batchAndWaitForExtrinsics(provider, extrinsics, handlers, ExtrinsicHelper.apiPromise.tx.frequencyTxPayment.payWithCapacityBatchAll);
}
