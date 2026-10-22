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
  'access-control-allow-headers': 'content-type,range',
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

async function neteasePlayUrl(id, env, mode, opts) {
  // 音质档位（借 IIROSE-MEDIA-WEB 的做法）：v1 接口支持 level，
  // 不传就退回老接口的 br=320000，行为跟以前完全一致。
  const LEVELS = ['standard', 'higher', 'exhigh', 'lossless', 'hires', 'jyeffect', 'sky', 'jymaster'];
  const level = opts && LEVELS.indexOf(String(opts.level || '')) >= 0 ? String(opts.level) : '';
  const base = 'https://music.163.com/api/song/enhance/player/url';
  const url = level
    ? base + '/v1?ids=%5B' + encodeURIComponent(id) + '%5D&level=' + level + '&encodeType=flac'
    : base + '?ids=%5B' + encodeURIComponent(id) + '%5D&br=320000';
  let data = await fetchJson(url, netHeaders(env));
  let d = data?.data?.[0];
  // 要了高档却没有地址（没会员/没版权）：退回 320k，别让整首播不出来
  if (level && (!d || !d.url)) {
    const fallback = await fetchJson(base + '?ids=%5B' + encodeURIComponent(id) + '%5D&br=320000', netHeaders(env));
    const d2 = fallback?.data?.[0];
    if (d2 && d2.url) {
      return {
        playable: true,
        streamUrl: https(d2.url),
        ext: d2.type || 'mp3',
        bitrate: d2.br || null,
        size: d2.size || null,
        level: 'exhigh',
        note: '要的 ' + level + ' 没给（没会员/没版权），已退回 320k',
      };
    }
  }
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
    level: d.level || level || '',
  };
}

/** 网易云：cloudsearch / song/detail 两种返回统一成面板要的 Song 形状 */
function neteaseSongOf(s) {
  const fee = Number(s.fee);
  const ar = s.ar || s.artists || [];
  const al = s.al || s.album || {};
  return {
    platform: 'netease',
    id: String(s.id),
    title: s.name ?? '',
    artists: ar.map((a) => a.name).filter(Boolean),
    album: al.name ?? '',
    durationMs: Number(s.dt || s.duration) || null,
    cover: https(al.picUrl || al.picUrl_str),
    vip: fee === 1 || fee === 4,
    playable: true,
    url: 'https://music.163.com/song?id=' + s.id,
  };
}

/** 网易云：搜用户（type=1002） */
async function neteaseUsers({ keyword, limit, page }, env) {
  const offset = (page - 1) * limit;
  const url =
    'https://music.163.com/api/cloudsearch/pc?s=' +
    encodeURIComponent(keyword) +
    '&type=1002&limit=' +
    limit +
    '&offset=' +
    offset;
  const data = await fetchJson(url, netHeaders(env));
  return (data?.result?.userprofiles ?? []).map((u) => ({
    platform: 'netease',
    id: String(u.userId),
    name: u.nickname ?? '',
    avatar: https(u.avatarUrl),
    followers: u.followeds ?? null,
    signature: u.signature ?? '',
    url: 'https://music.163.com/#/user/home?id=' + u.userId,
  }));
}

/** 网易云：搜歌单（type=1000） */
async function neteasePlaylistSearch({ keyword, limit, page }, env) {
  const offset = (page - 1) * limit;
  const url =
    'https://music.163.com/api/cloudsearch/pc?s=' +
    encodeURIComponent(keyword) +
    '&type=1000&limit=' +
    limit +
    '&offset=' +
    offset;
  const data = await fetchJson(url, netHeaders(env));
  return (data?.result?.playlists ?? []).map((p) => ({
    platform: 'netease',
    id: String(p.id),
    name: p.name ?? '',
    cover: https(p.coverImgUrl),
    trackCount: p.trackCount ?? null,
    creator: p.creator?.nickname ?? '',
    playCount: p.playCount ?? null,
    url: 'https://music.163.com/#/playlist?id=' + p.id,
  }));
}

/**
 * 网易云：歌单里的歌。
 * 注意 /api/v6/playlist/detail 里 tracks 默认只给前 10 首，完整列表在 trackIds，
 * 所以这里按 id 分批再查一次 song/detail（最多 400 首，避免一次拉太多）。
 */
async function neteasePlaylist(id, env) {
  const data = await fetchJson('https://music.163.com/api/v6/playlist/detail?id=' + encodeURIComponent(id), netHeaders(env));
  const pl = data?.playlist || {};
  const ids = (pl.trackIds || []).map((x) => x.id).slice(0, 400);
  const songs = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const sd = await fetchJson(
      'https://music.163.com/api/song/detail?ids=' + encodeURIComponent(JSON.stringify(chunk)),
      netHeaders(env),
    );
    for (const s of sd?.songs || []) songs.push(neteaseSongOf(s));
  }
  return {
    playlist: {
      platform: 'netease',
      id: String(pl.id ?? id),
      name: pl.name ?? '',
      cover: https(pl.coverImgUrl),
      trackCount: pl.trackCount ?? ids.length,
      creator: pl.creator?.nickname ?? '',
      playCount: pl.playCount ?? null,
    },
    songs,
  };
}

/** 网易云：某个用户创建的歌单 */
async function neteaseUserPlaylists(id, env) {
  const data = await fetchJson(
    'https://music.163.com/api/user/playlist?uid=' + encodeURIComponent(id) + '&limit=100&offset=0',
    netHeaders(env),
  );
  return (data?.playlist ?? []).map((p) => ({
    platform: 'netease',
    id: String(p.id),
    name: p.name ?? '',
    cover: https(p.coverImgUrl),
    trackCount: p.trackCount ?? null,
    creator: p.creator?.nickname ?? '',
    playCount: p.playCount ?? null,
    url: 'https://music.163.com/#/playlist?id=' + p.id,
  }));
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
    // 注意：song_search_v2 现在把 Privilege / PayType 一律返回 0，判断不出是否付费，
    // 硬标「可听」会误导（其实点下去可能提示「需要付费」），所以这里给 null = 未知。
    const vip = null;
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
  if (!data?.url) {
    const raw = String(data?.error || '');
    if (/付费|购买|vip/i.test(raw)) {
      return {
        playable: false,
        reason: 'paid',
        note: '酷狗把这首标为付费曲，接口直接拒绝（会员 Cookie 也无效）。换一个免费版本，或切到网易云源。',
      };
    }
    return { playable: false, reason: 'no-url', note: raw || '酷狗没有返回可播放地址' };
  }
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

/**
 * 数据中心出口很容易被 B 站判成爬虫（playurl 直接 412）。
 * 配了 BILI_COOKIE（浏览器里整条 Cookie，含 SESSDATA）就用真的，否则用合成的 buvid3 碰运气。
 */
function biliHeaders(env) {
  const cookie = env && env.BILI_COOKIE;
  return cookie ? Object.assign({}, BILI_HEADERS, { cookie: String(cookie) }) : BILI_HEADERS;
}

async function bilibiliSearch({ keyword, limit, page, order, duration, days, author }) {
  const qs = new URLSearchParams({
    search_type: 'video',
    keyword: keyword,
    page: String(page),
    page_size: String(limit),
  });
  // 和 B 站网页一致的筛选项：排序 / 时长 / 发布日期
  if (order && order !== 'totalrank') qs.set('order', order);
  if (duration && duration !== '0') qs.set('duration', String(duration));
  if (days && Number(days) > 0) {
    qs.set('pubtime_begin_s', String(Math.floor(Date.now() / 1000 - Number(days) * 86400)));
    qs.set('pubtime_end_s', String(Math.floor(Date.now() / 1000)));
  }
  const data = await fetchJson('https://api.bilibili.com/x/web-interface/search/type?' + qs.toString(), BILI_HEADERS);
  let list = data?.data?.result ?? [];
  // 「只看这个 UP 主」：B 站搜索没有作者过滤参数，拿回来按作者名筛一遍
  const onlyAuthor = String(author || '').trim();
  if (onlyAuthor) list = list.filter((v) => String(v.author || '').includes(onlyAuthor));
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

async function bilibiliPlayUrl(id, mode, env, opts) {
  const headers = biliHeaders(env);
  try {
    return await bilibiliPlayUrlInner(id, mode, headers, opts, env);
  } catch (err) {
    // 数据中心 IP 命中 B 站风控时，fetch 会直接抛（412 / 403 / 超时）。
    // 把原因说清楚，别让面板只显示「中转返回异常」。
    return {
      playable: false,
      mode,
      reason: 'upstream',
      note:
        'B 站接口请求失败（' +
        String((err && err.message) || err).slice(0, 120) +
        '）。机房 IP 常被 412 风控，给中转配 BILI_COOKIE 再试',
    };
  }
}

async function bilibiliPlayUrlInner(id, mode, headers, opts, env) {
  const view = await fetchJson(
    'https://api.bilibili.com/x/web-interface/view?bvid=' + encodeURIComponent(id),
    headers,
  );
  const cid = view?.data?.cid;
  if (!cid) return { playable: false, reason: 'no-cid', note: '取不到该视频的 cid' };
  const dur = Number(view?.data?.duration) || null;

  // 1080P：B 站只在 DASH 里给，得先用 FFmpeg 合成 mp4（仅云函数 + FFmpeg 层支持）
  if (mode === 'video' && opts && opts.quality === '1080' && canMux()) {
    return {
      playable: true,
      mode: 'video',
      streamUrl: '/stream/hd-' + encodeURIComponent(id) + '.mp4?platform=bilibili&id=' + encodeURIComponent(id) + '&q=1080&mode=video',
      source: 'mux',
      ext: 'mp4',
      qn: 80,
      size: null,
      durationSec: dur,
      note: '1080P 由中转合流，首播会多等几秒',
    };
  }

  // 视频：先用 bilibilix 这类「302 直链」站点——它会把 /video/BVxxx 重定向到 B 站 CDN 的 mp4，
  // 而且这个地址是**客户端自己**去拿的（IIROSE 播得出来），不经过我们中转、不吃出口 IP。
  // 拿不到再退回 B 站官方 durl + /stream 中转。
  if (mode === 'video') {
    // ① 先要一条 html5 直链：这类地址由**客户端自己**去 CDN 取，不经过我们中转，
    //    也不绑我们的出口 IP（bilibilix 用的就是这条路）。播放器看到的域名是 *.bilivideo.com，
    //    和 B 站原生的域名一致，最容易被接受。
    try {
      const hj = await fetchJson(
        `https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(id)}&cid=${cid}` +
          '&fnval=1&qn=80&fourk=1&platform=html5&high_quality=1',
        headers,
      );
      const hd = hj?.data?.durl?.[0];
      if (hd && hd.url) {
        return {
          playable: true,
          mode: 'video',
          streamUrl: https(hd.url),
          source: 'html5',
          ext: 'mp4',
          qn: hj?.data?.quality ?? null,
          size: hd.size ?? null,
          durationSec: dur,
        };
      }
    } catch {
      /* 落到下一条路 */
    }
    const mirror = 'https://www.bilibilix.com/video/' + encodeURIComponent(id);
    try {
      const probe = await fetch(mirror, {
        headers: { 'user-agent': UA, range: 'bytes=0-0' },
        redirect: 'manual',
        signal: AbortSignal.timeout(6000),
      });
      const st = probe.status;
      try {
        await probe.body?.cancel();
      } catch {
        /* 忽略 */
      }
      if (st === 200 || st === 206 || (st >= 300 && st < 400)) {
        return {
          playable: true,
          mode: 'video',
          streamUrl: mirror,
          source: 'bilibilix',
          ext: 'mp4',
          qn: 64,
          size: null,
          durationSec: dur,
        };
      }
    } catch {
      /* 镜像站不通就走下面的官方地址 */
    }
    const vj = await fetchJson(
      `https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(id)}&cid=${cid}` +
        '&fnval=1&qn=80&fourk=1',
      headers,
    );
    const durl = vj?.data?.durl ?? [];
    const first = durl.length ? durl[0] : null;
    if (!first) {
      return {
        playable: false,
        mode: 'video',
        reason: 'no-video',
        note: 'B 站没返回合并视频流（可能是付费/大会员内容，或需要登录）',
      };
    }
    // 主地址 + backup_url 一起带出去：上游如果是 403，调用方可以换镜像重试。
    // 注意这里**不再**提前探测——探测和真正的拉流可能落在不同实例（出口 IP 不同），
    // B 站签名地址认 IP，探得通不代表拉得通。
    const cands = [];
    for (const u of [first.url, ...(first.backup_url || [])]) {
      if (u && !cands.includes(u)) cands.push(u);
    }
    if (!cands.length) {
      return { playable: false, mode: 'video', reason: 'no-url', note: 'B 站没给视频地址' };
    }
    return {
      playable: true,
      mode: 'video',
      streamUrl: https(cands[0]),
      backups: cands.slice(1, 3).map((u) => https(u)),
      ext: 'mp4',
      qn: vj?.data?.quality ?? null,
      size: first.size ?? null,
      durationSec: dur,
      mirrors: cands.length,
    };
  }

  const pj = await fetchJson(
    `https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(id)}&cid=${cid}&fnval=16&fourk=1`,
    headers,
  );
  const audios = pj?.data?.dash?.audio ?? [];
  if (!audios.length) return { playable: false, reason: 'no-audio', note: '这个视频没有独立音频轨' };
  const best = audios.slice().sort((a, b) => (b.bandwidth ?? 0) - (a.bandwidth ?? 0))[0];
  const url = best.baseUrl || best.base_url;
  if (!url) return { playable: false, reason: 'no-url', note: 'B 站没有返回音频地址' };
  return {
    playable: true,
    mode: 'audio',
    streamUrl: https(url),
    ext: 'm4a',
    bitrate: best.bandwidth ?? null,
    durationSec: dur,
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

async function proxyAudio(request, target, platform, env, mode) {
  if (!allowedAudioHost(target)) {
    let host = '';
    try {
      host = new URL(String(target)).hostname;
    } catch {
      host = String(target).slice(0, 60);
    }
    return new Response('拒绝：不在允许的音频域名白名单内（' + host + '）', { status: 403, headers: CORS });
  }
  const range = request.headers.get('range');
  // B 站 CDN 对「登录态」也有校验：不带宽带的 Cookie 时，upos-* 的镜像会直接 403。
  // 所以 /stream 拉 B 站资源时要带上 BILI_COOKIE（配了才有）。
  const cookie = platform === 'bilibili' && env && env.BILI_COOKIE ? String(env.BILI_COOKIE) : '';
  const upstream = await fetch(target, {
    headers: {
      'user-agent': UA,
      referer: UPSTREAM_REFERER[platform] || 'https://www.bilibili.com/',
      ...(cookie ? { cookie } : {}),
      ...(range ? { range } : {}),
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
  });

  const headers = new Headers(CORS);
  // B 站 CDN 常常回 application/octet-stream；播放器靠 content-type/后缀判断能不能播，
  // 这里统一成视频/音频类型（mode 由调用方传进来）。
  let ct = upstream.headers.get('content-type') || '';
  if (!ct || /octet-stream/i.test(ct)) ct = mode === 'video' ? 'video/mp4' : 'audio/mp4';
  headers.set('content-type', ct);
  headers.set('accept-ranges', upstream.headers.get('accept-ranges') || 'bytes');
  headers.set('cache-control', 'no-store');
  const len = upstream.headers.get('content-length');
  if (len) headers.set('content-length', len);
  const cr = upstream.headers.get('content-range');
  if (cr) headers.set('content-range', cr);

  return new Response(upstream.body, { status: upstream.status, headers });
}

// ------------------------------------------------- 1080P：DASH → mp4 合流
// B 站 1080P 只在 DASH（音视频两条 m4s）里，播放器要一个 mp4，所以用 FFmpeg 层 `-c copy` 合流。
// 只在阿里云 FC（有 /opt/bin/ffmpeg）上启用；Cloudflare 上直接回退 720P。

// 只有挂了 FFmpeg 层的云函数才能合流；Cloudflare 上直接回退 720P。
function canMux() {
  if (typeof process === 'undefined' || !process.env) return false;
  if (process.env.MUX_ENABLED === '0') return false;
  return Boolean(process.env.FC_FUNCTION_NAME || process.env.FC_REGION || process.env.MUX_ENABLED === '1');
}

/** 把 URL 下载到本地文件（流式，避免整块进内存） */
async function downloadTo(url, path, headers) {
  const fs = await import('node:fs');
  const { Readable } = await import('node:stream');
  const { pipeline } = await import('node:stream/promises');
  const res = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error('下载失败 HTTP ' + res.status);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(path));
}

/** 取 B 站 DASH 的音/视频地址（1080P 优先，带 Cookie 才可能拿到 1080P+） */
async function bilibiliDash(id, env) {
  const headers = biliHeaders(env);
  const view = await fetchJson('https://api.bilibili.com/x/web-interface/view?bvid=' + encodeURIComponent(id), headers);
  const cid = view?.data?.cid;
  if (!cid) throw new Error('拿不到 cid');
  const pj = await fetchJson(
    `https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(id)}&cid=${cid}` +
      '&fnval=16&qn=80&fourk=1&platform=pc',
    headers,
  );
  const dash = pj?.data?.dash;
  if (!dash || !dash.video || !dash.video.length) throw new Error('B 站没给 DASH 流');
  const vids = dash.video.filter((v) => Number(v.id) <= 80).sort((a, b) => Number(b.id) - Number(a.id));
  const v = vids[0] || dash.video[0];
  const auds = (dash.audio || []).slice().sort((a, b) => Number(b.id) - Number(a.id));
  const a = auds[0];
  if (!v || !a) throw new Error('DASH 流不完整');
  return { video: v, audio: a, duration: pj?.data?.timelength ? pj.data.timelength / 1000 : 0, cid };
}

/** 合流并返回 /tmp 里的 mp4 路径（同实例里复用，第二次起秒开） */
async function muxBilibiliHd(id, env) {
  const fs = await import('node:fs');
  const out = '/tmp/hd-' + id + '.mp4';
  try {
    if (fs.existsSync(out) && fs.statSync(out).size > 100000) return { path: out, cached: true };
  } catch {
    /* 忽略 */
  }
  const headers = biliHeaders(env);
  const d = await bilibiliDash(id, env);
  const vPath = '/tmp/hd-' + id + '.v.m4s';
  const aPath = '/tmp/hd-' + id + '.a.m4s';
  await downloadTo(d.video.baseUrl || d.video.base_url, vPath, headers);
  await downloadTo(d.audio.baseUrl || d.audio.base_url, aPath, headers);

  // 层里的 ffmpeg 是只读的，复制到 /tmp 再加执行位
  const bin = '/tmp/ffmpeg';
  if (!fs.existsSync(bin)) {
    fs.copyFileSync('/opt/bin/ffmpeg', bin);
    fs.chmodSync(bin, 0o755);
  }
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(
    bin,
    ['-y', '-i', vPath, '-i', aPath, '-c', 'copy', '-movflags', '+faststart', out],
    { encoding: 'utf8', timeout: 110000 },
  );
  try {
    fs.unlinkSync(vPath);
    fs.unlinkSync(aPath);
  } catch {
    /* 忽略 */
  }
  if (r.status !== 0) throw new Error('ffmpeg 合流失败：' + String(r.stderr || '').slice(-180));
  return { path: out, cached: false, height: d.video.height || null };
}

/** 从 /tmp 读文件并按 Range 返回（播放器会多次分段请求） */
async function serveFile(request, path, ct) {
  const fs = await import('node:fs');
  const stat = fs.statSync(path);
  const size = stat.size;
  const range = request.headers.get('range') || '';
  const headers = new Headers(CORS);
  headers.set('content-type', ct || 'video/mp4');
  headers.set('accept-ranges', 'bytes');
  headers.set('cache-control', 'no-store');
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  if (m) {
    let start = m[1] ? parseInt(m[1], 10) : 0;
    let end = m[2] ? parseInt(m[2], 10) : size - 1;
    if (end >= size) end = size - 1;
    if (start > end || start >= size) {
      headers.set('content-range', 'bytes */' + size);
      return new Response(null, { status: 416, headers });
    }
    const buf = Buffer.alloc(end - start + 1);
    const fd = fs.openSync(path, 'r');
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    headers.set('content-range', `bytes ${start}-${end}/${size}`);
    headers.set('content-length', String(buf.length));
    return new Response(buf, { status: 206, headers });
  }
  headers.set('content-length', String(size));
  return new Response(fs.readFileSync(path), { status: 200, headers });
}

// ------------------------------------------------------------------ 路由

/** 播放地址缓存：地址本身带时效（约 20 分钟），缓存 5 分钟既省上游调用又不至于过期 */
const PLAY_CACHE_MS = 5 * 60 * 1000;
const playCache = new Map();

// ---------------- QQ 音乐 ----------------
// 搜索打 search_for_qq_cp（要 format=json，jsonp 版本会返回空）；
// 取地址打 musicu.fcg 的 vkey 模块，sip + purl 拼出 m4a 直链（http 的 sip 换 https 也能放）。
// 绿钻曲需要 QQ_COOKIE（qm_keyst 那一串）+ QQ_UIN（QQ 号）两个环境变量。
async function qqSearch({ keyword, limit, page }, env) {
  const url =
    'https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp?format=json&new_json=1&p=' +
    page +
    '&n=' +
    limit +
    '&w=' +
    encodeURIComponent(keyword);
  const data = await fetchJson(url, {
    referer: 'https://y.qq.com/portal/search.html',
    cookie: (env && env.QQ_COOKIE) || '',
  });
  const list = data?.data?.song?.list ?? [];
  return list.map((s) => ({
    platform: 'qq',
    id: String(s.songmid ?? ''),
    title: s.songname ?? '',
    artists: (s.singer || []).map((x) => x.name).filter(Boolean),
    album: s.albumname ?? '',
    durationMs: seconds((Number(s.interval) || 0) * 1000),
    cover: s.albummid ? `https://y.qq.com/music/photo_new/T002R300x300M000${s.albummid}.jpg` : null,
    vip: Number((s.pay && s.pay.payplay) || 0) > 0,
    playable: true,
    url: `https://y.qq.com/n/ryqq/songDetail/${s.songmid}`,
  }));
}

async function qqPlayUrl(id, env) {
  const cookie = (env && env.QQ_COOKIE) || '';
  // QQ 的 Cookie 里 uin 常写成 o1234567890，vkey 要纯数字，这里兜一下
  const uin = String((env && env.QQ_UIN) || '0').replace(/^o/i, '') || '0';
  const payload = {
    req_0: {
      module: 'vkey.GetVkeyServer',
      method: 'CgiGetVkey',
      param: { guid: '10000', songmid: [id], songtype: [0], uin, loginflag: 1, platform: '20' },
    },
    comm: { uin, format: 'json', ct: 24, cv: 0 },
  };
  const data = await fetchJson('https://u.y.qq.com/cgi-bin/musicu.fcg?data=' + encodeURIComponent(JSON.stringify(payload)), {
    referer: 'https://y.qq.com/',
    cookie,
  });
  const info = data?.req_0?.data?.midurlinfo?.[0];
  const sip = (data?.req_0?.data?.sip || [])[0] || 'https://dl.stream.qqmusic.qq.com/';
  if (!info || !info.purl) {
    return {
      playable: false,
      reason: cookie ? 'vip' : 'need-cookie',
      note: cookie
        ? 'QQ 音乐没给地址：这首可能是付费/版权限制，或者 Cookie 过期了'
        : '这首要绿钻：在 Worker 里配 QQ_COOKIE + QQ_UIN 后重试',
    };
  }
  return {
    playable: true,
    streamUrl: String(sip).replace(/^http:\/\//, 'https://') + info.purl,
    ext: 'm4a',
    bitrate: 128000,
  };
}

const PLATFORMS = {
  netease: {
    search: neteaseSearch,
    playurl: neteasePlayUrl,
    // 用户 / 歌单只有网易云有：面板按平台能力决定要不要显示这两个入口
    users: neteaseUsers,
    playlistSearch: neteasePlaylistSearch,
    playlist: neteasePlaylist,
    userPlaylists: neteaseUserPlaylists,
  },
  // 酷狗已下线（用 QQ 音乐平替）：不再注册平台，老客户端请求会收到「不支持的平台」
  bilibili: {
    search: bilibiliSearch,
    // 路由按 (id, env, mode) 调；B 站需要 env 里的 BILI_COOKIE
    playurl: (id, env, mode, opts) => bilibiliPlayUrl(id, mode, env, opts),
  },
  qq: { search: qqSearch, playurl: qqPlayUrl },
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
      const KNOWN_PATHS = ['/', '', '/health', '/search', '/playlist', '/user', '/playurl', '/stream', '/ffmpeg', '/lyric'];
      // /stream/xxx.mp4 这种带后缀的流地址也要放行（IIROSE 靠扩展名挑播放器）
      if (!KNOWN_PATHS.includes(url.pathname) && !url.pathname.startsWith('/stream/')) {
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

      // 诊断：确认 FFmpeg 层能用（层挂在 /opt，只读；复制到 /tmp 再加执行位）
      if (url.pathname === '/ffmpeg') {
        try {
          const fs = await import('node:fs');
          const { spawnSync } = await import('node:child_process');
          const bin = '/tmp/ffmpeg';
          if (!fs.existsSync(bin)) {
            fs.copyFileSync('/opt/bin/ffmpeg', bin);
            fs.chmodSync(bin, 0o755);
          }
          const r2 = spawnSync(bin, ['-version'], { encoding: 'utf8', timeout: 20000 });
          return json({
            ok: r2.status === 0,
            status: r2.status,
            first: String(r2.stdout || '').split('\n')[0],
            err: String(r2.stderr || '').slice(0, 200),
          });
        } catch (e) {
          let listing = '';
          try {
            const fs2 = await import('node:fs');
            listing = JSON.stringify({
              opt: fs2.existsSync('/opt') ? fs2.readdirSync('/opt') : null,
              optBin: fs2.existsSync('/opt/bin') ? fs2.readdirSync('/opt/bin') : null,
            });
          } catch (e2) {
            listing = 'list fail: ' + String((e2 && e2.message) || e2);
          }
          return json({ ok: false, note: String((e && e.message) || e), listing }, 500);
        }
      }

      if (url.pathname === '/health') {
        // features 让客户端判断「这台中转是不是新版」：老版本没有这个字段，
        // 面板就能提示「中转过旧、不支持 B 站视频」，省得对着旧地址反复试。
        return json({
          ok: true,
          platforms: Object.keys(PLATFORMS),
          features: ['bilibili-video', 'html5-direct', 'stream-id'],
        });
      }

      if (!impl) return json({ ok: false, error: '不支持的平台：' + platform }, 400);

      if (url.pathname === '/search') {
        const keyword = (p.get('kw') || '').trim();
        const type = (p.get('type') || 'song').toLowerCase();
        const limit = Math.min(30, Math.max(1, Number(p.get('limit') || 20)));
        const page = Math.max(1, Number(p.get('page') || 1));
        if (!keyword) return json({ ok: true, data: [] });

        if (type === 'user') {
          if (typeof impl.users !== 'function') {
            return json({ ok: false, code: 'unsupported', error: platform + ' 不支持搜用户，换网易云试试' }, 400);
          }
          return json({ ok: true, data: await impl.users({ keyword, limit, page }, env), type: 'user' });
        }
        if (type === 'playlist') {
          if (typeof impl.playlistSearch !== 'function') {
            return json({ ok: false, code: 'unsupported', error: platform + ' 不支持搜歌单，换网易云试试' }, 400);
          }
          return json({ ok: true, data: await impl.playlistSearch({ keyword, limit, page }, env), type: 'playlist' });
        }
        return json({
          ok: true,
          data: await impl.search(
            {
              keyword,
              limit,
              page,
              order: p.get('order') || '',
              duration: p.get('duration') || '',
              days: p.get('days') || '',
              author: p.get('author') || '',
            },
            env,
          ),
          type: 'song',
        });
      }

      // 歌单详情：一次拿到歌单信息 + 歌（面板用它做「批量入队」）
      if (url.pathname === '/playlist') {
        const id = (p.get('id') || '').trim();
        if (!id) return json({ ok: false, error: '缺少 id' }, 400);
        if (typeof impl.playlist !== 'function') {
          return json({ ok: false, code: 'unsupported', error: platform + ' 不支持读歌单' }, 400);
        }
        return json({ ok: true, data: await impl.playlist(id, env) });
      }

      // 某个用户创建的歌单（搜用户点进去之后用）
      if (url.pathname === '/user') {
        const id = (p.get('id') || '').trim();
        if (!id) return json({ ok: false, error: '缺少 id' }, 400);
        if (typeof impl.userPlaylists !== 'function') {
          return json({ ok: false, code: 'unsupported', error: platform + ' 不支持读用户歌单' }, 400);
        }
        return json({ ok: true, data: await impl.userPlaylists(id, env) });
      }

      // 音频/视频中转：只放行白名单域名（见 AUDIO_HOSTS），并补上 CDN 要的 Referer/Cookie
      if (url.pathname === '/stream' || url.pathname.startsWith('/stream/')) {
        // 1080P 合流：/stream/hd-<id>.mp4?q=1080 → 用 FFmpeg 现合现发（同实例缓存到 /tmp）
        if (platform === 'bilibili' && (p.get('q') === '1080' || url.pathname.indexOf('/hd-') >= 0)) {
          const hid = (p.get('id') || '').trim();
          if (!hid) return json({ ok: false, error: '缺少 id' }, 400);
          try {
            const built = await muxBilibiliHd(hid, env);
            return await serveFile(request, built.path, 'video/mp4');
          } catch (e) {
            return json({ ok: false, error: '合流失败：' + String((e && e.message) || e).slice(0, 200) }, 502);
          }
        }
        const target = p.get('url') || '';
        if (target) {
          return await proxyAudio(
            request,
            target,
            platform,
            env,
            (p.get('mode') || '') === 'video' ? 'video' : 'audio',
          );
        }
        // B 站的签名地址是**认出口 IP** 的：playurl 在 A 实例拿到地址，另一实例去拉就会 403。
        // 所以这里支持「只给 id + mode」，在本次调用里现解析现拉流（同一个实例 = 同一个出口 IP）。
        const rid = (p.get('id') || '').trim();
        if (!rid) return new Response('缺少 url 或 id', { status: 400, headers: CORS });
        const rmode = (p.get('mode') || '') === 'video' ? 'video' : 'audio';
        const impl2 = PLATFORMS[platform];
        if (!impl2 || typeof impl2.playurl !== 'function') {
          return json({ ok: false, error: '这个平台不支持中转播放' }, 400);
        }
        const ckey = platform + ':' + rid + ':' + rmode;
        // B 站地址认出口 IP：**不读也不写缓存**，每次都在本实例现解析，
        // 否则 A 实例解析的地址被 B 实例拿去用，就会 403（表现就是「有时有画面」）。
        let resolved = null;
        if (platform !== 'bilibili') {
          const cHit = playCache.get(ckey);
          resolved = cHit && Date.now() - cHit.at < PLAY_CACHE_MS ? cHit.value : null;
        }
        if (!resolved) {
          resolved = await impl2.playurl(rid, env, rmode);
          if (platform !== 'bilibili' && resolved && resolved.playable) {
            playCache.set(ckey, { at: Date.now(), value: resolved });
          }
        }
        if (!resolved || !resolved.playable || !resolved.streamUrl) {
          return json({ ok: false, error: (resolved && resolved.note) || '拿不到可播放地址' }, 502);
        }
        // 主地址 403 就换 backup 镜像再试（都在同一次调用里，出口 IP 不变）
        const cands = [resolved.streamUrl].concat(resolved.backups || []).filter(Boolean);
        let resp = null;
        for (const c of cands.slice(0, 3)) {
          resp = await proxyAudio(request, c, platform, env, rmode);
          if (resp.status !== 403 && resp.status !== 502) break;
        }
        return resp;
      }

      // 歌词：目前只有网易云稳定（LRC + 翻译），QQ/B 站回一句「没有」
      if (url.pathname === '/lyric') {
        const lid = (p.get('id') || '').trim();
        if (!lid) return json({ ok: false, error: '缺少 id' }, 400);
        if (platform !== 'netease') {
          return json({ ok: true, data: { lrc: '', tlrc: '' }, note: '这个平台没有歌词' });
        }
        const lj = await fetchJson(
          'https://music.163.com/api/song/lyric?id=' + encodeURIComponent(lid) + '&lv=-1&kv=-1&tv=-1',
          { referer: 'https://music.163.com/', cookie: (env && env.NETEASE_COOKIE) || '' },
        );
        return json({
          ok: true,
          data: {
            lrc: (lj && lj.lrc && lj.lrc.lyric) || '',
            tlrc: (lj && lj.tlyric && lj.tlyric.lyric) || '',
          },
        });
      }
      if (url.pathname === '/playurl') {
        const id = (p.get('id') || '').trim();
        if (!id) return json({ ok: false, error: '缺少 id' }, 400);

        // 播放地址带时效（约 20 分钟），缓存 5 分钟够用，还能少打几次上游。
        // B 站例外：它的地址认出口 IP，而且返回前还要改写成 /stream?id=…，
        // 缓存值原样返回会漏出「别的实例签的地址」→ 客户端 403（表现就是「有时有画面」）。
        const mode = (p.get('mode') || '') === 'video' ? 'video' : 'audio';
        const level = (p.get('level') || '').trim();
        const cacheable = platform !== 'bilibili';
        const cacheKey = platform + ':' + id + ':' + mode + (level ? ':' + level : '');
        const hit = cacheable ? playCache.get(cacheKey) : null;
        if (hit && Date.now() - hit.at < PLAY_CACHE_MS) {
          return json({ ok: true, data: hit.value, cached: true });
        }

        const quality = p.get('quality') === '1080' ? '1080' : '720';
        const data = await impl.playurl(id, env, mode, { quality, level });

        // 酷狗从 Cloudflare 出口很容易被限流，给一条能照着做的提示
        if (data && data.playable === false && /频繁|too\s*frequent/i.test(String(data.note || ''))) {
          data.note = '酷狗这边限流了（Cloudflare 出口 IP 被判定为高频）。等 1–2 分钟再试；要稳定就把中转部署到国内云函数。';
          data.rateLimited = true;
        }

        // 注意：下面会改写 data.streamUrl（B 站换成 /stream?id=... ），
        // 所以缓存里要存一份**副本**，否则二次读缓存拿到的是被改写过的地址。
        if (cacheable && data && data.playable) playCache.set(cacheKey, { at: Date.now(), value: { ...data } });

        // B 站的签名地址认出口 IP：这里只回「id + mode」，让 /stream 当场解析当场拉流。
        // 腾讯云「函数 URL」不支持二进制响应，那种运行时下只能直接给 CDN 地址（多半 403）。
        if (
          platform === 'bilibili' &&
          data &&
          data.playable &&
          data.streamUrl &&
          data.source !== 'bilibilix' &&
          data.source !== 'html5' &&
          data.source !== 'mux'
        ) {
          if (request.headers.get('x-mr-binary') === '0') {
            data.note = '当前运行时（腾讯云函数 URL）不支持二进制代理，已直接给 CDN 地址；若播放失败请改用酷狗/网易云';
          } else {
            // 地址带后缀（.mp4/.m4a）：IIROSE 的播放器会看扩展名挑播放器，
            // 纯 /stream?id=... 没有后缀时它可能当成「未知媒体」不播。
            const ext = mode === 'video' ? 'mp4' : 'm4a';
            data.streamUrl =
              url.origin +
              '/stream/bili-' +
              encodeURIComponent(id) +
              '.' +
              ext +
              '?platform=bilibili&id=' +
              encodeURIComponent(id) +
              '&mode=' +
              mode;
          }
        }
        // 合流地址是相对路径（/stream/hd-…），补成绝对地址给客户端
        if (data && typeof data.streamUrl === 'string' && data.streamUrl.charAt(0) === '/') {
          data.streamUrl = url.origin + data.streamUrl;
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
  } else if (event?.queryString && typeof event.queryString === 'object') {
    // 腾讯云「函数 URL」给的是对象：{ platform: 'kugou', kw: 'xx' }
    for (const [k, v] of Object.entries(event.queryString)) add(k, v);
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

/** 腾讯云「函数 URL」的事件形状：{ httpMethod, path, queryString, headers, body } */
function isScfFunctionUrl(event) {
  return Boolean(event && event.httpMethod && typeof event.path === 'string' && event.queryString && typeof event.queryString === 'object');
}

/**
 * Web Response → event 响应。
 * 阿里云 FC 支持 isBase64Encoded；腾讯云函数 URL 不支持（会把 base64 原样吐出来），
 * 所以那边降级成文本响应，二进制接口（/stream）由 worker 侧改走直链。
 */
async function toResult(response, textOnly = false) {
  const headers = {};
  response.headers.forEach((v, k) => {
    const lower = k.toLowerCase();
    if (RESERVED_HEADERS.has(lower) || lower.startsWith('x-fc-')) return;
    headers[k] = v;
  });
  const buf = Buffer.from(await response.arrayBuffer());
  if (textOnly) {
    return { statusCode: response.status, headers, isBase64Encoded: false, body: buf.toString('utf8') };
  }
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
 *
 * 注意：阿里云 FC 的 Node.js 20 运行时下，HTTP 触发器有时把 event 作为
 * **Buffer / JSON 字符串** 交进来（而不是对象）。这里先统一解码成对象再适配。
 */
function normalizeEvent(event) {
  let ev = event;
  try {
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(ev)) ev = JSON.parse(ev.toString('utf8'));
    else if (typeof ev === 'string') ev = JSON.parse(ev);
  } catch {
    /* 解析不了就按原样传下去（下面会走 '/' 或报错） */
  }
  return ev;
}

export async function handler(event) {
  const ev = normalizeEvent(event);
  const scf = isScfFunctionUrl(ev);
  try {
    const request = toRequest(ev);
    // 告诉 worker：这次跑在不支持二进制响应的运行时上
    if (scf) request.headers.set('x-mr-binary', '0');
    // 云函数的环境变量在 process.env 里（阿里云 FC / 腾讯云 SCF 都是这样）
    const env = typeof process !== 'undefined' && process.env ? process.env : {};
    const response = await worker.fetch(request, env);
    return await toResult(response, scf);
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

