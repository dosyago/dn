#!/usr/bin/env bash

which brew || /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
which mkcert || brew install mkcert
mkdir -p $HOME/local-sslcerts
cd $HOME/local-sslcerts

mkcert -key-file privkey.pem -cert-file fullchain.pem localhost
mkcert -install

