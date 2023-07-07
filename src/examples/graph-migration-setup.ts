/*
 * Sample application showing how to initialize the environment
 * and do a basic chain operation.
 */

import { userPrivateConnections, userPrivateFollows, publicKey, userPublicFollows } from '@dsnp/frequency-schemas/dsnp/index';
import {
  Config,
  SchemaConfig,
  DsnpVersion,
  Graph,
  DevEnvironment,
  Action,
  DsnpKeys,
  EnvironmentType,
  ConnectAction,
  Connection,
  ConnectionType,
  PrivacyType,
} from '@dsnp/graph-sdk';
import { firstValueFrom } from 'rxjs';
import * as log from 'npmlog';
import { ExtrinsicHelper } from '../scaffolding/extrinsicHelpers';
import { initialize, devAccounts } from '../scaffolding/helpers';
import { SchemaBuilder } from '../scaffolding/schema-builder';
import { UserBuilder } from '../scaffolding/user-builder';

function getTestConfig(schemaMap: { [key: number]: SchemaConfig }): Config {
  const config: Config = {} as Config;
  config.sdkMaxStaleFriendshipDays = 100;
  config.maxPageId = 100;
  config.dsnpVersions = [DsnpVersion.Version1_0];
  config.maxGraphPageSizeBytes = 100;
  config.maxKeyPageSizeBytes = 100;
  config.schemaMap = schemaMap;
  return config;
}

async function main() {
  // Connect to chain & initialize API
  await initialize();
  // log.level = 'verbose';

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

  const environment: DevEnvironment = { environmentType: EnvironmentType.Dev, config: getTestConfig(schemaMap) };
  const graph = new Graph(environment);

  // Fetch Alice's public follow graph
  const pages = await firstValueFrom(
    ExtrinsicHelper.api.rpc.statefulStorage.getPaginatedStorage(alice.msaId, graph.getSchemaIdFromConfig(environment, ConnectionType.Follow, PrivacyType.Public)),
  );

  const pageArray = pages.toArray();
  log.verbose(pageArray);
}

// Run the main program
main()
  .then(() => {})
  .catch((e) => console.log(e))
  .finally(async () => {
    await ExtrinsicHelper.disconnect();
  });
