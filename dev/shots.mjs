// 文档截图：用本机 Chrome 的 headless 模式把 docs/demo 页面拍成 docs/img/*.png
//
//   node dev/shots.mjs              重拍全部
//   node dev/shots.mjs panel        只重拍 panel.png
//
// 为什么不用 playwright：仓库里不想多一个几百 MB 的浏览器依赖，而 Chrome 自带
// `--headless=new --screenshot` 够用（2x 缩放 + 虚拟时间预算，等异步跑完再拍）。
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
const OUT_DIR = join(ROOT, 'docs', 'img');
const PORT = Number(process.env.SHOT_PORT || 3099);

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);

const SHOTS = [
  { file: 'panel.png', w: 1060, h: 790, query: '?lyric=0', what: '面板主界面（搜索结果 + 正在播放条）' },
  { file: 'playlists.png', w: 1060, h: 790, query: '?lyric=0&view=playlists', what: '我的歌单（导出 / 导入）' },
  { file: 'lyric.png', w: 1000, h: 620, query: '?view=lyric', what: '歌词悬浮窗' },
];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function serve() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      let p = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
      if (!p || p.endsWith('/')) p = join(p, 'index.html');
      const full = join(ROOT, p);
      if (!full.startsWith(ROOT)) return res.writeHead(403).end('no');
      const body = await readFile(full);
      res.writeHead(200, { 'content-type': TYPES[extname(full).toLowerCase()] || 'application/octet-stream' }).end(body);
    } catch (e) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404');
    }
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

function shoot(chrome, shot) {
  const out = join(OUT_DIR, shot.file);
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=2',
    '--window-size=' + shot.w + ',' + shot.h,
    '--virtual-time-budget=9000',
    '--screenshot=' + out,
    'http://127.0.0.1:' + PORT + '/docs/demo/index.html' + shot.query,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(chrome, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (b) => {
      err += String(b);
    });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 && existsSync(out) ? resolve(out) : reject(new Error('chrome 退出 ' + code + '：' + err.slice(0, 300)))));
  });
}

const only = process.argv[2];
const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chrome) {
  console.error('没找到 Chrome / Edge。装一个，或者用 CHROME_PATH 指过去。');
  process.exit(1);
}
await mkdir(OUT_DIR, { recursive: true });
const server = await serve();
console.log('静态服务 http://127.0.0.1:' + PORT + '（' + ROOT + '）');
let failed = 0;
for (const shot of SHOTS) {
  if (only && !shot.file.startsWith(only)) continue;
  try {
    const out = await shoot(chrome, shot);
    const size = (await stat(out)).size;
    console.log('✓ ' + shot.file + '  ' + (size / 1024).toFixed(0) + ' KB  ' + shot.what);
  } catch (e) {
    failed += 1;
    console.error('✗ ' + shot.file + '  ' + e.message);
  }
}
server.close();
process.exit(failed ? 1 : 0);
