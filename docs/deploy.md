# Deploying to TestFlight

`.github/workflows/deploy.yml` builds the iPhone/iPad and Mac apps, signs them with the team's
App Store Connect API key, and uploads them to TestFlight. It runs on:

- every push to `main` that changes the extension (`src/`, `static/`, `xcode/`, package files)
- every `v*` tag (`v0.2.0` sets the version to 0.2.0)
- a manual run (Actions → Deploy to TestFlight → Run workflow)

The version comes from the tag, or from `package.json` otherwise. The build number is the workflow
run number, so every upload is unique. Until the setup below is done, runs end with a
"TestFlight not configured" notice instead of failing.

## One-time setup

You need an Apple Developer Program membership. Steps 1–4 happen on Apple's sites, and step 5 on GitHub.

### 1. Find your Team ID

[developer.apple.com/account](https://developer.apple.com/account), then **Membership details**,
then **Team ID**: 10 characters, e.g. `A1B2C3D4E5`.

### 2. Register the app's bundle ID

[Certificates, Identifiers & Profiles → Identifiers](https://developer.apple.com/account/resources/identifiers/list),
then **+**, then **App IDs**, then **App**:

- Description: `Card Finder`
- Bundle ID: **Explicit**, `com.kylebolin.cardfinder`
- No capabilities need to be ticked.

The extension's ID (`com.kylebolin.cardfinder.Extension`) is registered automatically on the first upload.

### 3. Create the app in App Store Connect

[appstoreconnect.apple.com](https://appstoreconnect.apple.com), then **Apps**, then **+**, then **New App**:

- Platforms: **iOS** and **macOS**
- Name: `Card Finder`. The name must be unique across the whole App Store; if it's taken, use
  something like `Card Finder for MTG`. Testers see this name, nobody else.
- Primary language: English (U.S.)
- Bundle ID: `com.kylebolin.cardfinder`
- SKU: `card-finder`
- User access: Full Access

### 4. Create an API key for GitHub Actions

App Store Connect, then **Users and Access**, then **Integrations**, then **App Store Connect API**,
then **Team Keys**, then **+**:

- Name: `GitHub Actions`
- Access: **Admin**. Signing in CI creates the distribution certificate and profiles itself
  (cloud-managed signing), and that needs Admin.

Note the **Issuer ID**, shown above the key list, and the **Key ID**. Then click **Download** to
save `AuthKey_<KEYID>.p8`. Apple lets you download it **only once**. Keep it out of the repo.

### 5. Add the secrets to GitHub

Repo, then **Settings**, then **Secrets and variables**, then **Actions**:

| Kind                     | Name            | Value                                                                   |
| ------------------------ | --------------- | ----------------------------------------------------------------------- |
| Secret                   | `ASC_KEY_ID`    | the Key ID                                                              |
| Secret                   | `ASC_ISSUER_ID` | the Issuer ID                                                           |
| Secret                   | `ASC_KEY_P8`    | the whole contents of the `.p8` file, including the `BEGIN`/`END` lines |
| Variable (Variables tab) | `APPLE_TEAM_ID` | the Team ID                                                             |

Then run **Actions → Deploy to TestFlight → Run workflow**.

## Installing builds

1. After an upload, App Store Connect takes about 10–30 minutes to process the build.
2. App Store Connect, then the app, then **TestFlight**. Under **Internal Testing**, create a
   group, e.g. "Me", and add yourself. Internal builds need no review.
3. Install **TestFlight** from the App Store on the iPad (and on the Mac, from the Mac App Store),
   sign in with the same Apple ID, and install Card Finder.
4. Turn the extension on:
   - iPad: Settings → Apps → Safari → Extensions → Card Finder
   - Mac: Safari → Settings → Extensions

   TestFlight builds are properly signed, so the Mac doesn't need "Allow unsigned extensions".

Each TestFlight build works for 90 days. New uploads replace older ones automatically.

## Troubleshooting

- **"No profiles for 'com.kylebolin.cardfinder' were found"**: the bundle ID isn't registered
  (step 2), or the API key isn't Admin (step 4).
- **"Invalid large app icon … alpha channel" (ITMS-90717)**: the 1024px icon must have no alpha
  channel. `scripts/create-xcode-project.sh` strips it after generating the project; run
  `node scripts/strip-icon-alpha.mjs <icon.png>` if the icon is replaced by hand.
- **Build is "Missing Compliance"**: the workflow sets `ITSAppUsesNonExemptEncryption = NO`
  (Card Finder uses only standard HTTPS), so this shouldn't happen. If it does, answer the
  export-compliance question in App Store Connect once.
- **"The bundle version must be higher"**: build numbers come from the workflow run number,
  which always goes up. Don't upload builds from Xcode with a higher number by hand.
