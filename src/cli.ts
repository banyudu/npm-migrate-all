import npmMigrateAll from './index.js'
import 'zx/globals'

const pkgs = argv._
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
if (!argv.from || !argv.to || !pkgs.length) {
  console.error(chalk.red('need from and to registry urls'))
  process.exit(1)
}

npmMigrateAll(argv.from, argv.to, pkgs).catch(console.error)
