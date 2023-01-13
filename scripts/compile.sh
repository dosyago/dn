#!/usr/bin/env bash

unset npm_config_prefix
source $HOME/.nvm/nvm.sh

./node_modules/.bin/esbuild src/app.js --bundle --outfile=build/out.cjs --platform=node

nvm use --lts

pkg --compress GZip .
