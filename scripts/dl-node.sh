#!/usr/bin/env bash

unset npm_config_prefix
source $HOME/.nvm/nvm.sh
. $HOME/.profile

nvm install --lts
nvm use v22

pkg ./src/hello.js

rm -rf hello-*

