/**
 * Build the package.json for the actual publishing
 */

const removeDist = (s) => s.replace('dist/', '');

// eslint-disable-next-line
const fs = require('fs');
// eslint-disable-next-line
const path = require('path');

// Copy over the Readme and License
fs.copyFileSync(path.join(__dirname, '../README.md'), path.join(__dirname, '../dist/README.md'));
fs.copyFileSync(path.join(__dirname, '../LICENSE'), path.join(__dirname, '../dist/LICENSE'));

// eslint-disable-next-line
const rootPackage = require('../package.json');

// Don't keep scripts
rootPackage['scripts'] = {};

// Don't keep file reference
delete rootPackage['files'];

// Don't keep dev dependencies
delete rootPackage['devDependencies'];

// Setup the main and types correctly
rootPackage['main'] = removeDist(rootPackage['main']);
rootPackage['module'] = removeDist(rootPackage['module']);
rootPackage['types'] = removeDist(rootPackage['types']);
const rootExports = rootPackage['exports']['.'];
rootExports['import'] = removeDist(rootExports['import']);
rootExports['require'] = removeDist(rootExports['require']);

const cjsPackage = {
  type: 'commonjs',
};
const mjsPackage = {
  type: 'module',
};

// Write it out
fs.writeFileSync(`${path.join(__dirname, '../dist', 'package.json')}`, JSON.stringify(rootPackage, null, 2), (err) => {
  if (err) throw new Error(err);
});
fs.writeFileSync(`${path.join(__dirname, '../dist/cjs', 'package.json')}`, JSON.stringify(cjsPackage, null, 2), (err) => {
  if (err) throw new Error(err);
});
fs.writeFileSync(`${path.join(__dirname, '../dist/mjs', 'package.json')}`, JSON.stringify(mjsPackage, null, 2), (err) => {
  if (err) throw new Error(err);
});
