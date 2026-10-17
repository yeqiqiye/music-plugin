/**
 * 中转的本地跑法（VPS / 自己电脑都行）—— 和 Cloudflare Worker 是同一份逻辑。
 *
 *   node relay/dev-server.mjs          # 默认 127.0.0.1:8799
 *   PORT=9000 node relay/dev-server.mjs
 *
 * 注意：
 *   · 只有 IIROSE 页面是 https 时，它才允许请求 http 的地址——所以正式用要么套 https，
 *     要么（推荐）直接用 Cloudflare Workers 的 https 地址。
 *   · 监听 127.0.0.1 只在本机能访问；要让页面访问，得监听 0.0.0.0 并做端口转发/反代，
 *     而且没有任何鉴权，别开在公网裸奔。
 */
import { createServer } from 'node:http';
import worker from './worker.js';

const PORT = Number(process.env.PORT || 8799);
const HOST = process.env.HOST || '127.0.0.1';

const server = createServer(async (req, res) => {
  try {
    const request = new Request(`http://${HOST}:${PORT}${req.url}`, {
      method: req.method,
      headers: req.headers,
    });
    const response = await worker.fetch(request);
    const headers = {};
    response.headers.forEach((v, k) => {
      headers[k] = v;
    });
    res.writeHead(response.status, headers);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('中转出错：' + String((err && err.message) || err));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`点歌台中转已在 http://${HOST}:${PORT} 启动`);
  console.log(`  自检： curl "http://${HOST}:${PORT}/health"`);
  console.log(`  页面里： localStorage.setItem('mk_iirose_relay', 'https://你的地址')`);
});
