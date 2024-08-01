#!/usr/bin/env bash

source $HOME/.nvm/nvm.sh

rm -rf build
mkdir -p build/esm/
mkdir -p build/cjs/
mkdir -p build/global/
nvm use v22
if [[ ! -d "node_modules" ]]; then
  npm i
fi
./node_modules/.bin/esbuild src/app.js --bundle --outfile=build/esm/downloadnet.mjs --format=esm --platform=node --minify --analyze
./node_modules/.bin/esbuild src/app.js --bundle --outfile=build/cjs/out.cjs --platform=node --minify --analyze
echo "#!/usr/bin/env node" > build/global/downloadnet.cjs
cat build/cjs/out.cjs >> build/global/downloadnet.cjs
chmod +x build/global/downloadnet.cjs

