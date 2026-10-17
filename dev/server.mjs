/**
 * 本地开发服务器（不是插件的一部分，只是让我能在 churn UI 时不重启 DSH）。
 *
 *   node dev/server.mjs            默认 http://127.0.0.1:3098
 *
 * 它做的事和插件的 host 路由**完全一样**：/api/search?platform=&kw=&limit=
 * 唯一的区别是它顺手把 dev/ui.html 和 client/client.js 静态发出去，方便浏览器直接开。
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLATFORMS, PLATFORM_LIST } from '../lib/adapters.mjs';
import { envelope } from '../lib/http.mjs';
import { isAllowedAudioHost, resolvePlayUrl, upstreamHeaders } from '../lib/playurl.mjs';
import { proxyAudio } from '../lib/proxy.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const PORT = Number(process.env.PORT || 3098);

const json = (res, status, body) => {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
};

async function handleSearch(url, res) {
  const platform = url.searchParams.get('platform') || 'netease';
  const keyword = (url.searchParams.get('kw') || '').trim();
  const limit = Math.min(30, Math.max(1, Number(url.searchParams.get('limit') || 20)));
  const adapter = PLATFORMS[platform];
  if (!adapter) return json(res, 400, { ok: false, error: 'unknown platform: ' + platform });
  if (!keyword) return json(res, 200, { ok: true, data: [] });
  const out = await envelope(() => adapter.search({ keyword, limit, offset: 0 }));
  json(res, 200, out);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname === '/api/platforms') return json(res, 200, { ok: true, data: PLATFORM_LIST });
  if (url.pathname === '/api/search') return handleSearch(url, res);

  // 与插件的 /music/api/playurl 等价
  if (url.pathname === '/api/playurl') {
    const platform = url.searchParams.get('platform') || '';
    const id = url.searchParams.get('id') || '';
    if (!platform || !id) return json(res, 400, { ok: false, error: '需要 platform 与 id' });
    const info = await resolvePlayUrl(platform, id);
    if (!info.playable) return json(res, 200, { ok: true, data: info });
    return json(res, 200, {
      ok: true,
      data: {
        playable: true,
        streamUrl: '/api/stream?platform=' + encodeURIComponent(platform) + '&url=' + encodeURIComponent(info.url),
        ext: info.ext,
        bitrate: info.bitrate,
        size: info.size,
      },
    });
  }

  // 与插件的 /music/api/stream 等价（白名单 + Range 透传）
  if (url.pathname === '/api/stream') {
    const platform = url.searchParams.get('platform') || '';
    const target = url.searchParams.get('url') || '';
    if (!target) {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('缺少 url');
    }
    if (!isAllowedAudioHost(target)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('拒绝：不在音频域名白名单内');
    }
    return proxyAudio(req, res, { url: target, headers: upstreamHeaders(platform) });
  }

  const files = {
    '/': join(here, 'ui.html'),
    '/ui.html': join(here, 'ui.html'),
    '/selftest': join(here, 'selftest.html'),
    '/selftest.html': join(here, 'selftest.html'),
  };
  // /client/* 直接映射到 client/ 目录，方便 UI 迭代
  let file = files[url.pathname];
  if (!file && url.pathname.startsWith('/client/')) {
    const rel = url.pathname.slice('/client/'.length);
    if (!rel.includes('..') && !rel.includes('\\')) file = join(root, 'client', rel);
  }
  if (!file) {
    res.writeHead(404).end('not found');
    return;
  }
  try {
    const body = await readFile(file);
    const ext = file.slice(file.lastIndexOf('.'));
    res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch (err) {
    res.writeHead(500).end(String(err));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`dev server: http://127.0.0.1:${PORT}/`);
});
