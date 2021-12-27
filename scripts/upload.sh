#!/bin/sh

gpush patch "New release" 
description=$1
latest_tag=$(git describe --abbrev=0)
grel release -u i5ik -r 22120 --tag $latest_tag --name "New release" --description '"'"$description"'"'
grel upload -u i5ik -r 22120 --tag $latest_tag --name "bin/exlibris-win.exe" --file exlibris-win.exe
grel upload -u i5ik -r 22120 --tag $latest_tag --name "bin/exlibris-linux" --file exlibris-linux
grel upload -u i5ik -r 22120 --tag $latest_tag --name "bin/exlibris-macos" --file exlibris-macos



