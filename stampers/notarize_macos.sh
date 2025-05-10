#!/bin/bash

# notarize_macos.sh
# Script to notarize a macOS executable using xcrun notarytool and App Store Connect API Key.

set -e # Exit immediately if a command exits with a non-zero status.
# set -x # Uncomment for debugging to see each command as it's executed.

# --- Script Configuration & Input Parameters ---
if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <path_to_signed_executable> <bundle_identifier>" >&2
  echo "Example: $0 build/bin/DownloadNet com.DOSAYGO.DownloadNet" >&2
  echo "" >&2
  echo "Required Environment Variables for App Store Connect API Key Authentication:" >&2
  echo "  API_KEY_ID         : Your App Store Connect API Key ID" >&2
  echo "  API_KEY_ISSUER_ID  : Your App Store Connect API Issuer ID" >&2
  echo "  API_KEY_P8_PATH    : Absolute path to your downloaded .p8 API Key file" >&2
  echo "Optional Environment Variable:" >&2
  echo "  TEAM_ID            : Your Apple Developer Team ID (needed if your account is on multiple teams)" >&2
  exit 1
fi

SIGNED_EXE_PATH="$1"
BUNDLE_ID="$2" # Though not directly used by notarytool for single executables, good to have for context.

# --- Validate Inputs and Environment Variables ---
if [ ! -f "$SIGNED_EXE_PATH" ]; then
  echo "ERROR: Signed executable not found at '$SIGNED_EXE_PATH'" >&2
  exit 1
fi
if [ -z "$BUNDLE_ID" ]; then # Should be caught by calling script, but good to double check
  echo "ERROR: Bundle Identifier cannot be empty." >&2
  exit 1
fi

# Validate environment variables for API Key auth
if [ -z "$API_KEY_ID" ]; then
  echo "ERROR: Environment variable API_KEY_ID is not set." >&2
  exit 1
fi
if [ -z "$API_KEY_ISSUER_ID" ]; then
  echo "ERROR: Environment variable API_KEY_ISSUER_ID is not set." >&2
  exit 1
fi
if [ -z "$API_KEY_P8_PATH" ]; then
  echo "ERROR: Environment variable API_KEY_P8_PATH is not set." >&2
  exit 1
fi
if [ ! -f "$API_KEY_P8_PATH" ]; then
  echo "ERROR: API Key .p8 file not found at path specified by API_KEY_P8_PATH: '$API_KEY_P8_PATH'" >&2
  exit 1
fi

echo "--- Starting Notarization Process for '$SIGNED_EXE_PATH' ---"
echo "INFO: Using Bundle ID: $BUNDLE_ID (for context)" >&2

# 1. Create a temporary zip archive of the executable
# The notary service expects a zip, dmg, or pkg. For a single exe, zip is easiest.
ARCHIVE_BASENAME=$(basename "$SIGNED_EXE_PATH")
# Create temp zip in a more robust temporary location
TEMP_DIR=$(mktemp -d -t downloadnet-notary-XXXXXX)
TEMP_ZIP_PATH="${TEMP_DIR}/${ARCHIVE_BASENAME}.zip"

# Ensure TEMP_DIR is cleaned up on exit (normal or error)
trap 'rm -rf "$TEMP_DIR"' EXIT

echo "INFO: Creating temporary archive at '$TEMP_ZIP_PATH'..." >&2
# Go into the directory of the executable to ensure the zip contains only the executable itself, not parent dirs
pushd "$(dirname "$SIGNED_EXE_PATH")" > /dev/null
zip -jq "$TEMP_ZIP_PATH" "$(basename "$SIGNED_EXE_PATH")" # -j junks paths, -q for quiet
popd > /dev/null

if [ ! -f "$TEMP_ZIP_PATH" ]; then
  echo "ERROR: Failed to create zip archive '$TEMP_ZIP_PATH'" >&2
  exit 1
fi
echo "INFO: Archive created successfully." >&2

# 2. Submit for Notarization using notarytool with API Key
echo "INFO: Submitting '$TEMP_ZIP_PATH' for notarization..." >&2
# Construct the notarytool command arguments
NOTARYTOOL_ARGS=(
    "submit"
    "$TEMP_ZIP_PATH"
    "--key" "$API_KEY_P8_PATH"
    "--key-id" "$API_KEY_ID"
    "--issuer" "$API_KEY_ISSUER_ID"
    "--wait" # Tells notarytool to wait for the process to complete
    # "--progress" # Shows a progress bar, useful for interactive sessions
)

# Add Team ID if provided (useful if your Apple ID is part of multiple developer teams)
if [ -n "$TEAM_ID" ]; then
  NOTARYTOOL_ARGS+=("--team-id" "$TEAM_ID")
  echo "INFO: Using Team ID: $TEAM_ID" >&2
fi

echo "Executing: xcrun notarytool ${NOTARYTOOL_ARGS[*]}" >&2

# Execute and capture output. Using eval can be risky if variables contain shell metacharacters,
# but here paths and IDs are generally safe. For utmost safety, avoid eval if possible.
# However, direct execution with array expansion is safer:
submission_output=$(xcrun notarytool "${NOTARYTOOL_ARGS[@]}" 2>&1) # Capture stdout and stderr
SUBMISSION_EXIT_CODE=$?

echo "-----------------------------------------------------" >&2
echo "INFO: Notarytool submission output:" >&2
echo "$submission_output"                                    >&2
echo "-----------------------------------------------------" >&2


# The temporary zip file is no longer needed after submission if --wait is used
# The trap command will clean up TEMP_DIR which includes the zip file on script exit.
# rm -f "$TEMP_ZIP_PATH" 
# echo "INFO: Temporary archive $TEMP_ZIP_PATH removed." >&2


if [ $SUBMISSION_EXIT_CODE -ne 0 ]; then
  echo "ERROR: Notarization submission failed with notarytool. Exit code: $SUBMISSION_EXIT_CODE" >&2
  echo "Please review the output above from notarytool for specific error messages." >&2
  # Example: To get logs for a specific submission ID (if you didn't use --wait or it failed early):
  #   submission_id=$(echo "$submission_output" | awk '/id:/ {print $2}')
  #   xcrun notarytool log "$submission_id" --key "$API_KEY_P8_PATH" --key-id "$API_KEY_ID" --issuer "$API_KEY_ISSUER_ID"
  exit 1
fi

# With --wait, notarytool's output directly indicates success or failure.
# A successful output with --wait usually includes "status: Accepted".
if [[ "$submission_output" == *"status: Accepted"* ]]; then
  echo "SUCCESS: Notarization successful! Status is 'Accepted'." >&2
else
  echo "ERROR: Notarization did not complete successfully or status is not 'Accepted'." >&2
  echo "Please check the submission history in App Store Connect or use 'xcrun notarytool history'." >&2
  exit 1
fi

# 3. Staple the notarization ticket to the original executable
# This must be done on the *original* signed executable, not the zip.
echo "INFO: Stapling notarization ticket to '$SIGNED_EXE_PATH'..." >&2
xcrun stapler staple "$SIGNED_EXE_PATH"
STAPLER_EXIT_CODE=$?

if [ $STAPLER_EXIT_CODE -ne 0 ]; then
  echo "ERROR: Failed to staple the notarization ticket to '$SIGNED_EXE_PATH'. Exit code: $STAPLER_EXIT_CODE" >&2
  echo "This can happen if the notarization ticket isn't available on Apple's servers yet, though '--wait' should prevent this." >&2
  echo "Try running 'xcrun stapler staple \"$SIGNED_EXE_PATH\"' manually after a few minutes." >&2
  exit 1
fi

echo "SUCCESS: Notarization ticket stapled successfully to '$SIGNED_EXE_PATH'." >&2

# 4. Verify Gatekeeper assessment again (optional, but good for confirmation)
echo "INFO: Re-assessing with spctl after notarization and stapling for '$SIGNED_EXE_PATH'..." >&2
spctl_output_after_notarize=$(spctl --assess --type execute --verbose "$SIGNED_EXE_PATH" 2>&1) || true # Capture output, ignore exit code for now
echo "$spctl_output_after_notarize"

# Check for expected "accepted" and "Notarized" source
if [[ "$spctl_output_after_notarize" == *": accepted"* && \
      ( "$spctl_output_after_notarize" == *"source=Notarized Developer ID"* || \
        "$spctl_output_after_notarize" == *"source=Apple notarization"* || \
        "$spctl_output_after_notarize" == *"source=Mac App Store"* ) ]]; then # Mac App Store source also implies notarization
    echo "SUCCESS: spctl assessment after notarization: accepted with notarized source." >&2
else
    echo "WARNING: spctl assessment after notarization did not confirm 'accepted' with a notarized source." >&2
    echo "         Output was: $(echo "$spctl_output_after_notarize" | head -n 1)" >&2
    echo "         This might indicate an issue with the stapling or the notarization itself." >&2
fi

echo "--- Notarization Process Completed for '$SIGNED_EXE_PATH' ---"
