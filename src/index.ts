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

const { NPM_MIGRATE_MAX_CONCURRENCY } = process.env as any

const concurrenyLimit = pLimit(
  NPM_MIGRATE_MAX_CONCURRENCY ? Number(NPM_MIGRATE_MAX_CONCURRENCY) || 1 : 20
)

const getRegistryParam = (pkgName: string, registry: string) => {
  const scope = pkgName.startsWith('@') ? pkgName.split('/')[0] : null
  const prefix = scope ? `${scope}:` : ''
  return `--${prefix}registry=${registry}`
}

const padName = (str: string, length: number = 20): string => str.padEnd(length, ' ')

const inspect = async (name: string, version: string | null, registry: string) => {
  const target = version ? [name, version].join('@') : name
  const registryParam = getRegistryParam(name, registry)
  const result = JSON.parse(
    (await $`npm show ${target} ${registryParam} --json`).stdout
  )
  return result
}

interface MigrateResult {
  succeeded: string[]
  failed: string[]
  skipped: string[]
}

/**
 * batch migrate npm packages
 * @param from source registry url. Example: https://registry.npmjs.org/
 * @param to target registry url
 * @param pkgs packages to migrate. with or without version. Example: ['react', 'react-dom@16.8.0']
 * @returns MigrateResult
 */
const npmMigrateAll = async (from: string, to: string, pkgs: string[]): Promise<MigrateResult> => {
  pkgs = pkgs.map(e => e?.trim?.()).filter(Boolean)
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'npm-migrate-all-'))
  await $`cd ${tempDir}`

  const succeeded: string[] = []
  const failed: string[] = []
  const skipped: string[] = []

  try {
    await $`npm whoami --registry ${to}`
  } catch (error) {
    console.warn(chalk.bgYellowBright(
      `Caution: Not logging to ${to} , npm publish may fail. Consider npm login first.`
    ))
  }

  // fetch metadata
  const metadataBar = multi.newBar(
    `${padName('fetching metadata')} [:bar] :current/:total :etas`,
    getProgressBarOptions(2 * pkgs.length)
  )
  metadataBar.tick(0)

  const getPackageSummary = async (
    pkg: string,
    registry: string
  ): Promise<PackageSummary | null> => {
    let result = null
    try {
      const metadata = await inspect(pkg, null, registry)

      // if pkg is `name@version` format, return only given version.
      // else return all versions
      const lastIndex = pkg.lastIndexOf('@')
      const specifiedVersion = lastIndex > 0 ? pkg.substring(lastIndex + 1) : null

      result = {
        name: metadata.name,
        distTags: metadata['dist-tags'],
        versions: specifiedVersion ? [specifiedVersion] : metadata.versions
      }
    } catch (error) {
      // do nothing
    }
    metadataBar.tick()
    return result
  }

  const fetchSourcePackages = async (): Promise<Array<PackageSummary | null>> => {
    const info = await Promise.all(pkgs.map(async pkg =>
      await concurrenyLimit(async () => await getPackageSummary(pkg, from))
    ))
    return info
  }

  const fetchTargetPackages = async (): Promise<Array<PackageSummary | null>> => {
    const info = await Promise.all(pkgs.map(async pkg =>
      await concurrenyLimit(async () => await getPackageSummary(pkg, to))
    ))
    return info
  }

  const sourcePackages = await fetchSourcePackages()
  const targetPackages = await fetchTargetPackages()

  const delimeter = '^'
  const targetPackageSet = new Set(
    targetPackages
      .filter(Boolean)
      .flatMap(pkg =>
        pkg?.versions.map(e => [pkg.name, e].join(delimeter))
      )
  )

  const publishBar = multi.newBar(
    `${padName('publishing...')} [:bar] :current/:total :etas`,
    getProgressBarOptions(sourcePackages.length)
  )
  publishBar.tick(0)

  const syncOne = async (
    pkg: PackageSummary,
    version: string,
    distTag: string,
    bar: ProgressBar
  ): Promise<void> => {
    const key = [pkg.name, version].join(delimeter)
    const packageName = [pkg.name, version].join('@')
    if (version != null && !targetPackageSet.has(key)) {
      // process single version

      // fetch metadata
      try {
        const metadata = await inspect(pkg.name, version, from)
        const tarballUrl = metadata.dist.tarball
        const tarballData = (await axios.get(
          tarballUrl,
          {
            responseType: 'arraybuffer'
          }
        )).data
        const basename = path.basename(tarballUrl)
        const pkgDir = path.join(tempDir, pkg.name)
        const destFilename = path.join(pkgDir, basename)

        // if publishConfig.registry exists in package.json, then package.json must be edited to use target registry
        // const needUpdate = metadata.publishConfig?.registry && metadata.publishConfig.registry !== to
        const needUpdate = metadata.publishConfig?.registry &&
          metadata.publishConfig?.registry !== to

        if (needUpdate) {
          const pack = tar.pack()
          const extract = tar.extract()

          // eslint-disable-next-line @typescript-eslint/no-misused-promises
          extract.on('entry', async function (header, stream, callback) {
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

          extract.on('finish', function () {
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

        const registryParam = getRegistryParam(pkg.name, to)
        await $`npm publish ${registryParam} --tag ${distTag} ${destFilename}`
        succeeded.push(packageName)
      } catch (error) {
        console.error(chalk.red(error))
        failed.push(packageName)
      }
    } else {
      skipped.push(packageName)
    }
    bar.tick({ version: `v${version ?? ''}` })
  }

  const sync = async (pkg: PackageSummary): Promise<void> => {
    const bar = multi.newBar(
      `${padName('      ' + pkg.name, 40)} [:bar] [:version] :current/:total :etas`,
      getProgressBarOptions(pkg.versions.length)
    )

    bar.tick(0, { version: ' ... ' })

    const pkgDir = path.join(tempDir, pkg.name)
    await fs.rm(pkgDir, { force: true, recursive: true })
    await fs.mkdirp(pkgDir)

    let tmpDistTag = 'npm-release-all-temp'
    while (pkg.distTags[tmpDistTag]) {
      tmpDistTag = 'npm-release-all-temp-' + Math.random().toString().substring(2, 6)
    }
    const version2DistTag = Object.keys(pkg.distTags).reduce((res: Record<string, string>, tag) => {
      const version = pkg.distTags[tag] as string
      res[version] = tag
      return res
    }, {})

    let shouldCleanTmpDistTag = false

    await Promise.all(pkg.versions.map(async version =>
      await concurrenyLimit(async () => {
        const distTag = version2DistTag[version] ?? tmpDistTag
        if (distTag === tmpDistTag) {
          shouldCleanTmpDistTag = true
        }
        await syncOne(pkg, version, version2DistTag[version] ?? tmpDistTag, bar)
      })
    ))

    bar.tick(0, { version: '100%' })

    // clean temporary distTag
    const registryParam = getRegistryParam(pkg.name, to)
    try {
      if (shouldCleanTmpDistTag) {
        await $`npm dist-tag rm ${registryParam} ${pkg.name} ${tmpDistTag}`
      }
    } catch (error) {
      // do nothing
    }

    // treat latest dist-tag specially
    try {
      if (pkg.distTags.latest) {
        await $`npm dist-tag add ${registryParam} ${pkg.name}@${pkg.distTags.latest} latest`
      }
    } catch (error) {
      // do nothing
    }
    publishBar.tick()
  }

  await Promise.all(sourcePackages.filter(Boolean).map(async e =>
    await concurrenyLimit(async () => await sync(e as PackageSummary))
  ))
  return {
    succeeded,
    failed,
    skipped
  }
}

export default npmMigrateAll
