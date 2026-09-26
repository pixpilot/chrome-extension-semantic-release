# chrome-extension-semantic-release

GitHub Action to automate semantic versioning, release notes, packaging, and Chrome Web Store publishing for Chrome extensions.

## What it does

1. Runs `semantic-release` to determine the next version and release notes.
2. Updates your extension `manifest.json` version.
3. Packages the extension directory as a ZIP archive.
4. Publishes the package to the Chrome Web Store API.

## Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `extension-directory` | No | `.` | Directory with extension files to package |
| `manifest-path` | No | `manifest.json` | Path to manifest relative to `extension-directory` |
| `package-path` | No | `release/chrome-extension.zip` | Output ZIP path |
| `run-semantic-release` | No | `true` | Whether to run semantic-release |
| `release-version` | No | `""` | Explicit version override when semantic-release is disabled |
| `release-notes` | No | `""` | Explicit release notes override when semantic-release is disabled |
| `publish` | No | `true` | Whether to publish to Chrome Web Store |
| `chrome-extension-id` | Conditionally | `""` | Chrome Web Store extension ID (required when `publish=true`) |
| `chrome-client-id` | Conditionally | `""` | OAuth client ID (required when `publish=true`) |
| `chrome-client-secret` | Conditionally | `""` | OAuth client secret (required when `publish=true`) |
| `chrome-refresh-token` | Conditionally | `""` | OAuth refresh token (required when `publish=true`) |
| `chrome-publish-target` | No | `default` | Publish target (`default` or `trustedTesters`) |

## Outputs

| Output | Description |
| --- | --- |
| `released` | Whether semantic-release published a release |
| `version` | Version written to `manifest.json` |
| `release-notes` | Generated/provided release notes |
| `package-path` | Absolute path to generated ZIP |
| `published` | Whether publish to Chrome Web Store succeeded |

## Example

```yaml
name: release

on:
  push:
    branches: [main]

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: npm ci
      - run: npm run build

      - name: Release and publish extension
        uses: pixpilot/chrome-extension-semantic-release@v1
        with:
          extension-directory: dist
          manifest-path: manifest.json
          package-path: release/extension.zip
          run-semantic-release: true
          publish: true
          chrome-extension-id: ${{ secrets.CHROME_EXTENSION_ID }}
          chrome-client-id: ${{ secrets.CHROME_CLIENT_ID }}
          chrome-client-secret: ${{ secrets.CHROME_CLIENT_SECRET }}
          chrome-refresh-token: ${{ secrets.CHROME_REFRESH_TOKEN }}
```
