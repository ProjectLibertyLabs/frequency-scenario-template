/*
 * Takes in the signup-response from Amplica Access signup request flow.
 * Paste the signup-response into the singup-response.json file.
 * Do not include the "response" wrapper object found in the sms flow
 */
/* eslint-disable new-cap */
import minimist from 'minimist';
import { Keyring } from '@polkadot/api';
import { Bytes, u64 } from '@polkadot/types';
import { AddProviderPayload, ExtrinsicHelper } from '#app/scaffolding/extrinsicHelpers.js';
import { initialize, devAccounts, Sr25519Signature } from '#app/scaffolding/helpers.js';
import { UserBuilder } from '#app/scaffolding/user-builder.js';

async function main() {
  // Connect to chain & initialize API
  await initialize();

  const builder = new UserBuilder();
  const alice = await builder.withKeypair(devAccounts[0].keys).build();

  // Extract any CLI arguments
  const argv = minimist(process.argv);
  const responseLocation = argv?.response;
  if (!responseLocation) {
    console.error('No response parameter supplied for signup-response. Please include a json response to use.');
    return;
  }
  const response = await import(`examples/amplica-access/${responseLocation}`);
  const keyring = new Keyring({ type: 'sr25519' });
  const userPublicKeyByteArray = keyring.decodeAddress(response.publicKey.encodedValue);

  // Create AddProviderPayloadSignature
  const addProviderPayloadSignature: Sr25519Signature = {
    Sr25519: response.addProviderPayloadSignature.encodedValue as `0x${string}`,
  };

  // Create AddProvider Payload
  const msaId = new u64(ExtrinsicHelper.api.registry, response.addProviderPayload.authorizedMsaId);
  const addProviderPayload: AddProviderPayload = {
    authorizedMsaId: msaId,
    schemaIds: response.addProviderPayload.schemaIds,
    expiration: response.addProviderPayload.expiration,
  };

  // Execute CreateSponsoredAccountWithDelegation Extrinsic
  await ExtrinsicHelper.createSponsoredAccountWithDelegation(userPublicKeyByteArray, alice.keypair, addProviderPayloadSignature, addProviderPayload).signAndSend();

  // Create ClaimHandlePayloadSignature
  const claimHandlePayloadSignature: Sr25519Signature = {
    Sr25519: response.handle.signature.encodedValue as `0x${string}`,
  };

  // Create ClaimHandlePayload
  const handle_vec = new Bytes(ExtrinsicHelper.api.registry, response.handle.payload.baseHandle);
  const payload = {
    baseHandle: handle_vec,
    expiration: response.handle.payload.expiration,
  };
  const claimHandlePayload = ExtrinsicHelper.api.registry.createType('CommonPrimitivesHandlesClaimHandlePayload', payload);

  // Execute ClaimHandle Extrinsic
  await ExtrinsicHelper.claimHandleWithProvider(userPublicKeyByteArray, alice.keypair, claimHandlePayloadSignature, claimHandlePayload).signAndSend();
}

// Run the main program
main()
  .catch((e) => console.log(e))
  .finally(async () => {
    await ExtrinsicHelper.disconnect();
  });
