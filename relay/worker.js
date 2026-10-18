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

// ------------------------------------------------------------------ 网易云

/**
 * 网易云直接打官方接口（不经过任何第三方），Cookie 放在 Worker 的 secret 里：
 *   NETEASE_COOKIE = "MUSIC_U=xxx; __csrf=xxx;"
 * 有 Cookie 时 VIP / 付费曲能拿到真实地址；没有就只能放免费曲。
 */
const NET_Z = { UA, Referer: 'https://music.163.com/' };

function netHeaders(env) {
  const cookie = (env && env.NETEASE_COOKIE) || '';
  return { ...NET_Z, ...(cookie ? { Cookie: cookie } : {}) };
}

async function neteaseSearch({ keyword, limit, page }, env) {
  const offset = (page - 1) * limit;
  const url =
    'https://music.163.com/api/cloudsearch/pc?s=' +
    encodeURIComponent(keyword) +
    '&type=1&limit=' +
    limit +
    '&offset=' +
    offset;
  const data = await fetchJson(url, netHeaders(env));
  const list = data?.result?.songs ?? [];
  return list.map((s) => {
    const fee = Number(s.fee);
    const vip = fee === 1 || fee === 4;
    return {
      platform: 'netease',
      id: String(s.id),
      title: s.name ?? '',
      artists: (s.ar ?? []).map((a) => a.name).filter(Boolean),
      album: s.al?.name ?? '',
      durationMs: Number(s.dt) || null,
      cover: https(s.al?.picUrl),
      vip,
      playable: true,
      url: 'https://music.163.com/song?id=' + s.id,
    };
  });
}

async function neteasePlayUrl(id, env) {
  const url = 'https://music.163.com/api/song/enhance/player/url?ids=%5B' + encodeURIComponent(id) + '%5D&br=320000';
  const data = await fetchJson(url, netHeaders(env));
  const d = data?.data?.[0];
  if (!d || !d.url) {
    return {
      playable: false,
      reason: 'no-url',
      note: (env && env.NETEASE_COOKIE ? '有 Cookie 仍拿不到：可能是数字专辑/地区限制' : '这首要会员：在 Worker 里配 NETEASE_COOKIE 后重试'),
    };
  }
  return {
    playable: true,
    streamUrl: https(d.url),
    ext: d.type || 'mp3',
    bitrate: d.br || null,
    size: d.size || null,
  };
}

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

async function kugouPlayUrl(id, env) {
  const cookie = ['kg_mid=1', (env && env.KUGOU_COOKIE) || ''].filter(Boolean).join('; ');
  const data = await fetchJson(
    'https://m.kugou.com/app/i/getSongInfo.php?cmd=playInfo&hash=' + encodeURIComponent(id),
    { referer: 'https://www.kugou.com/', cookie },
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

/** 播放地址缓存：地址本身带时效（约 20 分钟），缓存 5 分钟既省上游调用又不至于过期 */
const PLAY_CACHE_MS = 5 * 60 * 1000;
const playCache = new Map();

const PLATFORMS = {
  netease: { search: neteaseSearch, playurl: neteasePlayUrl },
  kugou: { search: kugouSearch, playurl: kugouPlayUrl },
  bilibili: { search: bilibiliSearch, playurl: bilibiliPlayUrl },
};

export const worker = {
  async fetch(request, env) {
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
        return json({ ok: true, data: await impl.search({ keyword, limit, page }, env) });
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

        // 播放地址带时效（约 20 分钟），缓存 5 分钟够用，还能少打几次上游
        const cacheKey = platform + ':' + id;
        const hit = playCache.get(cacheKey);
        if (hit && Date.now() - hit.at < PLAY_CACHE_MS) {
          return json({ ok: true, data: hit.value, cached: true });
        }

        const data = await impl.playurl(id, env);

        // 酷狗从 Cloudflare 出口很容易被限流，给一条能照着做的提示
        if (data && data.playable === false && /频繁|too\s*frequent/i.test(String(data.note || ''))) {
          data.note = '酷狗这边限流了（Cloudflare 出口 IP 被判定为高频）。等 1–2 分钟再试；要稳定就把中转部署到国内云函数。';
          data.rateLimited = true;
        }

        if (data && data.playable) playCache.set(cacheKey, { at: Date.now(), value: data });

        // B 站音频在部分 CDN 节点上要 Referer，走本中转最稳；酷狗直链匿名可取，不绕这一圈。
        // 但腾讯云「函数 URL」不支持二进制响应，那种运行时下只能直接给 CDN 地址（部分节点会 403）。
        if (platform === 'bilibili' && data && data.playable && data.streamUrl) {
          if (request.headers.get('x-mr-binary') === '0') {
            data.note = '当前运行时（腾讯云函数 URL）不支持二进制代理，已直接给 CDN 地址；若播放失败请改用酷狗/网易云';
          } else {
            data.rawStreamUrl = data.streamUrl;
            data.streamUrl = url.origin + '/stream?platform=bilibili&url=' + encodeURIComponent(data.streamUrl);
          }
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
