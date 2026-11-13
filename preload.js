const { contextBridge, ipcRenderer } = require('electron');
const call = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld('RushDesktop', {
  isDesktop: true,
  info: call('info'),
  printers: call('printers'),
  printHTML: call('print-html'),
  printEscpos: call('print-escpos'),
  kick: call('kick'),
  testTcp: call('test-tcp'),
  scanLan: call('scan-lan'),
  setAutostart: call('autostart'),
  reload: () => location.reload()
});
