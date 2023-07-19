/*
 * Sample application showing how to initialize the environment
 * and do a basic chain operation.
 */

import minimist from 'minimist';
import { mnemonicGenerate } from '@polkadot/util-crypto';
import { ExtrinsicHelper } from './scaffolding/extrinsicHelpers';
import { initialize, getDefaultFundingSource, stakeToProvider } from './scaffolding/helpers';
import { createKeys } from './scaffolding/apiConnection';
import { User } from './scaffolding/user';

async function main() {
  // Connect to chain & initialize API
  await initialize();

  // Extract any CLI arguments
  const argv = minimist(process.argv);
  const uri = argv?.seedPhrase ?? argv?.uri ?? getDefaultFundingSource().uri ?? mnemonicGenerate();
  console.log(`mnemonic/uri: ${uri}`);

  // Sample application logic: Get/create keypair and create MSA
  const keys = createKeys(uri);
  const user = new User(keys);

  await user.createMsa();
  console.log(`Created MSA ID ${user.msaId.toString()}`);
  
  await user.registerAsProvider("ABC");

  await stakeToProvider(keys, user.providerId, 320000000n);

  // Use staked Capacity to claim a user handle
  await user.claimHandleUsingCapacity("MyNameIsAlice");
  console.log(`Claimed handle ${user.handle}`);
}

// Run the main program
main()
  .catch((e) => console.log(e))
  .finally(async () => {
    await ExtrinsicHelper.disconnect();
  });
 