#!/usr/bin/env bash

source $HOME/.nvm/nvm.sh

rm -rf build
mkdir -p build/esm/
mkdir -p build/cjs/
mkdir -p build/global/
mkdir -p build/bin/
nvm use v22
if [[ ! -d "node_modules" ]]; then
  npm i
fi
if [[ -n "$NO_MINIFY" ]]; then
  ./node_modules/.bin/esbuild src/app.js --bundle --outfile=build/esm/downloadnet.mjs --format=esm --platform=node --analyze
  ./node_modules/.bin/esbuild src/app.js --bundle --outfile=build/cjs/out.cjs --platform=node --analyze
else
  ./node_modules/.bin/esbuild src/app.js --bundle --outfile=build/esm/downloadnet.mjs --format=esm --platform=node --minify --analyze
  ./node_modules/.bin/esbuild src/app.js --bundle --outfile=build/cjs/out.cjs --platform=node --minify --analyze
fi
echo "const bigR = require('module').createRequire(__dirname); require = bigR;" > build/cjs/dn.cjs
cat build/cjs/out.cjs >> build/cjs/dn.cjs
echo "#!/usr/bin/env node" > build/global/downloadnet.cjs
cat build/cjs/out.cjs >> build/global/downloadnet.cjs
chmod +x build/global/downloadnet.cjs
if [[ "$OSTYPE" == darwin* ]]; then
  ./stampers/macos.sh dn build/cjs/out.cjs build/bin/
elif [[ "$OSTYPE" == win* ]]; then
  ./stampers/win.sh dn build/cjs/out.cjs build/bin/
else
  ./stampers/nix.sh build/cjs/out.cjs build/bin/
fi

