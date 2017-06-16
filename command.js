#!/usr/bin/env node
const dashdash = require("dashdash")
const path = require("path")
const chalk = require("chalk")
const ora = require("ora")
const { MeshbluConnectorInstaller } = require("./src/installer")

const CLI_OPTIONS = [
  {
    name: "version",
    type: "bool",
    help: "Print connector version and exit.",
  },
  {
    names: ["help", "h"],
    type: "bool",
    help: "Print this help and exit.",
  },
  {
    names: ["connector-path"],
    type: "string",
    env: "MESHBLU_CONNECTOR_PATH",
    help: "Path to connector package.json and assets",
    helpArg: "PATH",
    default: ".",
  },
  {
    names: ["destination-path"],
    type: "string",
    env: "MESHBLU_CONNECTOR_DESTINATION_PATH",
    help: "Path for bin files to be placed in installer",
    helpArg: "PATH",
  },
  {
    names: ["user-install"],
    type: "bool",
    env: "MESHBLU_CONNECTOR_USER_INSTALL",
    help: "Creates a per-user installer",
  },
  {
    names: ["cert-password"],
    type: "string",
    env: "MESHBLU_CONNECTOR_CERT_PASSWORD",
    help: "Password to unlock .p12 certificate",
    helpArg: "PASSWORD",
  },
]

class MeshbluConnectorInstallerWindowsMSICommand {
  constructor(options) {
    if (!options) options = {}
    var { argv, cliOptions } = options
    if (!cliOptions) cliOptions = CLI_OPTIONS
    if (!argv) return this.die(new Error("MeshbluConnectorInstallerWindowsMSICommand requires options.argv"))
    this.argv = argv
    this.cliOptions = cliOptions
    this.parser = dashdash.createParser({ options: this.cliOptions })
  }

  parseArgv({ argv }) {
    try {
      var opts = this.parser.parse(argv)
    } catch (e) {
      return {}
    }

    if (opts.help) {
      console.log(`usage: meshblu-connector-installer-windows-msi [OPTIONS]\noptions:\n${this.parser.help({ includeEnv: true, includeDefault: true })}`)
      process.exit(0)
    }

    if (opts.version) {
      console.log(this.packageJSON.version)
      process.exit(0)
    }

    return opts
  }

  run() {
    const options = this.parseArgv({ argv: this.argv })
    const { connector_path, cert_password, destination_path, user_install } = options
    var errors = []
    if (!connector_path) errors.push(new Error("MeshbluConnectorInstallerWindowsMSICommand requires --connector-path or MESHBLU_CONNETOR_PATH"))
    if (!cert_password) errors.push(new Error("MeshbluConnectorInstallerWindowsMSICommand requires --cert-password or MESHBLU_CONNECTOR_CERT_PASSWORD"))

    if (errors.length) {
      console.log(`usage: meshblu-connector-installer-windows-msi [OPTIONS]\noptions:\n${this.parser.help({ includeEnv: true, includeDefault: true })}`)
      errors.forEach(error => {
        console.error(chalk.red(error.message))
      })
      process.exit(1)
    }

    const spinner = ora("Building package").start()

    const installer = new MeshbluConnectorInstaller({
      connectorPath: path.resolve(connector_path),
      destinationPath: destination_path,
      userInstall: user_install,
      spinner,
      certPassword: cert_password,
    })
    return installer.build().then(() => spinner.succeed("Ship it!")).catch(error => {
      spinner.fail(error.message)
      return Promise.reject(error)
    })
  }

  die(error) {
    console.error("Meshblu Connector Installer Windows MSI Command: error: %s", error.message)
    process.exit(1)
  }
}

const command = new MeshbluConnectorInstallerWindowsMSICommand({ argv: process.argv })
command
  .run()
  .then(() => {
    process.exit(0)
  })
  .catch(error => {
    if (error) {
      if (error.stdout) console.error(error.stdout)
      if (error.stderr) console.error(error.stderr)
      console.error(error)
    }
    process.exit(1)
  })
