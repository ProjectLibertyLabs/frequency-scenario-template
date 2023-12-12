/*
 * Sample application showing how to initialize the environment
 * and do a basic chain operation.
 */

import { User } from '#app/scaffolding/user';
import { UserBuilder } from '#app/scaffolding/user-builder';
import { ExtrinsicHelper } from '../scaffolding/extrinsicHelpers';
import { createKeys, devAccounts, getBlockNumber, initialize, stakeToProvider } from '../scaffolding/helpers';

const firstNames = [
  'Emma', 'Liam', 'Olivia', 'Noah', 'Ava', 'Isabella', 'Sophia', 'Jackson', 'Lucas', 'Aiden',
  'Mia', 'Oliver', 'Amelia', 'Evelyn', 'Elijah', 'Harper', 'Benjamin', 'Ethan', 'Abigail', 'Emily',
  'Alexander', 'James', 'Scarlett', 'Sebastian', 'Aria', 'Avery', 'Ella', 'Ellie', 'Grace',
  'Julian', 'Matthew', 'Samuel', 'David', 'Joseph', 'Victoria', 'Gabriel', 'Madison', 'Zoe',
  'Chloe', 'Penelope', 'Lily', 'Hannah', 'Layla', 'Nathan', 'Lucy', 'Isaac', 'Eva',
  'Christopher', 'Andrew', 'Aaliyah', 'Sofia', 'Daniel', 'Wyatt', 'Natalie', 'Bella', 'Zachary',
  'Leo', 'Aubrey', 'Camila', 'Peyton', 'Eli', 'Riley', 'Hazel', 'Sophie', 'Annabelle',
  'Claire', 'Jordan', 'Julia', 'Landon', 'Mason', 'Sophie', 'Annabelle', 'Claire', 'Jordan',
  'Julia', 'Landon', 'Caleb', 'Aria', 'Carter', 'Ariana', 'Elena', 'Xavier', 'Naomi', 'Jaxon',
  'Zara', 'Nora', 'Ezra', 'Ruby', 'Isaiah', 'Alice', 'Eva', 'Kai', 'Quinn', 'Mila'
];

function randomName(): string {
  const name = firstNames[Math.floor(Math.random() * firstNames.length)];
  return name;
}

async function incrementBlock() {
  let blockNumber = await getBlockNumber();
  console.log(`Incrementing block number: ${blockNumber} to ${blockNumber + 1}`);
  await ExtrinsicHelper.run_to_block(blockNumber + 1);
}

async function createProvider(providerName: string) : Promise<User> {
  const builder = new UserBuilder();
  const keypair = createKeys();
  const provider = await builder
  .withKeypair(keypair)
  .asProvider(providerName)
  .build();
  
  return provider
}

async function createUserForProvider(provider: User) : Promise<void> {
  console.log(`Creating user for provider ${provider.providerName}`);
  const userName = randomName();
  const keypair = createKeys();
  const builder = new UserBuilder();
  const userBuilder = builder.withDelegation(provider, []);
  
  const user = await userBuilder.withKeypair(keypair).build();
  await user.claimHandleUsingCapacity(provider.keypair, userName);
  console.log(`Created user ${userName} with id ${user.msaId} and handle ${user.handle}`);
  await incrementBlock
}

async function createProviders(num: number) : Promise<void> {
  const aliceKeyPair = devAccounts[0].keys;
  const minStakingAmount = await ExtrinsicHelper.apiPromise.consts.capacity.minimumStakingAmount;
  console.log(`Minimum staking amount is ${minStakingAmount.toBigInt()}`);

  for (let i = 0; i < num; i++) {
    const provider = await createProvider(randomName());

    // Stake some tokens to the provider
    console.log(`Staking tokens to provider ${provider.providerName}`);
    const tokensToStake: bigint = minStakingAmount.toBigInt() + BigInt(Math.floor(Math.random() * 3000000000));
    await stakeToProvider(aliceKeyPair, provider.providerId!, tokensToStake);
    console.log(`Created provider ${provider.providerName} with id ${provider.providerId} and staked ${tokensToStake} tokens`);
    await incrementBlock();

    // Create some users for the provider
    const numUsers = Math.floor(Math.random() * 5);
    for (let j = 0; j < numUsers; j++) {
      await createUserForProvider(provider);
    }
    await incrementBlock();

  }

}

async function main() {
  // Connect to chain & initialize API
  await initialize();

  // Create 10 providers and stake some tokens to them
  await createProviders(10);

}

// Run the main program
main()
  .catch((e) => console.log(e))
  .finally(async () => {
    await ExtrinsicHelper.disconnect();
  });
 