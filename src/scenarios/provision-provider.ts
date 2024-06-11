import { KeyringPair } from '@polkadot/keyring/types';
import { AnyNumber } from '@polkadot/types/types';
import { ExtrinsicHelper, User, UserBuilder } from '../scaffolding';
import { ChainUser } from './types';

/**
 * Description: Create a new MSA and register as a provider.
 *              The account associated with the seed must be appropriately funded.
 *
 * @param {string} seed - Seed phrase/URI to use for key generation
 * @param {string} name - Provider name to register
 * @returns {Promise<ChainUser>}
 */
export async function provisionProvider(seed: string, name: string): Promise<ChainUser> {
  const builder = new UserBuilder().asProvider(name).withKeyUri(seed).withTokenPayment();
  const provider = await builder.build();

  return { uri: seed, keypair: provider.keypair, msaId: provider.msaId };
}

/**
 * Description: Ensure that a Provider has at least N tokens staked for Capacity. If the total amount currently staked
 *              is less than N, stake the amount of the shortfall.
 *
 * @param {KeyringPair} stakingKeys - keypair of account with funds being staked
 * @param {number|bigint} amount - amount to stake in Plancks
 * @param {AnyNumber} targetProviderId - MSA ID of provider to which tokens will be staked
 * @returns {Promise<void>}
 */
export async function ensureProviderStake(stakingKeys: KeyringPair, amount: number | bigint, targetProviderId: AnyNumber): Promise<void> {
  const capacity = await ExtrinsicHelper.apiPromise.query.capacity.capacityLedger(targetProviderId);
  const totalAmountStaked = capacity.unwrapOr({ totalTokensStaked: { toBigInt: () => 0n } }).totalTokensStaked.toBigInt();
  if (totalAmountStaked < BigInt(amount)) {
    const amountToStake = BigInt(amount) - totalAmountStaked;
    await ExtrinsicHelper.stake(stakingKeys, targetProviderId, amountToStake).signAndSend();
    console.log(`Staked ${amountToStake.toString()} to provider to guarantee minimum staking level of ${amount.toString()}`);
  } else {
    console.log(`Verified provider stake of at least ${amount.toString()}`);
  }
}
