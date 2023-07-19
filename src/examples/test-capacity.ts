/*
 * Sample application showing how to initialize the environment
 * and do a basic chain operation.
 */

import { UserBuilder } from '#app/scaffolding/user-builder';
import { ExtrinsicHelper } from '../scaffolding/extrinsicHelpers';
import { devAccounts, initialize, stakeToProvider } from '../scaffolding/helpers';

async function main() {
  // Connect to chain & initialize API
  await initialize();

  const builder = new UserBuilder();

  const alice = await builder
    .withKeypair(devAccounts[0].keys)
    .asProvider("ABC")
    .build();

  await stakeToProvider(alice.keypair, alice.providerId!, 320000000n);

  // Use staked Capacity to claim a user handle
  await alice.claimHandleUsingCapacity("MyNameIsAliceToo");
  console.log(`Claimed handle ${alice.handle}`);
}

// Run the main program
main()
  .catch((e) => console.log(e))
  .finally(async () => {
    await ExtrinsicHelper.disconnect();
  });
 