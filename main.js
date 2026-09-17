const { app, BrowserWindow, Menu, shell, dialog, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const net = require('net');

// 若环境里存在 ELECTRON_RUN_AS_NODE，electron.exe 会退化成普通 Node 运行，此时 require('electron')
// 不返回 Electron API，app 为 undefined，随后会在任意一个 app.xxx 调用处抛出难以理解的
// "Cannot read properties of undefined" 而直接退出。这里提前给出人话提示。
// 正常入口（npm start / npm run dev）已各自清掉该变量，只有直接调 electron.exe 才会踩到。
if (!app || typeof app.whenReady !== 'function') {
  console.error('[novel-canvas] 启动失败：Electron 未以桌面模式运行。');
  if (process.env.ELECTRON_RUN_AS_NODE) {
    console.error('检测到环境变量 ELECTRON_RUN_AS_NODE 已设置，它会让 electron 退化为纯 Node 进程。');
    console.error('请清除该变量后重试，或改用入口命令：npm run dev（无 GPU 环境加 NC_FORCE_SOFTWARE_RENDER=1）');
  }
  process.exit(1);
}

const PORT = Number(process.env.PORT || 8787);
const URL = `http://127.0.0.1:${PORT}/`;

// 无 GPU 环境（容器 / 远程桌面 / 无显卡驱动的虚拟机）下，Chromium 的 GPU 进程会反复崩溃并
// 直接 FATAL("GPU process isn't usable. Goodbye.")，导致应用启动即退出、看不到任何提示。
// 这里提供显式降级开关：设 NC_FORCE_SOFTWARE_RENDER=1 或带 --disable-gpu 启动即改用软件渲染。
// 默认不改变行为——有 GPU 的机器仍走硬件加速，避免白白牺牲渲染性能。
//
// 实测要点（都是踩过的坑，别删）：
//  1) 三段代码必须在 app ready 之前执行才生效；
//  2) 只调 app.disableHardwareAcceleration() 不够——它只关硬件加速，Chromium 仍会去起
//     GPU 进程，在此环境依旧 FATAL；
//  3) 真正让进程活下来的是 'no-sandbox'。而 'disable-gpu' 通过 appendSwitch 追加是**无效**的
//     （命令行 --disable-gpu 才有用），保留它只是为了覆盖 GPU 弱可用的环境；
//     所以走 npm script 时请用 NC_FORCE_SOFTWARE_RENDER=1，而不是指望参数透传。
if (process.env.NC_FORCE_SOFTWARE_RENDER === '1' || process.argv.includes('--disable-gpu')) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-gpu-compositing');
}
let serverProc = null;
let serverStarting = false;
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
  if (serverProc || serverStarting) return;
  serverStarting = true;
  try {
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
  } finally {
    serverStarting = false;
  }
}

// 服务存活自愈：被复用的外部 server 退出或自拉 server 崩溃后，自动重新拉起本地服务
function ensureServer() {
  startServer().catch(() => {});
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
  // 每 3 秒检查一次：端口无监听且无自拉服务时重新拉起，避免「窗口还开着、服务已死」的假死状态
  setInterval(ensureServer, 3000);
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
