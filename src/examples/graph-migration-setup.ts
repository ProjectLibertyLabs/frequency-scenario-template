/*
 * Sample application showing how to initialize the environment
 * and do a basic chain operation.
 */

import { userPrivateConnections, userPrivateFollows, publicKey, userPublicFollows } from '@dsnp/frequency-schemas/dsnp';
import {
  Config,
  SchemaConfig,
  DsnpVersion,
  Graph,
  DevEnvironment,
  DsnpKeys,
  EnvironmentType,
  ConnectAction,
  ConnectionType,
  PrivacyType,
  ImportBundleBuilder,
  Update,
  KeyData,
} from '@dsnp/graph-sdk';
import { firstValueFrom } from 'rxjs';
import log from 'loglevel';
import { PaginatedStorageResponse, SchemaId } from '@frequency-chain/api-augment/interfaces';
import { User } from '#app/scaffolding/user';
import { assert } from '@polkadot/util';
import { ExtrinsicHelper } from '../scaffolding/extrinsicHelpers';
import { initialize, devAccounts } from '../scaffolding/helpers';
import { SchemaBuilder } from '../scaffolding/schema-builder';
import { UserBuilder } from '../scaffolding/user-builder';

function getTestConfig(schemaMap: { [key: number]: SchemaConfig }, keySchemaId: SchemaId): Config {
  const config: Config = {} as Config;
  config.sdkMaxStaleFriendshipDays = 100;
  config.maxPageId = 100;
  config.dsnpVersions = [DsnpVersion.Version1_0];
  config.maxGraphPageSizeBytes = 100;
  config.maxKeyPageSizeBytes = 100;
  config.schemaMap = schemaMap;
  config.graphPublicKeySchemaId = keySchemaId.toNumber();
  return config;
}

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

async function main() {
  // Connect to chain & initialize API
  await initialize();
  log.setLevel('trace');

  // Create graph schemata
  const schemaBuilder = new SchemaBuilder().withModelType('AvroBinary').withPayloadLocation('Paginated').withAutoDetectExistingSchema();
  const publicFollowSchema = await schemaBuilder.withModel({ ...userPublicFollows, doc: 'Public follow schema' }).build(devAccounts[0].keys);
  const publicFriendSchema = await schemaBuilder.withModel({ ...userPublicFollows, doc: 'Public friend schema' }).build(devAccounts[0].keys);
  const privateFollowSchema = await schemaBuilder.withModel(userPrivateFollows).build(devAccounts[0].keys);
  const privateFriendSchema = await schemaBuilder.withModel(userPrivateConnections).build(devAccounts[0].keys);
  const publicKeySchema = await schemaBuilder.withPayloadLocation('Itemized').withModel(publicKey).withSetting('AppendOnly').build(devAccounts[0].keys);

  // Create MSAs and register a Provider
  const builder = new UserBuilder();
  const provider = await builder.withKeypair(devAccounts[5].keys).asProvider('FerdieNet').build();

  const userBuilder = builder.withDelegation(provider, [publicFollowSchema.id, privateFollowSchema.id, privateFriendSchema.id, publicKeySchema.id]);

  const alice = await userBuilder.withKeypair(devAccounts[0].keys).build();
  const bob = await userBuilder.withKeypair(devAccounts[1].keys).build();
  const charlie = await userBuilder.withKeypair(devAccounts[2].keys).build();
  const dave = await userBuilder.withKeypair(devAccounts[3].keys).build();
  const eve = await userBuilder.withKeypair(devAccounts[4].keys).build();

  log.info(`
  Follow(Public) Schema ID: ${publicFollowSchema.id.toNumber()}
  Friendship(Public) Schema ID: ${publicFriendSchema.id.toNumber()}
  Follow(Private) Schema ID: ${privateFollowSchema.id.toNumber()}
  Friendship(Private) Schema ID: ${privateFriendSchema.id.toNumber()}
  DSNP Key Schema ID: ${publicKeySchema.id.toNumber()}

  User (Alice) MSA ID: ${alice.msaId.toString()}
  User (Bob) MSA ID: ${bob.msaId.toString()}
  User (Charlie) MSA ID: ${charlie.msaId.toString()}
  User (Dave) MSA ID: ${dave.msaId.toString()}
  User (Eve) MSA ID: ${eve.msaId.toString()}
  Provider (Ferdie) ID: ${provider.providerId?.toString()}
  `);

  const schemaMap: { [key: number]: SchemaConfig } = {};
  schemaMap[publicFollowSchema.id.toNumber()] = {
    dsnpVersion: DsnpVersion.Version1_0,
    connectionType: ConnectionType.Follow,
    privacyType: PrivacyType.Public,
  };
  schemaMap[publicFriendSchema.id.toNumber()] = {
    dsnpVersion: DsnpVersion.Version1_0,
    connectionType: ConnectionType.Friendship,
    privacyType: PrivacyType.Public,
  };
  schemaMap[privateFollowSchema.id.toNumber()] = {
    dsnpVersion: DsnpVersion.Version1_0,
    connectionType: ConnectionType.Follow,
    privacyType: PrivacyType.Private,
  };
  schemaMap[privateFriendSchema.id.toNumber()] = {
    dsnpVersion: DsnpVersion.Version1_0,
    connectionType: ConnectionType.Friendship,
    privacyType: PrivacyType.Private,
  };
  const a = ExtrinsicHelper.api.consts.frequencyTxPayment.maximumCapacityBatchLength;
  console.log(`Max capacity batch: ${a}`);
  const environment: DevEnvironment = { environmentType: EnvironmentType.Dev, config: getTestConfig(schemaMap, publicKeySchema.id) };
  const graph = new Graph(environment);

  // Fetch Alice's public follow graph
  log.debug('Retrieving graph from chain');
  const schemaId = await graph.getSchemaIdFromConfig(environment, ConnectionType.Follow, PrivacyType.Public);
  let pages = await firstValueFrom(ExtrinsicHelper.api.rpc.statefulStorage.getPaginatedStorage(alice.msaId, schemaId));

  let pageArray: PaginatedStorageResponse[] = pages.toArray();

  const actions: ConnectAction[] = [];

  // Remove the whole graph
  log.info('Removing all pages from graph');
  const removals = pageArray.map((page) => ExtrinsicHelper.removePage(alice.keypair, 1, alice.msaId, page.page_id, page.content_hash).fundAndSend());
  await Promise.all(removals);

  // Add connections
  [bob, charlie, dave, eve].forEach((user) => {
    actions.push(createConnection(alice, user, schemaId));
  });
  log.info('Applying connections to graph');
  await graph.applyActions(actions);

  // Export graph to chain
  log.info('Getting export bundles...');
  const exportBundles: Update[] = await graph.exportUpdates();

  const promises: Promise<any>[] = [];
  exportBundles.forEach((bundle) => {
    let op: any;
    switch (bundle.type) {
      case 'PersistPage':
        op = ExtrinsicHelper.upsertPage(alice.keypair, schemaId, alice.msaId, bundle.pageId, Array.from(Array.prototype.slice.call(bundle.payload)), 0); // hash is zero because graphs have been deleted

        promises.push(op.fundAndSend());
        break;

      default:
        break;
    }
  });
  log.info('Writing graph updates to the chain');
  await Promise.all(promises);

  // Read the graph back in from the chain to verify
  pages = await firstValueFrom(ExtrinsicHelper.api.rpc.statefulStorage.getPaginatedStorage(alice.msaId, schemaId));

  pageArray = pages.toArray();

  const bundleBuilder = new ImportBundleBuilder().withDsnpUserId(alice.msaId.toString());
  let bb = bundleBuilder.withSchemaId(schemaId);
  pageArray.forEach((page) => {
    bb = bb.withPageData(page.page_id.toNumber(), page.payload, page.content_hash.toNumber());
  });

  log.info('Re-importing graph from chain');
  const importBundle = bb.build();
  log.debug(JSON.stringify(importBundle));

  await graph.importUserData([importBundle]);
  const reExportedBundles = await graph.exportUpdates();
  assert(reExportedBundles.length === 0, 'Export of re-imported graph should be empty as there should be no changes');
}

// Run the main program
main()
  .then(() => {})
  .catch((e) => console.log(e))
  .finally(async () => {
    await ExtrinsicHelper.disconnect();
  });
