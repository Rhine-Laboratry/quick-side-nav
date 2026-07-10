# Release and Deployment

This repository deploys Chrome Web Store updates from release branches.

## Branch rule

- Develop and merge normal changes on `main`.
- Create a release branch named `v<major>.<minor>`, for example `v1.3`.
- The release branch name must match the first two parts of `manifest.json` version.
  - `manifest.json` version `1.3.0` deploys from branch `v1.3`.
  - `manifest.json` version `1.4.1` deploys from branch `v1.4`.
- Patch updates stay on the same minor release branch. For example, `1.2.1` and `1.2.2` both deploy from `v1.2`.

The GitHub Actions workflow rejects deploys when the branch and manifest version do not match.

## First Chrome Web Store release

Chrome Web Store still requires the first listing setup in the Developer Dashboard.

1. Build the ZIP locally:

   ```powershell
   ./scripts/package-extension.ps1 -OutputDirectory dist
   ```

2. Upload the ZIP from `dist/` in the Chrome Web Store Developer Dashboard.
3. Fill in Store Listing, Privacy, Distribution, and reviewer test instructions.
4. Publish the first version manually.
5. Save the extension ID and publisher ID for GitHub Actions.

## GitHub Secrets

Add these repository secrets in GitHub before using release branches:

- `CWS_CLIENT_ID`
- `CWS_CLIENT_SECRET`
- `CWS_REFRESH_TOKEN`
- `CWS_PUBLISHER_ID`
- `CWS_EXTENSION_ID`

The OAuth token must have the Chrome Web Store scope:

```text
https://www.googleapis.com/auth/chromewebstore
```

## Deploy an update

1. Update `manifest.json` version.
2. Commit the release-ready changes to `main`.
3. Create or update the matching release branch:

   ```powershell
   git checkout main
   git pull
   git checkout -B v1.3
   git push origin v1.3 --force-with-lease
   ```

4. GitHub Actions builds the exact file `dist/quick-side-nav-v<version>.zip` and verifies its packaged manifest version.
5. GitHub Actions uploads the ZIP and waits for Chrome Web Store to report a successful upload.
6. On push to a release branch, GitHub Actions submits the uploaded package for review.

For a manual upload-only run, open the `Chrome Web Store deploy` workflow in GitHub Actions, choose the release branch, and set `publish` to `false`.

## Package contents

The release ZIP contains only the extension runtime files and supporting public docs:

- `manifest.json`
- `background.js`
- `content.js`
- `popup.*`
- `options.*`
- `icons/`
- `README.md`
- `PRIVACY.md`

The ZIP intentionally excludes `store-assets/`, `.github/`, `scripts/`, local notes, and Git metadata.
The packaging script removes older `quick-side-nav-v*.zip` files from the selected output directory before creating the current version.
