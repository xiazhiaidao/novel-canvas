const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('novelAPI', {
  changeFolder: () => ipcRenderer.invoke('change-folder')
});
