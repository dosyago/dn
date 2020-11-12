#!/bin/sh

gpush patch "New release" 
description=$1
latest_tag=$(git describe --abbrev=0)
grel release -u dosyago -r 22120 --tag $latest_tag --name "New release" --description '"'"$description"'"'
grel upload -u c9fe -r 22120 --tag $latest_tag --name "22120.exe" --file 22120.exe
grel upload -u c9fe -r 22120 --tag $latest_tag --name "22120.macos" --file 22120.mac
grel upload -u c9fe -r 22120 --tag $latest_tag --name "22120.linux" --file 22120.nix
grel upload -u c9fe -r 22120 --tag $latest_tag --name "22120.linx32" --file 22120.nix32
grel upload -u c9fe -r 22120 --tag $latest_tag --name "22120.win32.exe" --file 22120.win32.exe



