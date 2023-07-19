import { ExtrinsicHelper } from '#app/scaffolding/extrinsicHelpers';
import { initialize } from '#app/scaffolding/helpers';
import minimist from 'minimist';

async function main() {
  // Extract any CLI arguments
  const argv = minimist(process.argv);
  const uri = argv?.uri;

  await initialize(uri);

  const entries = await ExtrinsicHelper.apiPromise.query.schemas.schemas.entries();

  entries
    .filter(([_, entry]) => ['Paginated', 'Itemized'].some((pl) => pl === entry.unwrap().payloadLocation.toString()))
    .forEach(([index, entry]) => {
      const schema = entry.unwrap();
      console.log(`SchemaId: ${index.toHuman()}
    Model: ${schema.model.toHuman()}
    `);
    });
}

// eslint-disable-next-line no-return-await
// main().finally(async () => await ExtrinsicHelper.disconnect());
main().finally(async () => ExtrinsicHelper.disconnect());
