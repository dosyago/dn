import path from 'path';
import url from 'url';

let mod;
let esm = false;

try {
  const [a, b] = [__dirname, __filename];
} catch(e) {
  esm = true;
}

if ( ! esm ) {
  mod = require('./root.cjs');
} else {
  const file = url.fileURLToPath(import.meta.url);
  const dir = path.dirname(file);
  mod = {
    dir,
    file,
    APP_ROOT: dir
  };
}

//console.log({root});

export const root = mod;

