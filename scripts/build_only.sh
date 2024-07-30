#!/usr/bin/env bash

./node_modules/.bin/esbuild src/app.js --bundle --outfile=dist/downloadnet.mjs --format=esm --platform=node --minify --analyze
./node_modules/.bin/esbuild src/app.js --bundle --outfile=build/out.cjs --platform=node --minify --analyze
#./node_modules/.bin/esbuild src/app.js --bundle --outfile=build/test.cjs --platform=node 
echo "#!/usr/bin/env node" > build/downloadnet.cjs
cat build/out.cjs >> build/downloadnet.cjs
chmod +x build/downloadnet.cjs

