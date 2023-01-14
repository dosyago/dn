#!/usr/bin/env bash

./scripts/build_only.sh

unset npm_config_prefix
source $HOME/.nvm/nvm.sh
nvm use --lts

pkg --compress GZip .
