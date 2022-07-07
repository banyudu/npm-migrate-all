import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import npmMigrateAll from '.'
import chalk from 'chalk'

const argv: any = yargs(hideBin(process.argv)).argv

const pkgs = argv._
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
if (!argv.from || !argv.to || !pkgs.length) {
  console.error(chalk.red('need from and to registry urls'))
  process.exit(1)
}

npmMigrateAll(argv.from, argv.to, pkgs).catch(console.error)
