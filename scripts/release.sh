#!/bin/sh

#./scripts/compile.sh
description=$1
latest_tag=$(git describe --abbrev=0)
grel release -u crisdosyago -r 22120 --tag $latest_tag --name "New release" --description '"'"$description"'"'
grel upload -u crisdosyago -r 22120 --tag $latest_tag --name "diskernet-win.exe" --file bin/diskernet-win.exe
grel upload -u crisdosyago -r 22120 --tag $latest_tag --name "diskernet-linux" --file bin/diskernet-linux
grel upload -u crisdosyago -r 22120 --tag $latest_tag --name "diskernet-macos" --file bin/diskernet-macos



