const { app, BrowserWindow, globalShortcut, ipcMain, dialog, shell } = require('electron')
const path = require('path')
const fsConstanst = require('fs').constants
const fs = require('fs').promises
const fse = require('fs-extra')
const AdmZip = require('adm-zip')
const mime = require('mime-types')
const os = require('os')
const {promisify} = require('util')
const curseforge = require('./curseforge.js')

const iconExtensions = ['.jpg', '.jpeg', '.png']

// Find default position for .minecraft
let defaultMinecraftPath
switch (os.platform()) {
  case 'win32':
    defaultMinecraftPath = "C:/Users/" + os.userInfo().username + "/AppData/Roaming/.minecraft"
    break
  case 'darwin':
    defaultMinecraftPath = "/Users/" + os.userInfo().username + "/Library/Application Support/minecraft"
    break
  case 'linux':
  default:
    defaultMinecraftPath = "/home/" + os.userInfo().username + "/.minecraft"
}

// Define Default Setings
const defaultSettings = {
  minecraftPath: defaultMinecraftPath,
  createProfiles: true,
  modSymlink: true,
  skipModloaderCheck: false
}
// Load settings file if present
let settings
if (fse.existsSync('settings.json')){
  settings = JSON.parse(fse.readFileSync('settings.json'))
}else{
  settings = {}
}
// Update settings file
settings = { ...defaultSettings, ...settings }

function isDev() {
  return process.argv[2] == '--dev';
}

let win
let manifest

function createWindow () {
  win = new BrowserWindow({
    width: 450,
    height: 264,
    useContentSize: true,
    autoHideMenuBar: true,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  })
  win.setMenu(null)

  if (isDev()){
    globalShortcut.register('f5', function() {
  		win.reload()
  	})
    globalShortcut.register('f12', function() {
  		win.webContents.openDevTools()
  	})
  }

  // Open links in external browser
  win.webContents.on('new-window', function(e, url) {
    e.preventDefault()
    shell.openExternal(url)
  })

  win.loadFile(path.join('public', 'index.html'))
}

app.whenReady().then(() => {
  createWindow()

  // Only one istance per time
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', async () => {
  if (process.platform !== 'darwin') {
    // Remove current working .pack when closing
    await fs.rmdir('.pack', { recursive: true })
    app.quit()
  }
})

// Settings calls handlers
ipcMain.on('getSettings', (event)=>{
  win.webContents.send("settings", settings)
})
ipcMain.on('getDefaultSettings', (event)=>{
  win.webContents.send("settings", defaultSettings)
})
ipcMain.on('setSettings', async (event, newSettings)=>{
  settings = newSettings
  await fs.writeFile('settings.json', JSON.stringify(settings))
})

// Load modpack file
ipcMain.on('openSelectModpackDialog', async (event) => {
  let path = await dialog.showOpenDialog({
    title: "Select the modpack file",
    filters: [
      { name: '.zip files', extensions: ['zip'] },
    ],
    properties: ["openFile"]
  })
  if (path.filePaths[0]) await loadModpack(path.filePaths[0])
  else win.webContents.send("ErrorNoModpack")
})
ipcMain.on('loadModpackFromDrag', async (event, filepath) => {
  await loadModpack(filepath)
})

async function loadModpack(filepath){
  win.webContents.send("loadingModpack")
  // Remove current pack if present
  try {
    await fs.rmdir('.pack', { recursive: true })
  } catch { /*empty*/ }

  let zip = new AdmZip(filepath)
  // Check if zipfile is a modpack
  let zipFiles = zip.getEntries()
  let manifestFound = false
  for (let i = 0; i<zipFiles.length; i++){
    if (zipFiles[i].entryName == "manifest.json"){
      manifestFound = true
      break
    }
  }
  if (!manifestFound){
    win.webContents.send("ErrorNoModpack")
    await fs.rmdir('.pack', { recursive: true })
    return
  }
  // Extract the zip in the .pack folder
  const pExtractAll = promisify(zip.extractAllToAsync.bind(zip))
  await pExtractAll('.pack', true)

  win.webContents.send("updateStatus", "Reading Info...")
  manifest = JSON.parse(await fs.readFile('.pack/manifest.json'))
  let modpackInfo = {
    name: manifest.name,
    author: manifest.author,
    version: manifest.manifestVersion,
    mcVersion: manifest.minecraft.version,
    modloader: manifest.minecraft.modLoaders[0].id,
    modsNum: manifest.files.length
  }

  // Check for modpack icon
  for (let i = 0; i < iconExtensions.length; i++){
    let iconPath = `.pack/icon${iconExtensions[i]}`
    try {
      let mimetype = mime.lookup(iconPath)
      if (mimetype)
        modpackInfo.picture = `data:${mimetype};base64,${(await fs.readFile(iconPath)).toString('base64')}`
      break
    } catch { /*empty*/ }
  }

  // Add mods in the overrides folder to the count
  try {
    modpackInfo.modsNum += (await fs.readdir('.pack/overrides/mods')).length
  } catch { /*empty*/ }

  win.webContents.send("modpackInfo", modpackInfo)
}

async function checkForge(mc, ver){
  let loaderFolder = `${mc}-forge-${ver}`
  let isModloaderInstalled = await fs.access(settings.minecraftPath+'/versions/'+loaderFolder, fsConstanst.F_OK)
  if (isModloaderInstalled) return loaderFolder
  win.webContents.send("updateStatus", `Please install Forge ${ver} for ${mc}`)
  const url = `https://adfoc.us/serve/sitelinks/?id=271228&url=https://maven.minecraftforge.net/net/minecraftforge/forge/${mc}-${ver}/forge-${mc}-${ver}-installer.jar`
  shell.openExternal(url)
  return false
}

async function checkFabric(mc, ver){
  let loaderFolder = `fabric-loader-${ver}-${mc}`
  let isModloaderInstalled = await fs.access(settings.minecraftPath+'/versions/'+loaderFolder, fsConstanst.F_OK)
  if (isModloaderInstalled) return loaderFolder
  win.webContents.send("updateStatus", `Please install Fabric Loader ${ver} for ${mc}`)
  const url = `https://fabricmc.net/use/`
  shell.openExternal(url)
  return false
}

ipcMain.on('installModpack', async (event, forced)=>{
  let modpackSlug = manifest.name.replace(/\s+/g, '-').toLowerCase()
  let minecraftVersion = manifest.minecraft.version
  let loader = manifest.minecraft.modLoaders[0].id
  let [loaderName, loaderVersion] = loader.split('-')

  if (!settings.skipModloaderCheck){
    win.webContents.send("updateStatus", `Checking if ${loader} is installed...`)
    let loaderFolder
    switch (loaderName) {
      case 'forge': loaderFolder = await checkForge(minecraftVersion, loaderVersion); break;
      case 'fabric': loaderFolder = await checkFabric(minecraftVersion, loaderVersion); break;
    }
    if (!loaderFolder){
      win.webContents.send("installationDone", false)
      return
    }
  }

  let modpackFolder = settings.minecraftPath
  if (settings.createProfiles) modpackFolder += '/modpacks/'+modpackSlug

  try {
    let currentModpack = JSON.parse(await fs.readFile(`${modpackFolder}/modpack.json`))
    if (currentModpack.version == manifest.manifestVersion && !forced){
      win.webContents.send("updateStatus", 'Modpack already installed!')
      win.webContents.send("updateLoading", 100)
      win.webContents.send("installationDone", true)
      return
    }else{
      for (let i = 0; i < currentModpack.overrides.length; i++){
        let item = currentModpack.overrides[i]
        await fse.remove(`${modpackFolder}/${item}`)
      }
      await fse.remove(`${modpackFolder}/mods`)
    }
  } catch { /*empty*/ }

  win.webContents.send("updateStatus", 'Initializing download...')

  const modlistFolder = settings.minecraftPath+'/.modlist'
  try { await fs.mkdir(modlistFolder, { recursive: true }) } catch { /*empty*/ }
  let filesDB = {}
  try {
    filesDB = JSON.parse(await fs.readFile(`${modlistFolder}/filesDB.json`))
  } catch { /*empty*/ }

  let filesKeys = Object.keys(filesDB)
  let modpackFiles = []
  let modpackFilesKeys = []

  for (let i = 0; i < manifest.files.length; i++){
    let file = manifest.files[i]
    let fileObject = {}

    if (filesKeys.includes(`${file.projectID}_${file.fileID}`)){
      fileObject = filesDB[`${file.projectID}_${file.fileID}`]
    } else {
      let projectData = await curseforge.getProjectData(file.projectID)
      fileObject.projectName = projectData.name

      fileObject.type = projectData.websiteUrl.split('/')[4]
      switch (fileObject.type) {
        case 'mc-mods': fileObject.type = 'mod'; break;
        case 'texture-packs': fileObject.type = 'resourcepack'; break;
      }

      let fileData = await curseforge.getFileData(file.projectID, file.fileID)
      fileObject.fileName = fileData.fileName
      fileObject.downloadUrl = fileData.downloadUrl
      fileObject.fileLength = fileData.fileLength

      filesDB[`${file.projectID}_${file.fileID}`] = fileObject
    }

    win.webContents.send("updateStatus", `Downloading ${fileObject.type} ${fileObject.projectName}... (${i+1}/${manifest.files.length})`)

    let filePath = `${modlistFolder}/${fileObject.type}s/${fileObject.fileName}`
    let alreadyDownloaded = await fs.access(filePath, fsConstanst.F_OK)
    if (alreadyDownloaded){
      let stats = await fs.stat(filePath)
      alreadyDownloaded = stats.size == fileObject.fileLength
    }

    if (!alreadyDownloaded) await curseforge.downloadFile(filePath, fileObject.downloadUrl)

    win.webContents.send("updateLoading", Math.round((i+1)*100/manifest.files.length))

    modpackFilesKeys.push(`${file.projectID}_${file.fileID}`)
    modpackFiles.push(fileObject)
  }

  win.webContents.send("updateStatus", `Copying mods over...`)

  await fs.writeFile(`${modlistFolder}/filesDB.json`, JSON.stringify(filesDB))

  try { await fs.mkdir(modpackFolder, { recursive: true }) } catch{ /*empty*/ }
  if (settings.modSymlink){
    for (let i = 0; i < modpackFiles.length; i++){
      let file = modpackFiles[i]
      await fse.createSymlink(`${modlistFolder}/${file.type}s/${file.fileName}`, `${modpackFolder}/${file.type}s/${file.fileName}`, 'file')
    }
  } else {
    for (let i = 0; i < modpackFiles.length; i++){
      let file = modpackFiles[i]
      await fse.move(`${modlistFolder}/${file.type}s/${file.fileName}`, `${modpackFolder}/${file.type}s/${file.fileName}`)
    }
    await fse.remove(`${modlistFolder}`)
  }

  win.webContents.send("updateStatus", `Copying overrides...`)
  await fse.copy('.pack/overrides', modpackFolder)
  let overrides = await fs.readdir('.pack/overrides')

  if (settings.createProfiles){
    win.webContents.send("updateStatus", `Generating profile...`)
    let launcherProfiles = JSON.parse(await fs.readFile(`${settings.minecraftPath}/launcher_profiles.json`))
    if (!launcherProfiles.profiles[modpackSlug])
      launcherProfiles.profiles[modpackSlug] = {
        created: new Date().toISOString(),
        gameDir: modpackFolder,
        icon: "TNT",
        lastVersionId: loaderFolder,
        name : manifest.name,
        type : "custom"
      }
    await fs.writeFile(`${settings.minecraftPath}/launcher_profiles.json`, JSON.stringify(launcherProfiles))
  }

  await fs.rmdir('.pack', { recursive: true })
  await fs.writeFile(`${modpackFolder}/modpack.json`, JSON.stringify({
    name: manifest.name,
    author: manifest.author,
    version: manifest.manifestVersion,
    mcVersion: manifest.minecraft.version,
    modloader: loaderFolder,
    files: modpackFilesKeys,
    overrides
  }))

  win.webContents.send("updateStatus", `Ready!`)
  win.webContents.send("installationDone", true)
})
