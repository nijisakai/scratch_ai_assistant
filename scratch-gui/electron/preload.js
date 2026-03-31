// Electron preload script
// 使用 contextBridge 安全地暴露API给渲染进程
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    platform: process.platform,
    isElectron: true,
    getSettings: () => ipcRenderer.invoke('get-settings'),
    saveSettings: (config) => ipcRenderer.invoke('save-settings', config),
    openLink: (url) => ipcRenderer.invoke('open-link', url)
});
