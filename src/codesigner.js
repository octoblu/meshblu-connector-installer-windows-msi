const util = require("util")
const exec = util.promisify(require("child_process").exec)
const path = require("path")
const fs = require("fs")
const axios = require("axios")

class CodeSigner {
  constructor({ certPassword, filePath, cachePath, arch }) {
    this.filePath = filePath
    this.cachePath = cachePath
    this.certPassword = certPassword
    this.appCertPath = path.join(this.cachePath, "app.p12")
    this.arch = arch.split("-")[1]
  }

  sign() {
    // sorry!
    return this.downloadCerts().then(() => this.signFile()).then(() => this.cleanup())
  }

  cleanup() {
    const unlinkIfExists = file => {
      if (fs.existsSync(file)) fs.unlinkSync(file)
    }
    unlinkIfExists(this.appCertPath)
  }

  downloadCerts() {
    return this.downloadCert({ url: "https://s3-us-west-2.amazonaws.com/meshblu-connector/certs/CodeSigningCert.p12", filePath: this.appCertPath })
  }

  downloadCert({ url, filePath }) {
    return axios({
      method: "get",
      url,
      responseType: "stream",
    }).then(function(response) {
      return new Promise((resolve, reject) => {
        const stream = response.data
        stream.pipe(fs.createWriteStream(filePath))
        stream.on("end", resolve)
        stream.on("error", reject)
      })
    })
  }

  signFile() {
    const options = {
      env: {
        PATH: process.env.PATH + `;C:\\Program Files (x86)\\Windows Kits\\10\\bin\\${this.arch}`,
      },
    }
    return exec(`signtool /f${this.appCertPath} /p${this.certPassword} ${this.filePath}`, options)
  }
}

module.exports.CodeSigner = CodeSigner
