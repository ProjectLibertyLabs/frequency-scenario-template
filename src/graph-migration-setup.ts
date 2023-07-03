/*
 * Sample application showing how to initialize the environment
 * and do a basic chain operation.
 */

import { SchemaId } from '@frequency-chain/api-augment/interfaces';
import { userPrivateConnections, userPrivateFollows, publicKey } from '@dsnp/frequency-schemas/dsnp';
import { ExtrinsicHelper } from './scaffolding/extrinsicHelpers.js';
import { initialize, devAccounts } from './scaffolding/helpers.js';
import { User } from './scaffolding/user';

let privateFriendSchemaId: SchemaId;
let privateFollowSchemaId: SchemaId;
let publicKeySchemaId: SchemaId;

async function main() {
  // Connect to chain & initialize API
  await initialize();

  // Create graph schemata
  let [schemaCreatedEvent] = await ExtrinsicHelper.createSchema(devAccounts[0].keys, userPrivateConnections, 'AvroBinary', 'Paginated').signAndSend();
  if (!ExtrinsicHelper.api.events.schemas.SchemaCreated.is(schemaCreatedEvent)) {
    throw new Error('graph schema not created');
  }
  privateFriendSchemaId = schemaCreatedEvent.data.schemaId;

  [schemaCreatedEvent] = await ExtrinsicHelper.createSchema(devAccounts[0].keys, userPrivateFollows, 'AvroBinary', 'Itemized').signAndSend();
  if (!ExtrinsicHelper.api.events.schemas.SchemaCreated.is(schemaCreatedEvent)) {
    throw new Error('graph key schema not created');
  }
  privateFollowSchemaId = schemaCreatedEvent.data.schemaId;

  [schemaCreatedEvent] = await ExtrinsicHelper.createSchema(devAccounts[0].keys, publicKey, 'AvroBinary', 'Itemized').signAndSend();
  if (!ExtrinsicHelper.api.events.schemas.SchemaCreated.is(schemaCreatedEvent)) {
    throw new Error('graph key schema not created');
  }
  publicKeySchemaId = schemaCreatedEvent.data.schemaId;

  // Create MSAs and register a Provider
  const alice = new User(devAccounts[0].keys);
  await alice.createMsa();
  const provider = new User(devAccounts[4].keys);
  await provider.createMsa();
  await provider.registerAsProvider('FerdieNet');

  // Perform Provider delegations
  await alice.grantDelegation(provider, [privateFollowSchemaId, privateFriendSchemaId, publicKeySchemaId]);
  console.log('foo');
}

// Run the main program
main()
  .then(() => {})
  .catch((e) => console.log(e))
  .finally(async () => {
    await ExtrinsicHelper.disconnect();
  });
