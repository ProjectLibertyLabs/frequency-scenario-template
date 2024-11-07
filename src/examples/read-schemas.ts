import minimist from 'minimist';
import { ExtrinsicHelper } from '#app/scaffolding/extrinsicHelpers.js';
import { initialize } from '#app/scaffolding/helpers.js';

async function main() {
  // Extract any CLI arguments
  const argv = minimist(process.argv);
  const uri = argv?.uri;

  await initialize(uri);

  const entries = await ExtrinsicHelper.apiPromise.query.schemas.schemas.entries();

  entries
    .filter(([_, entry]) => ['Paginated', 'Itemized'].some((pl) => pl === (entry as any).unwrap().payloadLocation.toString()))
    .forEach(([index, entry]) => {
      const schema = (entry as any).unwrap();
      console.log(`SchemaId: ${index.toHuman()}
    Model: ${schema.model.toHuman()}
    `);
    });
}

// main().finally(async () => await ExtrinsicHelper.disconnect());
main().finally(async () => ExtrinsicHelper.disconnect());
