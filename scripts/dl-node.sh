#!/usr/bin/env bash

unset npm_config_prefix
source $HOME/.nvm/nvm.sh
. $HOME/.profile

nvm install v14.15.3
nvm use v14.15.3

pkg ./src/hello.js

rm -rf hello-*

