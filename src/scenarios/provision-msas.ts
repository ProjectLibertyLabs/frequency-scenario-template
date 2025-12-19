import Keyring from '@polkadot/keyring';
import { AnyNumber } from '@polkadot/types/types';
import { colors, names, NumberDictionary, uniqueNamesGenerator } from 'unique-names-generator';
import { Bytes } from '@polkadot/types';
import { hexToU8a, u8aToHex, u8aWrapBytes } from '@polkadot/util';
import { GraphKeyType } from '@projectlibertylabs/graph-sdk';
import { KeyringPair } from '@polkadot/keyring/types';
import { StringDecoder } from 'string_decoder';
import {
  AddProviderPayload,
  batchWithCapacityAndWaitForExtrinsics,
  ChainEventHandler,
  ExtrinsicHelper,
  getAddGraphKeyPayload,
  getCurrentPublicGraphKey,
  signPayloadSr25519,
  Sr25519Signature,
} from '#app/scaffolding';
import { ChainUser } from './types.js';

const DEFAULT_GRAPH_SCHEMAS = [8, 9, 10];
const DEFAULT_GRAPH_KEY_SCHEMA = 7;
const DEFAULT_PROFILE_SCHEMA = 5;
const DEFAULT_SCHEMAS_TO_GRANT = [DEFAULT_PROFILE_SCHEMA, DEFAULT_GRAPH_KEY_SCHEMA, ...DEFAULT_GRAPH_SCHEMAS];
const keyring = new Keyring({ type: 'sr25519' });
const wellKnownGraphKeypair = {
  publicKey: '0x0514f63edc89d414061bf451cc99b1f2b43fac920c351be60774559a31523c75',
  privateKey: '0x1c15b6d1af4716615a4eb83a2dfba3284e1c0a199603572e7b95c164f7ad90e3',
};
const decoder = new StringDecoder('utf-8');
const numberDictionary = NumberDictionary.generate({ min: 1000, max: 999999 });

/**
 * Given an array of ChainUser, for each user that does not have an `msaId` populated,
 * attempt to look up an existing MSA ID using the keypair. If an existing MSA is found,
 * also look up the associated handle.
 *
 * @param {ChainUser[]} users - an array of users with keypairs to be resolved to MSAs on-chain
 * @returns {Promise<void>}
 */
async function resolveUsersFromChain(users: ChainUser[]): Promise<void> {
  const addresses = users.map((u) => u.keypair.address);
  process.stdout.write(`Attempting to resolve existing MSAs for ${addresses.length} addresses... `);
  const allMsas = await ExtrinsicHelper.apiPromise.query.msa.publicKeyToMsaId.multi([...addresses]);
  addresses.forEach((_, index) => {
    if (!allMsas[index].isNone) {
      users[index].msaId = allMsas[index].unwrap();
    }
  });

  const resolvedUsers = users.filter((u) => u?.msaId);
  if (resolvedUsers.length > 0) {
    const allHandles = await ExtrinsicHelper.apiPromise.query.handles.msaIdToDisplayName.multi(resolvedUsers.map((u) => u.msaId));
    if (allHandles) {
      resolvedUsers.forEach((u, i) => {
        if (allHandles[i].isSome) {
          u.handle = decoder.write(allHandles[i].unwrap()[0]);
        }
      });
    }
    console.log(`resolved ${users.filter((u) => u?.msaId).length} existing user accounts on-chain`);
  }
}

/**
 * Convenience method for initializing a set of MSAs to be used in test scenarios. The function
 * will provision a keypair for each user, with all keypairs being derived from the same base seed
 * phrase or URI. Then it will call `resolveUsersFromChain` to resolve the created keypairs to any
 * already-existing MSAs.
 *
 * @param {string} baseSeed - Seed phrase/uri to use as a derivation base for the keypair
 * @param {number} numUsers - number of users to create
 * @returns {Promise<ChainUser[]>} An array of initialized users
 */
export async function initializeLocalUsers(baseSeed: string, numUsers: number): Promise<ChainUser[]> {
  process.stdout.write(`Creating keypairs for ${numUsers} accounts... `);
  const users = new Array(numUsers).fill(0).map((_, i) => {
    const uri = `${baseSeed}//${i}`;
    return { uri, keypair: keyring.createFromUri(uri) };
  });
  console.log(`done`);

  await resolveUsersFromChain(users);
  return users;
}

/**
 * Convenience method to get the current block number.
 *
 * @returns {Promise<number>} Current block number
 */
export async function getCurrentBlockNumber(): Promise<number> {
  const block = await ExtrinsicHelper.apiPromise.rpc.chain.getBlock();
  return block.block.header.number.toNumber();
}

/**
 * Create a signed payload to be used with either of the following extrinsics:
 *     - createSponsoredAccountWithDelegations
 *     - grantDelegation
 * @param {ChainUser} user - ChainUser object containing the keys to be used in signing the payload
 * @param {ChainUser} provider - ChainUser object containing the Provider ID to be authorized in the delegation
 * @param {number} currentBlockNumber - current block number to be used in determining expiration of the payload signature
 * @param {AnyNumber[]} schemaIds - Array of Schema IDs to be included in the Provider delegation
 * @returns {{ payload: PalletMsaAddProvider, proof: Sr25519Signature }}
 */
export function getAddProviderPayload(
  user: ChainUser,
  provider: ChainUser,
  currentBlockNumber: number,
  schemaIds: AnyNumber[],
): { payload: AddProviderPayload; proof: Sr25519Signature } {
  const mortalityWindowSize = ExtrinsicHelper.apiPromise.consts.msa.mortalityWindowSize.toNumber();
  const addProvider: AddProviderPayload = {
    authorizedMsaId: provider.msaId,
    intentIds: schemaIds,
    expiration: currentBlockNumber + mortalityWindowSize,
  };
  const payload = ExtrinsicHelper.apiPromise.registry.createType('PalletMsaAddProvider', addProvider);
  const proof = signPayloadSr25519(user.keypair, payload);

  return { payload: addProvider, proof };
}

/**
 * Generate a signed payload to be used with the `claimHandle` or `changeHandle` extrinsics.
 *
 * @param {ChainUser} user object containing keypair to be used in signing the payload
 * @param {string} handle Base handle to be claimed
 * @param {number} currentBlockNumber Current block number used to calculate expiration of the payload signature
 * @returns {{ payload, proof: Sr25519Signature }}
 */
export function getClaimHandlePayload(user: ChainUser, handle: string, currentBlockNumber: number): { payload: any; proof: Sr25519Signature } {
  const mortalityWindowSize = ExtrinsicHelper.apiPromise.consts.msa.mortalityWindowSize.toNumber();
  const handleBytes = new Bytes(ExtrinsicHelper.apiPromise.registry, handle);
  const payload = {
    baseHandle: handleBytes,
    expiration: currentBlockNumber + mortalityWindowSize,
  };
  const payloadToSign = ExtrinsicHelper.apiPromise.registry.createType('CommonPrimitivesHandlesClaimHandlePayload', payload).toU8a();
  const proof = { Sr25519: u8aToHex(user.keypair.sign(u8aWrapBytes(payloadToSign))) };

  return { payload, proof };
}

/**
 * For each ChainUser in the input array that does not have an MSA ID provisioned, create an extrinsic call to
 * `createSponsoredAccountWithDelegation`, and, optionally, `claimHandle`.
 *
 * @param {ChainUser} provider User object representing the Provider to be delegated to
 * @param {ChainUser[]} users Array of users to be provisioned
 * @param {{ schemaIds, allocateHandle }} options Record of options to the function
 * @returns {Promise<void>}
 */
export async function provisionLocalUserCreationExtrinsics(
  provider: ChainUser,
  users: ChainUser[],
  options?: { schemaIds?: AnyNumber[]; allocateHandle?: boolean },
): Promise<void> {
  const { schemaIds, allocateHandle } = options || {};
  const currentBlock = await getCurrentBlockNumber();
  users
    .filter((u) => !u?.msaId)
    .forEach((u) => {
      const { payload: addProviderPayload, proof } = getAddProviderPayload(u, provider, currentBlock, schemaIds ?? DEFAULT_SCHEMAS_TO_GRANT);

      u.create = () => ExtrinsicHelper.apiPromise.tx.msa.createSponsoredAccountWithDelegation(u.keypair.publicKey, proof, addProviderPayload);

      if (allocateHandle) {
        const name = uniqueNamesGenerator({ dictionaries: [colors, names, numberDictionary], separator: '', length: 3, style: 'capital' });
        const { payload: handlePayload, proof: handleProof } = getClaimHandlePayload(u, name, currentBlock);
        u.claimHandle = () => ExtrinsicHelper.apiPromise.tx.handles.claimHandle(u.keypair.publicKey, handleProof, handlePayload);
      }
    });
}

/**
 * Method to provision extrinsics to delete existing user graphs.
 * For each user in the input, determine if any populated graph pages exist for the given schema IDs, and for
 * each detected graph page, create an extrinsic call to `deletePage`
 *
 * @param {ChainUser} users Array of users to have their graphs deleted
 * @param {AnyNumber[]} [schemaIds] Array of schemaIds for graphs to be cleared. (Default: DEFAULT_GRAPH_SCHEMAS)
 * @returns {Promise<void[]>}
 */
export function provisionUserGraphResets(users: ChainUser[], schemaIds?: AnyNumber[]): Promise<void[]> {
  return Promise.all(
    users.map(async (user) => {
      if (!user?.msaId) {
        return;
      }
      const { msaId } = user;

      await Promise.all(
        (schemaIds || DEFAULT_GRAPH_SCHEMAS).map(async (schemaId) => {
          const pages = await ExtrinsicHelper.apiPromise.rpc.statefulStorage.getPaginatedStorage(user.msaId, schemaId);
          if (!user?.graphUpdates) {
            user.graphUpdates = [];
          }

          user.graphUpdates.push(
            ...pages.toArray().map((page) => () => ExtrinsicHelper.apiPromise.tx.statefulStorage.deletePage(msaId, schemaId, page.page_id, page.content_hash)),
          );
        }),
      );
    }),
  );
}

/**
 * Provision graph encryption keys for users.
 *
 * For each user in the input, fetch the latest public graph key and compare to the key to be provisioned. If they match, do nothing,
 * otherwise, provision a new graph encryption keypair.
 *
 * @param {ChainUser[]} users Users to have graph keys provisioned
 * @param {boolean} useWellKnownKey=true If true and no key is indicated in the input use, use the `wellKnownGraphKeypair`
 * @returns {Promise<void[]>}
 */
export async function provisionUserGraphEncryptionKeys(users: ChainUser[], useWellKnownKey: boolean = true): Promise<void[]> {
  const currentBlockNumber = await getCurrentBlockNumber();
  return Promise.all(
    users.map(async (user) => {
      const [currentPubKey, targetHash] = await getCurrentPublicGraphKey(user.msaId!);
      if (user?.graphKeyPair && currentPubKey === u8aToHex(user.graphKeyPair.publicKey)) {
        return;
      }

      if (!user?.graphKeyPair && useWellKnownKey) {
        user.graphKeyPair = {
          keyType: GraphKeyType.X25519,
          publicKey: hexToU8a(wellKnownGraphKeypair.publicKey),
          secretKey: hexToU8a(wellKnownGraphKeypair.privateKey),
        };

        if (currentPubKey === wellKnownGraphKeypair.publicKey) {
          return;
        }

        const { payload: addGraphKeyPayload, proof: addGraphKeyProof } = await getAddGraphKeyPayload(
          u8aToHex(user.graphKeyPair.publicKey),
          user.keypair,
          targetHash,
          currentBlockNumber,
        );

        user.addGraphKey = () => ExtrinsicHelper.apiPromise.tx.statefulStorage.applyItemActionsWithSignatureV2(user.keypair.publicKey, addGraphKeyProof, addGraphKeyPayload);
      }
    }),
  );
}

/**
 * Execute previously provisioned extrinsic call for an array of users on-chain and await their completion.
 *
 * @param {KeyringPair} payorKeys - Signing keys for the account that will be submitting the transactions.
 * @param {ChainUser[]} users - Array of users to be provisioned on-chain
 * @param {ChainEventHandler[]} eventHandlers - Array of methods to be invoked in the chain event subscription handler
 * @returns {Promise<void>}
 */
export async function provisionUsersOnChain(payorKeys: KeyringPair, users: ChainUser[], eventHandlers: ChainEventHandler[]): Promise<void> {
  let usersToCreate = 0;
  let handlesToClaim = 0;
  let graphUpdates = 0;
  let graphKeys = 0;

  const extrinsics: any[] = [];

  users.forEach((user) => {
    if (user?.create) {
      extrinsics.push(user.create());
      usersToCreate++;
    }
    if (user?.claimHandle) {
      extrinsics.push(user.claimHandle());
      handlesToClaim++;
    }
    if (user?.addGraphKey) {
      extrinsics.push(user.addGraphKey());
      graphKeys++;
    }
    if (user?.graphUpdates?.length && user.graphUpdates?.length > 0) {
      extrinsics.push(...user.graphUpdates.map((e) => e()));
      graphUpdates++;
    }
  });

  console.log(`
MSAs to create: ${usersToCreate}
Handles to claim: ${handlesToClaim}
Graph keys to provision: ${graphKeys}
User graphs to clear: ${graphUpdates}
`);

  if (extrinsics.length !== 0) {
    console.log(`Enqueuing ${extrinsics.length} extrinsics for execution`);

    await batchWithCapacityAndWaitForExtrinsics(payorKeys, extrinsics, eventHandlers);
  }
}
