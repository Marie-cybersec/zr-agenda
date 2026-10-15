const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('zr', {
  minimize: () => ipcRenderer.send('win:minimize'),
  maximize: () => ipcRenderer.send('win:maximize'),
  close: () => ipcRenderer.send('win:close'),
  focus: () => ipcRenderer.send('win:focus'),
  isMaximized: () => ipcRenderer.invoke('win:is-maximized'),
  onMaximized: cb => ipcRenderer.on('win:maximized', (_, v) => cb(v)),

  vaultStatus: () => ipcRenderer.invoke('vault:status'),
  unlock: password => ipcRenderer.invoke('vault:unlock', password),
  lock: () => ipcRenderer.invoke('vault:lock'),
  setPassword: (current, next) => ipcRenderer.invoke('vault:set-password', current, next),

  load: () => ipcRenderer.invoke('db:load'),
  save: data => ipcRenderer.invoke('db:save', data),
  saveSync: data => ipcRenderer.sendSync('db:save-sync', data),

  saveFile: opts => ipcRenderer.invoke('file:save', opts),
  openFile: opts => ipcRenderer.invoke('file:open', opts),
  info: () => ipcRenderer.invoke('app:info'),
  openDataDir: () => ipcRenderer.send('app:open-data-dir')
})
