/*
 * Sample application showing how to initialize the environment
 * and do a basic chain operation.
 */
// Examples do not require all dependencies for examples
import { AddGraphKeyAction, AddKeyUpdate, ConnectAction, ConnectionType, DsnpKeys, EnvironmentType, Graph, KeyData, PrivacyType } from '@projectlibertylabs/graph-sdk';
import log from 'loglevel';
import { ItemizedStoragePageResponse, PaginatedStorageResponse } from '@frequency-chain/api-augment/interfaces';
import { hexToU8a } from '@polkadot/util';
import { Option } from '@polkadot/types';
import { PalletCapacityCapacityDetails } from '@polkadot/types/lookup';
import { devAccounts, ExtrinsicHelper, initialize, User, UserBuilder } from '../scaffolding';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function createConnection(from: User, to: User, schemaId: number, toKeys?: { keys: KeyData[]; keysHash: number }): ConnectAction {
  const connection = {
    type: 'Connect',
    ownerDsnpUserId: from.msaId.toString(),
    connection: {
      dsnpUserId: to.msaId.toString(),
      schemaId,
    },
  } as ConnectAction;

  if (toKeys) {
    connection.dsnpKeys = {
      dsnpUserId: to.msaId.toString(),
      keys: toKeys.keys,
      keysHash: toKeys.keysHash,
    } as DsnpKeys;
  }

  return connection;
}

const AMOUNT_TO_STAKE = 20000000000000n;

async function main() {
  // Connect to chain and initialize API
  await initialize();
  log.setLevel('trace');

  // Create MSAs and register a Provider
  const builder = new UserBuilder();
  const provider = await builder.withKeypair(devAccounts[5].keys).asProvider('FerdieNet').build();
  const capacityResult: Option<PalletCapacityCapacityDetails> = (await ExtrinsicHelper.apiPromise.query.capacity.capacityLedger(provider.providerId)) as any;
  const capacity = capacityResult.unwrapOr({ totalCapacityIssued: 0n });
  const stakeAmount = AMOUNT_TO_STAKE - (typeof capacity.totalCapacityIssued === 'bigint' ? capacity.totalCapacityIssued : capacity.totalCapacityIssued.toBigInt());
  await ExtrinsicHelper.stake(provider.keypair, provider.providerId, stakeAmount).signAndSend();

  const environment = { environmentType: EnvironmentType.Mainnet };
  const graph = new Graph(environment);
  const publicFollowIntentId = graph.getSchemaIdFromConfig(environment, ConnectionType.Follow, PrivacyType.Public);
  const privateFollowIntentId = graph.getSchemaIdFromConfig(environment, ConnectionType.Follow, PrivacyType.Private);
  const privateFriendIntentId = graph.getSchemaIdFromConfig(environment, ConnectionType.Friendship, PrivacyType.Private);
  const publicKeyIntentId = graph.getGraphConfig(environment).graphPublicKeySchemaId;

  const userBuilder = builder.withDelegation(provider, [publicFollowIntentId, privateFollowIntentId, privateFriendIntentId, publicKeyIntentId]);

  const users: User[] = [];
  const alice = await userBuilder.withKeypair(devAccounts[0].keys).build();
  users.push(alice);
  const bob = await userBuilder.withKeypair(devAccounts[1].keys).build();
  users.push(bob);
  const charlie = await userBuilder.withKeypair(devAccounts[2].keys).build();
  users.push(charlie);
  const dave = await userBuilder.withKeypair(devAccounts[3].keys).build();
  users.push(dave);
  const eve = await userBuilder.withKeypair(devAccounts[4].keys).build();
  users.push(eve);

  const a = ExtrinsicHelper.api.consts.frequencyTxPayment.maximumCapacityBatchLength;
  log.debug(`Max capacity batch: ${a}`);

  // Clear all users' graphs
  for (const user of users) {
    log.info(`Clearing existing graph for MSA ${user.msaId.toString()}`);

    // Fetch the user's public follow graph
    const pages = await ExtrinsicHelper.apiPromise.rpc.statefulStorage.getPaginatedStorage(user.msaId, publicFollowIntentId);

    const pageArray: PaginatedStorageResponse[] = pages.toArray();

    // Remove the whole graph
    const removals = pageArray.map((page) => ExtrinsicHelper.removePage(user.keypair, 1, user.msaId, page.page_id, page.content_hash).fundAndSend());

    await Promise.all(removals);
  }

  // Install public key(s)

  for (const user of users) {
    const itemizedPage: ItemizedStoragePageResponse = await ExtrinsicHelper.getItemizedStorage(user.msaId, publicKeyIntentId);
    if (itemizedPage.items.length > 0) {
      log.info(`Found an existing public graph key for user ${user.msaId.toString()}; skipping key install`);

      continue;
    }

    log.info(`Installing public Graph key for user ${user.msaId.toString()}`);
    const actions = [
      {
        type: 'AddGraphKey',
        ownerDsnpUserId: user.msaId.toString(),
        newPublicKey: hexToU8a('0xe3b18e1aa5c84175ec0c516838fb89dd9c947dd348fa38fe2082764bbc82a86f'),
      } as AddGraphKeyAction,
    ];
    graph.applyActions(actions);
    const keyExport = graph.exportUserGraphUpdates(user.msaId.toString());

    const promises = keyExport
      .filter((bundle) => bundle.type === 'AddKey')
      .map((bundle) => {
        const keyActions = [
          {
            Add: {
              data: Array.from((bundle as AddKeyUpdate).payload),
            },
          },
        ];
        return ExtrinsicHelper.applyItemActions(user.keypair, publicKeyIntentId, user.msaId, keyActions, 0).fundAndSend();
      });

    await Promise.all(promises);
  }

  /**
   *  Leave this here for reference, but really for testing reconnection-service
   *  we want all graphs to be initially empty on-chain, as that's how it'll be
   *  (at least while we still have a single provider, MeWe)

  // Connect everyone to everyone else
  // eslint-disable-next-line no-restricted-syntax
  for (const user of users) {
    log.info(`*****
Building new graph for user ${user.msaId.toString()}`);
    const actions: Action[] = [];
    users
      .filter((otherUser) => otherUser.msaId !== user.msaId)
      .forEach((otherUser) => {
        actions.push(createConnection(user, otherUser, schemaId));
      });
    log.info('Applying connections to graph');
    graph.applyActions(actions);

    // Export graph to chain
    log.info('Getting export bundles...');
    const exportBundles: Update[] = graph.exportUserGraphUpdates(user.msaId.toString());

    const promises: Promise<any>[] = [];
    exportBundles.forEach((bundle) => {
      let op: any;
      switch (bundle.type) {
        case 'PersistPage':
          op = ExtrinsicHelper.upsertPage(user.keypair, schemaId, user.msaId, bundle.pageId, Array.from(Array.prototype.slice.call(bundle.payload)), 0); // hash is zero because graphs have been deleted

          promises.push(op.fundAndSend());
          break;

        default:
          break;
      }
    });
    log.info('Writing graph updates to the chain');
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(promises);

    const bundleBuilder = new ImportBundleBuilder().withDsnpUserId(user.msaId.toString());
    let bb = bundleBuilder.withSchemaId(schemaId);

    // Import the user's keys
    // eslint-disable-next-line no-await-in-loop
    const publicKeys: ItemizedStoragePageResponse = await ExtrinsicHelper.getItemizedStorage(user.msaId, publicKeyIntentId);
    const keyData: KeyData[] = publicKeys.items.toArray().map((pk) => ({
      index: pk.index.toNumber(),
      content: hexToU8a(pk.payload.toHex()),
    }));
    const dsnpKeys: DsnpKeys = {
      dsnpUserId: user.msaId.toString(),
      keysHash: publicKeys.content_hash.toNumber(),
      keys: keyData,
    };
    bb = bb.withDsnpKeys(dsnpKeys);

    // Read the graph back in from the chain to verify
    // eslint-disable-next-line no-await-in-loop
    const pages = await ExtrinsicHelper.apiPromise.rpc.statefulStorage.getPaginatedStorage(user.msaId, schemaId);

    const pageArray = pages.toArray();

    pageArray.forEach((page) => {
      bb = bb.withPageData(page.page_id.toNumber(), page.payload, page.content_hash.toNumber());
    });

    log.info('Re-importing graph from the chain');
    const importBundle = bb.build();
    // log.debug(JSON.stringify(importBundle));

    graph.importUserData([importBundle]);
    const reExportedBundles = graph.exportUserGraphUpdates(user.msaId.toString());
    if (reExportedBundles.length > 0) {
      log.error(`State problem: re-export of imported graph for user ${user.msaId.toString()} should be empty, but it is not:
      ${JSON.stringify(reExportedBundles)}`);
    }
  }
  */
}

// Run the main program
main()
  .then(() => {})
  .catch((e) => log.log(e))
  .finally(async () => {
    await ExtrinsicHelper.disconnect();
  });
