import { KeyringPair } from '@polkadot/keyring/types';
import { AnyNumber } from '@polkadot/types/types';
import { ExtrinsicHelper, User, UserBuilder } from '..';

/**
 * Description: Create a new MSA and register as a provider.
 *              The account associated with the seed must be appropriately funded.
 *
 * @param seed - Seed phrase/URI to use for key generation
 * @param name - Provider name to register
 * @returns User
 */
export async function provisionProvider(seed: string, name: string): Promise<User> {
  const builder = new UserBuilder().asProvider(name).withKeyUri(seed).withTokenPayment();
  const provider = await builder.build();

  return provider;
}

/**
 * Description: Stake tokens to a provider for Capacity.
 *
 * @param stakingKeys - keypair of account with funds being staked
 * @param amount - amount to stake in Plancks
 * @param targetProviderId - MSA ID of provider to which tokens will be staked
 */
export async function stakeToProvider(stakingKeys: KeyringPair, amount: AnyNumber, targetProviderId: AnyNumber): Promise<void> {
  await ExtrinsicHelper.stake(stakingKeys, targetProviderId, amount).signAndSend();
}
