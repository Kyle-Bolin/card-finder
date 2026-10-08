#!/usr/bin/env bash
# Archives one scheme and uploads it to App Store Connect (TestFlight).
# Used by .github/workflows/deploy.yml; expects PROJECT, APPLE_TEAM_ID, ASC_KEY_PATH,
# ASC_KEY_ID, ASC_ISSUER_ID, VERSION and BUILD in the environment, and
# $RUNNER_TEMP/ExportOptions.plist.
# Usage: scripts/testflight.sh <scheme> <destination> <name>
set -euo pipefail
scheme="$1" destination="$2" name="$3"
auth=(
  -allowProvisioningUpdates
  -authenticationKeyPath "$ASC_KEY_PATH"
  -authenticationKeyID "$ASC_KEY_ID"
  -authenticationKeyIssuerID "$ASC_ISSUER_ID"
)

xcodebuild archive \
  -project "$PROJECT" \
  -scheme "$scheme" \
  -destination "$destination" \
  -archivePath "$RUNNER_TEMP/$name.xcarchive" \
  "${auth[@]}" \
  DEVELOPMENT_TEAM="$APPLE_TEAM_ID" \
  CODE_SIGN_STYLE=Automatic \
  MARKETING_VERSION="$VERSION" \
  CURRENT_PROJECT_VERSION="$BUILD" \
  INFOPLIST_KEY_ITSAppUsesNonExemptEncryption=NO \
  INFOPLIST_KEY_LSApplicationCategoryType=public.app-category.utilities

xcodebuild -exportArchive \
  -archivePath "$RUNNER_TEMP/$name.xcarchive" \
  -exportOptionsPlist "$RUNNER_TEMP/ExportOptions.plist" \
  -exportPath "$RUNNER_TEMP/$name-export" \
  "${auth[@]}"

echo "Uploaded $scheme $VERSION ($BUILD) to App Store Connect." >> "$GITHUB_STEP_SUMMARY"
