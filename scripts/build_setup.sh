#!/bin/sh

echo "Installing nexe and upx..."

mkdir -p bin/
mkdir -p build/

pkg -v || npm i -g pkg
curl -L -o upx.tar.xz https://github.com/upx/upx/releases/download/v3.96/upx-3.96-amd64_linux.tar.xz
tar -xJf upx.tar.xz
rm upx.tar.xz
sudo cp upx-3.96-amd64_linux/upx /usr/local/bin
rm -rf upx-3.96-amd64_linux

./scripts/dl-node.sh

# upx packing does not work with pkg
#cd ~/.pkg-cache/v3.2/
#chmod +x *
#upx * || :

echo "Done"

