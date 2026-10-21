// Exposes a tiny, safe bridge to the web UI as window.bitsDesktop.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bitsDesktop", {
  platform: process.platform,
  hideOverlay: () => ipcRenderer.send("bits:hide-overlay"),
  openMain: () => ipcRenderer.send("bits:open-main"),
  resizeOverlay: (height) => ipcRenderer.send("bits:resize-overlay", height),
  onOverlayShown: (fn) => {
    const handler = () => fn();
    ipcRenderer.on("bits:overlay-shown", handler);
    return () => ipcRenderer.removeListener("bits:overlay-shown", handler);
  },
});
