/*
 * Sample application showing how to initialize the environment
 * and do a basic chain operation.
 */

import { userPrivateConnections, userPrivateFollows, publicKey, userPublicFollows } from '@dsnp/frequency-schemas/dsnp/index';
import { ExtrinsicHelper } from './scaffolding/extrinsicHelpers';
import { initialize, devAccounts } from './scaffolding/helpers';
import { SchemaBuilder } from './scaffolding/schema-builder';
import { UserBuilder } from './scaffolding/user-builder';

async function main() {
  // Connect to chain & initialize API
  await initialize();

  // Create graph schemata
  const schemaBuilder = new SchemaBuilder().withModelType('AvroBinary').withPayloadLocation('Paginated');
  const publicFollowSchema = await schemaBuilder.withModel(userPublicFollows).build(devAccounts[0].keys);
  const privateFollowSchema = await schemaBuilder.withModel(userPrivateFollows).build(devAccounts[0].keys);
  const privateFriendSchema = await schemaBuilder.withModel(userPrivateConnections).build(devAccounts[0].keys);
  const publicKeySchema = await schemaBuilder.withPayloadLocation('Itemized').withModel(publicKey).build(devAccounts[0].keys);

  // Create MSAs and register a Provider
  const builder = new UserBuilder();
  const provider = await builder.withKeypair(devAccounts[4].keys).asProvider('FerdieNet').build();

  const alice = await builder
    .withKeypair(devAccounts[0].keys)
    .withDelegation(provider, [publicFollowSchema.id, privateFollowSchema.id, privateFriendSchema.id, publicKeySchema.id])
    .build();

  console.log(`
  Public Graph Schema ID: ${publicFollowSchema.id.toNumber()}
  Follow(Private) Schema ID: ${privateFollowSchema.id.toNumber()}
  Friendship(Private) Schema ID: ${privateFriendSchema.id.toNumber()}

  User (Alice) MSA ID: ${alice.msaId.toString()}
  Provider (Ferdie) ID: ${provider.providerId.toString()}
  `);
}

// Run the main program
main()
  .then(() => {})
  .catch((e) => console.log(e))
  .finally(async () => {
    await ExtrinsicHelper.disconnect();
  });
