#!/usr/bin/env bash

source $HOME/.nvm/nvm.sh

echo "Making build directories..."

mkdir -p dist/
mkdir -p bin/
mkdir -p build/

echo "Setting node to lts/*..."
nvm use --lts

echo "Installing pkg..."

which pkg || npm i -g pkg

echo "Installing esbuild..."
npm install --save-exact esbuild

echo "Done"

