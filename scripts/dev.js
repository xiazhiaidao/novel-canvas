// 开发环境：node --watch server.js（服务端热重载）+ Electron（前端文件变更自动刷新）
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');

const root = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8787);
const URL = `http://127.0.0.1:${PORT}/`;

function isPortOpen() {
  return new Promise((resolve) => {
    const socket = net.connect(PORT, '127.0.0.1');
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('error', () => { socket.destroy(); resolve(false); });
  });
}

async function waitForServer(timeout = 20000) {
  const start = Date.now();
  while (!(await isPortOpen())) {
    if (Date.now() - start > timeout) throw new Error('等待本地服务启动超时');
    await new Promise(r => setTimeout(r, 250));
  }
}

async function main() {
  let serverProc = null;
  let electronProc = null;
  let reuseServer = false;

  if (await isPortOpen()) {
    console.log(`ℹ️  ${PORT} 端口已有服务，直接复用，不启动热重载 server。`);
    reuseServer = true;
  } else {
    console.log('🚀 启动热重载服务端：node --watch server.js');
    serverProc = spawn(process.execPath, ['--watch', 'server.js'], {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, PORT: String(PORT) }
    });
    try {
      await waitForServer();
    } catch (e) {
      console.error('❌ ' + e.message);
      if (serverProc) serverProc.kill();
      process.exit(1);
    }
  }

  console.log('🖥️  启动 Electron 开发窗口...');
  const electronPath = require('electron');
  const env = { ...process.env, PORT: String(PORT) };
  delete env.ELECTRON_RUN_AS_NODE;
  electronProc = spawn(electronPath, ['.'], {
    cwd: root,
    stdio: 'inherit',
    env
  });

  function cleanup(signal) {
    console.log(`\n👋 退出开发环境 (${signal})`);
    if (electronProc && !electronProc.killed) {
      try { electronProc.kill(); } catch (_) {}
    }
    if (serverProc && !serverProc.killed) {
      try { serverProc.kill(); } catch (_) {}
    }
    process.exit(0);
  }

  electronProc.on('exit', (code) => {
    console.log('Electron 已退出，code=' + code);
    cleanup('electron-exit');
  });
  serverProc && serverProc.on('exit', (code) => {
    console.log('server 已退出，code=' + code);
    if (!reuseServer) cleanup('server-exit');
  });

  process.on('SIGINT', () => cleanup('SIGINT'));
  process.on('SIGTERM', () => cleanup('SIGTERM'));
}

main().catch(e => { console.error(e); process.exit(1); });
