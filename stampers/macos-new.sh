#!/bin/bash

# macOS Single Executable Application (SEA) Stamper and Signer for DownloadNet
#
# This script automates the process of:
# 1. Setting up the correct Node.js version using NVM.
# 2. Generating a SEA configuration and blob.
# 3. Creating an executable from the Node binary.
# 4. Injecting the SEA blob into the executable.
# 5. Automatically detecting and prompting for the appropriate Apple Developer ID Application certificate.
# 6. Code signing the executable with hardened runtime and timestamping.
# 7. Verifying the signature.

# Exit on any error
set -e

# Optional: Enable for detailed command tracing during debugging
# set -x

# --- Configuration & Variables ---
DEFAULT_NODE_VERSION="22" # Node.js version to use for building the SEA
MACOS_APP_BUNDLE_ID="com.DOSAYGO.DownloadNet" # Define your bundle ID

# --- Helper Functions ---

# Function to ensure NVM is sourced and working
source_nvm() {
  # Try standard NVM paths
  if [ -n "$NVM_DIR" ] && [ -s "$NVM_DIR/nvm.sh" ]; then
    # shellcheck source=/dev/null
    source "$NVM_DIR/nvm.sh"
  elif [ -s "$HOME/.nvm/nvm.sh" ]; then
    # shellcheck source=/dev/null
    source "$HOME/.nvm/nvm.sh"
  fi

  if ! command -v nvm &> /dev/null; then
    echo "ERROR: NVM command not found after attempting to source." >&2
    echo "Please ensure NVM is installed correctly: https://github.com/nvm-sh/nvm#installing-and-updating" >&2
    return 1
  fi
  return 0
}

# Function to find Developer ID Application signing identities
find_developer_id_identities() {
  local identities_output
  local developer_id_identities=()
  local identity_line

  echo "INFO: Searching for valid 'Developer ID Application' signing identities in keychain..." >&2
  identities_output=$(security find-identity -v -p codesigning)

  while IFS= read -r identity_line; do
    if [[ "$identity_line" == *"Developer ID Application:"* ]]; then
      local name
      # Extract the full name in quotes. Handles names with spaces.
      # Regex: Find a closing parenthesis, a space, then capture everything up to the next quote (non-greedy if possible, but sed is greedy).
      # Then remove leading/trailing quotes.
      name=$(echo "$identity_line" | sed -n 's/.*\) *"\(.*\)"/\1/p')
      if [ -n "$name" ]; then
        developer_id_identities+=("$name")
      fi
    fi
  done <<< "$identities_output"

  # Return the found identities (one per line for easy processing by calling script)
  for id_name in "${developer_id_identities[@]}"; do
    echo "$id_name"
  done
}

# --- Main Script Logic ---

# Validate input parameters
if [ "$#" -ne 3 ]; then
  echo "Usage: $0 <output-executable-name> <path-to-js-source-file> <output-folder-path>" >&2
  echo "Example: $0 dn build/cjs/dn.cjs build/bin/" >&2
  exit 1
fi

EXE_NAME_ARG="$1"
JS_SOURCE_FILE_ARG="$2"
OUTPUT_FOLDER_ARG="$3"

echo "--- DownloadNet macOS SEA Stamper & Signer ---"

# 1. Setup NVM and Node.js
echo "[Step 1/7] Setting up Node.js environment..." >&2
if ! source_nvm; then exit 1; fi

echo "INFO: Ensuring Node.js version $DEFAULT_NODE_VERSION is installed and used..." >&2
nvm install "$DEFAULT_NODE_VERSION" || { echo "ERROR: Failed to install Node $DEFAULT_NODE_VERSION" >&2; exit 1; }
nvm use "$DEFAULT_NODE_VERSION" || { echo "ERROR: Failed to use Node $DEFAULT_NODE_VERSION" >&2; exit 1; }
echo "INFO: Using Node version: $(node -v) from $(command -v node)" >&2

# 2. Prepare output directory and paths
mkdir -p "$OUTPUT_FOLDER_ARG"
# Temporary executable will be created in the current directory, then moved.
TEMP_EXE_PATH="./${EXE_NAME_ARG}_temp_sea" # Temporary name to avoid conflict if script is re-run

# 3. Create sea-config.json
# Assuming 'public/' directory and JS_SOURCE_FILE_ARG are relative to the CWD where this script is run from.
# If JS_SOURCE_FILE_ARG is not relative to CWD, it needs to be an absolute path or handled accordingly.
echo "[Step 2/7] Creating sea-config.json..." >&2
cat <<EOF > sea-config.json
{
  "main": "${JS_SOURCE_FILE_ARG}",
  "output": "sea-prep.blob",
  "disableExperimentalSEAWarning": true,
  "useCodeCache": true,
  "assets": {
    "favicon.ico": "public/favicon.ico",
    "top.html": "public/top.html",
    "style.css": "public/style.css",
    "injection.js": "public/injection.js",
    "redirector.html": "public/redirector.html"
  }
}
EOF
echo "INFO: sea-config.json created for main entry: ${JS_SOURCE_FILE_ARG}" >&2

# 4. Generate the SEA blob
echo "[Step 3/7] Generating SEA blob (sea-prep.blob)..." >&2
node --experimental-sea-config sea-config.json || { echo "ERROR: Failed to generate SEA blob." >&2; rm -f sea-config.json; exit 1; }
echo "INFO: SEA blob generated." >&2

# 5. Prepare the Node binary for injection
echo "[Step 4/7] Preparing Node binary..." >&2
NODE_EXECUTABLE_PATH="$(command -v node)"
if [ ! -f "$NODE_EXECUTABLE_PATH" ]; then
    echo "ERROR: Node executable not found at $NODE_EXECUTABLE_PATH" >&2
    rm -f sea-config.json sea-prep.blob
    exit 1
fi
cp "$NODE_EXECUTABLE_PATH" "$TEMP_EXE_PATH" || { echo "ERROR: Failed to copy node binary to $TEMP_EXE_PATH." >&2; rm -f sea-config.json sea-prep.blob; exit 1; }
echo "INFO: Node binary copied to $TEMP_EXE_PATH." >&2

echo "INFO: Removing existing signature from $TEMP_EXE_PATH (if any)..." >&2
codesign --remove-signature "$TEMP_EXE_PATH" 2>/dev/null || echo "INFO: No existing signature to remove, or removal failed (this is often okay)." >&2

# 6. Inject the SEA blob
echo "[Step 5/7] Injecting SEA blob into $TEMP_EXE_PATH..." >&2
NPX_CMD="npx"
if ! command -v npx &> /dev/null; then
    NODE_BIN_PATH=$(dirname "$(command -v node)")
    if [ -x "$NODE_BIN_PATH/npx" ]; then NPX_CMD="$NODE_BIN_PATH/npx"; else
        echo "ERROR: npx command not found. Please install npx (usually comes with npm)." >&2
        rm -f sea-config.json sea-prep.blob "$TEMP_EXE_PATH"
        exit 1
    fi
fi
"$NPX_CMD" postject "$TEMP_EXE_PATH" NODE_SEA_BLOB sea-prep.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 \
  --macho-segment-name NODE_SEA || { echo "ERROR: postject failed."; rm -f sea-config.json sea-prep.blob "$TEMP_EXE_PATH"; exit 1; }
echo "INFO: SEA blob injected successfully." >&2

# 7. Code Signing
echo "[Step 6/7] Preparing for Code Signing..." >&2
SELECTED_SIGNING_IDENTITY=""
# Attempt to use environment variable first, if set for non-interactive use
if [ -n "${MACOS_CODESIGN_IDENTITY_DOWNLOADNET}" ]; then
    echo "INFO: Using pre-set signing identity from MACOS_CODESIGN_IDENTITY_DOWNLOADNET: ${MACOS_CODESIGN_IDENTITY_DOWNLOADNET}" >&2
    SELECTED_SIGNING_IDENTITY="${MACOS_CODESIGN_IDENTITY_DOWNLOADNET}"
else
    # Auto-detect Developer ID Application certificates
    DEVELOPER_ID_CANDIDATES=()
    while IFS= read -r line; do DEVELOPER_ID_CANDIDATES+=("$line"); done < <(find_developer_id_identities)

    NUM_CANDIDATES=${#DEVELOPER_ID_CANDIDATES[@]}

    if [ "$NUM_CANDIDATES" -eq 0 ]; then
        echo "WARNING: No 'Developer ID Application' certificates found in keychain." >&2
        echo "The application will be ad-hoc signed. It will run locally but may not pass Gatekeeper on other machines or be notarizable." >&2
        SELECTED_SIGNING_IDENTITY="-" # Ad-hoc signing
    elif [ "$NUM_CANDIDATES" -eq 1 ]; then
        SELECTED_SIGNING_IDENTITY="${DEVELOPER_ID_CANDIDATES[0]}"
        echo "INFO: Automatically selected unique 'Developer ID Application' certificate: $SELECTED_SIGNING_IDENTITY" >&2
    else
        echo "INFO: Multiple 'Developer ID Application' certificates found. Please choose one:" >&2
        PS3="Select certificate by number (or type 'q' to quit, 'a' for ad-hoc): "
        select opt in "${DEVELOPER_ID_CANDIDATES[@]}" "Ad-hoc Sign (not recommended for distribution)" "Quit"; do
            if [[ "$REPLY" == "q" || "$opt" == "Quit" ]]; then
                echo "INFO: Signing process aborted by user." >&2
                rm -f sea-config.json sea-prep.blob "$TEMP_EXE_PATH"
                exit 1
            elif [[ "$opt" == "Ad-hoc Sign (not recommended for distribution)" ]]; then
                echo "INFO: Proceeding with ad-hoc signing." >&2
                SELECTED_SIGNING_IDENTITY="-"
                break
            elif [[ "$REPLY" -ge 1 && "$REPLY" -le "$NUM_CANDIDATES" ]]; then
                SELECTED_SIGNING_IDENTITY="${DEVELOPER_ID_CANDIDATES[$((REPLY-1))]}"
                echo "INFO: You selected: $SELECTED_SIGNING_IDENTITY" >&2
                break
            else
                echo "Invalid selection: $REPLY. Please try again." >&2
            fi
        done
    fi
fi

if [ -z "$SELECTED_SIGNING_IDENTITY" ]; then
    echo "ERROR: No signing identity was selected or determined. Cannot proceed with signing." >&2
    rm -f sea-config.json sea-prep.blob "$TEMP_EXE_PATH"
    exit 1
fi

echo "INFO: Signing $TEMP_EXE_PATH with identity: '$SELECTED_SIGNING_IDENTITY' and bundle ID: '$MACOS_APP_BUNDLE_ID'" >&2
SIGN_OPTIONS="--force --deep --timestamp --identifier \"$MACOS_APP_BUNDLE_ID\"" # Add identifier
if [ "$SELECTED_SIGNING_IDENTITY" != "-" ]; then
    SIGN_OPTIONS="$SIGN_OPTIONS --options runtime"
fi

codesign $SIGN_OPTIONS --sign "$SELECTED_SIGNING_IDENTITY" "$TEMP_EXE_PATH"
SIGN_EXIT_CODE=$?
if [ $SIGN_EXIT_CODE -ne 0 ]; then
    echo "ERROR: codesign failed for $TEMP_EXE_PATH with identity '$SELECTED_SIGNING_IDENTITY'. Exit code: $SIGN_EXIT_CODE" >&2
    echo "Ensure the certificate is in your login keychain and accessible, and that the private key is not passphrase protected or is unlocked." >&2
    rm -f sea-config.json sea-prep.blob "$TEMP_EXE_PATH"
    exit 1
fi
echo "INFO: Code signing successful." >&2

# 8. Verification and Finalization
echo "[Step 7/7] Verifying signature and finalizing..." >&2
echo "INFO: Verifying signature for $TEMP_EXE_PATH..." >&2
codesign --verify --verbose=2 "$TEMP_EXE_PATH" || { echo "ERROR: codesign --verify failed. The signature is invalid."; rm -f sea-config.json sea-prep.blob "$TEMP_EXE_PATH"; exit 1; }
echo "INFO: Signature verified by codesign." >&2

echo "INFO: Displaying signature details for $TEMP_EXE_PATH..." >&2
codesign --display --verbose=2 "$TEMP_EXE_PATH"

echo "INFO: Assessing with spctl for $TEMP_EXE_PATH..." >&2
spctl_output=$(spctl --assess --type execute --verbose "$TEMP_EXE_PATH" 2>&1) || true # Capture output even on failure
echo "$spctl_output"
if [[ "$spctl_output" == *": accepted"* ]]; then
    echo "INFO: spctl assessment: accepted." >&2
else
    echo "WARNING: spctl assessment did not explicitly state 'accepted'. This might be expected if not notarized or if ad-hoc signed." >&2
fi

FINAL_EXE_PATH="$OUTPUT_FOLDER_ARG/$EXE_NAME_ARG"
echo "INFO: Moving $TEMP_EXE_PATH to $FINAL_EXE_PATH..." >&2
mv "$TEMP_EXE_PATH" "$FINAL_EXE_PATH" || { echo "ERROR: Failed to move executable to output folder $FINAL_EXE_PATH."; rm -f sea-config.json sea-prep.blob "$TEMP_EXE_PATH"; exit 1; }

echo "INFO: Cleaning up temporary files (sea-config.json, sea-prep.blob)..." >&2
rm -f sea-config.json sea-prep.blob

echo "--- DownloadNet macOS SEA Stamping & Signing Complete ---" >&2
echo "SUCCESS: Executable created at: $FINAL_EXE_PATH" >&2
