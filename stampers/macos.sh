#!/bin/bash

source $HOME/.nvm/nvm.sh

# Variables
EXE_NAME="$1"
JS_SOURCE_FILE="$2"
OUTPUT_FOLDER="$3"

# Ensure nvm is installed
if ! command -v nvm &> /dev/null
then
  echo "nvm not found. Installing..."
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.3/install.sh | bash
  # shellcheck source=/dev/null
  source ~/.nvm/nvm.sh
fi

# Use Node 22
nvm install 22
nvm use 22

# Create sea-config.json
cat <<EOF > sea-config.json
{
  "main": "${JS_SOURCE_FILE}",
  "output": "sea-prep.blob",
  "disableExperimentalSEAWarning": true,
  "useCodeCache": true,
  "assets": {
    "index.html": "public/index.html",
    "favicon.ico": "public/favicon.ico",
    "top.html": "public/top.html",
    "style.css": "public/style.css",
    "injection.js": "public/injection.js",
    "redirector.html": "public/redirector.html"
  }
}
EOF

# Generate the blob
node --experimental-sea-config sea-config.json

# Copy node binary
cp "$(command -v node)" "$EXE_NAME"

# Remove the signature of the binary
codesign --remove-signature "$EXE_NAME"

# Inject the blob
npx postject "$EXE_NAME" NODE_SEA_BLOB sea-prep.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 \
  --macho-segment-name NODE_SEA

# Sign the binary
codesign --sign - "$EXE_NAME"

# Move the executable to the output folder
mv "$EXE_NAME" "$OUTPUT_FOLDER"

# Clean up
rm sea-config.json sea-prep.blob

