const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kringAPI', {
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (data) => ipcRenderer.invoke('data:save', data),
  importBackupData: (data) => ipcRenderer.invoke('data:import', data),
  openExternal: (url) => ipcRenderer.invoke('external:open', url),
  selectVideoFile: () => ipcRenderer.invoke('video:select'),
  startVodAnalysis: (videoPath, options) =>
    ipcRenderer.invoke('vod:start-analysis', { videoPath, ...options }),
  cancelVodAnalysis: () => ipcRenderer.invoke('vod:cancel-analysis'),
  onVodProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('vod:progress', handler);
    return () => ipcRenderer.removeListener('vod:progress', handler);
  },
  onVodKillEvent: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('vod:kill-event', handler);
    return () => ipcRenderer.removeListener('vod:kill-event', handler);
  },
  onVodError: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('vod:error', handler);
    return () => ipcRenderer.removeListener('vod:error', handler);
  },
  toLocalVideoUrl: (filePath) => {
    if (!filePath) return '';
    return `local-video://media?path=${encodeURIComponent(filePath)}`;
  },
  onUpdaterStatus: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('updater:status', handler);
    return () => ipcRenderer.removeListener('updater:status', handler);
  },
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  quitAndInstallUpdate: () => ipcRenderer.invoke('updater:quit-and-install'),
  openUserDataFolder: () => ipcRenderer.invoke('userData:open-folder'),
});
