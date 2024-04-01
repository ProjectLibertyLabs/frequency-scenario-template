/*
 * This program uses 'sudo' to add a delegation to a wallet that is controlled
 * by the Amplica Access custodial wallet.
 *
 * Inputs required:
 * --providerMsaId: Provider MSA ID being delegated to
 * --sudoUri: Testnet sudo seed phrase
 * --delegator: MSA ID or Handle being delegated
 *
 * To run:
 * npm run run-example --example=add-rococo-delegation -- --delegator=? --providerMsaId=? --sudoUri='seed phrase'
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

  const { providerMsaId, delegator, sudoUri } = argv;
  if (typeof providerMsaId === 'undefined' || typeof delegator === 'undefined' || typeof sudoUri === 'undefined') {
    console.log('Missing required command-line argument(s): "delegator", "providerMsaId", or "sudoUri"');
    process.exit(1);
  }

  const keyring = new Keyring();
  const sudo = keyring.addFromUri(sudoUri, {}, 'sr25519');

  const delegatorMsaId = await (async () => {
    if (parseInt(delegator, 10).toString() === delegator) {
      return delegator;
    }
    const handleResp = (await api.rpc.handles.getMsaForHandle(delegator.replace('@', ''))).toJSON();
    return parseInt(handleResp as string, 10);
  })();

  if (Number.isNaN(delegatorMsaId)) {
    throw new Error(`Unable to resolve ${delegator} to an MSA Id`);
  }

  console.log('Attempting to setup a delegation with:', {
    providerMsaId,
    delegatorMsaId,
  });

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
