/*
 * Sample application showing how to initialize the environment
 * and do a basic chain operation.
 */

import minimist from 'minimist';
import log from 'loglevel';
import { ExtrinsicHelper } from '../scaffolding/extrinsicHelpers';
import { initialize } from '../scaffolding/helpers';

async function main() {
  // Connect to chain & initialize API
  await initialize();
  log.setLevel('trace');

  // Extract any CLI arguments
  const argv = minimist(process.argv);
  const blockNumber = parseInt(argv?.blockNumber, 10);
  log.info(`Running to block: ${blockNumber}`);
  await ExtrinsicHelper.run_to_block(blockNumber);
}

// Run the main program
main()
  .catch((e) => console.log(e))
  .finally(async () => {
    await ExtrinsicHelper.disconnect();
  });
