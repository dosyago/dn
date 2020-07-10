#!/bin/sh

echo "Installing nexe and upx..."

npm i -g nexe
curl -L -o upx.tar.xz https://github.com/upx/upx/releases/download/v3.96/upx-3.96-amd64_linux.tar.xz
tar -xJf upx.tar.xz
rm upx.tar.xz
sudo cp upx-3.96-amd64_linux/upx /usr/local/bin
rm -rf upx-3.96-amd64_linux

