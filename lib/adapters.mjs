/**
 * 各平台搜索适配器（host 半侧）。
 *
 * 设计约束（都是踩过的坑，别改）：
 *  1. 全部走服务端出站：浏览器的 fetch 会被这些平台的 CORS 挡住，所以搜索只能由 DSH 的
 *     web server 代理。这也是这个插件必须有 host 半侧的原因。
 *  2. 每个适配器只负责「把自家 JSON 拆成统一形状」，不许把原始 JSON 丢给前端 ——
 *     前端渲染统一形状，平台字段变了只改这一处。
 *  3. 出站必须带 Referer / UA：163 与 QQ 都会按来源拒绝。
 *  4. 超时必须收（AbortSignal.timeout），不能让一个挂住的连接占住路由。
 *
 * 统一形状（Song）：
 *   { platform, id, title, artists[], album, durationMs, cover, vip, playable, url }
 */
import { fetchJson } from './http.mjs';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const ms = (sec) => (Number.isFinite(sec) ? Math.round(sec * 1000) : null);

/** 网易云：fee ∈ {0,8} 免费/低音质免费，{1} VIP，{4} 付费专辑 */
function neteaseVip(fee) {
  return fee === 1 || fee === 4;
}

export const netease = {
  id: 'netease',
  label: '网易云音乐',
  home: 'https://music.163.com/',
  async search({ keyword, limit = 20, offset = 0 }) {
    const url =
      'https://music.163.com/api/search/get/web?csrf_token=&type=1&offset=' +
      offset +
      '&limit=' +
      limit +
      '&s=' +
      encodeURIComponent(keyword);
    const json = await fetchJson(url, {
      headers: { 'User-Agent': UA, Referer: 'https://music.163.com/' },
    });
    const songs = json?.result?.songs ?? [];
    return songs.map((s) => ({
      platform: 'netease',
      id: String(s.id),
      title: s.name,
      artists: (s.artists ?? []).map((a) => a.name).filter(Boolean),
      album: s.album?.name ?? '',
      durationMs: s.duration ?? null,
      cover: s.album?.picId ? `https://p1.music.126.net/${s.album.picId}.jpg` : null,
      vip: neteaseVip(s.fee),
      playable: !neteaseVip(s.fee),
      url: `https://music.163.com/#/song?id=${s.id}`,
    }));
  },
};

export const kugou = {
  id: 'kugou',
  label: '酷狗音乐',
  home: 'https://www.kugou.com/',
  async search({ keyword, limit = 20, offset = 0 }) {
    const page = Math.floor(offset / limit) + 1;
    const url =
      'https://songsearch.kugou.com/song_search_v2?keyword=' +
      encodeURIComponent(keyword) +
      '&page=' +
      page +
      '&pagesize=' +
      limit;
    const json = await fetchJson(url, { headers: { 'User-Agent': UA } });
    const lists = json?.data?.lists ?? [];
    return lists.map((s) => ({
      platform: 'kugou',
      // id 用 FileHash：/music/api/playurl 拿它才能换到播放地址（酷狗的 ID/Audioid 换不到）
      id: String(s.FileHash ?? s.ID ?? ''),
      title: s.SongName ?? '',
      artists: [s.SingerName].filter(Boolean),
      album: s.AlbumName ?? '',
      durationMs: ms(s.Duration),
      cover: null,
      vip: Number(s.Privilege ?? 0) > 0 || Number(s.PayType ?? 0) > 0,
      playable: Number(s.Privilege ?? 0) === 0,
      url: s.Audioid
        ? `https://www.kugou.com/mixsong/${s.Audioid}.html`
        : `https://www.kugou.com/yy/html/search.html#searchType=song&searchKeyWord=${encodeURIComponent(keyword)}`,
    }));
  },
};

export const qq = {
  id: 'qq',
  label: 'QQ 音乐',
  home: 'https://y.qq.com/',
  async search({ keyword, limit = 20, offset = 0 }) {
    // 实测（dev/probe-apis.mjs）：musicu.fcg 的 Desktop 入口稳定返回空列表，
    // 而老的 search_for_qq_cp 正常返回 —— 别"升级"这个 URL。
    const page = Math.floor(offset / limit) + 1;
    const url =
      'https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp?format=json&new_json=1&p=' +
      page +
      '&n=' +
      limit +
      '&w=' +
      encodeURIComponent(keyword);
    const json = await fetchJson(url, {
      headers: { 'User-Agent': UA, Referer: 'https://y.qq.com/portal/search.html', Accept: 'application/json' },
    });
    const list = json?.data?.song?.list ?? [];
    return list.map((s) => {
      const mid = s.songmid ?? s.mid ?? '';
      const pay = s.pay ?? {};
      const vip = Number(pay.payplay ?? 0) > 0 || Number(pay.paytrackprice ?? 0) > 0;
      return {
        platform: 'qq',
        id: String(s.songid ?? mid),
        title: s.songname ?? s.title ?? '',
        artists: (s.singer ?? []).map((x) => x.name).filter(Boolean),
        album: s.albumname ?? '',
        durationMs: ms(s.interval),
        cover: s.albummid ? `https://y.qq.com/music/photo_new/T002R300x300M000${s.albummid}.jpg` : null,
        vip,
        playable: !vip,
        url: mid ? `https://y.qq.com/n/ryqq/songDetail/${mid}` : `https://y.qq.com/n/ryqq/search?w=${encodeURIComponent(keyword)}`,
      };
    });
  },
};

/**
 * B 站：不是音乐平台，但对「现场版 / Live / MV / 翻唱」特别有用，所以留一个通用位。
 * 走公开的 search/type 接口，字段少但稳定。
 */
export const bilibili = {
  id: 'bilibili',
  label: 'B 站（Live / MV）',
  home: 'https://www.bilibili.com/',
  async search({ keyword, limit = 20, offset = 0 }) {
    const url =
      'https://api.bilibili.com/x/web-interface/search/type?search_type=video&page=' +
      (Math.floor(offset / limit) + 1) +
      '&page_size=' +
      limit +
      '&keyword=' +
      encodeURIComponent(keyword);
    // 必须带 buvid3：不带时该接口稳定回 -412「request was banned」（实测见 dev/probe-apis.mjs）。
    const json = await fetchJson(url, {
      headers: {
        'User-Agent': UA,
        Referer: 'https://search.bilibili.com/',
        Origin: 'https://search.bilibili.com',
        Accept: 'application/json, text/plain, */*',
        Cookie: 'buvid3=0',
      },
    });
    const list = json?.data?.result ?? [];
    const strip = (html) => String(html ?? '').replace(/<[^>]*>/g, '');
    /** "mm:ss" / "hh:mm:ss" → 毫秒 */
    const dms = (v) => {
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
      durationMs: dms(v.duration),
      cover: v.pic ? (String(v.pic).startsWith('//') ? 'https:' + v.pic : v.pic) : null,
      vip: false,
      playable: true,
      url: v.bvid ? `https://www.bilibili.com/video/${v.bvid}` : `https://search.bilibili.com/all?keyword=${encodeURIComponent(keyword)}`,
    }));
  },
};

export const PLATFORMS = { netease, kugou, qq, bilibili };

export const PLATFORM_LIST = Object.values(PLATFORMS).map((p) => ({
  id: p.id,
  label: p.label,
  home: p.home,
}));
