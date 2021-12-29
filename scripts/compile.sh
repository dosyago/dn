#!/usr/bin/env bash

unset npm_config_prefix
source $HOME/.nvm/nvm.sh
. $HOME/.profile
nvm use v14.15.3

echo "Setting build mode..."
./scripts/go_build.sh

echo "Bundling javascript..."
npx webpack
chmod +x ./build/22120.js
echo "Building for windows nix and macos..."
pkg --compress Brotli . 

echo "Restoring dev mode..."
./scripts/go_dev.sh
