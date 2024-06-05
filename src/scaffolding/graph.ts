/* eslint-disable import/no-extraneous-dependencies */
import { AnyNumber } from '@polkadot/types/types';
import { HexString } from '@polkadot/util/types';
import { ItemizedStoragePageResponse } from '@frequency-chain/api-augment/interfaces';
import { hexToU8a, u8aToHex } from '@polkadot/util';
import { KeyringPair } from '@polkadot/keyring/types';
import { ExtrinsicHelper } from './extrinsicHelpers';
import { ItemizedSignaturePayload, Schema, SchemaBuilder, Sr25519Signature, signPayloadSr25519 } from '..';

// let publicGraphKeyAvroType: AvroType;
let publicGraphKeySchema: Schema;

export async function fetchPublicKeySchema(): Promise<void> {
  if (publicGraphKeySchema) {
    return;
  }

  //   const pubKeySchemaIdResponse = await ExtrinsicHelper.apiPromise.query.schemas.schemaNameToIds('dsnp', 'public-key-key-agreement');
  //   const schemaIds = pubKeySchemaIdResponse.ids.toArray();
  // Bug on mainnet: schema 7 (public key) not named; need to specify the complete model to resolve
  const schema = await new SchemaBuilder()
    .withName('dsnp', 'public-key-key-agreement')
    .withModelType('AvroBinary')
    .withModel('{type:record,name:PublicKey,namespace:org.dsnp,fields:[{name:publicKey,doc:Multicodec public key,type:bytes}]}')
    .withPayloadLocation('Itemized')
    .withAutoDetectExistingSchema(true)
    .withSettings(['SignatureRequired', 'AppendOnly'])
    .resolve();
  //   const { model }: SchemaResponse = (await ExtrinsicHelper.apiPromise.rpc.schemas.getBySchemaId(publicGraphKeySchemaId)).unwrap();
  //   const modelObj = JSON.parse(model.toHuman() as string);
  //   publicGraphKeyAvroType = AvroType.forSchema(modelObj);
  if (!schema) {
    throw new Error('dsnp.public-key-key-agreement schema not resolved');
  }

  publicGraphKeySchema = schema;
}

export async function getCurrentPublicGraphKey(msaId: AnyNumber): Promise<HexString | undefined> {
  await fetchPublicKeySchema();
  const itemizedPageResponse: ItemizedStoragePageResponse = await ExtrinsicHelper.apiPromise.rpc.statefulStorage.getItemizedStorage(msaId, publicGraphKeySchema?.id);
  const currentKeyPayload = itemizedPageResponse.items.pop();
  if (!currentKeyPayload) {
    return undefined;
  }
  const { publicKey } = publicGraphKeySchema.fromBuffer(Buffer.from(hexToU8a(currentKeyPayload.payload.toHex())));
  return u8aToHex(publicKey);
}

export async function getAddGraphKeyPayload(publicKey: HexString, signingKeys: KeyringPair): Promise<{ payload: ItemizedSignaturePayload; proof: Sr25519Signature }> {
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
    targetHash: 0,
    schemaId: 7,
    actions: addAction,
  };
  const currentBlockNumber = (await ExtrinsicHelper.apiPromise.rpc.chain.getBlock()).block.header.number.toNumber();
  graphKeyAction.expiration = currentBlockNumber + ExtrinsicHelper.apiPromise.consts.msa.mortalityWindowSize.toNumber();
  const payloadBytes = ExtrinsicHelper.api.registry.createType('PalletStatefulStorageItemizedSignaturePayloadV2', graphKeyAction);
  const proof = signPayloadSr25519(signingKeys, payloadBytes);
  return { payload: { ...graphKeyAction }, proof };
}
