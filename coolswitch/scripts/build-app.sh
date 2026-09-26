#!/bin/bash
# Builds dist/CoolSwitch.app.
#
#   ./scripts/build-app.sh                      Local build for this Mac, signed with a
#                                               self-signed identity (created on first run).
#   ./scripts/build-app.sh --release 1.2.3      Universal, hardened-runtime build. Requires
#                                               SIGNING_IDENTITY="Developer ID Application: …".
#
# SIGNING_IDENTITY=- makes an ad hoc signature (used by CI, where nothing needs to persist).
set -euo pipefail
cd "$(dirname "$0")/.."

readonly RELEASE_ID='io.github.evanbunnage.coolswitch'
readonly LOCAL_IDENTITY='CoolSwitch Local Development'
IDENTITY="${SIGNING_IDENTITY:-$LOCAL_IDENTITY}"
OUTPUT="$PWD/dist"
BUILD_ARGS=(-c release)
SIGN_ARGS=()
# Local builds use their own bundle ID so their Accessibility approval never
# replaces the one for an installed release (and vice versa).
BUNDLE_ID="$RELEASE_ID.dev"
VERSION='0.0.0'

if [[ $# -gt 0 ]]; then
    if [[ $# -ne 2 || "$1" != '--release' || ! "$2" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        echo 'Usage: build-app.sh [--release MAJOR.MINOR.PATCH]' >&2
        exit 1
    fi
    VERSION="$2"
    BUNDLE_ID="$RELEASE_ID"
    BUILD_ARGS+=(--arch arm64 --arch x86_64)
    SIGN_ARGS+=(--options runtime --timestamp)
    if [[ "$IDENTITY" != 'Developer ID Application: '* ]]; then
        echo 'Release builds require SIGNING_IDENTITY="Developer ID Application: Name (TEAMID)".' >&2
        exit 1
    fi
fi

if ! SDK_VERSION=$(/usr/bin/xcrun --sdk macosx --show-sdk-version) || [[ "${SDK_VERSION%%.*}" -lt 26 ]]; then
    echo 'Building requires Xcode 26 or newer, selected in Xcode Settings → Locations (or with xcode-select).' >&2
    exit 1
fi

/usr/bin/xcrun --sdk macosx swift build "${BUILD_ARGS[@]}"
BIN_PATH=$(/usr/bin/xcrun --sdk macosx swift build "${BUILD_ARGS[@]}" --show-bin-path)
mkdir -p "$OUTPUT"
STAGING=$(mktemp -d "$OUTPUT/.coolswitch.XXXXXX")
trap 'rm -rf "$STAGING"' EXIT

# A stable self-signed identity keeps Accessibility approval across local rebuilds.
# It need not be trusted system-wide.
has_identity() {
    security find-identity -p codesigning | grep -Fq "\"$IDENTITY\""
}
if [[ "$IDENTITY" != "-" ]] && ! has_identity; then
    if [[ "$IDENTITY" != "$LOCAL_IDENTITY" ]]; then
        printf 'Signing identity not found: %s. Install its certificate and private key in Keychain Access.\n' "$IDENTITY" >&2
        exit 1
    fi
    if security find-certificate -c "$IDENTITY" >/dev/null 2>&1; then
        echo 'The local signing certificate exists but its private key is missing. Restore the key in Keychain Access, or remove the incomplete certificate and rebuild.' >&2
        exit 1
    fi
    echo 'Creating a local signing identity in your login keychain. macOS may ask for your keychain password when signing.'
    (
        umask 077
        mkdir "$STAGING/signing"
        /usr/bin/openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -sha256 \
            -subj "/CN=$IDENTITY/" \
            -addext 'basicConstraints=critical,CA:FALSE' \
            -addext 'keyUsage=critical,digitalSignature' \
            -addext 'extendedKeyUsage=critical,codeSigning' \
            -keyout "$STAGING/signing/key.pem" -out "$STAGING/signing/cert.pem"
        signing_password=$(/usr/bin/openssl rand -hex 24)
        export signing_password
        /usr/bin/openssl pkcs12 -export -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 \
            -inkey "$STAGING/signing/key.pem" -in "$STAGING/signing/cert.pem" \
            -out "$STAGING/signing/identity.p12" -passout env:signing_password
        security import "$STAGING/signing/identity.p12" -k "$HOME/Library/Keychains/login.keychain-db" \
            -P "$signing_password" -T /usr/bin/codesign
    )
    if ! has_identity; then
        echo 'The imported signing identity is unavailable. Check that your login keychain is unlocked in Keychain Access.' >&2
        exit 1
    fi
fi

APP="$STAGING/CoolSwitch.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN_PATH/coolswitch" "$APP/Contents/MacOS/coolswitch"
cp packaging/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
cp packaging/Info.plist "$APP/Contents/Info.plist"
plist() { /usr/libexec/PlistBuddy -c "Set :$1 $2" "$APP/Contents/Info.plist"; }
plist CFBundleIdentifier "$BUNDLE_ID"
plist CFBundleShortVersionString "$VERSION"
plist CFBundleVersion "$VERSION"
plutil -lint "$APP/Contents/Info.plist" >/dev/null

codesign --force --sign "$IDENTITY" ${SIGN_ARGS[@]+"${SIGN_ARGS[@]}"} "$APP"
codesign --verify --strict "$APP"
FINAL_APP="$OUTPUT/CoolSwitch.app"
rm -rf "$FINAL_APP"
mv "$APP" "$FINAL_APP"
printf 'Built %s (%s, %s)\n' "$FINAL_APP" "$BUNDLE_ID" "$VERSION"
printf 'Run: open "%s"\n' "$FINAL_APP"
