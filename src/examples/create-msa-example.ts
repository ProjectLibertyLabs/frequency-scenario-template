/*
 * Sample application showing how to initialize the environment
 * and do a basic chain operation.
 */

import minimist from 'minimist';
import { mnemonicGenerate } from '@polkadot/util-crypto';
import * as log from 'npmlog';
import { ExtrinsicHelper } from '../scaffolding/extrinsicHelpers';
import { initialize, getDefaultFundingSource } from '../scaffolding/helpers';
import { UserBuilder } from '../scaffolding/user-builder';

async function main() {
  // Connect to chain & initialize API
  await initialize();

  // Extract any CLI arguments
  const argv = minimist(process.argv);
  const uri = argv?.uri ?? mnemonicGenerate();
  log.info(`Generating user for URI: ${uri}`);

  // Sample application logic: Get/create keypair and create MSA
  const builder = new UserBuilder();
  const provider = await builder.withKeyUri(`${uri}//0`).withFundingSource(getDefaultFundingSource().keys).asProvider('Test Provider').build();
  // const user = await builder.withKeyUri(`${uri}//1`).withFundingSource(getDefaultFundingSource().keys).withInitialFundingLevel(20000000n).build();
  const user = await builder.withKeyUri(`${uri}`).build();
  await user.stakeToProvider(provider.providerId!, 7000000n);
}

// Run the main program
main()
  .catch((e) => console.log(e))
  .finally(async () => {
    await ExtrinsicHelper.disconnect();
  });
