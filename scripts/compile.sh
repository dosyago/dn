#!/usr/bin/env bash

unset npm_config_prefix
source $HOME/.nvm/nvm.sh
. $HOME/.profile
nvm use v14.15.3

echo "Bundling javascript..."
npx webpack
chmod +x ./build/22120.js
echo "Building for windows nix and macos..."
pkg . 
