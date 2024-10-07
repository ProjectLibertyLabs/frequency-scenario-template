/*
 * Setup code for Frequency Access testing. Creates an MSA for alice
 * and makes her a MeWe provider. Finally, it stakes a large amount
 */

import { ExtrinsicHelper } from '#app/scaffolding/extrinsicHelpers.js';
import { initialize, devAccounts, stakeToProvider } from '#app/scaffolding/helpers.js';
import { UserBuilder } from '#app/scaffolding/user-builder.js';

async function main() {
  // Connect to chain & initialize API
  await initialize();

  // Create alice account with msa and as provider "MeWe"
  // In other scripts the msa and provider will be picked
  // up from chain after this one is run
  const builder = new UserBuilder();
  const alice = await builder.withKeypair(devAccounts[0].keys).asProvider('MeWe').build();

  // Stake to provider alice
  await stakeToProvider(alice.keypair, alice.providerId!, 320000000n);
}

// Run the main program
main()
  .catch((e) => console.log(e))
  .finally(async () => {
    await ExtrinsicHelper.disconnect();
  });
