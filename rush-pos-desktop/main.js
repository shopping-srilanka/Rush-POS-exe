// Rush POS Pro - Desktop shell (Electron = Chromium engine)
const { app, BrowserWindow, ipcMain, protocol, net, dialog, Menu, session, shell } = require('electron');
const path = require('path'), fs = require('fs'), os = require('os');
const nodeNet = require('net');
const { execFile } = require('child_process');
const { pathToFileURL } = require('url');

// app is served from rush://app/ -> secure origin (localStorage, Web Serial, fetch to Firebase all work)
protocol.registerSchemesAsPrivileged([{ scheme: 'rush', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
if (!app.requestSingleInstanceLock()) app.quit();

let win;
const APP_DIR = path.join(__dirname, 'app');

function createWindow() {
  win = new BrowserWindow({
    width: 1366, height: 820, minWidth: 1000, minHeight: 600, show: false,
    backgroundColor: '#0b1020', autoHideMenuBar: true, title: 'Rush POS Pro',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, spellcheck: false }
  });
  win.once('ready-to-show', () => win.show());
  win.loadURL('rush://app/index.html');
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('before-input-event', (e, i) => {
    if (i.type !== 'keyDown') return;
    if (i.key === 'F11') win.setFullScreen(!win.isFullScreen());
    if (i.key === 'F5' || (i.control && i.key.toLowerCase() === 'r')) win.reload();
    if (i.key === 'F12' || (i.control && i.shift && i.key.toLowerCase() === 'i')) win.webContents.toggleDevTools();
  });
  win.webContents.on('did-fail-load', (e, code, desc, url) => { if (code !== -3) dialog.showErrorBox('Rush POS', 'Load failed: ' + desc + '\n' + url); });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  protocol.handle('rush', (req) => {
    let p = decodeURIComponent(new URL(req.url).pathname);
    if (!p || p === '/') p = '/index.html';
    const f = path.normalize(path.join(APP_DIR, p));
    if (!f.startsWith(APP_DIR)) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(f).toString());
  });
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, perm, cb) => cb(true));
  ses.setPermissionCheckHandler(() => true);
  ses.setDevicePermissionHandler(() => true);            // Web Serial (cash drawer COM port)
  ses.on('select-serial-port', async (e, ports, wc, cb) => {
    e.preventDefault();
    if (!ports.length) return cb('');
    if (ports.length === 1) return cb(ports[0].portId);
    const r = await dialog.showMessageBox(win, { type: 'question', message: 'Select COM port', buttons: ports.map(p => (p.displayName || p.portName) + ' (' + p.portName + ')').slice(0, 8).concat('Cancel'), cancelId: 99 });
    cb(ports[r.response] ? ports[r.response].portId : '');
  });
  createWindow();
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => app.quit());

/* ---------------- helpers ---------------- */
const tmpFile = (ext) => path.join(os.tmpdir(), 'rush-' + Date.now() + '-' + Math.random().toString(36).slice(2) + ext);

function sendTCP(host, port, buf, timeout = 6000) {
  return new Promise((res, rej) => {
    if (!host) return rej(new Error('Printer IP is empty'));
    const s = new nodeNet.Socket(); let done = false;
    const fin = (e) => { if (done) return; done = true; s.destroy(); e ? rej(e) : res(true); };
    s.setTimeout(timeout, () => fin(new Error('Printer not reachable: ' + host + ':' + port)));
    s.once('error', fin);
    s.connect(+port || 9100, host, () => s.write(Buffer.from(buf), () => setTimeout(() => fin(), 500)));
  });
}
function sendShare(share, buf) {   // USB thermal printer shared in Windows: \\localhost\<share>
  return new Promise((res, rej) => {
    if (!share) return rej(new Error('Windows share name is empty'));
    const f = tmpFile('.bin'); fs.writeFileSync(f, Buffer.from(buf));
    execFile('cmd.exe', ['/c', 'copy', '/b', f, '\\\\localhost\\' + share], { windowsHide: true }, (err, out, se) => {
      try { fs.unlinkSync(f); } catch (e) {}
      err ? rej(new Error('Share print failed: ' + (se || err.message))) : res(true);
    });
  });
}
const sendRaw = (o, buf) => o.mode === 'share' ? sendShare(o.share, buf) : sendTCP(o.host, o.port, buf);

async function renderReceipt(html, mm, dots) {
  const pxW = Math.round(mm * 96 / 25.4), z = dots ? dots / pxW : 1;
  const w = new BrowserWindow({ show: false, width: dots || pxW, height: 600, useContentSize: true, webPreferences: { backgroundThrottling: false, sandbox: true, contextIsolation: true } });
  const f = tmpFile('.html'); fs.writeFileSync(f, html, 'utf8');
  await w.loadFile(f);
  try { fs.unlinkSync(f); } catch (e) {}
  if (dots) w.webContents.setZoomFactor(z);
  const h = await w.webContents.executeJavaScript(
    "Promise.all([document.fonts?document.fonts.ready:1].concat([...document.images].map(i=>i.complete?1:new Promise(r=>{i.onload=i.onerror=r})))).then(()=>Math.ceil(document.documentElement.scrollHeight))");
  return { w, h, z };
}

/* ---------------- Windows driver printing (silent) ---------------- */
ipcMain.handle('printers', async (e) => (await e.sender.getPrintersAsync()).map(p => ({ name: p.name, isDefault: !!p.isDefault })));

ipcMain.handle('print-html', async (e, html, o = {}) => {
  const mm = o.mm || 80, { w, h } = await renderReceipt(html, mm, 0);
  return new Promise((res, rej) => {
    w.webContents.print({
      silent: true, printBackground: true, deviceName: o.printer || '', copies: o.copies || 1,
      margins: { marginType: 'none' },
      pageSize: { width: Math.round(mm * 1000), height: Math.round(Math.max(h, 120) * 264.583) + 2000 }
    }, (ok, why) => { w.destroy(); ok ? res(true) : rej(new Error(why || 'print failed')); });
  });
});

/* ---------------- ESC/POS raster (LAN :9100 or Windows share) ---------------- */
const KICK = [0x1B, 0x70, 0x00, 0x19, 0xFA];
async function toEscpos(html, o) {
  const mm = o.mm || 80, dots = mm >= 80 ? 576 : 384;
  const { w, h, z } = await renderReceipt(html, mm, dots);
  w.setContentSize(dots, Math.max(60, Math.ceil(h * z)));
  await new Promise(r => setTimeout(r, 250));
  let img = await w.webContents.capturePage();
  w.destroy();
  img = img.resize({ width: dots, quality: 'best' });
  const { width, height } = img.getSize(), bmp = img.toBitmap(), bpr = Math.ceil(width / 8);
  const out = [0x1B, 0x40];
  if (o.kick) out.push(...KICK);
  for (let y0 = 0; y0 < height; y0 += 200) {
    const rows = Math.min(200, height - y0);
    out.push(0x1D, 0x76, 0x30, 0x00, bpr & 255, bpr >> 8, rows & 255, rows >> 8);
    for (let y = y0; y < y0 + rows; y++) for (let bx = 0; bx < bpr; bx++) {
      let b = 0;
      for (let k = 0; k < 8; k++) {
        const x = bx * 8 + k; let bit = 0;
        if (x < width) { const i = (y * width + x) * 4, lum = 0.114 * bmp[i] + 0.587 * bmp[i + 1] + 0.299 * bmp[i + 2]; bit = (bmp[i + 3] > 40 && lum < 160) ? 1 : 0; }
        b |= bit << (7 - k);
      }
      out.push(b);
    }
  }
  out.push(0x1B, 0x64, o.feed == null ? 3 : o.feed);
  if (o.cut !== false) out.push(0x1D, 0x56, 0x42, 0x00);
  return out;
}
ipcMain.handle('print-escpos', async (e, html, o = {}) => sendRaw(o, await toEscpos(html, o)));
ipcMain.handle('kick', async (e, o = {}) => sendRaw(o, [0x1B, 0x40, ...KICK]));

/* ---------------- network tools ---------------- */
const probe = (host, port, t = 350) => new Promise((res) => {
  const s = new nodeNet.Socket(), t0 = Date.now(); let d = false;
  const f = (ok) => { if (d) return; d = true; s.destroy(); res(ok ? Date.now() - t0 : -1); };
  s.setTimeout(t, () => f(false)); s.once('error', () => f(false)); s.connect(port, host, () => f(true));
});
ipcMain.handle('test-tcp', async (e, host, port) => { const ms = await probe(host, +port || 9100, 3000); return { ok: ms >= 0, ms }; });
ipcMain.handle('scan-lan', async () => {
  const found = [], bases = new Set();
  for (const list of Object.values(os.networkInterfaces())) for (const n of list || []) if (n.family === 'IPv4' && !n.internal) bases.add(n.address.split('.').slice(0, 3).join('.'));
  for (const b of bases) {
    const jobs = []; for (let i = 1; i < 255; i++) jobs.push(probe(b + '.' + i, 9100, 400).then(ms => { if (ms >= 0) found.push(b + '.' + i); }));
    await Promise.all(jobs);
  }
  return found;
});
ipcMain.handle('info', () => ({ version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, platform: process.platform, host: os.hostname(), autostart: app.getLoginItemSettings().openAtLogin }));
ipcMain.handle('autostart', (e, on) => { app.setLoginItemSettings({ openAtLogin: !!on }); return !!on; });
