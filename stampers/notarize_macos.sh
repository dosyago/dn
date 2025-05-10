#!/bin/bash

# create-notarized-pkg.sh
# Creates a notarized and stapled .pkg installer from a code-signed binary, signing the entire package.

# Usage
usage() {
    echo "Usage: $0 --binary <path> --keychain-profile <profile> --bundle-id <id> --version <version> --installer-cert <installer-cert-name>"
    echo "Example: $0 --binary ./bin/dn-macos --keychain-profile notarization-profile --bundle-id com.DOSAYGO.DownloadNet --version 4.5.1 --installer-cert 'Developer ID Installer: DOSAYGO"
    exit 1
}

# Parse command-line arguments
while [ "$#" -gt 0 ]; do
    case "$1" in
        --binary) BINARY_PATH="$2"; shift 2 ;;
        --keychain-profile) KEYCHAIN_PROFILE="$2"; shift 2 ;;
        --bundle-id) BUNDLE_ID="$2"; shift 2 ;;
        --version) VERSION="$2"; shift 2 ;;
        --installer-cert) INSTALLER_CERT="$2"; shift 2 ;;
        *) echo "Unknown option: $1"; usage ;;
    esac
done

# Validate inputs
if [ -z "$BINARY_PATH" ] || [ -z "$KEYCHAIN_PROFILE" ] || [ -z "$BUNDLE_ID" ] || [ -z "$VERSION" ] || [ -z "$INSTALLER_CERT" ]; then
    echo "Error: All arguments are required."
    usage
fi

if [ ! -f "$BINARY_PATH" ]; then
    echo "Error: Binary not found at $BINARY_PATH"
    exit 1
fi

# Verify binary is code-signed
echo "Verifying signature of input binary: $BINARY_PATH"
if ! codesign --verify --verbose "$BINARY_PATH"; then
    echo "Error: Input binary is not code-signed or signature is invalid."
    exit 1
fi

# Set up working directory
BUILD_DIR="$HOME/build"
echo "Cleaning and setting up working directory: $BUILD_DIR"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/pkg_root/usr/local/bin"

# Copy binary to package root
BINARY_NAME=$(basename "$BINARY_PATH")
cp "$BINARY_PATH" "$BUILD_DIR/pkg_root/usr/local/bin/$BINARY_NAME"
chmod +x "$BUILD_DIR/pkg_root/usr/local/bin/$BINARY_NAME"

# Verify signature after copying
echo "Verifying signature of copied binary: $BUILD_DIR/pkg_root/usr/local/bin/$BINARY_NAME"
if ! codesign --verify --verbose "$BUILD_DIR/pkg_root/usr/local/bin/$BINARY_NAME"; then
    echo "Error: Copied binary lost its signature or is invalid."
    exit 1
fi

# Create component package
COMPONENT_PKG="$BUILD_DIR/component.pkg"
pkgbuild --root "$BUILD_DIR/pkg_root" \
         --identifier "$BUNDLE_ID" \
         --version "$VERSION" \
         --install-location "/" \
         "$COMPONENT_PKG"

if [ $? -ne 0 ]; then
    echo "Error: Failed to create component package."
    exit 1
fi

# Create distribution package
UNSIGNED_DISTRIBUTION_PKG="$BUILD_DIR/unsigned-notarized-$BINARY_NAME-$VERSION.pkg"
productbuild --package "$COMPONENT_PKG" \
             --identifier "$BUNDLE_ID" \
             --version "$VERSION" \
             "$UNSIGNED_DISTRIBUTION_PKG"

if [ $? -ne 0 ]; then
    echo "Error: Failed to create distribution package."
    exit 1
fi

# Sign the distribution package
DISTRIBUTION_PKG="notarized-$BINARY_NAME-$VERSION.pkg"
echo "Signing distribution package with Installer certificate: $INSTALLER_CERT"
productsign --sign "$INSTALLER_CERT" "$UNSIGNED_DISTRIBUTION_PKG" "$DISTRIBUTION_PKG"

if [ $? -ne 0 ]; then
    echo "Error: Failed to sign distribution package."
    exit 1
fi

# Notarize the package
echo "Submitting $DISTRIBUTION_PKG for notarization..."
SUBMISSION_OUTPUT=$(xcrun notarytool submit "$DISTRIBUTION_PKG" --keychain-profile "$KEYCHAIN_PROFILE" --wait 2>&1)

if [ $? -ne 0 ]; then
    echo "Error: Notarization submission failed."
    echo "$SUBMISSION_OUTPUT"
    exit 1
fi

# Extract submission ID
SUBMISSION_ID=$(echo "$SUBMISSION_OUTPUT" | grep "id:" | head -1 | awk '{print $2}')

if [ -z "$SUBMISSION_ID" ]; then
    echo "Error: Could not retrieve submission ID."
    exit 1
fi

echo "Notarization submission ID: $SUBMISSION_ID"

# Check notarization status
LOG_OUTPUT=$(xcrun notarytool log "$SUBMISSION_ID" --keychain-profile "$KEYCHAIN_PROFILE")
STATUS=$(echo "$LOG_OUTPUT" | grep '"status":' | awk -F'"' '{print $4}')

if [ "$STATUS" != "Accepted" ]; then
    echo "Error: Notarization failed. Status: $STATUS"
    echo "Notarization log:"
    echo "$LOG_OUTPUT"
    exit 1
fi

echo "Notarization successful. Status: $STATUS"

# Staple the notarization ticket
xcrun stapler staple "$DISTRIBUTION_PKG"

if [ $? -ne 0 ]; then
    echo "Error: Failed to staple notarization ticket."
    exit 1
fi

echo "Successfully created notarized and stapled package: $DISTRIBUTION_PKG"

# Clean up
rm -rf "$BUILD_DIR"

echo "Package is ready for distribution. Upload $DISTRIBUTION_PKG to your GitHub release."
