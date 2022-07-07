import axios from 'axios'
import 'zx/globals'
import pLimit from 'p-limit'
import MultiProgress from 'multi-progress'
import { ProgressBarOptions } from 'progress'
import tar from 'tar-stream'
import { Readable } from 'stream'
import gunzip from 'gunzip-maybe'
import toString from 'stream-to-string'
import streamToPromise from 'stream-to-promise'
// import * as _ from 'lodash'

interface PackageSummary {
  name: string
  distTags: Record<string, string>
  versions: string[]
}

$.verbose = false

const multi = new MultiProgress(process.stdout)

const getProgressBarOptions = (total: number): ProgressBarOptions => ({
  complete: '=',
  incomplete: ' ',
  width: 50,
  total
})

const metaLimit = pLimit(20) // set max concurrency to 10, change as your wish
const pkgLimit = pLimit(10)
const versionLimit = pLimit(50)

const padName = (str: string): string => str.padEnd(20, ' ')

const inspect = async (name: string, version: string | null, registry: string) => {
  const scope = name.startsWith('@') ? name.split('/')[0] : null
  const prefix = scope ? `${scope}:` : ''
  const target = version ? [name, version].join('@') : name
  const result = JSON.parse((await $`npm show ${target} --${prefix}registry=${registry} --json`).stdout)
  return result
}

const npmMigrateAll = async (from: string, to: string, pkgs: string[]): Promise<void> => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'npm-migrate-all-'))
  await $`cd ${tempDir}`

  for (const pkg of pkgs) {
    console.log(chalk.green(`processing ${pkg}`))
  }

  const getPackageSummary = async (pkg: string, registry: string): Promise<PackageSummary | null> => {
    try {
      const metadata = await inspect(pkg, null, registry)
      return {
        name: metadata.name,
        distTags: metadata['dist-tags'],
        versions: metadata.versions
      }
    } catch (error) {
      return null
    }
  }

  const fetchSourcePackages = async (): Promise<Array<PackageSummary | null>> => {
    const info = await Promise.all(pkgs.map(async pkg => await metaLimit(async () => await getPackageSummary(pkg, from))))
    return info
  }

  const fetchTargetPackages = async (): Promise<Array<PackageSummary | null>> => {
    const info = await Promise.all(pkgs.map(async pkg => await metaLimit(async () => await getPackageSummary(pkg, to))))
    return info
  }

  // fetch metadata
  const metadataBar = multi.newBar(`${padName('fetching metadata')} [:bar] :percent :etas`, getProgressBarOptions(2))
  metadataBar.tick(0)
  const sourcePackages = await fetchSourcePackages()
  metadataBar.tick()
  const targetPackages = await fetchTargetPackages()
  metadataBar.tick()

  const delimeter = '^'
  const targetPackageSet = new Set(
    targetPackages.filter(Boolean).flatMap(pkg => pkg?.versions.map(e => [pkg.name, e].join(delimeter)))
  )

  const publishBar = multi.newBar(`${padName('publishing...')} [:bar] :percent :etas`, getProgressBarOptions(sourcePackages.length))
  publishBar.tick(0)

  const syncOne = async (pkg: PackageSummary, version: string | null, bar: ProgressBar): Promise<void> => {
    const key = [pkg.name, version].join(delimeter)
    if (version != null && !targetPackageSet.has(key)) {
      // process single version

      // fetch metadata
      try {
        const metadata = await inspect(pkg.name, version, from)
        const tarballUrl = metadata.dist.tarball
        const tarballData = (await axios.get(tarballUrl, { responseType: 'arraybuffer' })).data
        const basename = path.basename(tarballUrl)
        const pkgDir = path.join(tempDir, pkg.name)
        const destFilename = path.join(pkgDir, basename)

        // if publishConfig.registry exists in package.json, then package.json must be edited to use target registry
        // const needUpdate = metadata.publishConfig?.registry && metadata.publishConfig.registry !== to
        const needUpdate = metadata.publishConfig?.registry !== to
        if (needUpdate) {
          const pack = tar.pack()
          const extract = tar.extract()
          extract.on('entry', async function(header, stream, callback) {
            // let's prefix all names with 'tmp'
            if (header.name === 'package/package.json') {
              // remove publishConfig.registry field in package.json
              const pkgJsonStr = await toString(stream)
              const pkgJsonObj = JSON.parse(pkgJsonStr)
              pkgJsonObj.publishConfig = pkgJsonObj.publishConfig || {}
              pkgJsonObj.publishConfig.registry = to
              const newPkgJsonStr = JSON.stringify(pkgJsonObj, null, 2)
              pack.entry({ name: 'package/package.json' }, newPkgJsonStr, callback)
            } else {
              // write the new entry to the pack stream
              stream.pipe(pack.entry(header, callback))
            }
          })

          extract.on('finish', function() {
            // all entries done - lets finalize it
            pack.finalize()
          })

          Readable.from(tarballData).pipe(gunzip()).pipe(extract)
          const wStream = fs.createWriteStream(destFilename)
          pack.pipe(wStream)
          await streamToPromise(wStream)
        } else {
          await fs.writeFile(destFilename, tarballData)
        }

        const scope = pkg.name.startsWith('@') ? pkg.name.split('/')[0] : null
        const prefix = scope ? `${scope}:` : ''
        await $`npm publish --${prefix}registry=${to} ${destFilename}`
      } catch (error) {
        console.error(chalk.red(error))
      }
    }
    bar.tick({ version: `v${version ?? ''}` })
  }

  const sync = async (pkg: PackageSummary): Promise<void> => {
    const bar = multi.newBar(`${padName('      ' + pkg.name)} [:bar] [:version] :current/:total :etas`, getProgressBarOptions(pkg.versions.length))
    bar.tick(0, { version: ' ... ' })
    const pkgDir = path.join(tempDir, pkg.name)
    await fs.rm(pkgDir, { force: true, recursive: true })
    await fs.mkdirp(pkgDir)

    const versionsExceptLatest = pkg.versions.filter(e => e !== pkg.distTags.latest)
    await Promise.all(versionsExceptLatest.map(async version => await versionLimit(async () => await syncOne(pkg, version, bar))))
    await versionLimit(async () => await syncOne(pkg, pkg.distTags.latest ?? null, bar))
    bar.tick(pkg.versions.length, { version: '100%' })
    publishBar.tick()
  }

  await Promise.all(sourcePackages.filter(Boolean).map(async e => await pkgLimit(async () => await sync(e as PackageSummary))))
}

export default npmMigrateAll
