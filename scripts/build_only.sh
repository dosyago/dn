#!/usr/bin/env bash

./node_modules/.bin/esbuild src/app.js --bundle --outfile=dist/diskernet.mjs --format=esm --platform=node --minify --analyze
./node_modules/.bin/esbuild src/app.js --bundle --outfile=build/out.cjs --platform=node --minify --analyze
echo "#!/usr/bin/env node" > build/diskernet.js
cat build/out.cjs >> build/diskernet.js
chmod +x build/diskernet.js

