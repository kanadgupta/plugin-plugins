/* eslint-disable no-await-in-loop */
import {Args, Command, Errors, Flags, Interfaces, ux} from '@oclif/core'
import chalk from 'chalk'
import validate from 'validate-npm-package-name'

import Plugins from '../../plugins.js'

export default class PluginsInstall extends Command {
  static aliases = ['plugins:add']

  static args = {
    plugin: Args.string({description: 'Plugin to install.', required: true}),
  }

  static description = `Installs a plugin into the CLI.
Can be installed from npm or a git url.

Installation of a user-installed plugin will override a core plugin.

e.g. If you have a core plugin that has a 'hello' command, installing a user-installed plugin with a 'hello' command will override the core plugin implementation. This is useful if a user needs to update core plugin functionality in the CLI without the need to patch and update the whole CLI.
`

  public static enableJsonFlag = true

  static examples = [
    '<%= config.bin %> <%= command.id %> <%- config.pjson.oclif.examplePlugin || "myplugin" %> ',
    '<%= config.bin %> <%= command.id %> https://github.com/someuser/someplugin',
    '<%= config.bin %> <%= command.id %> someuser/someplugin',
  ]

  static flags = {
    force: Flags.boolean({
      char: 'f',
      description: 'Force npm to fetch remote resources even if a local copy exists on disk.',
    }),
    help: Flags.help({char: 'h'}),
    jit: Flags.boolean({
      hidden: true,
      async parse(input, ctx) {
        if (input === false || input === undefined) return input

        const requestedPlugins = ctx.argv.filter((a) => !a.startsWith('-'))
        if (requestedPlugins.length === 0) return input

        const jitPluginsConfig = ctx.config.pjson.oclif.jitPlugins ?? {}
        if (Object.keys(jitPluginsConfig).length === 0) return input

        const plugins = new Plugins({config: ctx.config})

        const nonJitPlugins = await Promise.all(
          requestedPlugins.map(async (plugin) => {
            const name = await plugins.maybeUnfriendlyName(plugin)
            return {jit: Boolean(jitPluginsConfig[name]), name}
          }),
        )

        const nonJitPluginsNames = nonJitPlugins.filter((p) => !p.jit).map((p) => p.name)
        if (nonJitPluginsNames.length > 0) {
          throw new Errors.CLIError(`The following plugins are not JIT plugins: ${nonJitPluginsNames.join(', ')}`)
        }

        return input
      },
    }),
    silent: Flags.boolean({
      char: 's',
      default: true,
      description: 'Silences npm output.',
      exclusive: ['verbose'],
    }),
    verbose: Flags.boolean({
      char: 'v',
      description: 'Show verbose npm output.',
      exclusive: ['silent'],
    }),
  }

  static strict = false

  static usage = 'plugins:install PLUGIN...'

  flags!: Interfaces.InferredFlags<typeof PluginsInstall.flags>

  // In this case we want these operations to happen
  // sequentially so the `no-await-in-loop` rule is ignored
  async parsePlugin(
    plugins: Plugins,
    input: string,
  ): Promise<{name: string; tag: string; type: 'npm'} | {type: 'repo'; url: string}> {
    // git ssh url
    if (input.startsWith('git+ssh://') || input.endsWith('.git')) {
      return {type: 'repo', url: input}
    }

    const getNameAndTag = async (input: string): Promise<{name: string; tag: string}> => {
      const regexAtSymbolNotAtBeginning = /(?<!^)@/
      const [splitName, tag = 'latest'] = input.split(regexAtSymbolNotAtBeginning)
      const name = splitName.startsWith('@') ? splitName : await plugins.maybeUnfriendlyName(splitName)
      validateNpmPkgName(name)

      if (this.flags.jit) {
        const jitVersion = this.config.pjson.oclif?.jitPlugins?.[name]
        if (jitVersion) {
          if (regexAtSymbolNotAtBeginning.test(input))
            this.warn(
              `--jit flag is present along side a tag. Ignoring tag ${tag} and using the version specified in package.json (${jitVersion}).`,
            )
          return {name, tag: jitVersion}
        }

        this.warn(`--jit flag is present but ${name} is not a JIT plugin. Installing ${tag} instead.`)
        return {name, tag}
      }

      return {name, tag}
    }

    // scoped npm package, e.g. @oclif/plugin-version
    if (input.startsWith('@') && input.includes('/')) {
      const {name, tag} = await getNameAndTag(input)
      return {name, tag, type: 'npm'}
    }

    if (input.includes('/')) {
      // github url, e.g. https://github.com/oclif/plugin-version
      if (input.includes(':')) return {type: 'repo', url: input}
      // github org/repo, e.g. oclif/plugin-version
      return {type: 'repo', url: `https://github.com/${input}`}
    }

    // unscoped npm package, e.g. my-oclif-plugin
    // friendly plugin name, e.g. version instead of @oclif/plugin-version (requires `scope` to be set in root plugin's package.json)
    const {name, tag} = await getNameAndTag(input)
    return {name, tag, type: 'npm'}
  }

  async run(): Promise<void> {
    const {argv, flags} = await this.parse(PluginsInstall)
    this.flags = flags

    const plugins = new Plugins({
      config: this.config,
      verbose: this.flags.verbose,
    })
    const aliases = this.config.pjson.oclif.aliases || {}
    for (let name of argv as string[]) {
      if (aliases[name] === null) this.error(`${name} is blocked`)
      name = aliases[name] || name
      const p = await this.parsePlugin(plugins, name)
      let plugin
      await this.config.runHook('plugins:preinstall', {
        plugin: p,
      })
      try {
        if (p.type === 'npm') {
          ux.action.start(
            `${this.config.name}: Installing plugin ${chalk.cyan(plugins.friendlyName(p.name) + '@' + p.tag)}`,
          )
          plugin = await plugins.install(p.name, {
            force: flags.force,
            tag: p.tag,
          })
        } else {
          ux.action.start(`${this.config.name}: Installing plugin ${chalk.cyan(p.url)}`)
          plugin = await plugins.install(p.url, {force: flags.force})
        }
      } catch (error) {
        ux.action.stop(chalk.bold.red('failed'))
        throw error
      }

      ux.action.stop(`installed v${plugin.version}`)
    }
  }
}

function validateNpmPkgName(name: string): void {
  if (!validate(name).validForNewPackages) {
    throw new Errors.CLIError('Invalid npm package name.')
  }
}
