/*
 * This program uses 'sudo' to add a delegation to a wallet that is controlled
 * by the Amplica Access custodial wallet.
 *
 * Inputs required:
 * --delegatorMsaId: MSA ID being delegated
 * --providerMsaId: Provider MSA ID being delegated to
 * --sudoUri: Testnet sudo seed phrase
 *
 * To run:
 * npm run run-example --example=add-rococo-delegation -- --delegatorMsaId=? --providerMsaId=? --sudoUri='seed phrase'
 */

import minimist from 'minimist';
import { Keyring } from '@polkadot/api';
import { compactStripLength, u8aToHex } from '@polkadot/util';
import { ExtrinsicHelper } from '#app/scaffolding/extrinsicHelpers';

const WEBSOCKET_URL = 'wss://rpc.rococo.frequency.xyz'; // Rococo

const main = async () => {
  const argv = minimist(process.argv);
  await ExtrinsicHelper.initialize(WEBSOCKET_URL);
  const api = ExtrinsicHelper.apiPromise;

  const { providerMsaId, delegatorMsaId, sudoUri } = argv;
  if (typeof providerMsaId === 'undefined' || typeof delegatorMsaId === 'undefined' || typeof sudoUri === 'undefined') {
    console.log('Missing required command-line argument(s)');
    process.exit(1);
  }

  const keyring = new Keyring();
  const sudo = keyring.addFromUri(sudoUri, {}, 'sr25519');

  const key = api.query.msa.delegatorAndProviderToDelegation.creator(delegatorMsaId, providerMsaId);

  const hexKey = u8aToHex(compactStripLength(key)[1]);

  const delegation = api.registry.createType('CommonPrimitivesMsaDelegation', {
    revoked_at: 0,
    schema_permissions: new Map([[1, 0]]),
  });

  const tx = api.tx.sudo.sudo(api.tx.system.setStorage([[hexKey, delegation.toHex()]]));

  await new Promise<void>((resolve, _reject) => {
    tx.signAndSend(sudo, (status) => {
      console.log('Status Update', status.status.toHuman());
      if (status.isInBlock || status.isFinalized) {
        console.log(
          'Events',
          status.events.map((x) => x.toHuman()),
        );
        resolve();
      }
    });
  });
};

main()
  .catch(console.error)
  .finally(async () => {
    await ExtrinsicHelper.disconnect();
  });
