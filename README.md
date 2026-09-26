# Chrome extension semantic release

This GitHub Action releases a Chrome extension from
[Conventional Commits](https://www.conventionalcommits.org/). It uses
[semantic-release](https://semantic-release.gitbook.io/) to decide the next
version, bumps `package.json`, runs your build, uploads the package to the
Chrome Web Store (API v2), submits it for review, then commits the new version
back to the branch, tags it and creates a GitHub release.

| Commits since the last release                           | Release |
| -------------------------------------------------------- | ------- |
| `feat!:`, `fix(scope)!:` or a `BREAKING CHANGE:` footer  | major   |
| `feat:`                                                  | minor   |
| `fix:`, `perf:`, `revert:`                               | patch   |
| anything else (`chore:`, `docs:`, `refactor:`, `test:`…) | none    |

In a monorepo, only commits that belong to the extension count, so a
`feat(web)!:` does not bump it. A commit belongs to the extension when it:

- changes the extension's folder, or the folder of a workspace package it
  depends on, directly or through other packages. All dependency fields count,
  because a bundled extension ships whatever it imports, however package.json
  lists it.
- changes the locked version of one of those packages' dependencies in
  `pnpm-lock.yaml`, such as `fix(deps): patch zod` that only touches the
  lockfile and the pnpm catalog.
- changes one of the extra `paths`.

Leave out packages that never reach the bundle with
`ignore-workspace-packages`: shared lint or test config, or a server package
imported for its types. Anything reachable only through an ignored package is
left out with it.

Workspaces are read from `pnpm-workspace.yaml` or the `workspaces` field of
`package.json` (npm, Yarn, Bun), at the nearest folder above the extension that
declares one. Only pnpm's lockfile is read; with npm, Yarn or Bun, dependency
updates count once a commit in the extension's folders ships them.

## Use

```yaml
on:
  push:
    branches: [main]

concurrency:
  group: extension-release
  cancel-in-progress: false

jobs:
  release:
    runs-on: ubuntu-latest
    environment: chrome-web-store-production
    permissions:
      contents: write # push the release commit and tag
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # semantic-release needs every tag and commit
          persist-credentials: false

      - uses: pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile

      - uses: pixpilot/chrome-extension-semantic-release@v1
        id: release
        with:
          build-command: pnpm run build
          package: dist
          extension-id: ${{ vars.CWS_EXTENSION_ID }}
          publisher-id: ${{ vars.CWS_PUBLISHER_ID }}
          client-id: ${{ secrets.CWS_CLIENT_ID }}
          client-secret: ${{ secrets.CWS_CLIENT_SECRET }}
          refresh-token: ${{ secrets.CWS_REFRESH_TOKEN }}

      - if: ${{ steps.release.outputs.released == 'true' }}
        run: echo "Released ${{ steps.release.outputs.version }}"
```

Before the first run, tag the commit that shipped the version currently in the
store; see [First release](#first-release).

### Monorepo (roleclick)

This replaces `publish-chrome-extension.yml` as the job the release workflow
calls when `pixpilot/turbo-affected` reports the extension affected. The
version-bump comparison in `release.yml` is no longer needed: semantic-release
decides whether there is anything to release.

```yaml
name: Release Chrome Extension

on:
  workflow_call:

jobs:
  release:
    name: Release Chrome extension
    runs-on: ubuntu-latest
    environment: chrome-web-store-production
    permissions:
      contents: read

    outputs:
      released: ${{ steps.release.outputs.released }}
      version: ${{ steps.release.outputs.version }}

    steps:
      # main is protected, so the release commit is pushed as the GitHub App.
      - name: Generate token
        id: token
        uses: actions/create-github-app-token@v3
        with:
          client-id: ${{ secrets.RELEASER_ID }}
          private-key: ${{ secrets.RELEASER_PRIVATE_KEY }}

      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0
          persist-credentials: false

      - name: Set up project
        uses: pixpilot/github-actions/setup-pnpm-project@v1
        with:
          npm-auth-registry: 'https://npm.pkg.github.com/'
          npm-auth-token: ${{ secrets.PIXPILOT_PRIVATE_REGISTRY_TOKEN }}
          npm-auth-scopes: '@pixpilot-private'

      - name: Release
        id: release
        uses: pixpilot/chrome-extension-semantic-release@v1
        env:
          # Browser-safe values the build embeds.
          SUPABASE_URL: ${{ vars.SUPABASE_URL }}
          SUPABASE_PUBLISHABLE_KEY: ${{ vars.SUPABASE_PUBLISHABLE_KEY }}
        with:
          working-directory: apps/chrome-extension
          # Lint/format/test tooling, and the API server imported for types only.
          ignore-workspace-packages: |
            @internal/api
            @internal/eslint-config
            @internal/prettier-config
            @internal/tsdown-config
            @internal/vitest-config
          tag-format: chrome-extension-v${version}
          build-command: pnpm run zip
          package: package
          extension-id: ${{ vars.CWS_EXTENSION_ID }}
          publisher-id: ${{ vars.CWS_PUBLISHER_ID }}
          client-id: ${{ secrets.CWS_CLIENT_ID }}
          client-secret: ${{ secrets.CWS_CLIENT_SECRET }}
          refresh-token: ${{ secrets.CWS_REFRESH_TOKEN }}
          github-token: ${{ steps.token.outputs.token }}

      - name: Upload package artifact
        if: ${{ steps.release.outputs.released == 'true' }}
        uses: actions/upload-artifact@v4
        with:
          name: chrome-extension
          path: ${{ steps.release.outputs.package-path }}
```

## First release

semantic-release finds the last release from Git tags. With no tag matching
`tag-format` it starts at `1.0.0`, which the store rejects when a higher version
is live, so the action stops and prints the command to run. Tag the commit that
shipped the current `package.json` version once:

```sh
git tag chrome-extension-v2.0.0 <commit>
git push origin chrome-extension-v2.0.0
```

The same check stops a release when `package.json` was bumped by hand past the
last tag.

## Inputs

| Input                       | Default                                                   | Description                                                                                     |
| --------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `working-directory`         | `.`                                                       | Folder of the extension's `package.json`.                                                       |
| `workspace-dependencies`    | `true`                                                    | Count commits to the workspace packages the extension depends on.                               |
| `ignore-workspace-packages` |                                                           | Workspace package names to leave out, with what only they reach. Unknown names fail the run.    |
| `dependency-updates`        | `true`                                                    | Count commits that change a locked dependency version of those packages in `pnpm-lock.yaml`.    |
| `paths`                     |                                                           | Extra folders or files whose commits count.                                                     |
| `branches`                  | `main`                                                    | Branches to release from.                                                                       |
| `tag-format`                | `v${version}`                                             | Tag format. Make it unique per app in a monorepo.                                               |
| `manifest`                  |                                                           | Source `manifest.json` to bump too, when the build does not take the version from package.json. |
| `build-command`             |                                                           | Shell command run in `working-directory` after the bump.                                        |
| `package`                   |                                                           | A `.zip`, a folder holding one `.zip`, or the unpacked build folder. Required when uploading.   |
| `upload`                    | `true`                                                    | Upload to the Chrome Web Store.                                                                 |
| `submit`                    | `true`                                                    | Submit for review; `false` leaves a draft.                                                      |
| `extension-id`              |                                                           | Store item ID.                                                                                  |
| `publisher-id`              |                                                           | Store publisher ID.                                                                             |
| `client-id`                 |                                                           | Google OAuth client ID.                                                                         |
| `client-secret`             |                                                           | Google OAuth client secret.                                                                     |
| `refresh-token`             |                                                           | Google OAuth refresh token.                                                                     |
| `commit`                    | `true`                                                    | Commit the bumped files back to the branch.                                                     |
| `commit-message`            | `chore(release): ${nextRelease.gitTag} [skip ci]` + notes | Release commit message template.                                                                |
| `changelog-file`            |                                                           | Changelog to update and commit, relative to `working-directory`.                                |
| `github-release`            | `true`                                                    | Create a GitHub release.                                                                        |
| `github-token`              | `${{ github.token }}`                                     | Pushes the commit and tag and creates the GitHub release.                                       |
| `dry-run`                   | `false`                                                   | Report the next version without changing anything.                                              |

Paths in `paths` and `working-directory` are relative to the repository checkout
(`GITHUB_WORKSPACE`); absolute paths inside it also work.

## Outputs

| Output             | Description                                                                 |
| ------------------ | --------------------------------------------------------------------------- |
| `released`         | `true` when a version was released; `false` in a dry run.                   |
| `version`          | The released version, or in a dry run the one that would be. Empty if none. |
| `previous-version` | The last released version.                                                  |
| `tag`              | The release tag.                                                            |
| `release-type`     | `major`, `minor` or `patch`.                                                |
| `notes`            | The release notes.                                                          |
| `package-path`     | Repository-relative path of the uploaded package.                           |

## How it works

1. **Verify** – reads `package.json` and, when uploading, fetches an access
   token and the item status, so bad credentials fail before anything changes.
2. **Analyze** – lists commits since the last tag, keeps those that belong to
   the extension (see above) and picks the release type with the Conventional
   Commits preset.
3. **Guard** – refuses a version lower than the one in `package.json`.
4. **Prepare** – writes the version to `package.json` (and `manifest`), runs
   `build-command`, checks an unpacked build's `manifest.json` carries the new
   version, and uploads the package as a draft. The upload happens before the
   commit and tag, so a rejected package leaves the branch untouched and the next
   run retries the same version.
5. **Commit and tag** – updates `changelog-file`, commits the bumped files with
   `[skip ci]`, pushes, then tags the release commit.
6. **Publish** – submits the draft for review and creates the GitHub release.

## Requirements

- Check out with `fetch-depth: 0`.
- `github-token` must be able to push to the release branch. Use a GitHub App
  token when the branch is protected; `GITHUB_TOKEN` needs `contents: write`.
- The build must read the version from `package.json`, or set `manifest`.
- The Chrome Web Store item must already exist; the API cannot create one.
- Queue runs with a non-cancelling `concurrency` group. semantic-release skips a
  run whose checkout is behind the remote branch.

## Gotchas

- `[skip ci]` in the release commit keeps it from triggering the release again.
  Keep it if you change `commit-message`.
- With `turbo-affected`, the next push still sees the release commit's
  `package.json` change and reports the extension affected. The action then
  finds no releasable commit and exits without a release.
- Submission failures happen after the tag is pushed, so a re-run will not
  retry them. The error says so; submit the uploaded draft from the developer
  dashboard.
- A workspace package added later counts until it is added to
  `ignore-workspace-packages`, so new tooling can release the extension. That
  errs towards releasing rather than missing a change the bundle ships.
- A semantic-release config file in the repository root is still read, but this
  action's `branches`, `tag-format`, plugins and preset take precedence.
- This action does not use `semantic-release-chrome`: its last release (2023)
  calls the Chrome Web Store API v1.1, which Google shuts down on
  2026-10-15. Uploads here go through `chrome-webstore-upload` on API v2.
