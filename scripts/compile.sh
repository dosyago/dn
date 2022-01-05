#!/usr/bin/env bash

unset npm_config_prefix
source $HOME/.nvm/nvm.sh
. $HOME/.profile
nvm use --lts

patch_required=$(grep -ER "require\([\"'](node:)?stream/web[\"']\)")
if [[ ! -z "$patch_required" ]]; then
  echo "Found an error!"
  echo "Found something you need to patch before building"
  echo "See: https://github.com/vercel/pkg/issues/1451"
  echo
  echo "$patch_required"
  echo
  echo "You need to add that to pkg.patches to replace with require('stream').web"
  exit 1
fi

echo "Setting build mode..."
./scripts/go_build.sh

npm run bundle

echo "Bundling javascript..."
npx webpack
chmod +x ./build/22120.js
echo "Building for windows nix and macos..."
#pkg --compress Brotli . 
pkg .

echo "Restoring dev mode..."
./scripts/go_dev.sh
