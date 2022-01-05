#!/bin/sh

#./scripts/compile.sh
description=$1
latest_tag=$(git describe --abbrev=0)
npm version $latest_tag
echo $(date) > .date.npm.release
gpush patch "$description" 
grel release -u i5ik -r 22120 --tag $latest_tag --name "New release" --description '"'"$description"'"'
grel upload -u i5ik -r 22120 --tag $latest_tag --name "archivist1-win.exe" --file bin/archivist1-win.exe
grel upload -u i5ik -r 22120 --tag $latest_tag --name "archivist1-linux" --file bin/archivist1-linux
grel upload -u i5ik -r 22120 --tag $latest_tag --name "archivist1-macos" --file bin/archivist1-macos



