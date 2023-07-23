#!/usr/bin/env bash

unset npm_config_prefix
source $HOME/.nvm/nvm.sh
nvm use --lts
PKG=$(which pkg)
if [ -z $PKG ]; then
  npm i -g pkg@latest
  PKG=$(which pkg)
fi

./scripts/build_only.sh

$PKG --compress GZip .
