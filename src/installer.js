const fs = require("fs-extra")
const Promise = require("bluebird")
const glob = Promise.promisify(require("glob"))
const path = require("path")
const exec = require("child_process").exec
const { CodeSigner } = require("./codesigner")
const debug = require("debug")("meshblu-connector-installer-windows-msi")
const uuidByString = require("uuid-by-string")
const JSONTemplateFiles = require("json-template-files")

class MeshbluConnectorInstaller {
  constructor({ connectorPath, spinner, certPassword, destinationPath, userInstall }) {
    this.connectorPath = connectorPath
    this.templatesPath = "templates"
    this.userInstall = userInstall
    this.spinner = spinner
    this.certPassword = certPassword
    this.packageJSON = fs.readJsonSync(path.join(this.connectorPath, "package.json"))
    this.type = this.packageJSON.name
    this.version = this.packageJSON.version
    this.arch = this.getArch()
    this.target = this.getTarget()
    this.windowsPackageName = `${this.type}_${this.version}-${this.arch}`
    this.deployPath = path.join(this.connectorPath, "deploy", this.target)
    this.deployCachePath = path.join(this.deployPath, ".cache")
    this.deployCachePackagePath = path.join(this.deployCachePath, this.windowsPackageName)
    this.deployInstallersPath = path.join(this.deployPath, "installers")
    this.installerMSIPath = path.join(this.deployInstallersPath, this.windowsPackageName + (this.userInstall ? "-user" : "") + ".msi")
    this.destinationPath = destinationPath || this.type
    this.templateData = {
      type: this.type,
      version: this.version,
      arch: this.arch,
      description: this.packageJSON.description,
    }
  }

  getArch() {
    if (process.arch === "ia32") return "windows-x86"
    return "windows-x64"
  }

  getTarget() {
    let { arch, platform } = process
    if (platform === "darwin") platform = "macos"
    if (platform === "win32") platform = "win"
    if (arch === "ia32") arch = "x86"
    if (arch === "arm") arch = "armv7"

    const nodeVersion = "8"
    return `node${nodeVersion}-${platform}-${arch}`
  }

  build() {
    return this.copyTemplates().then(() => this.copyAssets()).then(() => this.buildPackage()).then(() => this.signPackage()).then(() => this.cleanup())
  }

  cleanup() {
    return glob(path.join(this.deployInstallersPath, "*.wixpdb")).each(file => fs.unlink(file))
  }

  copyAssets() {
    this.spinner.text = "Copying pkg assets"
    const destination = path.join(this.deployCachePackagePath, this.type)
    const source = path.join(this.deployPath, "bin")
    debug("copy assets", { destination, source })
    return fs
      .pathExists(source)
      .then(exists => {
        if (!exists) {
          return Promise.reject(new Error(`Source path does not exist: ${source}`))
        }
        return fs.ensureDir(destination)
      })
      .then(() => fs.copy(source, destination))
  }

  buildPackage() {
    this.spinner.text = "Building package"
    debug("build package")
    const directoryWXSFile = path.join(this.deployCachePackagePath, "directory.wxs")
    const sourceDir = path.join(this.deployCachePackagePath, this.type)
    const options = {
      env: {
        PATH: process.env.PATH,
      },
    }
    let if64 = ""
    let win64 = "no"
    let transformOption = ""
    let platformOption = ""
    let archOption = "-arch x86"
    if (process.arch == "x64") {
      if64 = "64"
      win64 = "yes"
      transformOption = `-t ${path.join(this.deployCachePackagePath, "HeatTransform.xslt")}`
      platformOption = "-platform x64"
      archOption = "-arch x64"
    }
    return this.exec(
      `heat.exe dir ${sourceDir} -srd -dr INSTALLDIR -cg MainComponentGroup -out ${directoryWXSFile} -ke -sfrag -gg -var var.SourceDir -sreg -scom ${transformOption} ${platformOption}`,
      options
    )
      .then(() => {
        const resourceDirName = path.join(__dirname, "..", "resources")
        const installScope = this.userInstall ? "perUser" : "perMachine"
        const upgradeCode = uuidByString(`${this.type}-${installScope}`)
        return this.exec(
          `candle.exe ${archOption} -dWin64="${win64}" -dUpgradeCode="${upgradeCode}" -dInstallScope="${installScope}" -dDestinationPath="${this
            .destinationPath}" -dCacheDir="${this.deployCachePath}" -dSourceDir="${sourceDir}" -dType="${this.type}" -dResourceDir="${resourceDirName}" -dProductVersion="${this
            .version}" -dIf64="${if64}" ${this.deployCachePackagePath}\\*.wxs -o ${this.deployCachePackagePath}\\ -ext WiXUtilExtension`,
          options
        )
      })
      .then(() => {
        return this.exec(`light.exe -o ${this.installerMSIPath} ${this.deployCachePackagePath}\\*.wixobj -cultures:en-US -ext WixUIExtension.dll -ext WiXUtilExtension`, options)
      })
  }

  exec(cmd, options) {
    return new Promise((resolve, reject) => {
      exec(cmd, options, (error, stdout, stderr) => {
        if (error) {
          error.stdout = stdout
          error.stderr = stderr
          return reject(error)
        }
        return resolve(stdout, stderr)
      })
    })
  }

  signPackage() {
    debug("signing package")
    this.spinner.text = "Signing package"
    const codeSigner = new CodeSigner({
      certPassword: this.certPassword,
      filePath: this.installerMSIPath,
      cachePath: this.deployCachePath,
      arch: this.arch,
    })
    return codeSigner.sign()
  }

  copyTemplates() {
    debug("processing templates")
    this.spinner.text = "Processing templates"
    const packageTemplatePath = path.resolve(path.join(this.connectorPath, ".installer", "windows", this.templatesPath, "**/*"))
    const defaultTemplatePath = path.resolve(path.join(__dirname, "..", this.templatesPath, "**/*"))
    return new JSONTemplateFiles({
      packageTemplatePath,
      defaultTemplatePath,
      templateData: this.templateData,
      outputPath: this.deployCachePackagePath,
    }).process()
  }
}

module.exports.MeshbluConnectorInstaller = MeshbluConnectorInstaller
