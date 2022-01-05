#!/usr/bin/env bash

cp ./.package.dev.json ./package.json
cp ./src/.common.dev.js ./src/common.js
npm version patch

