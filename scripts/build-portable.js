// 构建便携版：将源码同步到 release/小说画布-win32-x64/resources/app
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const appDir = path.join(root, 'release', '小说画布-win32-x64', 'resources', 'app');

const files = [
  'main.js',
  'preload.js',
  'server.js',
  'index.html',
  'app.js',
  'canvas_upgrade.js',
  'file_editor.js',
  'canvas_theme.css',
  'package.json',
  'README.md'
];

if (!fs.existsSync(appDir)) {
  console.error('便携版目录不存在：' + appDir);
  console.error('请先运行一次打包（electron-builder 或手动组装），再执行本脚本。');
  process.exit(1);
}

for (const f of files) {
  const src = path.join(root, f);
  const dest = path.join(appDir, f);
  fs.copyFileSync(src, dest);
  console.log('已同步 ' + f);
}
console.log('✅ 便携版应用文件已更新：' + appDir);
