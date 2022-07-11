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
const pkgs = ['@my/pkg1', '@my/pkg2']

npmMigrateAll(from, to, pkgs).then(({
  succeeded, // ['@my/pkg1@0.0.1', '@my/pkg1@0.0.2']
  failed,
  skipped,
}) => {
  // migrated
})
```

## Cli Usage

```bash
npx npm-migrate-all --from=https://registry.npmjs.org/ --to=http://localhost:4873/ @my/pkg1 @my/pkg2
```
