/*! music-relay serverless (阿里云 FC / 腾讯云 SCF) —— 构建产物，别直接改；源码 relay/worker.js + relay/serverless-adapter.js */

/**
 * 点歌台中转（可选）—— 让 IIROSE 版也能搜酷狗 / B 站。
 *
 * 为什么必须有它：
 *   · 酷狗：搜索能 JSONP，但「hash → 播放地址」那个接口不带 CORS，浏览器读不到
 *   · B 站：搜索/播放地址接口有反爬（裸请求 412/403），必须由服务端带 UA/Referer/Cookie
 * 它只中转**元数据**（搜索 + 播放地址，都是几 KB 的 JSON），音频直链仍然是 CDN 直连，
 * 所以流量和成本都可以忽略。
 *
 * 部署（Cloudflare Workers，免费额度足够）：
 *   1. 新建 Worker，把本文件内容粘进去（或 wrangler deploy）
 *   2. 记下地址，例如 https://music-relay.你的子域.workers.dev
 *   3. 在 IIROSE 控制台执行：localStorage.setItem('mk_iirose_relay', 'https://music-relay.你的子域.workers.dev')
 *   4. 刷新页面 —— 点歌台会多出「酷狗音乐」「B 站」两个 tab
 *
 * 想在 VPS / 家里电脑上跑：见同目录 dev-server.mjs（同一份逻辑，Node 起个 http 服务）。
 *
 * 接口：
 *   GET /search?platform=kugou|bilibili&kw=..&limit=..&page=..   → Song[]
 *   GET /playurl?platform=kugou|bilibili&id=..                   → { playable, streamUrl, ext, bitrate }
 *   GET /health                                                  → { ok: true }
 * 所有响应都带 Access-Control-Allow-Origin: *（只读、无凭据）。
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS },
  });
}

async function fetchJson(url, headers = {}) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, ...headers },
    // Workers 里 fetch 默认跟随重定向
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`上游 HTTP ${res.status}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('上游返回的不是 JSON：' + text.slice(0, 80));
  }
}

const https = (u) => (typeof u === 'string' && u.startsWith('http://') ? 'https://' + u.slice(7) : u);
const seconds = (ms) => (Number.isFinite(Number(ms)) ? Math.round(Number(ms)) : null);

// ------------------------------------------------------------------ 酷狗

async function kugouSearch({ keyword, limit, page }) {
  const url =
    'https://songsearch.kugou.com/song_search_v2?keyword=' +
    encodeURIComponent(keyword) +
    '&page=' +
    page +
    '&pagesize=' +
    limit;
  const data = await fetchJson(url, { referer: 'https://www.kugou.com/' });
  const list = data?.data?.lists ?? [];
  return list.map((s) => {
    const vip = Number(s.Privilege ?? 0) > 0 || Number(s.PayType ?? 0) > 0;
    return {
      platform: 'kugou',
      // 酷狗要用 FileHash 才能换播放地址
      id: String(s.FileHash ?? s.ID ?? ''),
      title: s.SongName ?? '',
      artists: [s.SingerName].filter(Boolean),
      album: s.AlbumName ?? '',
      durationMs: seconds((Number(s.Duration) || 0) * 1000),
      cover: null,
      vip,
      playable: true,
      url: s.Audioid
        ? `https://www.kugou.com/mixsong/${s.Audioid}.html`
        : 'https://www.kugou.com/',
    };
  });
}

async function kugouPlayUrl(id) {
  const data = await fetchJson(
    'https://m.kugou.com/app/i/getSongInfo.php?cmd=playInfo&hash=' + encodeURIComponent(id),
    { referer: 'https://www.kugou.com/', cookie: 'kg_mid=1' },
  );
  if (!data?.url) return { playable: false, reason: 'no-url', note: data?.error || '酷狗没有返回可播放地址' };
  return {
    playable: true,
    streamUrl: https(data.url),
    ext: data.extName || 'mp3',
    bitrate: (Number(data.bitRate) || 0) * 1000 || null,
  };
}

// ------------------------------------------------------------------ B 站

/**
 * B 站的风控按 IP 判定，Cloudflare Workers 的出口 IP 很容易吃到 412。
 * 这里给一套尽量像真浏览器的头 + 每次冷启动生成一个 buvid3（固定 0 太假）。
 * 仍然可能被拦 —— 拦了就让用户换酷狗，或用国内云函数部署（出口 IP 在国内更容易过）。
 */
function makeBuvid3() {
  const hex = (n) => Array.from({ length: n }, () => '0123456789ABCDEF'[Math.floor(Math.random() * 16)]).join('');
  return `${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}infoc`;
}

const BUV = makeBuvid3();
const BILI_HEADERS = {
  referer: 'https://www.bilibili.com/',
  origin: 'https://www.bilibili.com',
  accept: 'application/json, text/plain, */*',
  'accept-language': 'zh-CN,zh;q=0.9',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-site',
  cookie: `buvid3=${BUV}; b_nut=${Math.floor(Date.now() / 1000)};`,
};

async function bilibiliSearch({ keyword, limit, page }) {
  const url =
    'https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=' +
    encodeURIComponent(keyword) +
    '&page=' +
    page +
    '&page_size=' +
    limit;
  const data = await fetchJson(url, BILI_HEADERS);
  const list = data?.data?.result ?? [];
  const strip = (html) => String(html ?? '').replace(/<[^>]*>/g, '');
  const toMs = (v) => {
    if (typeof v === 'number') return v * 1000;
    if (typeof v !== 'string' || !v.includes(':')) return null;
    return v.split(':').reduce((acc, part) => acc * 60 + Number(part), 0) * 1000;
  };
  return list.map((v) => ({
    platform: 'bilibili',
    id: v.bvid ?? String(v.aid),
    title: strip(v.title),
    artists: [v.author].filter(Boolean),
    album: '',
    durationMs: toMs(v.duration),
    cover: v.pic ? (String(v.pic).startsWith('//') ? 'https:' + v.pic : String(v.pic)) : null,
    vip: false,
    playable: true,
    url: v.bvid ? `https://www.bilibili.com/video/${v.bvid}` : 'https://search.bilibili.com/',
  }));
}

async function bilibiliPlayUrl(id) {
  const view = await fetchJson(
    'https://api.bilibili.com/x/web-interface/view?bvid=' + encodeURIComponent(id),
    BILI_HEADERS,
  );
  const cid = view?.data?.cid;
  if (!cid) return { playable: false, reason: 'no-cid', note: '取不到该视频的 cid' };
  const pj = await fetchJson(
    `https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(id)}&cid=${cid}&fnval=16&fourk=1`,
    BILI_HEADERS,
  );
  const audios = pj?.data?.dash?.audio ?? [];
  if (!audios.length) return { playable: false, reason: 'no-audio', note: '这个视频没有独立音频轨' };
  const best = audios.slice().sort((a, b) => (b.bandwidth ?? 0) - (a.bandwidth ?? 0))[0];
  const url = best.baseUrl || best.base_url;
  if (!url) return { playable: false, reason: 'no-url', note: 'B 站没有返回音频地址' };
  return {
    playable: true,
    streamUrl: https(url),
    ext: 'm4a',
    bitrate: best.bandwidth ?? null,
    durationSec: Number(view?.data?.duration) || null,
  };
}

// ------------------------------------------------------------------ 音频代理

/**
 * B 站的音频 CDN 会在部分节点上校验 Referer（裸请求 403），所以 B 站走 /stream 中转；
 * 酷狗的直链匿名可取（实测 206），就不占中转流量了。
 *
 * 白名单是硬边界：/stream 不能变成任意外网中转。
 */
const AUDIO_HOSTS = [
  '.bilivideo.com',
  '.bilivideo.cn',
  '.hdslb.com',
  '.mountaintoys.cn',
  '.kugou.com',
  '.music.126.net',
];

function allowedAudioHost(u) {
  let parsed;
  try {
    parsed = new URL(u);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  const host = parsed.hostname.toLowerCase();
  return AUDIO_HOSTS.some((suffix) => host.endsWith(suffix));
}

const UPSTREAM_REFERER = { bilibili: 'https://www.bilibili.com/', kugou: 'https://www.kugou.com/' };

async function proxyAudio(request, target, platform) {
  if (!allowedAudioHost(target)) {
    return new Response('拒绝：不在允许的音频域名白名单内', { status: 403, headers: CORS });
  }
  const range = request.headers.get('range');
  const upstream = await fetch(target, {
    headers: {
      'user-agent': UA,
      referer: UPSTREAM_REFERER[platform] || 'https://www.bilibili.com/',
      ...(range ? { range } : {}),
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
  });

  const headers = new Headers(CORS);
  headers.set('content-type', upstream.headers.get('content-type') || 'audio/mpeg');
  headers.set('accept-ranges', upstream.headers.get('accept-ranges') || 'bytes');
  headers.set('cache-control', 'no-store');
  const len = upstream.headers.get('content-length');
  if (len) headers.set('content-length', len);
  const cr = upstream.headers.get('content-range');
  if (cr) headers.set('content-range', cr);

  return new Response(upstream.body, { status: upstream.status, headers });
}

// ------------------------------------------------------------------ 路由

const PLATFORMS = {
  kugou: { search: kugouSearch, playurl: kugouPlayUrl },
  bilibili: { search: bilibiliSearch, playurl: bilibiliPlayUrl },
};

export const worker = {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const url = new URL(request.url);
    const p = url.searchParams;
    const platform = p.get('platform') || '';
    const impl = PLATFORMS[platform];

    try {
      // 先判路径再判平台：不然后面「不支持的平台」会把未知路径也说成 400
      const KNOWN_PATHS = ['/', '', '/health', '/search', '/playurl', '/stream'];
      if (!KNOWN_PATHS.includes(url.pathname)) {
        return json({ ok: false, error: '未知路径：' + url.pathname }, 404);
      }

      // 根路径给个说明书：直接拿 workers.dev 地址在浏览器里打开时，
      // 以前会看到 {"ok":false,"error":"不支持的平台："}，看着像部署失败
      if (url.pathname === '/' || url.pathname === '') {
        return json({
          ok: true,
          name: 'music-relay',
          note: '点歌台中转已就绪；下面这些才是接口，不是给人直接访问的页面',
          endpoints: [
            '/health',
            '/search?platform=kugou|bilibili&kw=..&limit=..&page=..',
            '/playurl?platform=kugou|bilibili&id=..',
            '/stream?platform=bilibili&url=..',
          ],
        });
      }

      if (url.pathname === '/health') return json({ ok: true, platforms: Object.keys(PLATFORMS) });

      if (!impl) return json({ ok: false, error: '不支持的平台：' + platform }, 400);

      if (url.pathname === '/search') {
        const keyword = (p.get('kw') || '').trim();
        if (!keyword) return json({ ok: true, data: [] });
        const limit = Math.min(30, Math.max(1, Number(p.get('limit') || 20)));
        const page = Math.max(1, Number(p.get('page') || 1));
        return json({ ok: true, data: await impl.search({ keyword, limit, page }) });
      }

      // 音频中转：只放行白名单域名（见 AUDIO_HOSTS），并补上 CDN 要的 Referer
      if (url.pathname === '/stream') {
        const target = p.get('url') || '';
        if (!target) return new Response('缺少 url', { status: 400, headers: CORS });
        return await proxyAudio(request, target, platform);
      }

      if (url.pathname === '/playurl') {
        const id = (p.get('id') || '').trim();
        if (!id) return json({ ok: false, error: '缺少 id' }, 400);
        const data = await impl.playurl(id);
        // B 站音频在部分 CDN 节点上要 Referer，走本中转最稳；酷狗直链匿名可取，不绕这一圈
        if (platform === 'bilibili' && data && data.playable && data.streamUrl) {
          data.rawStreamUrl = data.streamUrl;
          data.streamUrl = url.origin + '/stream?platform=bilibili&url=' + encodeURIComponent(data.streamUrl);
        }
        return json({ ok: true, data });
      }

      return json({ ok: false, error: '未知路径：' + url.pathname }, 404);
    } catch (err) {
      const msg = String((err && err.message) || err);
      // B 站按 IP 风控：Cloudflare Workers 的出口 IP 经常直接被判 412。
      // 这里给一条能照着做的提示，别只丢一个「上游 HTTP 412」。
      if (platform === 'bilibili' && /\b412\b/.test(msg)) {
        return json(
          {
            ok: false,
            code: 'bilibili-blocked',
            error: 'B 站把这个出口 IP 判定为异常（412）。先用酷狗，或把中转部署到国内云函数（阿里云 FC / 腾讯云 SCF）再试。',
          },
          502,
        );
      }
      return json({ ok: false, error: msg }, 502);
    }
  },
};

export default worker;


/**
 * 服务器函数适配层（这个文件本身不单独部署，构建时拼在 worker.js 后面生成 relay/serverless.js）。
 *
 * 目标：同一份中转逻辑，既能跑在 Cloudflare Workers（Web Request/Response），
 * 也能跑在阿里云函数计算 FC / 腾讯云 SCF 的 HTTP 触发器上（event/response 那一套）。
 *
 * 两家的入参形状：
 *   阿里云 FC 3.0（内置运行时 + HTTP 触发器）
 *     { version:'v1', rawPath, headers, queryParameters, body, isBase64Encoded,
 *       requestContext: { domainName, http: { method, path } } }
 *     返回 { statusCode, headers, body, isBase64Encoded }
 *   腾讯云 SCF（API 网关触发器，需开启「集成响应」）
 *     { path, httpMethod, headers, queryString（JSON 字符串）, queryStringParameters, requestContext }
 *     返回 { statusCode, headers, body, isBase64Encoded }
 *
 * 注意：两家对「响应体」都是先整块拿到再返回，所以 B 站那种几 MB 的音频要靠 Range 分段；
 * 单次响应过大（SCF 约 6MB / FC 16MB）会失败——这是平台限制，不是代码问题。
 */

/** FC/SCF 不允许自己设的响应头，设了会被丢掉甚至报错，这里主动过滤 */
const RESERVED_HEADERS = new Set([
  'connection',
  'content-length',
  'date',
  'keep-alive',
  'server',
  'content-disposition',
  'transfer-encoding',
]);

function pickMethod(event) {
  return (
    event?.requestContext?.http?.method ||
    event?.httpMethod ||
    event?.requestContext?.httpMethod ||
    event?.requestContext?.http?.method ||
    'GET'
  ).toUpperCase();
}

function pickPath(event) {
  // requestContext.http.path 是 URL 解码后的；rawPath 是编码过的
  return event?.requestContext?.http?.path || event?.path || event?.rawPath || '/';
}

function pickHost(event) {
  const host =
    event?.headers?.host ||
    event?.headers?.Host ||
    event?.requestContext?.domainName ||
    '';
  return String(host).split(',')[0].trim() || 'relay.local';
}

function pickQuery(event) {
  const out = new URLSearchParams();
  const add = (k, v) => {
    if (v == null) return;
    // 两家都会把同名参数用逗号拼起来，这里原样拆回多个值
    for (const part of String(v).split(',')) out.append(k, part);
  };

  if (event?.queryParameters && typeof event.queryParameters === 'object') {
    for (const [k, v] of Object.entries(event.queryParameters)) add(k, v);
  } else if (event?.queryStringParameters && typeof event.queryStringParameters === 'object') {
    for (const [k, v] of Object.entries(event.queryStringParameters)) add(k, v);
  } else if (typeof event?.queryString === 'string' && event.queryString.trim().startsWith('{')) {
    try {
      for (const [k, v] of Object.entries(JSON.parse(event.queryString))) add(k, v);
    } catch {
      /* 解析失败就当没参数 */
    }
  } else if (typeof event?.queryString === 'string' && event.queryString) {
    for (const [k, v] of new URLSearchParams(event.queryString)) add(k, v);
  }
  return out;
}

/** event → Web Request */
function toRequest(event) {
  const qs = pickQuery(event).toString();
  const url = `https://${pickHost(event)}${pickPath(event)}${qs ? '?' + qs : ''}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(event?.headers || {})) {
    if (v == null) continue;
    try {
      headers.set(k, String(v));
    } catch {
      /* 非法头名忽略 */
    }
  }
  return new Request(url, { method: pickMethod(event), headers });
}

/** Web Response → event 响应（统一 base64，音频也不怕） */
async function toResult(response) {
  const headers = {};
  response.headers.forEach((v, k) => {
    const lower = k.toLowerCase();
    if (RESERVED_HEADERS.has(lower) || lower.startsWith('x-fc-')) return;
    headers[k] = v;
  });
  const buf = Buffer.from(await response.arrayBuffer());
  return {
    statusCode: response.status,
    headers,
    isBase64Encoded: true,
    body: buf.toString('base64'),
  };
}

/**
 * 阿里云 FC 的入口（请求处理程序填 index.handler）
 * 腾讯云 SCF 的入口（请求处理程序填 index.main_handler）
 */
export async function handler(event) {
  try {
    const response = await worker.fetch(toRequest(event));
    return await toResult(response);
  } catch (err) {
    return {
      statusCode: 502,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      isBase64Encoded: false,
      body: JSON.stringify({ ok: false, error: String((err && err.message) || err) }),
    };
  }
}

export const main_handler = handler;
export const main = handler;

