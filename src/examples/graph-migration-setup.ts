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
  AddGraphKeyAction,
  GraphKeyType,
  GraphKeyPair,
} from '@dsnp/graph-sdk';
import { firstValueFrom, from } from 'rxjs';
import log from 'loglevel';
import { ItemizedStoragePageResponse, ItemizedStorageResponse, MessageSourceId, PageHash, PaginatedStorageResponse, SchemaId } from '@frequency-chain/api-augment/interfaces';
import { User } from '#app/scaffolding/user';
import { assert, hexToU8a, stringToHex, stringToU8a, u8aToHex } from '@polkadot/util';
import { ExtrinsicHelper } from '../scaffolding/extrinsicHelpers';
import { initialize, devAccounts } from '../scaffolding/helpers';
import { SchemaBuilder } from '../scaffolding/schema-builder';
import { UserBuilder } from '../scaffolding/user-builder';
import {Bytes, Compact, u16, u32, u64, u8, UInt, Vec} from '@polkadot/types';
import {INumber} from "@polkadot/types-codec/types";

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

function createGraphKey(to: User, key: Uint8Array): AddGraphKeyAction {
  // const connection = {
  //   type: 'Connect',
  //   ownerDsnpUserId: from.msaId.toString(),
  //   connection: {
  //     dsnpUserId: to.msaId.toString(),
  //     schemaId,
  //   },
  // } as ConnectAction;

  // if (toKeys) {
  //   connection.dsnpKeys = {
  //     dsnpUserId: to.msaId.toString(),
  //     keys: toKeys.keys,
  //     keysHash: toKeys.keysHash,
  //   } as DsnpKeys;
  // }
  const connection: AddGraphKeyAction = {
    type: 'AddGraphKey',
    ownerDsnpUserId: to.msaId.toString(),
    newPublicKey: key,
  } as AddGraphKeyAction;
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

  // lets generaye some keys for each user using sdk
  let privateKeyGraph = await Graph.generateKeyPair(GraphKeyType.X25519);
  console.log(`Private Key: ${u8aToHex(privateKeyGraph.secretKey)}`);
  console.log(`Public Key: ${u8aToHex(privateKeyGraph.publicKey)}`);

  log.info('Starting graph migration test');
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
  const schemaId = await graph.getSchemaIdFromConfig(environment, ConnectionType.Follow, PrivacyType.Private);
  let pages = await firstValueFrom(ExtrinsicHelper.api.rpc.statefulStorage.getPaginatedStorage(alice.msaId, schemaId));

  let pageArray: PaginatedStorageResponse[] = pages.toArray();

  const actions: AddGraphKeyAction[] = [];

  // Remove the whole graph
  log.info('Removing all pages from graph');
  const removals = pageArray.map((page) => ExtrinsicHelper.removePage(alice.keypair, 1, alice.msaId, page.page_id, page.content_hash).fundAndSend());
  await Promise.all(removals);

  // Add connections
  [alice/*, bob, charlie, dave, eve*/].forEach((user) => {
    actions.push(createGraphKey(user, privateKeyGraph.publicKey));
  });
  log.info('Applying connections to graph');
  await graph.applyActions(actions);

  // Export graph to chain
  log.info('Getting export bundles...');
  const exportBundles: Update[] = await graph.exportUpdates();
  console.log(`Export bundles: ${JSON.stringify(exportBundles)}`);
  const promises: Promise<any>[] = [];
  exportBundles.forEach((bundle) => {
    let op: any;
    switch (bundle.type) {
      case 'PersistPage':
        op = ExtrinsicHelper.upsertPage(alice.keypair, schemaId, alice.msaId, bundle.pageId, Array.from(Array.prototype.slice.call(bundle.payload)), 0); // hash is zero because graphs have been deleted

        promises.push(op.fundAndSend());
        break;

      case 'AddKey':
        let compactMsaId = ExtrinsicHelper.api.registry.createType('Compact<u64>', bundle.ownerDsnpUserId) as Compact<u64>;
        let target_hash = ExtrinsicHelper.api.registry.createType('Compact<u32>', bundle.prevHash) as Compact<u32>;
        let keySchemaId = ExtrinsicHelper.api.registry.createType('Compact<u16>', publicKeySchema.id) as Compact<u16>;
        let add_actions_1 = {
          "Add": {
            "data" : Array.from(bundle.payload)
          }
        };
        let itemized_add_result_1 = ExtrinsicHelper.applyItemActions(provider.keypair, keySchemaId, compactMsaId, [add_actions_1], target_hash);
        promises.push(itemized_add_result_1.fundAndSend());
      default:
        break;
    }
  });
  log.info('Writing graph updates to the chain');
  await Promise.all(promises);
  return;
  let results = await firstValueFrom(ExtrinsicHelper.api.rpc.statefulStorage.getItemizedStorage(alice.msaId, publicKeySchema.id));
  //loop over results.items and get the payload bytes and check if it makes public key
  let payload = results.items[0].payload;
  let het_tou8 = hexToU8a(payload.toString());
  console.log(`Itemized Storage: ${results.items[0].payload}`);
  console.log(`Payload: ${het_tou8}`);
  //console.log(`Payload_1: ${payload_1}`);
  console.log(`Public Key: ${alice.keypair.publicKey}`);
  // check if payload is equal to alice's public key
  assert(alice.keypair.publicKey.toString() === het_tou8.toString(), 'Payloads do not match');
  log.info('Public key is stored correctly');
  return;
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

export async function getCurrentItemizedHash(msa_id: MessageSourceId, schemaId: u16): Promise<PageHash> {
  const result = await ExtrinsicHelper.getItemizedStorage(msa_id, schemaId);
  return result.content_hash;
}

// Run the main program
main()
  .then(() => {})
  .catch((e) => console.log(e))
  .finally(async () => {
    await ExtrinsicHelper.disconnect();
  });
