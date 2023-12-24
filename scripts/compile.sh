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

pkg --compress GZip .

iconset single ./icons/dk.icns bin/diskernet-macos
codesign -vvvv --timestamp -s "Developer ID Application" --force bin/diskernet-macos
