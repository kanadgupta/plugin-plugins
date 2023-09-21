import {Interfaces, ux} from '@oclif/core'
import {fork} from 'child_process'
import NpmRunPath from 'npm-run-path'
import * as path from 'path'

const debug = require('debug')('cli:yarn')

export default class Yarn {
  config: Interfaces.Config

  constructor({config}: { config: Interfaces.Config }) {
    this.config = config
  }

  get bin(): string {
    return require.resolve('yarn/bin/yarn.js')
  }

  fork(modulePath: string, args: string[] = [], options: any = {}): Promise<void> {
    return new Promise((resolve, reject) => {
      const forked = fork(modulePath, args, options)
      forked.stderr?.on('data', (d: any) => process.stderr.write(d))
      forked.stdout?.setEncoding('utf8')
      forked.stdout?.on('data', (d: any) => {
        if (options.verbose) process.stdout.write(d)
        else ux.action.status = d.replace(/\n$/, '').split('\n').pop()
      })

      forked.on('error', reject)
      forked.on('exit', (code: number) => {
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`${modulePath} ${args.join(' ')} exited with code ${code}`))
        }
      })

      // Fix windows bug with node-gyp hanging for input forever
      // if (this.config.windows) {
      //   forked.stdin.write('\n')
      // }
    })
  }

  // eslint-disable-next-line default-param-last
  async exec(args: string[] = [], opts: {cwd: string; verbose: boolean}): Promise<void> {
    const cwd = opts.cwd
    if (args[0] !== 'run') {
      // https://classic.yarnpkg.com/lang/en/docs/cli/#toc-concurrency-and-mutex
      // Default port is: 31997
      const port = this.config.scopedEnvVar('NETWORK_MUTEX_PORT')
      const optionalPort = port ? `:${port}` : ''
      const mutex = this.config.scopedEnvVar('USE_NETWORK_MUTEX') ? `network${optionalPort}` : `file:${path.join(cwd, 'yarn.lock')}`
      const cacheDir = path.join(this.config.cacheDir, 'yarn')
      args = [
        ...args,
        '--non-interactive',
        `--mutex=${mutex}`,
        `--preferred-cache-folder=${cacheDir}`,
        '--check-files',
      ]
      if (opts.verbose) {
        args.push('--verbose')
      }

      if (this.config.npmRegistry) {
        args.push(`--registry=${this.config.npmRegistry}`)
      }
    }

    const npmRunPath: typeof NpmRunPath = require('npm-run-path')
    const options = {
      ...opts,
      cwd,
      stdio: [0, null, null, 'ipc'],
      env: npmRunPath.env({cwd, env: process.env}),
      // Remove --loader ts-node/esm from execArgv so that the subprocess doesn't fail if it can't find ts-node.
      // The ts-node/esm loader isn't need to execute yarn commands anyways.
      execArgv: process.execArgv.join(' ').replace('--loader ts-node/esm', '').split(' ').filter(Boolean),
    }

    if (opts.verbose) {
      process.stderr.write(`${cwd}: ${this.bin} ${args.join(' ')}`)
    }

    debug(`${cwd}: ${this.bin} ${args.join(' ')}`)
    try {
      await this.fork(this.bin, args, options)
      debug('yarn done')
    } catch (error: any) {
      debug('yarn error', error)
      // to-do: https://github.com/yarnpkg/yarn/issues/2191
      const networkConcurrency = '--network-concurrency=1'
      if (error.message.includes('EAI_AGAIN') && !args.includes(networkConcurrency)) {
        debug('EAI_AGAIN')
        return this.exec([...args, networkConcurrency], opts)
      }

      throw error
    }
  }
}
