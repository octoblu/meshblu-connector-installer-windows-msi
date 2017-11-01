#!/usr/bin/env node
const OctoDash = require("octodash")
const path = require("path")
const ora = require("ora")
const packageJSON = require("./package.json")
const { MeshbluConnectorInstaller } = require("./src/installer")

const CLI_OPTIONS = [
  {
    names: ["connector-path"],
    type: "string",
    required: true,
    env: "MESHBLU_CONNECTOR_PATH",
    help: "Path to connector package.json and assets",
    helpArg: "PATH",
    default: ".",
    completionType: "file",
  },
  {
    names: ["destination-path"],
    type: "string",
    env: "MESHBLU_CONNECTOR_DESTINATION_PATH",
    help: "Path for bin files to be placed in installer",
    helpArg: "PATH",
  },
  {
    names: ["cert-password"],
    type: "string",
    required: true,
    env: "MESHBLU_CONNECTOR_CERT_PASSWORD",
    help: "Password to unlock .p12 certificate",
    helpArg: "PASSWORD",
  },
  {
    names: ["user-install"],
    type: "bool",
    env: "MESHBLU_CONNECTOR_USER_INSTALL",
    help: "Creates a per-user installer",
    default: false,
  },
]

class MeshbluConnectorInstallerWindowsMSICommand {
  constructor({ argv, cliOptions = CLI_OPTIONS } = {}) {
    this.octoDash = new OctoDash({
      argv,
      cliOptions,
      name: packageJSON.name,
      version: packageJSON.version,
    })
  }

  async function run() {
    const { connectorPath, certPassword, destinationPath, userInstall } = this.octoDash.parseOptions()
    const spinner = ora("Building package").start()
    const installer = new MeshbluConnectorInstaller({
      connectorPath: path.resolve(connectorPath),
      destinationPath,
      userInstall,
      certPassword,
      spinner,
    })
    return installer
      .build()
      .catch(error => {
        spinner.fail(error.message)
        throw error
      })
      .then(() => spinner.succeed("Ship it!"))
  }

  die(error) {
    this.octoDash.die(error)
  }
}

const command = new MeshbluConnectorInstallerWindowsMSICommand({ argv: process.argv })
command
  .run()
  .catch(error => {
    command.die(error)
  })
  .then(() => {
    process.exit(0)
  })
