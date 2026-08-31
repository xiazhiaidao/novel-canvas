const { app, BrowserWindow, Menu, shell, dialog, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const net = require('net');

const PORT = Number(process.env.PORT || 8787);
const URL = `http://127.0.0.1:${PORT}/`;
let serverProc = null;
let mainWindow = null;
let projectsRoot = null;

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch (_) {
    return {};
  }
}

function saveSettings(settings) {
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), 'utf8');
  } catch (_) {}
}

function chooseProjectsRoot() {
  return dialog.showOpenDialog({
    title: '选择小说项目文件夹',
    message: '请选择包含小说项目的文件夹（例如 D:\\小说）',
    properties: ['openDirectory', 'createDirectory']
  });
}

function defaultDevRoot() {
  // 开发模式：main.js 位于 novel-canvas 目录，上一级即小说项目根
  return path.dirname(path.resolve(__dirname));
}

async function resolveProjectsRoot() {
  // 环境变量优先（也便于测试/自定义配置）
  if (process.env.NOVEL_PROJECTS_ROOT) {
    const p = path.resolve(process.env.NOVEL_PROJECTS_ROOT);
    if (fs.existsSync(p)) return p;
  }
  const settings = loadSettings();
  if (settings.projectsRoot && fs.existsSync(settings.projectsRoot)) {
    return settings.projectsRoot;
  }
  // 开发模式直接使用上一级目录（D:\小说），不弹窗
  if (!app.isPackaged) {
    return defaultDevRoot();
  }
  const result = await chooseProjectsRoot();
  if (result.canceled || !result.filePaths.length) {
    return null;
  }
  const chosen = result.filePaths[0];
  saveSettings({ ...settings, projectsRoot: chosen });
  return chosen;
}

function isPortOpen() {
  return new Promise((resolve) => {
    const socket = net.connect(PORT, '127.0.0.1');
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('error', () => { socket.destroy(); resolve(false); });
  });
}

function waitForServer(timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      isPortOpen().then((open) => {
        if (open) return resolve();
        if (Date.now() - start > timeoutMs) return reject(new Error('等待本地服务启动超时'));
        setTimeout(check, 250);
      });
    };
    check();
  });
}

async function startServer() {
  if (serverProc) return;
  // 如果端口已被外部占用（例如手动启动过 node server.js），直接复用，不重复拉起
  if (await isPortOpen()) return;
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  if (projectsRoot) env.NOVEL_PROJECTS_ROOT = projectsRoot;
  serverProc = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env,
    stdio: 'inherit',
    windowsHide: true
  });
  serverProc.on('exit', () => { serverProc = null; });
}

async function changeProjectsRoot() {
  const result = await dialog.showOpenDialog({
    title: '选择小说项目文件夹',
    message: '请选择包含小说项目的文件夹（例如 D:\\小说）',
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || !result.filePaths.length) {
    return { ok: false };
  }
  const newRoot = result.filePaths[0];
  saveSettings({ ...loadSettings(), projectsRoot: newRoot });
  projectsRoot = newRoot;

  // 如果端口被外部占用且不是我们拉起的 server，无法在应用内切换
  const portOpen = await isPortOpen();
  if (!serverProc && portOpen) {
    return { ok: false, error: '当前 8787 端口由外部服务占用，请先关闭外部 node server.js 再切换工作目录' };
  }

  // 停掉自己拉起的 server，等待端口释放
  if (serverProc) {
    try { serverProc.kill(); } catch (_) {}
    serverProc = null;
    const start = Date.now();
    while (await isPortOpen()) {
      if (Date.now() - start > 10000) break;
      await new Promise(r => setTimeout(r, 200));
    }
  }

  await startServer();
  try {
    await waitForServer();
  } catch (e) {
    return { ok: false, error: e.message };
  }
  return { ok: true, projectsRoot: newRoot };
}

function setupDevReload() {
  if (app.isPackaged) return;
  // 注意：必须覆盖全部前端 JS。漏掉 app.js/file_editor.js 会导致改了它们窗口不刷新（用户看不到新功能）
  const watchFiles = ['index.html', 'canvas_upgrade.js', 'canvas_theme.css', 'app.js', 'file_editor.js'];
  for (const f of watchFiles) {
    const p = path.join(__dirname, f);
    try {
      fs.watch(p, { persistent: false }, () => {
        if (mainWindow && !mainWindow.webContents.isDestroyed()) {
          mainWindow.webContents.reload();
        }
      });
    } catch (_) {}
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#0f1420',
    title: '小说画布',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  mainWindow.loadURL(URL);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

ipcMain.handle('change-folder', async () => {
  try {
    return await changeProjectsRoot();
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  projectsRoot = await resolveProjectsRoot();
  if (!projectsRoot) {
    app.quit();
    return;
  }
  await startServer();
  try {
    await waitForServer();
  } catch (e) {
    console.error('[novel-canvas] ' + e.message);
  }
  createWindow();
  setupDevReload();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (serverProc) {
    try { serverProc.kill(); } catch (_) {}
    serverProc = null;
  }
  app.quit();
});
