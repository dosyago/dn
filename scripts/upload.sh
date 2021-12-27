#!/bin/sh

gpush patch "New release" 
description=$1
latest_tag=$(git describe --abbrev=0)
grel release -u i5ik -r 22120 --tag $latest_tag --name "New release" --description '"'"$description"'"'
grel upload -u i5ik -r 22120 --tag $latest_tag --name "exlibris-win.exe" --file bin/exlibris-win.exe
grel upload -u i5ik -r 22120 --tag $latest_tag --name "exlibris-linux" --file bin/exlibris-linux
grel upload -u i5ik -r 22120 --tag $latest_tag --name "exlibris-macos" --file bin/exlibris-macos



