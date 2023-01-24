#!/usr/bin/env bash

./scripts/build_only.sh

unset npm_config_prefix
source $HOME/.nvm/nvm.sh
nvm use --lts


pkg --compress GZip .

iconset single ./icons/dk.icns bin/diskernet-macos
codesign -vvvv --timestamp -s "Developer ID Application" --force bin/diskernet-macos

