#!/bin/bash

# macOS Single Executable Application (SEA) Stamper, Signer, and Conditional Notarizer for DownloadNet

set -e
# set -x 

# --- Configuration & Variables ---
DEFAULT_NODE_VERSION="22"
MACOS_APP_BUNDLE_ID="com.DOSAYGO.DownloadNet" # Your registered Bundle ID
ENTITLEMENTS_FILE_PATH="scripts/downloadnet-entitlements.xml" 
NOTARIZE_SCRIPT_PATH="./stampers/notarize_macos.sh" # Path to your notarization script

# --- NEW: Check for Notarization Environment Variables ---
CAN_ATTEMPT_NOTARIZATION=true
echo "INFO: Checking for notarization prerequisites..." >&2
if [ -z "$API_KEY_ID" ]; then
  echo "WARNING: Environment variable API_KEY_ID is not set. Notarization will be skipped." >&2
  CAN_ATTEMPT_NOTARIZATION=false
fi
if [ -z "$API_KEY_ISSUER_ID" ]; then
  echo "WARNING: Environment variable API_KEY_ISSUER_ID is not set. Notarization will be skipped." >&2
  CAN_ATTEMPT_NOTARIZATION=false
fi
if [ -z "$API_KEY_P8_PATH" ]; then
  echo "WARNING: Environment variable API_KEY_P8_PATH is not set. Notarization will be skipped." >&2
  CAN_ATTEMPT_NOTARIZATION=false
elif [ ! -f "$API_KEY_P8_PATH" ]; then # Also check if the path points to an actual file
  echo "WARNING: API Key .p8 file not found at path specified by API_KEY_P8_PATH: '$API_KEY_P8_PATH'. Notarization will be skipped." >&2
  CAN_ATTEMPT_NOTARIZATION=false
fi

if [ "$CAN_ATTEMPT_NOTARIZATION" = true ]; then
    echo "INFO: Notarization environment variables appear to be set." >&2
else
    echo "INFO: One or more required environment variables for notarization are missing or invalid." >&2
    echo "      To enable notarization, please set: API_KEY_ID, API_KEY_ISSUER_ID, API_KEY_P8_PATH." >&2
fi
echo "-----------------------------------------------------" >&2


# --- Helper Functions (source_nvm, find_developer_id_identities - keep as is) ---
source_nvm() {
  if [ -n "$NVM_DIR" ] && [ -s "$NVM_DIR/nvm.sh" ]; then source "$NVM_DIR/nvm.sh";
  elif [ -s "$HOME/.nvm/nvm.sh" ]; then source "$HOME/.nvm/nvm.sh"; fi
  if ! command -v nvm &> /dev/null; then echo "ERROR: NVM command not found." >&2; return 1; fi
  return 0
}

find_developer_id_identities() {
  local identities_output developer_id_identities=() identity_line
  echo "INFO: Searching for valid 'Developer ID Application' signing identities in keychain..." >&2
  identities_output=$(security find-identity -v -p codesigning | awk '{$1=$1;print}')
  while IFS= read -r identity_line; do
    if [[ "$identity_line" == *"Developer ID Application:"* ]]; then
      local name; name=$(echo "$identity_line" | awk -F '"' '{print $2}')
      if [ -n "$name" ]; then developer_id_identities+=("$name"); fi
    fi
  done <<< "$identities_output"; for id_name in "${developer_id_identities[@]}"; do echo "$id_name"; done
}
# --- End Helper Functions ---

if [ "$#" -ne 3 ]; then
  echo "Usage: $0 <output-executable-name> <path-to-js-source-file> <output-folder-path>" >&2
  exit 1
fi

EXE_NAME_ARG="$1"
JS_SOURCE_FILE_ARG="$2"
OUTPUT_FOLDER_ARG="$3"

echo "--- DownloadNet macOS SEA Stamper, Signer & Conditional Notarizer ---"
# Steps 1-5: Setup, SEA generation, Node binary prep, Injection (keep as is)
echo "[Step 1/8] Setting up Node.js environment..." >&2
if ! source_nvm; then exit 1; fi
nvm install "$DEFAULT_NODE_VERSION" > /dev/null || { echo "ERROR: Failed to install Node $DEFAULT_NODE_VERSION" >&2; exit 1; }
nvm use "$DEFAULT_NODE_VERSION" > /dev/null || { echo "ERROR: Failed to use Node $DEFAULT_NODE_VERSION" >&2; exit 1; }
echo "INFO: Using Node version: $(node -v)" >&2
if [ ! -f "$ENTITLEMENTS_FILE_PATH" ]; then echo "ERROR: Entitlements file not found at $ENTITLEMENTS_FILE_PATH" >&2; exit 1; fi
echo "INFO: Using entitlements file: $ENTITLEMENTS_FILE_PATH" >&2
mkdir -p "$OUTPUT_FOLDER_ARG"
TEMP_EXE_PATH="./${EXE_NAME_ARG}_sea_final_build"
echo "[Step 2/8] Creating sea-config.json..." >&2
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
echo "[Step 3/8] Generating SEA blob..." >&2
node --experimental-sea-config sea-config.json || { echo "ERROR: Failed to generate SEA blob." >&2; rm -f sea-config.json; exit 1; }
echo "[Step 4/8] Preparing Node binary..." >&2
NODE_EXECUTABLE_PATH="$(command -v node)"
cp "$NODE_EXECUTABLE_PATH" "$TEMP_EXE_PATH" || { echo "ERROR: Failed to copy node binary." >&2; rm -f sea-config.json sea-prep.blob; exit 1; }
echo "INFO: Removing existing signature from copied Node binary $TEMP_EXE_PATH..." >&2
codesign --remove-signature "$TEMP_EXE_PATH" 2>/dev/null || echo "INFO: No existing signature or removal failed (okay)." >&2
echo "[Step 5/8] Injecting SEA blob into $TEMP_EXE_PATH..." >&2
NPX_CMD="npx"; if ! command -v npx &> /dev/null; then NODE_BIN_PATH=$(dirname "$(command -v node)"); if [ -x "$NODE_BIN_PATH/npx" ]; then NPX_CMD="$NODE_BIN_PATH/npx"; else echo "ERROR: npx not found." >&2; exit 1; fi; fi
"$NPX_CMD" postject "$TEMP_EXE_PATH" NODE_SEA_BLOB sea-prep.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 \
  --macho-segment-name NODE_SEA || { echo "ERROR: postject failed."; rm -f sea-config.json sea-prep.blob "$TEMP_EXE_PATH"; exit 1; }
echo "INFO: SEA blob injected." >&2

# Step 6: Code Signing (keep as is)
echo "[Step 6/8] Code Signing Process..." >&2
SELECTED_SIGNING_IDENTITY=""
if [ -n "${MACOS_CODESIGN_IDENTITY_DOWNLOADNET}" ]; then SELECTED_SIGNING_IDENTITY="${MACOS_CODESIGN_IDENTITY_DOWNLOADNET}"; echo "INFO: Using pre-set signing identity: ${SELECTED_SIGNING_IDENTITY}" >&2
else
    DEVELOPER_ID_CANDIDATES=(); while IFS= read -r line; do DEVELOPER_ID_CANDIDATES+=("$line"); done < <(find_developer_id_identities)
    NUM_CANDIDATES=${#DEVELOPER_ID_CANDIDATES[@]}
    if [ "$NUM_CANDIDATES" -eq 0 ]; then SELECTED_SIGNING_IDENTITY="-"; echo "WARNING: No Developer ID certs found. Ad-hoc signing." >&2
    elif [ "$NUM_CANDIDATES" -eq 1 ]; then SELECTED_SIGNING_IDENTITY="${DEVELOPER_ID_CANDIDATES[0]}"; echo "INFO: Auto-selected unique Developer ID cert: $SELECTED_SIGNING_IDENTITY" >&2
    else 
        if [ -t 0 ]; then PS3="Select certificate by number (or 'a' for ad-hoc, 'q' to quit): "; select opt in "${DEVELOPER_ID_CANDIDATES[@]}" "Ad-hoc Sign (not for distribution)" "Quit"; do case $REPLY in q|$(($NUM_CANDIDATES+2))) exit 1;; $(($NUM_CANDIDATES+1))) SELECTED_SIGNING_IDENTITY="-"; break;; *) if [[ "$REPLY" -ge 1 && "$REPLY" -le "$NUM_CANDIDATES" ]]; then SELECTED_SIGNING_IDENTITY="${DEVELOPER_ID_CANDIDATES[$((REPLY-1))]}"; break; else echo "Invalid."; fi;; esac; done;
        else SELECTED_SIGNING_IDENTITY="${DEVELOPER_ID_CANDIDATES[0]}"; echo "WARNING: Non-interactive, multiple certs, using first: $SELECTED_SIGNING_IDENTITY" >&2; fi
        echo "INFO: You selected: $SELECTED_SIGNING_IDENTITY" >&2
    fi
fi
if [ -z "$SELECTED_SIGNING_IDENTITY" ]; then echo "ERROR: No signing identity selected." >&2; exit 1; fi
echo "INFO: Signing $TEMP_EXE_PATH with identity: '$SELECTED_SIGNING_IDENTITY', bundle ID: '$MACOS_APP_BUNDLE_ID', entitlements: '$ENTITLEMENTS_FILE_PATH'" >&2
SIGN_OPTIONS="--force --deep --timestamp --identifier \"$MACOS_APP_BUNDLE_ID\" --entitlements \"$ENTITLEMENTS_FILE_PATH\""
if [ "$SELECTED_SIGNING_IDENTITY" != "-" ]; then SIGN_OPTIONS="$SIGN_OPTIONS --options runtime"; fi
eval "codesign $SIGN_OPTIONS --sign \"$SELECTED_SIGNING_IDENTITY\" \"$TEMP_EXE_PATH\""
if [ $? -ne 0 ]; then echo "ERROR: codesign failed." >&2; exit 1; fi
echo "INFO: Code signing successful." >&2

# Step 7: Verifying Signature and Testing Execution
echo "[Step 7/8] Verifying Signature and Testing Execution..." >&2
echo "INFO: Verifying signature for $TEMP_EXE_PATH..." >&2
codesign --verify --strict --verbose=4 "$TEMP_EXE_PATH" || { echo "ERROR: codesign --verify failed." >&2; exit 1; }
echo "INFO: Signature verified." >&2
echo "INFO: Displaying signature details (check entitlements)..." >&2
codesign --display --entitlements - --verbose=2 "$TEMP_EXE_PATH"
echo "INFO: Assessing with spctl for $TEMP_EXE_PATH..." >&2
spctl_output=$(spctl --assess --type execute --verbose "$TEMP_EXE_PATH" 2>&1) || true
echo "$spctl_output"

APP_SIGNED_WITH_DEV_ID=false
if [ "$SELECTED_SIGNING_IDENTITY" != "-" ]; then
    APP_SIGNED_WITH_DEV_ID=true
fi

ELIGIBLE_FOR_NOTARIZATION=false
if [ "$APP_SIGNED_WITH_DEV_ID" = true ] && [[ "$spctl_output" == *"source=Unnotarized Developer ID"* || "$spctl_output" == *"rejected"* ]]; then
    echo "INFO: App signed with Developer ID and appears unnotarized. Eligible for notarization attempt." >&2
    ELIGIBLE_FOR_NOTARIZATION=true
elif [ "$APP_SIGNED_WITH_DEV_ID" = true ] && [[ "$spctl_output" == *": accepted"* && ("$spctl_output" == *"source=Notarized Developer ID"* || "$spctl_output" == *"source=Apple notarization"*) ]]; then
    echo "INFO: App appears to be already signed with Developer ID and notarized." >&2
elif [ "$SELECTED_SIGNING_IDENTITY" == "-" ]; then
    echo "INFO: App is ad-hoc signed. Notarization is not applicable." >&2
else
    echo "WARNING: App status is unclear or not suitable for notarization based on spctl assessment." >&2
fi

PROCEED_WITH_NOTARIZATION_USER_CONFIRMED="no"
if [ "$ELIGIBLE_FOR_NOTARIZATION" = true ]; then
    echo "---------------------------------------------------------------------"
    echo "TESTING EXECUTABLE: The application '$TEMP_EXE_PATH' will now run in the foreground."
    echo "Please interact with it to verify its basic functionality."
    echo "Once you are done testing and have exited the application (or used Ctrl+C), "
    echo "this script will ask for your confirmation to notarize."
    echo "---------------------------------------------------------------------"
    chmod +x "$TEMP_EXE_PATH"
    if ! "$TEMP_EXE_PATH"; then
        echo "WARNING: Application exited with a non-zero status during test run." >&2
    fi
    echo "---------------------------------------------------------------------"
    if [ -t 0 ]; then 
        read -r -p "Do you want to proceed with notarization for '$EXE_NAME_ARG' ? (y/N): " USER_CONFIRM_SUCCESS
        if [[ "$USER_CONFIRM_SUCCESS" =~ ^[Yy]$ ]]; then
            echo "INFO: User confirmed successful execution."
            PROCEED_WITH_NOTARIZATION_USER_CONFIRMED="yes"
        else
            echo "INFO: Person indicated a preference to skip notarization."
        fi
    else 
        echo "WARNING: Non-interactive environment. Cannot get user confirmation for test run." >&2
        echo "         To notarize in CI, ensure MACOS_CODESIGN_IDENTITY_DOWNLOADNET is set and notarization env vars are present." >&2
        echo "         And consider adding an automated test or always notarizing if Dev ID signed." >&2
    fi
fi


# Step 8: Conditional Notarization and Finalization
echo "[Step 8/8] Conditional Notarization and Finalization..." >&2
FINAL_NOTARIZATION_DECISION="no"

if [ "$ELIGIBLE_FOR_NOTARIZATION" = true ] && [ "$PROCEED_WITH_NOTARIZATION_USER_CONFIRMED" = "yes" ] && [ "$CAN_ATTEMPT_NOTARIZATION" = true ]; then
    if [ -x "$NOTARIZE_SCRIPT_PATH" ]; then
        echo "INFO: Proceeding to notarization for $TEMP_EXE_PATH..." >&2
        # Pass the temporary executable path and bundle ID to the notarization script
        if "$NOTARIZE_SCRIPT_PATH" "$TEMP_EXE_PATH" "$MACOS_APP_BUNDLE_ID"; then
            echo "INFO: Notarization process reported success for $TEMP_EXE_PATH." >&2
            FINAL_NOTARIZATION_DECISION="yes" # Assume success from script
        else
            echo "ERROR: Notarization process reported failure for $TEMP_EXE_PATH." >&2
            # Notarization script should output details. The main build might still succeed but app won't be notarized.
        fi
    else
        echo "WARNING: Notarization script $NOTARIZE_SCRIPT_PATH not found or not executable. Skipping actual notarization." >&2
        echo "         (CAN_ATTEMPT_NOTARIZATION was true, but script is missing)" >&2
    fi
elif [ "$ELIGIBLE_FOR_NOTARIZATION" = true ]; then # Eligible, but user said no or env vars missing
    if [ "$CAN_ATTEMPT_NOTARIZATION" = false ]; then
        echo "INFO: Notarization skipped because required environment variables (API_KEY_ID, etc.) are not set." >&2
    elif [ "$PROCEED_WITH_NOTARIZATION_USER_CONFIRMED" = "no" ]; then
        echo "INFO: Notarization skipped based on test run outcome or user choice." >&2
    fi
fi


FINAL_EXE_PATH="$OUTPUT_FOLDER_ARG/$EXE_NAME_ARG"
echo "INFO: Moving $TEMP_EXE_PATH to $FINAL_EXE_PATH..." >&2
mv "$TEMP_EXE_PATH" "$FINAL_EXE_PATH" || { echo "ERROR: Failed to move executable."; exit 1; }

echo "INFO: Cleaning up temporary files..." >&2
rm -f sea-config.json sea-prep.blob

echo "--- DownloadNet macOS SEA Stamping & Signing Complete ---" >&2
echo "SUCCESS: Executable created at: $FINAL_EXE_PATH" >&2
if [ "$FINAL_NOTARIZATION_DECISION" = "yes" ]; then
    echo "INFO: The executable should be notarized."
elif [ "$ELIGIBLE_FOR_NOTARIZATION" = true ]; then # Was eligible but didn't get notarized for some reason
    echo "WARNING: The executable is signed with Developer ID but was NOT notarized."
elif [ "$SELECTED_SIGNING_IDENTITY" == "-" ]; then
    echo "INFO: The executable is ad-hoc signed (not for distribution, notarization not applicable)."
else
    echo "INFO: Notarization was not attempted or was not applicable for other reasons."
fi
