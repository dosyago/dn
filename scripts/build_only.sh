#!/usr/bin/env bash

./node_modules/.bin/esbuild src/app.js --bundle --outfile=dist/diskernet.mjs --format=esm --platform=node
./node_modules/.bin/esbuild src/app.js --bundle --outfile=build/out.cjs --platform=node
echo "#!/usr/bin/env node" > build/diskernet.js
cat build/out.cjs >> build/diskernet.js
chmod +x build/diskernet.js

