const {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  dialog,
  shell
} = require('electron')
const path = require('path')
const fs = require('fs')
const fse = require('fs-extra')
const AdmZip = require('adm-zip')
const mime = require('mime-types')
const os = require('os')
const {promisify} = require('util')
const curseforge = require('./curseforge.js')

const iconExtensions = ['.jpg', '.jpeg', '.png']

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

const defaultSettings = {
  minecraftPath: defaultMinecraftPath
}

let settings
if (fs.existsSync('settings.json')){
  settings = JSON.parse(fs.readFileSync('settings.json'))
}else{
  settings = { ...defaultSettings }
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

  /*
  globalShortcut.register('f5', function() {
		win.reload()
	})
  globalShortcut.register('f12', function() {
		win.webContents.openDevTools()
	})
  */

  win.webContents.on('new-window', function(e, url) {
    e.preventDefault();
    shell.openExternal(url);
  });

  win.loadFile(path.join('public', 'index.html'))
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    fs.rmdirSync('.pack', { recursive: true })
    app.quit()
  }
})

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

ipcMain.on('getSettings', (event)=>{
  win.webContents.send("settings", settings)
})
ipcMain.on('getDefaultSettings', (event)=>{
  win.webContents.send("settings", defaultSettings)
})

ipcMain.on('setSettings', (event, newSettings)=>{
  settings = newSettings
  fs.writeFileSync('settings.json', JSON.stringify(settings))
})

async function loadModpack(filepath){
  win.webContents.send("loadingModpack")
  if (fs.existsSync('.pack')) fs.rmdirSync('.pack', { recursive: true })
  let zip = new AdmZip(filepath)
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
    fs.rmdirSync('.pack', { recursive: true })
    return
  }
  const pExtractAll = promisify(zip.extractAllToAsync.bind(zip))
  await pExtractAll('.pack', true)
  
  win.webContents.send("updateStatus", "Reading Info...")

  manifest = JSON.parse(fs.readFileSync('.pack/manifest.json'))
  let modpackInfo = {
    name: manifest.name,
    author: manifest.author,
    mcVersion: manifest.minecraft.version,
    modloader: manifest.minecraft.modLoaders[0].id,
    modsNum: manifest.files.length
  }

  for (let i = 0; i < iconExtensions.length; i++){
    let iconPath = `.pack/icon${iconExtensions[i]}`
    if (fs.existsSync(iconPath)){
      let mimetype = mime.lookup(iconPath)
      if (mimetype)
        modpackInfo.picture = `data:${mimetype};base64,${fs.readFileSync(iconPath).toString('base64')}`
      break
    }
  }

  if (fs.existsSync('.pack/overrides/mods'))
    modpackInfo.modsNum += fs.readdirSync('.pack/overrides/mods').length
  win.webContents.send("modpackInfo", modpackInfo)
}

async function checkAndInstallForge(mc, ver){
  let loaderFolder = `${mc}-forge-${ver}`
  let isModloaderInstalled = fs.existsSync(settings.minecraftPath+'/versions/'+loaderFolder)
  if (isModloaderInstalled) return loaderFolder
  win.webContents.send("updateStatus", `Please install Forge ${ver} for ${mc}`)
  const url = `https://adfoc.us/serve/sitelinks/?id=271228&url=https://maven.minecraftforge.net/net/minecraftforge/forge/${mc}-${ver}/forge-${mc}-${ver}-installer.jar`
  shell.openExternal(url)
  return false
}

async function checkAndInstallFabric(mc, ver){
  let loaderFolder = `fabric-loader-${ver}-${mc}`
  let isModloaderInstalled = fs.existsSync(settings.minecraftPath+'/versions/'+loaderFolder)
  if (isModloaderInstalled) return loaderFolder
  win.webContents.send("updateStatus", `Please install Fabric Loader ${ver} for ${mc}`)
  const url = `https://fabricmc.net/use/`
  shell.openExternal(url)
  return false
}

ipcMain.on('installModpack', async (event)=>{
  let modpackSlug = manifest.name.replace(/\s+/g, '-').toLowerCase()
  let minecraftVersion = manifest.minecraft.version
  let loader = manifest.minecraft.modLoaders[0].id
  let [loaderName, loaderVersion] = loader.split('-')

  win.webContents.send("updateStatus", `Checking if ${loader} is installed...`)
  let loaderFolder
  switch (loaderName) {
    case 'forge': loaderFolder = await checkAndInstallForge(minecraftVersion, loaderVersion); break;
    case 'fabric': loaderFolder = await checkAndInstallFabric(minecraftVersion, loaderVersion); break;
  }

  if (!loaderFolder){
    win.webContents.send("installationDone", false)
    return
  }

  const modpackFolder = settings.minecraftPath+'/modpacks/'+modpackSlug
  if (!fs.existsSync(modpackFolder)) fs.mkdirSync(modpackFolder, { recursive: true })

  for (let i = 0; i < manifest.files.length; i++){
    let file = manifest.files[i]
    let projectData = await curseforge.getProjectData(file.projectID)
    let fileType = projectData.websiteUrl.split('/')[4]
    switch (fileType) {
      case 'mc-mods': fileType = 'mod'; break;
      case 'texture-packs': fileType = 'resourcepack'; break;
    }
    win.webContents.send("updateStatus", `Downloading ${fileType} ${projectData.name}... (${i+1}/${manifest.files.length})`)

    let fileData = await curseforge.getFileData(file.projectID, file.fileID)
    let {fileName, downloadUrl} = fileData
    let filePath = `${modpackFolder}/${fileType}s/${fileName}`
    if (fs.existsSync(filePath)){
      let stats = fs.statSync(filePath)
      if (stats.size != fileData.fileLength)
        await curseforge.downloadFile(filePath, downloadUrl)
    }else{
      await curseforge.downloadFile(filePath, downloadUrl)
    }

    win.webContents.send("updateLoading", Math.round((i+1)*100/manifest.files.length))
  }

  win.webContents.send("updateStatus", `Copying overrides...`)
  fse.copySync('.pack/overrides', modpackFolder)

  win.webContents.send("updateStatus", `Generating profile...`)
  let launcherProfiles = JSON.parse(fs.readFileSync(`${settings.minecraftPath}/launcher_profiles.json`))
  if (!launcherProfiles.profiles[modpackSlug])
    launcherProfiles.profiles[modpackSlug] = {
      created: new Date().toISOString(),
      gameDir: modpackFolder,
      icon: "TNT",
      lastVersionId: loaderFolder,
      name : manifest.name,
      type : "custom"
    }
  fs.writeFileSync(`${settings.minecraftPath}/launcher_profiles.json`, JSON.stringify(launcherProfiles))

  fs.rmdirSync('.pack', { recursive: true })
  win.webContents.send("updateStatus", `Ready!`)
  win.webContents.send("installationDone", true)
})
