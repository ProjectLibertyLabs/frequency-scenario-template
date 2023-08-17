/*
 * Sample application showing how to initialize the environment
 * and do a basic chain operation.
 */

import log from 'loglevel';
import { User } from '#app/scaffolding/user';
import { ExtrinsicHelper } from '../scaffolding/extrinsicHelpers';
import { initialize, devAccounts } from '../scaffolding/helpers';
import { UserBuilder } from '../scaffolding/user-builder';

async function main() {
  // Connect to chain & initialize API
  await initialize();
  log.setLevel('trace');

  // Register Ferdie as the provider "FerdieNet"
  const builder = new UserBuilder();
  const provider = await builder.withKeypair(devAccounts[5].keys).asProvider('FerdieNet').build();

  const userBuilder = builder.withDelegation(provider, []);

  const users: User[] = [];

  // Alice, Bob and Charlie have "FerdieNet" as their provider
  const alice = await userBuilder.withKeypair(devAccounts[0].keys).build();
  users.push(alice);
  const bob = await userBuilder.withKeypair(devAccounts[1].keys).build();
  users.push(bob);
  const charlie = await userBuilder.withKeypair(devAccounts[2].keys).build();
  users.push(charlie);

  // Dave and Eve do not have a provider
  const dave = await builder.withKeypair(devAccounts[3].keys).build();
  users.push(dave);
  const eve = await builder.withKeypair(devAccounts[4].keys).build();
  users.push(eve);

  log.info(`
  Provider (Ferdie) ID: ${provider.providerId?.toString()}

  User (Alice) MSA ID: ${alice.msaId.toString()}
  User (Bob) MSA ID: ${bob.msaId.toString()}
  User (Charlie) MSA ID: ${charlie.msaId.toString()}
  User (Dave) MSA ID: ${dave.msaId.toString()}
  User (Eve) MSA ID: ${eve.msaId.toString()}
  `);

  // Verify delegations
  // eslint-disable-next-line no-restricted-syntax
  for (const user of users) {
    // eslint-disable-next-line no-await-in-loop
    const delegation = await ExtrinsicHelper.apiPromise.query.msa.delegatorAndProviderToDelegation(user.msaId, provider.msaId);
    if (delegation.isSome) {
      log.info(`User ${user.msaId.toString()} is delegated to provider ${provider.msaId.toString()}`);
    } else {
      log.info(`User ${user.msaId.toString()} is NOT delegated`);
    }
  }
}

// Run the main program
main()
  .then(() => {})
  .catch((e) => log.log(e))
  .finally(async () => {
    await ExtrinsicHelper.disconnect();
  });
