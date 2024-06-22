#!/usr/bin/env node

import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import main, { Options } from '.'

(async () => {
  const argv = await yargs(hideBin(process.argv)).parse()
  const options: Options = argv
  await main(options)
})().catch(console.error)

