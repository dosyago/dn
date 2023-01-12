#!/usr/bin/env bash

./node_modules/.bin/esbuild src/app.js --bundle --outfile=build/out.cjs --platform=node
pkg --compress GZip .
