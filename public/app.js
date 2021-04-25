const btnSelectModpack = document.querySelector("#select-modpack")
const btnInstallModpack = document.querySelector("#install-modpack")

const btnOpenSettings = document.querySelector("#open-settings")
const btnCloseSettings = document.querySelector("#close-settings")
const btnSaveSettings = document.querySelector("#save-settings")
const btnDefaultSettings = document.querySelector("#default-settings")

const sectionSelectModpack = document.querySelector("#modpack-selection")
const sectionDisplayModpack = document.querySelector("#modpack-info")
const sectionSettings = document.querySelector("#settings-tab")

const minecraftPath = document.querySelector("#settings-tab input[name=minecraftPath]")
const createProfiles = document.querySelector("#settings-tab input[name=createProfiles]")
const modSymlink = document.querySelector("#settings-tab input[name=modSymlink]")

const modpackTitle = document.querySelector("#mod-container .info h1")
const modpackAuthor = document.querySelector("#mod-container .info h2")
const modpackVersion = document.querySelector("#mod-container .info p.version")
const modpackMods = document.querySelector("#mod-container .info p.mods")
const modpackPicture = document.querySelector("#mod-container .picture")

let statusText = document.querySelector("#status")
let loadingBar = document.querySelector("#loading-bar")

let loadingModpackLock = false

window.api.receive("updateStatus", (text) => {
  statusText.innerText = text+""
})

window.api.receive("ErrorNoModpack", () => {
  statusText.innerText = "The given file is not a modpack"
  loadingModpackLock = false
  btnSelectModpack.disabled = undefined
  sectionSelectModpack.classList.remove("hidden")
})

window.api.receive("updateLoading", (value) => {
  loadingBar.style.width = value+"%"
})

window.api.receive("loadingModpack", () => {
  loadingModpackLock = true
  statusText.innerText = "Loading modpack..."
})

window.api.receive("installationDone", (status) => {
  loadingModpackLock = false
  if (status){
    btnInstallModpack.innerText = "Installed!"
  } else {
    btnInstallModpack.disabled = undefined
  }
})

window.api.receive("modpackInfo", (modpack) => {
  loadingModpackLock = false
  btnInstallModpack.disabled = undefined
  btnInstallModpack.innerText = "Install modpack"
  statusText.innerText = "Ready!"

  modpackTitle.innerText = modpack.name
  modpackAuthor.innerText = modpack.author
  modpackVersion.innerText = `${modpack.mcVersion} - ${modpack.modloader}`
  modpackMods.innerText = `${modpack.modsNum} mods`
  if (modpack.picture)
    modpackPicture.style.backgroundImage = "url("+ modpack.picture +")"
  else
    modpackPicture.style.backgroundImage = null

  sectionDisplayModpack.classList.remove("hidden")
})

// Select modpack
btnSelectModpack.addEventListener('click', (event)=>{
  btnSelectModpack.disabled = true
  sectionSelectModpack.classList.add("hidden")
  sectionDisplayModpack.classList.add("hidden")
  window.api.send('openSelectModpackDialog')
})

document.addEventListener('drop', (event) => {
  event.preventDefault();
  event.stopPropagation();

  for (const f of event.dataTransfer.files) {
    let modpackPath = f.path
    if (modpackPath.endsWith(".zip") && !loadingModpackLock){
      btnSelectModpack.disabled = true
      sectionSelectModpack.classList.add("hidden")
      sectionDisplayModpack.classList.add("hidden")
      window.api.send('loadModpackFromDrag', modpackPath)
      loadingModpackLock = true
    }

  }
})

document.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.stopPropagation();
})

// Install modpack
btnInstallModpack.addEventListener('click', (event)=>{
  btnInstallModpack.disabled = true
  loadingModpackLock = true
  window.api.send('installModpack', event.shiftKey)
})

// Open/Close settings
btnOpenSettings.addEventListener('click', (event)=>{
  window.api.send('getSettings')
  sectionSettings.style.right = "0px";
})
btnCloseSettings.addEventListener('click', (event)=>{
  sectionSettings.style.right = "-100%";
})

btnSaveSettings.addEventListener('click', (event)=>{
  window.api.send('setSettings', {
    minecraftPath: minecraftPath.value,
    createProfiles: createProfiles.checked,
    modSymlink: modSymlink.checked,
  })
})

window.api.receive("settings", (settings) => {
  minecraftPath.value = settings.minecraftPath
  createProfiles.checked = settings.createProfiles
  modSymlink.checked = settings.modSymlink
})

btnDefaultSettings.addEventListener('click', (event)=>{
  window.api.send('getDefaultSettings')
})

// Load settings on startup
window.api.send('getSettings')
