# npm-migrate-all

Migrate all versions of given npm package to another registry.

## Install

```bash
npm i npm-migrate-all
```

## Usage

```typescript
import npmMigrateAll from 'npm-migrate-all'

const from = 'https://registry.npmjs.org/'  // source registry url
const to = 'http://localhost:4873/' // target registry url
const pkgs = ['pkg1', '@my/pkg2', 'pkg3@0.1.0']

npmMigrateAll(from, to, pkgs).then(({
  succeeded, // ['pkg1@0.0.1', 'pkg1@0.0.2']
  failed,
  skipped,
}) => {
  // migrated
})
```

## Cli Usage

```bash
npx npm-migrate-all --from=https://registry.npmjs.org/ --to=http://localhost:4873/ pkg1 @my/pkg2 pkg3@0.1.0
```

If you'd like to adjust concurreny limit, set environment variable `META_RATE_LIMIT`, `PACKAGE_RATE_LIMIT`, `VERSION_RATE_LIMIT` to the value as you wish.

```bash
# META_RATE_LIMIT default value 10
# PACKAGE_RATE_LIMIT default value 5
# VERSION_RATE_LIMIT default value 10
META_RATE_LIMIT=10 PACKAGE_RATE_LIMIT=5 VERSION_RATE_LIMIT=10 npx npm-migrate-all --from=https://registry.npmjs.org/ --to=http://localhost:4873/ pkg1 @my/pkg2 pkg3@0.1.0
```

## Explain

`npm-migrate-all` calls `npm` cli tool behind the scenes, with a limited concurrency (default 20).

```bash
# 1. fetch metadata
npm show pkg # get package metadata and tarball url.

# 2. download tarball via `npm pack`.
# 3. update package.json if needed.
# 4. save tarball to hard disk

# 5. publish to new registry
npm publish <path-to-tarball>
```

## Known issues

`npm-migrate-all` will try its best to migrate the package as it is, means that packages' dist-tag and shasum will keep
unchanged in most cases. However, this is impossible when package's `package.json` file contains `publishConfig.registry` field.

```json
{
  "publishConfig": {
    "registry": "https://registry.npmjs.org/"
  }
}
```

Npm doesn't allow command line parameters to override publishConfig in `package.json`, so there's no way to publish given package
without change its `package.json` file.

To fix this issue, `npm-migrate-all` open the tgz file in memory and update the content of `package.json` file. After this operation,
the tgz file's shasum will be changed.
