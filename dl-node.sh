#!/bin/bash

unset npm_config_prefix
source $HOME/.nvm/nvm.sh
. $HOME/.profile
nvm install v14.15.3
nvm use v14.15.3

npx nexe -t linux-x64 -o bin/hello.nix -i ./hello.js -r \"./build/*\"
npx nexe -t windows -o bin/hello.exe -i ./hello.js -r \"./build/*\"
npx nexe -t macos-x64 -o bin/hello.mac -i ./hello.js -r \"./build/*\"
npx nexe -t windows-x32 -o bin/hello.win32.exe -i ./hello.js -r \"./build/*\" && npx nexe -t linux-x32 -o bin/hello.nix32 -i ./hello.js -r \"./build/*\"

rm -rf bin/hello.*

