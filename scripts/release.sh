#!/bin/sh

#./scripts/compile.sh
description=$1
latest_tag=$(git describe --abbrev=0)
grel release -u crisdosyago -r 22120 --tag $latest_tag --name "New release" --description '"'"$description"'"'
grel upload -u crisdosyago -r 22120 --tag $latest_tag --name "downloadnet-win.exe" --file bin/downloadnet-win.exe
grel upload -u crisdosyago -r 22120 --tag $latest_tag --name "downloadnet-linux" --file bin/downloadnet-linux
grel upload -u crisdosyago -r 22120 --tag $latest_tag --name "downloadnet-macos" --file bin/downloadnet-macos



