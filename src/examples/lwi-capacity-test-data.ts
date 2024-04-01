/* eslint-disable no-plusplus */
/* eslint-disable no-await-in-loop */
/*
 * Sample application showing how to initialize the environment
 * and do a basic chain operation.
 */

import { User } from '#app/scaffolding/user';
import { UserBuilder } from '#app/scaffolding/user-builder';
import { ExtrinsicHelper } from '../scaffolding/extrinsicHelpers';
import { createKeys, devAccounts, getBlockNumber, initialize, stakeToProvider } from '../scaffolding/helpers';

const firstNames = [
  'Aaliyah',
  'Abigail',
  'Alexander',
  'Amelia',
  'Andrew',
  'Annabelle',
  'Aria',
  'Ariana',
  'Aubrey',
  'Ava',
  'Avery',
  'Benjamin',
  'Bella',
  'Caleb',
  'Camila',
  'Carter',
  'Chloe',
  'Christopher',
  'Claire',
  'Daniel',
  'David',
  'Elena',
  'Eli',
  'Elijah',
  'Ella',
  'Ellie',
  'Emily',
  'Emma',
  'Ethan',
  'Eva',
  'Evelyn',
  'Ezra',
  'Gabriel',
  'Grace',
  'Hannah',
  'Hazel',
  'Isaac',
  'Isabella',
  'Isaiah',
  'Jackson',
  'Jaxon',
  'John',
  'Jordan',
  'Joseph',
  'Julia',
  'Julian',
  'Kai',
  'Landon',
  'Layla',
  'Leo',
  'Liam',
  'Lily',
  'Lucas',
  'Lucy',
  'Madison',
  'Mason',
  'Matthew',
  'Mia',
  'Mila',
  'Natalie',
  'Nathan',
  'Naomi',
  'Nora',
  'Noah',
  'Oliver',
  'Olivia',
  'Peyton',
  'Penelope',
  'Quinn',
  'Riley',
  'Ruby',
  'Samuel',
  'Scarlett',
  'Sebastian',
  'Sofia',
  'Sophia',
  'Sophie',
  'Victoria',
  'Wyatt',
  'Xavier',
  'Zachary',
  'Zara',
  'Zoe',
];

function randomName(): string {
  const name = firstNames[Math.floor(Math.random() * firstNames.length)];
  return name;
}

async function incrementBlock(num: number) {
  const blockNumber = await getBlockNumber();
  console.log(`\tIncrementing block number: ${blockNumber} to ${blockNumber + num}`);
  await ExtrinsicHelper.run_to_block(blockNumber + num);
}

async function createProvider(providerName: string): Promise<User> {
  const builder = new UserBuilder();
  const keypair = createKeys();
  const provider = await builder.withKeypair(keypair).asProvider(providerName).build();
  provider.paysWithCapacity = true;

  return provider;
}

async function createUserForProvider(provider: User): Promise<void> {
  const userName = randomName();
  const keypair = createKeys();
  const builder = new UserBuilder().withProviderPayment();
  const userBuilder = builder.withDelegation(provider, []).withHandle(userName);

  const user = await userBuilder.withKeypair(keypair).build();
  console.log(`\tCreated user ${userName} with id ${user.msaId} and handle ${user.handle}`);
  await incrementBlock(1);
}

async function createProviders(num: number): Promise<void> {
  const aliceKeyPair = devAccounts[0].keys;
  const minStakingAmount = ExtrinsicHelper.apiPromise.consts.capacity.minimumStakingAmount;
  console.log(`Minimum staking amount is ${minStakingAmount.toBigInt()}`);

  for (let i = 0; i < num; i++) {
    const provider = await createProvider(randomName());
    console.log(`\nPROVIDER ${provider.providerName}`);

    // Stake some tokens to the provider
    const tokensToStake: bigint = minStakingAmount.toBigInt() + BigInt(Math.floor(Math.random() * 300000000000));
    await stakeToProvider(aliceKeyPair, provider.providerId!, tokensToStake);
    console.log(`\tCreated provider ${provider.providerName} with id ${provider.providerId} and staked ${tokensToStake} tokens.`);
    await incrementBlock(1);

    // Create some users for the provider
    const numUsers = Math.floor(Math.random() * 4);
    for (let j = 0; j < numUsers; j++) {
      await createUserForProvider(provider);
    }
    await incrementBlock(100);
  }
}

async function main() {
  // Connect to chain & initialize API
  await initialize();

  // Create 10 providers and stake some tokens to them
  await createProviders(8);
}

// Run the main program
main()
  .catch((e) => console.log(e))
  .finally(async () => {
    await ExtrinsicHelper.disconnect();
  });
