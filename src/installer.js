const fs = require("fs-extra")
const Promise = require("bluebird")
const glob = Promise.promisify(require("glob"))
const parseTemplate = require("json-templates")
const path = require("path")
const exec = require("child_process").exec
const { CodeSigner } = require("./codesigner")

class MeshbluConnectorInstaller {
  constructor({ connectorPath, spinner, certPassword }) {
    this.connectorPath = path.resolve(connectorPath)
    this.spinner = spinner
    this.certPassword = certPassword
    this.packageJSON = fs.readJsonSync(path.join(this.connectorPath, "package.json"))
    this.type = this.packageJSON.name
    this.version = this.packageJSON.version
    this.arch = this.getArch()
    this.windowsPackageName = `${this.type}_${this.version}-${this.arch}`
    this.deployPath = path.join(this.connectorPath, "deploy")
    this.deployCachePath = path.join(this.deployPath, ".cache")
    this.deployCachePackagePath = path.join(this.deployCachePath, this.windowsPackageName)
    this.deployInstallersPath = path.join(this.deployPath, "installers")
    this.installerMSIPath = path.join(this.deployInstallersPath, this.windowsPackageName + ".msi")
    this.windowsLibraryPath = `/Library/MeshbluConnectors/${this.type}`
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

  build() {
    return this.copyTemplates().then(() => this.copyPkg()).then(() => this.buildPackage()).then(() => this.signPackage())
  }

  copyPkg() {
    this.spinner.text = "Copying pkg assets"
    const destination = path.join(this.deployCachePackagePath, this.type)
    const source = path.join(this.deployPath, "bin")
    return fs.ensureDir(destination).then(() => {
      return fs.copy(source, destination)
    })
  }

  buildPackage() {
    this.spinner.text = "Building package"
    const directoryWXSFile = path.join(this.deployCachePackagePath, "directory.wxs")
    const sourceDir = path.join(this.deployCachePackagePath, this.type)
    const options = {
      env: {
        PATH: process.env.PATH + ";C:\\Program Files (x86)\\WiX Toolset v3.11\\bin",
      },
    }
    let if64 = ""
    let win64 = "no"
    let transformOption = ""
    let platformOption = ""
    if (process.arch == "x64") {
      if64 = "64"
      win64 = "yes"
      transformOption = `-t ${path.join(this.deployCachePackagePath, "HeatTransform.xslt")}`
      platformOption = "-platform x64"
    }
    return this.exec(
      `heat.exe dir ${sourceDir} -srd -dr INSTALLDIR -cg MainComponentGroup -out ${directoryWXSFile} -ke -sfrag -gg -var var.SourceDir -sreg -scom ${transformOption} ${platformOption}`,
      options
    )
      .then(() => {
        const resourceDirName = path.join(__dirname, "..", "resources")
        return this.exec(
          `candle.exe ${platformOption} -dWin64="${win64}"-dCacheDir="${this.deployCachePath}" -dSourceDir="${sourceDir}" -dType="${this
            .type}" -dResourceDir="${resourceDirName}" -dProductVersion="${this.version}" -dIf64="${if64}" ${this.deployCachePackagePath}\\*.wxs -o ${this
            .deployCachePackagePath}\\ -ext WiXUtilExtension`,
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
    this.spinner.text = "Processing templates"
    const packageTemplatePath = path.resolve(path.join(this.connectorPath, ".installer", "windows", "templates", "**/*"))
    const defaultTemplatePath = path.resolve(path.join(__dirname, "..", "templates", "**/*"))
    return this.findTemplatesFromPaths([packageTemplatePath, defaultTemplatePath]).each(templates => {
      return this.processTemplates(templates)
    })
  }

  findTemplatesFromPaths(templatePaths) {
    return Promise.map(templatePaths, templatePath => {
      return glob(templatePath, { nodir: true })
    })
  }

  processTemplates(templates) {
    return Promise.map(templates, template => {
      const filename = path.basename(template)
      if (filename.indexOf("_") == 0) {
        return this.processTemplate(template)
      }
      return this.copyFile(template)
    })
  }

  getFilePath(file) {
    const fileRegex = new RegExp(`/templates/(.*)$`)
    const matches = file.match(fileRegex)
    const filePartial = matches[matches.length - 1]
    const filePath = path.join(this.deployCachePackagePath, filePartial)
    const { base, dir } = path.parse(filePath)
    const newBase = base.replace(/^_/, "")
    return path.join(dir, newBase)
  }

  processTemplate(file) {
    const template = parseTemplate(fs.readFileSync(file, "utf-8"))
    const results = template(this.templateData)
    const filePath = this.getFilePath(file)
    return fs.outputFile(filePath, results)
  }

  copyFile(file) {
    const filePath = this.getFilePath(file)
    const fileDirPath = path.dirname(filePath)
    return fs.ensureDir(fileDirPath).then(() => {
      return fs.copy(file, filePath, { overwrite: true })
    })
  }
}

module.exports.MeshbluConnectorInstaller = MeshbluConnectorInstaller
