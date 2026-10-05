#!/usr/bin/env bash
# Generates the Xcode project (macOS + iOS/iPadOS Safari Web Extension app) in ./xcode.
# Run once on a Mac with Xcode installed. The project references ./dist in place,
# so later `npm run build` / `npm run dev` changes show up on the next Xcode run.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -d xcode ]]; then
  echo "xcode/ already exists. Delete it first if you want to regenerate the project." >&2
  exit 1
fi

npm run build
xcrun safari-web-extension-converter dist \
  --project-location xcode \
  --app-name "Card Finder" \
  --bundle-identifier "com.kylebolin.cardfinder" \
  --swift \
  --no-open \
  --no-prompt

echo
echo "Created xcode/Card Finder/Card Finder.xcodeproj"
echo "Open it, pick the 'Card Finder (macOS)' or 'Card Finder (iOS)' scheme, set your Team under"
echo "Signing & Capabilities for each target, and press Run."
