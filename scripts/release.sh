#!/bin/sh

#./scripts/compile.sh
description=$1
latest_tag=$(git describe --abbrev=0)
grel release -u o0101 -r dn --tag $latest_tag --name "New release" --description '"'"$description"'"'
grel upload -u o0101 -r dn --tag $latest_tag --name "downloadnet-win.exe" --file bin/downloadnet-win.exe
grel upload -u o0101 -r dn --tag $latest_tag --name "downloadnet-linux" --file bin/downloadnet-linux
grel upload -u o0101 -r dn --tag $latest_tag --name "downloadnet-macos" --file bin/downloadnet-macos



