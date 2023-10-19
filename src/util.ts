import {ux} from '@oclif/core'
import * as fs from 'node:fs'
import * as fsPromises from 'node:fs/promises'
import {createRequire} from 'node:module'
import {type} from 'node:os'
import * as path from 'node:path'

type CompareTypes = boolean | number | string | undefined

function compare(a: CompareTypes | CompareTypes[], b: CompareTypes | CompareTypes[]): number {
  const itemA = a === undefined ? 0 : a
  const itemB = b === undefined ? 0 : b

  if (Array.isArray(itemA) && Array.isArray(itemB)) {
    if (itemA.length === 0 && itemB.length === 0) return 0
    const diff = compare(itemA[0], itemB[0])
    if (diff !== 0) return diff
    return compare(itemA.slice(1), itemB.slice(1))
  }

  if (itemA < itemB) return -1
  if (itemA > itemB) return 1
  return 0
}

export function sortBy<T>(arr: T[], fn: (i: T) => CompareTypes | CompareTypes[]): T[] {
  return arr.sort((a, b) => compare(fn(a), fn(b)))
}

export function uniq<T>(arr: T[]): T[] {
  return arr.filter((a, i) => arr.indexOf(a) === i)
}

export function uniqWith<T>(arr: T[], fn: (a: T, b: T) => boolean): T[] {
  return arr.filter((a, i) => !arr.some((b, j) => j > i && fn(a, b)))
}

const isExecutable = (filepath: string): boolean => {
  if (type() === 'Windows_NT') return filepath.endsWith('node.exe')

  try {
    if (filepath.endsWith('node')) {
      // This checks if the filepath is executable on Mac or Linux, if it is not it errors.
      fs.accessSync(filepath, fs.constants.X_OK)
      return true
    }
  } catch {
    return false
  }

  return false
}

/**
 * Get the path to the node executable
 * If using a macos/windows/tarball installer it will use the node version included in it.
 * If that fails (or CLI was installed via npm), this will resolve to the global node installed in the system.
 * @param root - The root path of the CLI (this.config.root).
 * @returns The path to the node executable.
 */
export async function findNode(root: string): Promise<string> {
  const cliBinDirs = [path.join(root, 'bin'), path.join(root, 'client', 'bin')].filter((p) => fs.existsSync(p))
  const {default: shelljs} = await import('shelljs')

  if (cliBinDirs.length > 0) {
    // Find the node executable
    // eslint-disable-next-line unicorn/no-array-callback-reference
    const node = shelljs.find(cliBinDirs).find((file: string) => isExecutable(file))
    if (node) {
      return fs.realpathSync(node)
    }
  }

  // Check to see if node is installed
  const nodeShellString = shelljs.which('node')
  if (nodeShellString?.code === 0 && nodeShellString?.stdout) return nodeShellString.stdout

  const err = new Error('Cannot locate node executable.')
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore override readonly .name field
  err.name = 'CannotFindNodeExecutable'
  throw err
}

/**
 * Get the path to the npm CLI file.
 * This will always resolve npm to the pinned version in `@oclif/plugin-plugins/package.json`.
 *
 * @returns The path to the `npm/bin/npm-cli.js` file.
 */
export async function findNpm(): Promise<string> {
  const require = createRequire(import.meta.url)
  const npmPjsonPath = require.resolve('npm/package.json')
  const npmPjson = JSON.parse(await fsPromises.readFile(npmPjsonPath, {encoding: 'utf8'}))
  const npmPath = npmPjsonPath.slice(0, Math.max(0, npmPjsonPath.lastIndexOf(path.sep)))
  return path.join(npmPath, npmPjson.bin.npm)
}

export class WarningsCache {
  private static cache: string[] = []
  private static instance: WarningsCache
  public static getInstance(): WarningsCache {
    if (!WarningsCache.instance) {
      WarningsCache.instance = new WarningsCache()
    }

    return WarningsCache.instance
  }

  public add(...warnings: string[]): void {
    for (const warning of warnings) {
      if (!WarningsCache.cache.includes(warning)) {
        WarningsCache.cache.push(warning)
      }
    }
  }

  public flush(): void {
    for (const warning of WarningsCache.cache) {
      ux.warn(warning)
    }
  }
}
