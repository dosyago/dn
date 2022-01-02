#!/usr/bin/env bash

unset npm_config_prefix
source $HOME/.nvm/nvm.sh
. $HOME/.profile

nvm install --lts
nvm use --lts

pkg ./src/hello.js

rm -rf hello-*

