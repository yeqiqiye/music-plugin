// 布局体检：用本机 Chrome 的 headless 打开 docs/demo，量几块关键元素的坐标，
// 检查「搜索框 → 平台 tab」之间有没有凭空多出来的空隙。
//
//   node dev/layout-check.mjs            两套（无背景 / 设了自定义背景）各跑一遍
//
// 为什么要有这个：jsdom 不算布局，普通断言看不出「CSS 级联把装饰层拖回文档流」这类问题
// —— 设了自定义背景时 .mk-card>* 都会被设成 relative，绝对定位的封面层就变成 220px 的死高度，
// 表现为搜索框和平台 tab 之间空一大块（v3.0.0 的真实 bug，v3.0.1 修）。
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
const PORT = Number(process.env.SHOT_PORT || 3097);
const GAP_MAX = 60; // 允许的最大「块间空隙」px

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);

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
      const body = await readFile(join(ROOT, p));
      res.writeHead(200, { 'content-type': TYPES[extname(p).toLowerCase()] || 'application/octet-stream' }).end(body);
    } catch (e) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('404');
    }
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

/** 跑一次 headless，拿到 --dump-dom 的输出 */
function dumpDom(chrome, query) {
  const args = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=1200,820', '--virtual-time-budget=9000', '--dump-dom', 'http://127.0.0.1:' + PORT + '/docs/demo/index.html' + query];
  return new Promise((resolve, reject) => {
    const child = spawn(chrome, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (b) => {
      out += String(b);
    });
    child.stderr.on('data', (b) => {
      err += String(b);
    });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 && out ? resolve(out) : reject(new Error('chrome 退出 ' + code + '：' + err.slice(0, 200)))));
  });
}

const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chrome) {
  console.log('（跳过）没找到 Chrome / Edge；设 CHROME_PATH 指过去就能跑布局体检');
  process.exit(0);
}

const cases = [
  { name: '无自定义背景', query: '?rects=1&lyric=0' },
  { name: '设了自定义背景', query: '?rects=1&lyric=0&bg=1' },
];

const server = await serve();
let failed = 0;
for (const c of cases) {
  let rects = null;
  try {
    const dom = await dumpDom(chrome, c.query);
    const m = /<pre id="rects"[^>]*>([\s\S]*?)<\/pre>/.exec(dom);
    if (!m) throw new Error('页面里没有 rects（预览页没跑完？）');
    rects = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  } catch (e) {
    failed += 1;
    console.error('✗ ' + c.name + '：' + e.message);
    continue;
  }
  const gaps = [
    ['头 → 搜索', rects.head && rects.search ? rects.search.top - rects.head.bottom : null],
    ['搜索 → 平台 tab', rects.search && rects.tabs ? rects.tabs.top - rects.search.bottom : null],
    ['平台 tab → 范围 tab', rects.tabs && rects.scopes ? rects.scopes.top - rects.tabs.bottom : null],
    ['范围 tab → 列表', rects.scopes && rects.body ? rects.body.top - rects.scopes.bottom : null],
  ];
  const bad = gaps.filter(([, g]) => g != null && g > GAP_MAX);
  const bodyH = rects.body ? rects.body.height : 0;
  const okBody = bodyH >= 200;
  if (bad.length || !okBody) failed += 1;
  console.log(
    (bad.length || !okBody ? '✗ ' : '✓ ') +
      c.name +
      '  ' +
      gaps.map(([k, g]) => k + ' ' + (g == null ? '?' : g + 'px')).join(' · ') +
      ' · 列表高 ' +
      bodyH +
      'px',
  );
  if (bad.length) console.log('    空隙超了（>' + GAP_MAX + 'px）：' + bad.map(([k, g]) => k + '=' + g).join(', '));
}
server.close();
console.log(failed ? '布局体检：' + failed + ' 项不合格' : '布局体检：通过');
process.exit(failed ? 1 : 0);
