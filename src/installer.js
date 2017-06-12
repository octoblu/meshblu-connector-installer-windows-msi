const fs = require("fs-extra")
const Promise = require("bluebird")
const glob = Promise.promisify(require("glob"))
const parseTemplate = require("json-templates")
const path = require("path")
const utils = require("utils")
const exec = utils.promisify(require("child_process").exec)

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
    return this.copyTemplates()
      .then(() => {
        return this.copyPkg()
      })
      .then(() => {
        return this.buildPackage()
      })
      .then(() => {
        return this.signPackage()
      })
      .then(() => {
        return this.createDMG()
      })
  }

  copyPkg() {
    this.spinner.text = "Copying pkg assets"
    const destination = this.deployCachePackagePath
    const source = path.join(this.deployPath, "bin")
    return fs.ensureDir(destination).then(() => {
      return fs.copy(source, destination)
    })
  }

  buildPackage() {
    // $script_dir = Get-ScriptDirectory
    // $shared_dir = "$script_dir\..\win32-shared"
    // $output_dir = "$script_dir\output"
    // $cache_dir = "$script_dir\..\cache\$platform"
    // $tmp_dir = [io.path]::GetTempFileName()
    // $wix_template_dir = "$shared_dir\wix"
    // $wix_dir = "C:\Program Files (x86)\WiX Toolset v3.10\bin"

    // . $wix_dir\heat.exe dir $tmp_dir -srd -dr INSTALLDIR -cg MainComponentGroup -out $shared_dir\wix\directory.wxs -ke -sfrag -gg -var var.SourceDir -sreg -scom
    // . $wix_dir\candle.exe -dCacheDir="$cache_dir" -dSourceDir="$tmp_dir" -dProductVersion="$gateblu_legal_version" $wix_template_dir\*.wxs -o $output_dir\\ -ext WiXUtilExtension
    // . $wix_dir\light.exe -o $output_dir\GatebluService-$platform.msi $output_dir\*.wixobj -cultures:en-US -ext WixUIExtension.dll -ext WiXUtilExtension

    this.spinner.text = "Building package"
    const directoryWXSFile = path.join(this.deployCachePackagePath, "directory.wxs")
    return exec(`heat.exe dir ${this.deployCachePath} -srd -dr INSTALLDIR -cg MainComponentGroup -out ${directoryWXSFile} -ke -sfrag -gg -var var.SourceDir -sreg -scom`)
      .then(() => {
        return exec(
          `candle.exe -dCacheDir="${this.deployCachePath}" -dSourceDir="${this.deployCachePackagePath}" -dProductVersion="${this.version}" ${this.deployCachePackagePath} -o ${this
            .deployCachePackagePath}\\ -ext WiXUtilExtension`
        )
      })
      .then(() => {
        return exec(`light.exe -o ${this.installerMSIPath} ${this.deployCachePackagePath}\*.wixobj -cultures:en-US -ext WixUIExtension.dll -ext WiXUtilExtension`)
      })
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
    const fileRegex = new RegExp(`${path.sep}templates${path.sep}(.*)$`)
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
