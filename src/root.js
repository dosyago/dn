import path from 'path';
import url from 'url';

let root;
let esm = false;

try {
  console.log(__dirname, __filename);
} catch(e) {
  esm = true;
}

if ( ! esm ) {
  root = require('./root.cjs').APP_ROOT;
} else {
  root = path.dirname(url.fileURLToPath(import.meta.url));
}

console.log({root});

export const APP_ROOT = root;

