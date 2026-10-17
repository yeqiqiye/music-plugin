/**
 * 「能不能直接播、播哪个地址」的唯一判断处。
 *
 * 实测结论（dev/probe-playurl.mjs、dev/probe-playable.mjs，别凭感觉改）：
 *   · 163  music.163.com/api/song/enhance/player/url
 *         fee=8 / fee=0 → 有真实 mp3 地址（128k），支持 Range（206）
 *         fee=1         → code=-110，url=null —— 这是版权锁，没登录就是拿不到
 *         返回的地址是 http://，必须升级成 https://（页面在 localhost/https 下会被混合内容拦）
 *   · 酷狗 m.kugou.com/app/i/getSongInfo.php?cmd=playInfo&hash=<FileHash> → mp3 + Range
 *         （wwwapi.kugou.com 那条返回的是加密/空播放地址，不要用）
 *   · B 站 x/player/playurl（fnval=16）的 dash.audio 是 mp4a.40.2 的 m4a，支持 Range
 *
 * 所有出站都在 host 侧：浏览器直连这些 CDN 会被 referer 校验 + CORS 挡住。
 */
import { fetchJson } from './http.mjs';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** 解析结果在内存里放一会儿：地址带时效签名，但也别每个 range 请求都去问一次上游。 */
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map(); // `${platform}:${id}` -> { at, value }

const upgrade = (u) => (typeof u === 'string' && u.startsWith('http://') ? 'https://' + u.slice(7) : u);

/**
 * 流媒体代理允许访问的主机（防 SSRF：不能让 /music/api/stream 变成任意 URL 中转）。
 * 只放各平台实际的音频 CDN 域名后缀。
 */
const ALLOWED_HOST_SUFFIXES = [
  '.music.126.net', // 163 CDN
  '.kugou.com', // 酷狗 sharefs / trackercdn / 等
  '.bilivideo.com', // B 站音视频 CDN
  '.bilivideo.cn',
  '.hdslb.com', // B 站备用
];

export function isAllowedAudioHost(u) {
  let parsed;
  try {
    parsed = new URL(u);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  const host = parsed.hostname.toLowerCase();
  return ALLOWED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/** 上游请求要带的 referer/cookie —— 不带就会被 CDN 拒（403/404）。 */
export function upstreamHeaders(platform) {
  if (platform === 'netease') return { 'User-Agent': UA, Referer: 'https://music.163.com/' };
  if (platform === 'kugou') return { 'User-Agent': UA, Referer: 'https://www.kugou.com/', Cookie: 'kg_mid=1' };
  if (platform === 'bilibili') return { 'User-Agent': UA, Referer: 'https://www.bilibili.com/', Cookie: 'buvid3=0' };
  return { 'User-Agent': UA };
}

async function resolveNetease(id) {
  const json = await fetchJson(`https://music.163.com/api/song/enhance/player/url?ids=[${id}]&br=320000`, {
    headers: upstreamHeaders('netease'),
  });
  const d = json?.data?.[0];
  if (!d || !d.url) {
    return {
      playable: false,
      reason: d?.code === -110 ? 'vip-locked' : 'no-url',
      note: d?.code === -110 ? '这首歌需要网易云黑胶/VIP，未登录拿不到音频' : '上游没有返回可播放地址',
    };
  }
  return {
    playable: true,
    url: upgrade(d.url),
    ext: 'mp3',
    bitrate: d.br ?? null,
    size: d.size ?? null,
    expiresInSec: d.url.includes('authSecret') || /\/\d{14}\//.test(d.url) ? 1200 : null,
  };
}

async function resolveKugou(id) {
  // id 里放的是 FileHash
  const json = await fetchJson(`https://m.kugou.com/app/i/getSongInfo.php?cmd=playInfo&hash=${encodeURIComponent(id)}`, {
    headers: upstreamHeaders('kugou'),
  });
  if (!json?.url) {
    return { playable: false, reason: 'no-url', note: json?.error || '酷狗没有返回可播放地址' };
  }
  return {
    playable: true,
    url: upgrade(json.url),
    ext: json.extName || 'mp3',
    bitrate: (json.bitRate ?? 0) * 1000 || null,
    size: json.fileSize ?? null,
    expiresInSec: null,
  };
}

async function resolveBilibili(id) {
  // id 是 BV 号；先取 cid，再取 dash 音频，选最高码率那条
  const view = await fetchJson(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(id)}`, {
    headers: upstreamHeaders('bilibili'),
  });
  const cid = view?.data?.cid;
  if (!cid) return { playable: false, reason: 'no-cid', note: '取不到该视频的 cid' };
  const pj = await fetchJson(
    `https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(id)}&cid=${cid}&fnval=16&fourk=1`,
    { headers: upstreamHeaders('bilibili') },
  );
  const audios = pj?.data?.dash?.audio ?? [];
  if (!audios.length) return { playable: false, reason: 'no-audio', note: '这个视频没有独立音频轨（可能是纯音乐视频）' };
  const best = audios.slice().sort((a, b) => (b.bandwidth ?? 0) - (a.bandwidth ?? 0))[0];
  const url = best.baseUrl || best.base_url;
  if (!url) return { playable: false, reason: 'no-url', note: 'B 站没有返回音频地址' };
  return {
    playable: true,
    url: upgrade(url),
    ext: 'm4a',
    bitrate: best.bandwidth ?? null,
    size: null,
    expiresInSec: 100 * 60,
  };
}

const RESOLVERS = { netease: resolveNetease, kugou: resolveKugou, bilibili: resolveBilibili };

export async function resolvePlayUrl(platform, id) {
  const resolver = RESOLVERS[platform];
  if (!resolver) return { playable: false, reason: 'unsupported', note: '该平台暂不支持直接播放：' + platform };
  const key = platform + ':' + id;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  try {
    const value = await resolver(String(id));
    if (value.playable) cache.set(key, { at: Date.now(), value });
    return value;
  } catch (err) {
    return { playable: false, reason: 'upstream-error', note: String((err && err.message) || err) };
  }
}

export function clearPlayUrlCache() {
  cache.clear();
}
