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
  GraphKeyPair,
  GraphKeyType,
} from '@dsnp/graph-sdk';
import { firstValueFrom } from 'rxjs';
import log, { enableAll } from 'loglevel';
import { ItemizedStoragePageResponse, PaginatedStorageResponse, SchemaId } from '@frequency-chain/api-augment/interfaces';
import { User } from '#app/scaffolding/user';
import { assert, hexToU8a } from '@polkadot/util';
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
  const argv = minimist(process.argv, { string: ['publicGraphKeyHex', 'privateGraphKeyHex', 'msaId'] });
  const { msaId, publicGraphKeyHex, privateGraphKeyHex } = argv;

  // Connect to chain & initialize API
  await initialize();
  log.setLevel('trace');

  // Get graph schema IDs
  const schemaBuilder = new SchemaBuilder().withModelType('AvroBinary').withPayloadLocation('Paginated').withAutoDetectExistingSchema();
  const publicFollowSchema = await schemaBuilder
    .withNamedVersion('dsnp.public-follows', 1)
    .withModel({ ...userPublicFollows, doc: 'Public follow schema' })
    .build(devAccounts[0].keys);
  // const publicFriendSchema = await schemaBuilder
  //   .withNamedVersion('dsnp.public-connections', 1)
  //   .withModel({ ...userPublicFollows, doc: 'Public friend schema' })
  //   .build(devAccounts[0].keys);
  const privateFollowSchema = await schemaBuilder.withNamedVersion('dsnp.private-follows', 1).withModel(userPrivateFollows).build(devAccounts[0].keys);
  const privateFriendSchema = await schemaBuilder.withNamedVersion('dsnp.private-connections', 1).withModel(userPrivateConnections).build(devAccounts[0].keys);
  const publicKeySchema = await schemaBuilder
    .withNamedVersion('dsnp.public-key-key-agreement', 1)
    .withPayloadLocation('Itemized')
    .withModel(publicKey)
    .withSetting('AppendOnly')
    .build(devAccounts[0].keys);

  const schemaMap: { [key: number]: SchemaConfig } = {};
  schemaMap[publicFollowSchema.id.toNumber()] = {
    dsnpVersion: DsnpVersion.Version1_0,
    connectionType: ConnectionType.Follow,
    privacyType: PrivacyType.Public,
  };
  // schemaMap[publicFriendSchema.id.toNumber()] = {
  //   dsnpVersion: DsnpVersion.Version1_0,
  //   connectionType: ConnectionType.Friendship,
  //   privacyType: PrivacyType.Public,
  // };
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
  // const environment: DevEnvironment = { environmentType: EnvironmentType.Dev, config: getTestConfig(schemaMap, publicKeySchema.id) };
  const environment = { environmentType: EnvironmentType.Mainnet };
  const graph = new Graph(environment);

  // Fetch graphs
  let bundleBuilder = new ImportBundleBuilder().withDsnpUserId(msaId.toString());
  const bundles: ImportBundle[] = [];

  // Construct graph keys
  if (!!publicGraphKeyHex && !!privateGraphKeyHex) {
    const graphKeyPairsSdk: GraphKeyPair = {
      keyType: GraphKeyType.X25519,
      publicKey: hexToU8a(publicGraphKeyHex),
      secretKey: hexToU8a(privateGraphKeyHex),
    };
    bundleBuilder = bundleBuilder.withGraphKeyPairs([graphKeyPairsSdk]);
  }

  // Fetch public key from chain
  const publicKeys: ItemizedStoragePageResponse = await ExtrinsicHelper.apiPromise.rpc.statefulStorage.getItemizedStorage(msaId, publicKeySchema.id);
  const keyData: KeyData[] = publicKeys.items.toArray().map((chainKey) => ({
    index: chainKey.index.toNumber(),
    content: hexToU8a(chainKey.payload.toHex()),
  }));
  const dsnpKeys: DsnpKeys = {
    dsnpUserId: msaId,
    keysHash: publicKeys.content_hash.toNumber(),
    keys: keyData,
  };
  bundleBuilder = bundleBuilder.withDsnpKeys(dsnpKeys);

  // eslint-disable-next-line guard-for-in,no-restricted-syntax
  for (const schemaId in schemaMap) {
    const pages = await ExtrinsicHelper.apiPromise.rpc.statefulStorage.getPaginatedStorage(msaId, schemaId);
    const pageArray: PaginatedStorageResponse[] = pages.toArray();

    if (pageArray.length > 0) {
      let bb = bundleBuilder.withSchemaId(parseInt(schemaId, 10));
      pageArray.forEach((page) => {
        bb = bb.withPageData(page.page_id.toNumber(), page.payload, page.content_hash.toNumber());
      });
      bundles.push(bb.build());
    }
  }

  graph.importUserData(bundles);

  log.info(`
  Graph for MSA ${msaId}:
  `);
  // eslint-disable-next-line guard-for-in,no-restricted-syntax
  for (const schemaId in schemaMap) {
    const { connectionType, privacyType } = schemaMap[schemaId];
    const connections = graph.getConnectionsForUserGraph(msaId.toString(), parseInt(schemaId, 10), true);
    log.info(`${connectionType}(${privacyType}) => (${connections.length}) ${JSON.stringify(connections.map((connection) => connection.userId))}`);
  }
}

// Run the main program
main()
  .then(() => {})
  .catch((e) => console.log(e))
  .finally(async () => {
    await ExtrinsicHelper.disconnect();
  });
