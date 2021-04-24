const got = require('got')
const fs = require('fs')
const path = require('path')

const stream = require('stream')
const {promisify} = require('util')
const pipeline = promisify(stream.pipeline)

const apiURL = "https://addons-ecs.forgesvc.net/api/v2"
const headers = {'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:75.0) Gecko/20100101 Firefox/75.0'}

async function getProjectData(pid){
  return got.get(`${apiURL}/addon/${pid}`, { headers }).json()
}

async function getFileData(pid, fid){
  return got.get(`${apiURL}/addon/${pid}/file/${fid}`, { headers }).json()
}

async function downloadFile(filePath, url){
  let parentPath = path.dirname(filePath)
  if (!fs.existsSync(parentPath)) fs.mkdirSync(parentPath, { recursive: true })

  let output = fs.createWriteStream(filePath)
  let response = got.stream(url, { headers, retry: 3 })

  await pipeline(response, output)
}

module.exports = {
  getProjectData,
  getFileData,
  downloadFile
}
