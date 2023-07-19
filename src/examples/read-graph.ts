/* eslint-disable no-await-in-loop */
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
  ImportBundle,
} from '@dsnp/graph-sdk';
import { firstValueFrom } from 'rxjs';
import log from 'loglevel';
import { PaginatedStorageResponse, SchemaId } from '@frequency-chain/api-augment/interfaces';
import { User } from '#app/scaffolding/user';
import { assert } from '@polkadot/util';
import { Option } from '@polkadot/types';
import { PalletCapacityCapacityDetails } from '@polkadot/types/lookup';
import minimist from 'minimist';
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

async function main() {
  // Extract any CLI arguments
  const argv = minimist(process.argv);
  const { msaId } = argv;

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
  const environment: DevEnvironment = { environmentType: EnvironmentType.Dev, config: getTestConfig(schemaMap, publicKeySchema.id) };
  const graph = new Graph(environment);

  // Fetch graphs
  const bundleBuilder = new ImportBundleBuilder().withDsnpUserId(msaId.toString());
  const bundles: ImportBundle[] = [];

  // eslint-disable-next-line guard-for-in,no-restricted-syntax
  for (const schemaId in schemaMap) {
    const pages = await ExtrinsicHelper.apiPromise.rpc.statefulStorage.getPaginatedStorage(msaId, schemaId);
    const pageArray: PaginatedStorageResponse[] = pages.toArray();

    let bb = bundleBuilder.withSchemaId(parseInt(schemaId, 10));
    pageArray.forEach((page) => {
      bb = bb.withPageData(page.page_id.toNumber(), page.payload, page.content_hash.toNumber());
    });
    bundles.push(bb.build());
  }

  await graph.importUserData(bundles);

  log.info(`
  Graph for MSA ${msaId}:
  `);
  // eslint-disable-next-line guard-for-in,no-restricted-syntax
  for (const schemaId in schemaMap) {
    const { connectionType, privacyType } = schemaMap[schemaId];
    const connections = await graph.getConnectionsForUserGraph(msaId.toString(), parseInt(schemaId, 10), false);
    log.info(`${connectionType}(${privacyType}) => ${JSON.stringify(connections.map((connection) => connection.userId))}`);
  }
}

// Run the main program
main()
  .then(() => {})
  .catch((e) => console.log(e))
  .finally(async () => {
    await ExtrinsicHelper.disconnect();
  });
