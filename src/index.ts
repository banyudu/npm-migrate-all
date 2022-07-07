// import axios from 'axios'
import chalk from 'chalk'

const npmMigrateAll = async (
  from: string,
  to: string,
  pkgs: string[]
): Promise<void> => {
  for (const pkg of pkgs) {
    console.log(chalk.green(`processing ${pkg}`))
  }
}

export default npmMigrateAll
