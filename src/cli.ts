#!/usr/bin/env node

import npmMigrateAll from './index.js'
import 'zx/globals'

const pkgs = argv._

const usage = () => {
  console.log(`
  Usage:
    npx npm-migrate-all --from=<source registry url> --to=<target registry url> pkg1 pkg2 pkg3 [...]

  Example:
    npx npm-migrate-all --from=https://registry.npmjs.org/ --to=http://localhost:4873/ @my/pkg1 @my/pkg2
  `)
}
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
if (!argv.from || !argv.to || !pkgs.length) {
  usage()
  process.exit(1)
}

const run = async () => {
  const padName = (name: string) => name.padEnd(80, ' ')
  const { succeeded, failed, skipped } = await npmMigrateAll(argv.from, argv.to, pkgs)
  for (const item of skipped) {
    console.log(chalk.yellow(`${padName(item)}\tskiped`))
  }
  for (const item of succeeded) {
    console.log(chalk.green(`${padName(item)}\tsucceeded`))
  }
  for (const item of failed) {
    console.log(chalk.red(`${padName(item)}\tfailed`))
  }
}

run().catch(console.error)
