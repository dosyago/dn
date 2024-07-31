#!/usr/bin/env bash

unset npm_config_prefix
source $HOME/.nvm/nvm.sh
nvm use v22
PKG=$(which pkg)
if [ -z $PKG ]; then
  npm i -g pkg@latest
  PKG=$(which pkg)
fi

./scripts/build_only.sh

pkg --compress GZip .

iconset single ./icons/dk.icns bin/downloadnet-macos
codesign -vvvv --timestamp -s "Developer ID Application" --force bin/downloadnet-macos
