const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('snapAPI', {
  searchUser: (username) => ipcRenderer.invoke('search-user', username),

  downloadStory: (snap) => ipcRenderer.invoke('download-story', snap),

  downloadAll: (snaps, username) =>
    ipcRenderer.invoke('download-all', snaps, username),

  onDownloadProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('download-progress', handler);
    return () => ipcRenderer.removeListener('download-progress', handler);
  },

  onUpdateAvailable: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.once('update-available', handler);
    return () => ipcRenderer.removeListener('update-available', handler);
  },

  openReleaseUrl: (url) => ipcRenderer.invoke('open-release-url', url),
});
