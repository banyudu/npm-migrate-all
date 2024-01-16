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

`npm-migrate-all`` will make every effort to migrate the package as is, meaning that the package's dist-tag and shasum will remain unchanged in most cases. However, this becomes impossible when an unscoped package's package.json file contains the publishConfig.registry field.

```json
{
  "publishConfig": {
    "registry": "https://registry.npmjs.org/"
  }
}
```

Npm does not permit command line parameters to override publishConfig in package.json, and .npmrc can only update the registry for scoped packages. Therefore, there is no way to publish an unscoped package without modifying its `package.json` file.

To resolve this issue, `npm-migrate-all` opens the tgz file in memory and updates the content of the package.json file. As a result of this operation, the tgz file's shasum will be altered.
