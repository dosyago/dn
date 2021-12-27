#!/bin/bash

unset npm_config_prefix
source $HOME/.nvm/nvm.sh
. $HOME/.profile
nvm install v14.15.3
nvm use v14.15.3

npx webpack
chmod +x 22120.js
npx nexe -t windows -i ./build/22120.js -r \"./build/?.22120.js\" -r \"./public/*\" && npx nexe -t linux-x64 -o 22120.nix -i ./build/22120.js -r \"./build/?.22120.js\" -r \"./public/*\" && npx nexe -t macos-x64 -o 22120.mac -i ./build/22120.js -r \"./build/?.22120.js\" -r \"./public/*\" && npx nexe -t windows-x32 -o 22120.win32.exe -i ./build/22120.js -r \"./build/?.22120.js\" -r \"./public/*\" && npx nexe -t linux-x32 -o 22120.nix32 -i ./build/22120.js -r \"./build/?.22120.js\" -r \"./public/*\"
