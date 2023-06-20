/*
 * Sample application showing how to initialize the environment
 * and do a basic chain operation.
 */

import minimist from 'minimist';
import { mnemonicGenerate } from '@polkadot/util-crypto';
import { KeyringPair } from '@polkadot/keyring/types';
import { u64 } from '@polkadot/types';
import { Key } from '@polkadot/types/interfaces';
import { IsEvent } from '@polkadot/types/metadata/decorate/types';
import { AnyTuple } from '@polkadot/types/types';
import { ExtrinsicHelper } from './scaffolding/extrinsicHelpers';
import { initialize, getDefaultFundingSource, devAccounts } from './scaffolding/helpers';
import { createKeys } from './scaffolding/apiConnection';
import { AVRO_GRAPH_CHANGE } from './scaffolding/schemas/fixtures/avroGraphChangeSchemaType';

async function createMsa(keypair: KeyringPair): Promise<u64> {
  const op = ExtrinsicHelper.createMsa(keypair);
  const [createEvent] = await op.signAndSend();
  if (!ExtrinsicHelper.api.events.msa.MsaCreated.is(createEvent)) {
    throw new Error('Did not get MsaCreated event');
  }

  return createEvent.data.msaId;
}

async function delegateProvider

async function main() {
  // Connect to chain & initialize API
  await initialize();

  // Create graph schemata
  let [schemaCreatedEvent] = await ExtrinsicHelper.createSchema(devAccounts[0].keys, AVRO_GRAPH_CHANGE, 'AvroBinary', 'Paginated').signAndSend();
  if (!ExtrinsicHelper.api.events.schemas.SchemaCreated.is(schemaCreatedEvent)) {
    throw new Error('graph schema not created');
  }
  const graphSchemaId = schemaCreatedEvent.data.schemaId;

  [schemaCreatedEvent] = await ExtrinsicHelper.createSchema(devAccounts[0].keys, AVRO_GRAPH_CHANGE, 'AvroBinary', 'Itemized').signAndSend();
  if (!ExtrinsicHelper.api.events.schemas.SchemaCreated.is(schemaCreatedEvent)) {
    throw new Error('graph key schema not created');
  }
  const graphKeySchemaId = schemaCreatedEvent.data.schemaId;

  // Create MSAs and register a Provider
  const aliceMsaId = await createMsa(devAccounts[0].keys);
  const providerMsaId = await createMsa(devAccounts[4].keys); // Ferdie as Provider
  const [providerCreatedEvent] = await ExtrinsicHelper.createProvider(devAccounts[4].keys, 'FerdieNet').signAndSend();
  if (!ExtrinsicHelper.api.events.msa.ProviderCreated.is(providerCreatedEvent)) {
    throw new Error("provider not registered");
  }

  // Perform Provider delegations
  const [delegationEvent] = await ExtrinsicHelper.grantDelegation(devAccounts[0].keys, devAccounts[4].keys, signature, pay)

  // Extract any CLI arguments
  const argv = minimist(process.argv);
  const uri = argv?.seedPhrase ?? argv?.uri ?? getDefaultFundingSource().uri ?? mnemonicGenerate();
  console.log(`mnemonic/uri: ${uri}`);

  // Sample application logic: Get/create keypair and create MSA
  const keys = createKeys(uri);
  const op = ExtrinsicHelper.createMsa(keys);
  const [createEvent] = await op.signAndSend();
  if (!createEvent || !ExtrinsicHelper.api.events.msa.MsaCreated.is(createEvent)) {
    throw new Error('MSA not created');
  }
  console.log(`Created MSA ID ${createEvent.data.msaId.toString()}`);
}

// Run the main program
main()
  .catch((e) => console.log(e))
  .finally(async () => {
    await ExtrinsicHelper.disconnect();
  });
