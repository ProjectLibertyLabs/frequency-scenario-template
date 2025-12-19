/*
 * Sample application showing how to initialize the environment
 * and do a basic chain operation.
 */

// Examples do not require all dependencies for examples
import {
  Config,
  ConnectionType,
  DsnpKeys,
  DsnpVersion,
  EnvironmentInterface,
  EnvironmentType,
  Graph,
  GraphKeyPair,
  GraphKeyType,
  ImportBundle,
  ImportBundleBuilder,
  KeyData,
  PrivacyType,
  SchemaConfig,
} from '@projectlibertylabs/graph-sdk';
import log from 'loglevel';
import {ItemizedStoragePageResponse, PaginatedStorageResponse} from '@frequency-chain/api-augment/interfaces';
import {hexToU8a} from '@polkadot/util';
import minimist from 'minimist';
import {ExtrinsicHelper, initialize, IntentBuilder} from '../scaffolding';

function getDevTestConfig(schemaMap: Record<number, SchemaConfig>, keySchemaId: number): Config {
  const config: Config = {} as Config;
  config.sdkMaxStaleFriendshipDays = 100;
  config.maxPageId = 100;
  config.dsnpVersions = [DsnpVersion.Version1_0];
  config.maxGraphPageSizeBytes = 100;
  config.maxKeyPageSizeBytes = 100;
  config.schemaMap = schemaMap;
  config.graphPublicKeySchemaId = keySchemaId;
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

  // For local chains with Frequency 1.10 or higher, or Testnet (Paseo or Rococo), we can look up the schemas using schema names
  const environmentType: string = EnvironmentType.Mainnet;
  let environment: EnvironmentInterface;

  if (environmentType === EnvironmentType.Dev) {
    const intentBuilder = new IntentBuilder().withAutoDetectExisting(true);
    const publicFollowIntent = await intentBuilder.withName('dsnp', 'public-follows').resolve();
    const privateFollowIntent = await intentBuilder.withName('dsnp', 'private-follows').resolve();
    const privateFriendIntent = await intentBuilder.withName('dsnp', 'private-connections').resolve();
    const publicKeyIntent = await intentBuilder.withName('dsnp', 'public-key-key-agreement').resolve();

    if (!publicFollowIntent || !privateFollowIntent || !privateFriendIntent || !publicKeyIntent) {
      throw new Error('Failed to resolve graph Intents');
    }

    const schemaMap: Record<number, SchemaConfig> = {};
    schemaMap[publicFollowIntent.id] = {
      dsnpVersion: DsnpVersion.Version1_0,
      connectionType: ConnectionType.Follow,
      privacyType: PrivacyType.Public,
    };
    schemaMap[privateFollowIntent.id] = {
      dsnpVersion: DsnpVersion.Version1_0,
      connectionType: ConnectionType.Follow,
      privacyType: PrivacyType.Private,
    };
    schemaMap[privateFriendIntent.id] = {
      dsnpVersion: DsnpVersion.Version1_0,
      connectionType: ConnectionType.Friendship,
      privacyType: PrivacyType.Private,
    };

    environment = { environmentType, config: getDevTestConfig(schemaMap, publicKeyIntent.id) } as EnvironmentInterface;
  } else {
    environment = { environmentType: environmentType as EnvironmentType };
  }
  const graph = new Graph(environment);

  const { schemaMap } = graph.getGraphConfig(environment);
  const publicKeySchemaId = graph.getGraphConfig(environment).graphPublicKeySchemaId;

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
  const publicKeys: ItemizedStoragePageResponse = await ExtrinsicHelper.apiPromise.rpc.statefulStorage.getItemizedStorage(msaId, publicKeySchemaId);
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
