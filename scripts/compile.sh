#!/usr/bin/env bash

unset npm_config_prefix
source $HOME/.nvm/nvm.sh
. $HOME/.profile
nvm use --lts

echo "Cleaning old build and dist files..."

rm -rf build/* dist/*

echo "Setting build (CJS) mode..."
./scripts/go_build.sh

patch_required=$(grep -ER "require\([\"'](node:)?stream/web[\"']\)" node_modules/*)
files=$(grep -rlER "require\([\"'](node:)?stream/web[\"']\)" node_modules/*)
if [[ ! -z "$patch_required" ]]; then
  while IFS= read -r file; do
    #echo '--->' $file
    #grep -q $file package.json
    #if [ $? == 1 ]; then
      echo '--->' $file "UNPATCHED!"
      echo "Found an error!"
      echo "Found something you need to patch before building"
      echo "See: https://github.com/vercel/pkg/issues/1451"
      echo
      echo "$patch_required"
      echo
      echo "You need to add all these to pkg.patches to replace with require('stream').web"
      ./scripts/go_dev.sh
      exit 1
    #fi
    #echo "OK"
  done <<< $files
fi

npm run bundle
echo "Bundling javascript..."
npx webpack
chmod +x ./build/22120.js
echo "Building for windows nix and macos..."
pkg --compress Gzip . 

echo "Restoring dev (ES module) mode..."
./scripts/go_dev.sh

echo "Rebundling an es module for npm es module import..."
npm run bundle
