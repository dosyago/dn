#!/usr/bin/env bash

./node_modules/.bin/esbuild src/app.js --bundle --outfile=dist/diskernet.mjs --format=esm --platform=node --minify --analyze
./node_modules/.bin/esbuild src/app.js --bundle --outfile=build/out.cjs --platform=node --minify --analyze
./node_modules/.bin/esbuild src/app.js --bundle --outfile=build/test.cjs --platform=node 
echo "#!/usr/bin/env node" > build/diskernet.cjs
cat build/out.cjs >> build/diskernet.cjs
chmod +x build/diskernet.cjs
cp -r node_modules/ps-list-commonjs/vendor build/

