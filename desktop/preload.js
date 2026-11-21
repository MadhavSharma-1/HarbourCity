const { contextBridge, ipcRenderer } = require('electron');

// The only things the game page can ask the desktop app to do.
contextBridge.exposeInMainWorld('neon', {
  hasApiKey: () => ipcRenderer.invoke('has-key'),
  setApiKey: (key) => ipcRenderer.invoke('set-key', key),
  askClaude: (payload) => ipcRenderer.invoke('ask-claude', payload),
  quit: () => ipcRenderer.send('quit'),
});
