/* eslint-disable import/no-extraneous-dependencies */
import { AnyNumber } from '@polkadot/types/types';
import { HexString } from '@polkadot/util/types';
import { ItemizedStoragePageResponse } from '@frequency-chain/api-augment/interfaces';
import { hexToU8a, u8aToHex } from '@polkadot/util';
import { KeyringPair } from '@polkadot/keyring/types';
import { ExtrinsicHelper, ItemizedSignaturePayload } from './extrinsicHelpers.js';
import { Schema } from './schema.js';
import { SchemaBuilder } from './schema-builder.js';
import { Sr25519Signature, signPayloadSr25519 } from './helpers.js';

let publicGraphKeySchema: Schema;

/**
 * Attempt to resolve the public graph key schema on-chain. Will first attempt to resolve
 * using the schema name, and, failing that, will attempt to find a schema matching the data model
 * (mostly useful for local dev chains not using a standard image, or Mainnet 1.12 which currently has a bug
 * where the schema name is missing for this schema)
 *
 * NOTE: This method should be called before any other methods requiring the public graph key schema ID
 *
 * @returns {Promise<void>}
 */
export async function fetchPublicKeySchema(): Promise<void> {
  if (publicGraphKeySchema) {
    return;
  }

  // Bug on mainnet: schema 7 (public key) not named; need to specify the complete model to resolve
  const schema = await new SchemaBuilder()
    .withName('dsnp', 'public-key-key-agreement')
    .withModelType('AvroBinary')
    .withModel('{type:record,name:PublicKey,namespace:org.dsnp,fields:[{name:publicKey,doc:Multicodec public key,type:bytes}]}')
    .withPayloadLocation('Itemized')
    .withAutoDetectExistingSchema(true)
    .withSettings(['SignatureRequired', 'AppendOnly'])
    .resolve();
  if (!schema) {
    throw new Error('dsnp.public-key-key-agreement schema not resolved');
  }

  publicGraphKeySchema = schema;
}

/**
 * Fetch the current public graph key for a user, and return an array containing the key as
 * a hex string and the current Itemized page hash. If no key currently provisioned, will
 * return `[undefined, 0]`
 *
 * @param {AnyNumber} msaId MSA ID to retrieve public graph key for
 * @returns {Promise<[HexString | undefined, number]>}
 */
export async function getCurrentPublicGraphKey(msaId: AnyNumber): Promise<[HexString | undefined, number]> {
  await fetchPublicKeySchema();
  const itemizedPageResponse: ItemizedStoragePageResponse = await ExtrinsicHelper.apiPromise.rpc.statefulStorage.getItemizedStorage(msaId, publicGraphKeySchema?.id);
  const currentKeyPayload = itemizedPageResponse.items.pop();
  if (!currentKeyPayload) {
    return [undefined, itemizedPageResponse.content_hash.toNumber()];
  }
  const { publicKey } = publicGraphKeySchema.fromBuffer(Buffer.from(hexToU8a(currentKeyPayload.payload.toHex())));
  return [u8aToHex(publicKey), itemizedPageResponse.content_hash.toNumber()];
}

/**
 * Create a signed payload for adding a new public graph key to a user's
 * Itemized storage. Returns both the payload and the signature.
 *
 * @param {HexString} publicKey The public key to be provisioned
 * @param {KeyringPair} signingKeys MSA keypair to sign the payload with
 * @param {number} targetHash Last known content hash of the public key Itemized storage
 * @param {number} currentBlock Last known "current" block number to be used for computing payload expiration
 * @returns {Promise<{ payload: ItemizedSignaturePayload, proof: Sr25519Signature }>}
 */
export async function getAddGraphKeyPayload(
  publicKey: HexString,
  signingKeys: KeyringPair,
  targetHash: number,
  currentBlock?: number,
): Promise<{ payload: ItemizedSignaturePayload; proof: Sr25519Signature }> {
  const keyString = publicKey.replace(/^0x/, '');
  const graphKey = {
    publicKey: Buffer.from(keyString, 'hex'),
  };

  await fetchPublicKeySchema();
  const graphKeyBuffer = publicGraphKeySchema.toBuffer(graphKey);

  const addAction = [
    {
      Add: {
        data: u8aToHex(graphKeyBuffer),
      },
    },
  ];

  const graphKeyAction: any = {
    targetHash,
    schemaId: publicGraphKeySchema.id,
    actions: addAction,
  };
  const currentBlockNumber = currentBlock || (await ExtrinsicHelper.apiPromise.rpc.chain.getBlock()).block.header.number.toNumber();
  graphKeyAction.expiration = currentBlockNumber + ExtrinsicHelper.apiPromise.consts.msa.mortalityWindowSize.toNumber();
  const payloadBytes = ExtrinsicHelper.api.registry.createType('PalletStatefulStorageItemizedSignaturePayloadV2', graphKeyAction);
  const proof = signPayloadSr25519(signingKeys, payloadBytes);
  return { payload: { ...graphKeyAction }, proof };
}
