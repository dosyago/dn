#!/bin/bash

# macOS Single Executable Application (SEA) Stamper, Signer, and Conditional Notarizer for DownloadNet

set -e
# set -x 

DEFAULT_NODE_VERSION="22"
MACOS_APP_BUNDLE_ID="com.DOSAYGO.DownloadNet"
ENTITLEMENTS_FILE_PATH="scripts/downloadnet-entitlements.xml" 
NOTARIZE_SCRIPT_PATH="./stampers/notarize_macos.sh" # Adjust if needed

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

CAN_NOTARIZE=false
if [[ "$SELECTED_SIGNING_IDENTITY" != "-" && ("$spctl_output" == *"source=Unnotarized Developer ID"* || "$spctl_output" == *"rejected"*) ]]; then
    echo "INFO: App signed with Developer ID. Eligible for notarization." >&2
    CAN_NOTARIZE=true
elif [[ "$SELECTED_SIGNING_IDENTITY" == "-" && "$spctl_output" == *": accepted"* ]]; then
    echo "INFO: App is ad-hoc signed and accepted locally. Notarization is not applicable." >&2
elif [[ "$SELECTED_SIGNING_IDENTITY" != "-" && "$spctl_output" == *": accepted"* && ("$spctl_output" == *"source=Notarized Developer ID"* || "$spctl_output" == *"source=Apple notarization"*) ]]; then
    echo "INFO: App appears to be already signed with Developer ID and notarized." >&2
else
    echo "WARNING: App status is unclear or not suitable for notarization based on spctl assessment." >&2
fi

PROCEED_WITH_NOTARIZATION="no"
if [ "$CAN_NOTARIZE" = true ]; then
    echo "---------------------------------------------------------------------"
    echo "TESTING EXECUTABLE: The application '$TEMP_EXE_PATH' will now run in the foreground."
    echo "Please interact with it to verify its basic functionality (e.g., menu appears, can select exit)."
    echo "Once you are done testing and have exited the application (or used Ctrl+C), "
    echo "this script will ask for your confirmation."
    echo "---------------------------------------------------------------------"
    
    # Make the temporary executable runnable by the current user
    chmod +x "$TEMP_EXE_PATH"

    # Run the application in the foreground. The script will pause here.
    # The user needs to manually exit the application or Ctrl+C it.
    if ! "$TEMP_EXE_PATH"; then
        echo "WARNING: Application exited with a non-zero status during test run." >&2
        # This doesn't necessarily mean it failed for the user's visual check,
        # but it's worth noting. For an Inquirer app, Ctrl+C often results in non-zero.
    fi
    
    # After the application exits (or is Ctrl+C'd), ask the user.
    echo "---------------------------------------------------------------------"
    if [ -t 0 ]; then # Check if running in an interactive terminal
        read -r -p "Did the application '$EXE_NAME_ARG' run correctly during your test? (y/N): " USER_CONFIRM_SUCCESS
        if [[ "$USER_CONFIRM_SUCCESS" =~ ^[Yy]$ ]]; then
            echo "INFO: User confirmed successful execution."
            PROCEED_WITH_NOTARIZATION="yes"
        else
            echo "INFO: User indicated the test run was not successful. Notarization will be skipped."
            PROCEED_WITH_NOTARIZATION="no"
        fi
    else # Non-interactive (CI) - this part is tricky for interactive apps
        echo "WARNING: Non-interactive environment. Cannot get user confirmation for test run." >&2
        echo "         Skipping notarization. For CI, implement automated tests or always notarize." >&2
        PROCEED_WITH_NOTARIZATION="no" # Default to no for CI without specific automated tests
    fi
fi


# Step 8: Conditional Notarization and Finalization
echo "[Step 8/8] Conditional Notarization and Finalization..." >&2
if [ "$PROCEED_WITH_NOTARIZATION" = "yes" ]; then
    if [ -x "$NOTARIZE_SCRIPT_PATH" ]; then
        echo "INFO: Proceeding to notarization for $TEMP_EXE_PATH..." >&2
        if "$NOTARIZE_SCRIPT_PATH" "$TEMP_EXE_PATH" "$MACOS_APP_BUNDLE_ID"; then
            echo "INFO: Notarization process completed successfully for $TEMP_EXE_PATH." >&2
        else
            echo "ERROR: Notarization process failed for $TEMP_EXE_PATH." >&2
        fi
    else
        echo "WARNING: Notarization script $NOTARIZE_SCRIPT_PATH not found or not executable. Skipping notarization." >&2
    fi
else
    if [ "$CAN_NOTARIZE" = true ]; then # Only print this if notarization was an option
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
# ... (final status message about notarization)
