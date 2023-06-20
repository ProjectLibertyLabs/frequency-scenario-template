/*
 * Sample application showing how to initialize the environment
 * and do a basic chain operation.
 */

import minimist from 'minimist';
import { mnemonicGenerate } from '@polkadot/util-crypto';
import { ExtrinsicHelper } from './scaffolding/extrinsicHelpers';
import { initialize, getDefaultFundingSource } from './scaffolding/helpers';
import { createKeys } from './scaffolding/apiConnection';

async function main() {
  // Connect to chain & initialize API
  await initialize();

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
