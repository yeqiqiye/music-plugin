/**
 * IIROSE 版点歌台 —— 源码（产物是 iirose/music-iirose.js，别直接引用这个文件）。
 *
 * 和 DSH 版的区别，一句话：这里没有 Node 半侧。
 *   · 搜索 / 取直链 → 浏览器直接打 api.shadowsee.icu（它对 https://iirose.com 回 CORS 白名单）
 *   · 点播到房间   → 走页面自身的 WebSocket（window.socket 或 #mainFrame.contentWindow.socket），
 *                    发两帧：`&1{json}`（媒体数据）+ `m__4@0>...`（点播卡片）
 *   · 本地播放     → 完全不碰，否则会和房间播放器双声
 *
 * 协议来源（都是别人在生产里跑通的实现，不是猜的）：
 *   · iirose-scripts 的 script-manager：脚本列表就是 localStorage['extJs']
 *   · iirose-scripts 的 emoji 插件：`node.contentWindow.socket` + `socket.send(JSON.stringify({m,mc,i}))`
 *   · koishi-plugin-adapter-iirose：media_data.ts / media_card.ts 定义的 &1 帧与卡片格式
 *
 * 构建：node scripts/build-iirose.mjs（把面板源码与版本号注入进来，占位符写在构建脚本里）
 */
;(function () {
  'use strict';

  var VERSION = '__VERSION__';

  // 注入计数：设置页的诊断行会显示它 —— 大于 1 说明 extJs 里贴了不止一份脚本
  window.__MUSIC_IIROSE_LOADS__ = (window.__MUSIC_IIROSE_LOADS__ || 0) + 1;

  /**
   * 幂等 / 换版：
   *   · 同版本已经装过 → 直接退出（脚本列表里贴两遍不会挂两套）
   *   · 装着的是旧版本（extJs 里还留着老链接）→ 把旧的拆掉，这次装的说了算
   */
  function supersedePrevious() {
    var prev = window.__MUSIC_IIROSE__;
    if (!prev || !prev.mounted) return true;
    // 同版本重复注入：什么都不挂，但注入次数要记上（设置页诊断会显示实例数）
    if (prev.version === VERSION) {
      prev.instances = window.__MUSIC_IIROSE_LOADS__ || 1;
      return false;
    }
    try {
      if (typeof prev.destroy === 'function') prev.destroy();
    } catch (e) {
      /* 旧版没有 destroy：下面靠清 DOM 兜底 */
    }
    return true;
  }

  /** 清掉上一次（或旧版本）留下的界面：悬浮球、⚙、面板宿主 */
  function removeStaleNodes(doc) {
    try {
      var stale = doc.querySelectorAll('.mk-iirose-ball, .mk-iirose-gear, [data-music-iirose="host"], .mk-root');
      for (var i = 0; i < stale.length; i++) {
        var n = stale[i];
        if (n && n.parentNode) n.parentNode.removeChild(n);
      }
    } catch (e) {
      /* 忽略：清不掉也不影响接下来重新挂 */
    }
  }

  if (!supersedePrevious()) return;

  // 面板源码不在运行时注入：构建脚本把它拼在这个文件前面，直接就是同一个 <script>。
  // 这样不依赖「内联 <script> 能不能执行」——很多站点的 CSP 会拦 inline，但不会拦 <script src>。

  var API_DEFAULT = 'https://api.shadowsee.icu';
  var LS = {
    api: 'mk_iirose_api',
    hotkey: 'mk_iirose_hotkey',
    mode: 'mk_iirose_mode',
    relay: 'mk_iirose_relay',
    ball: 'mk_iirose_ball',
  };
  var HINT = 'Alt+T 开 / 关 · 双指上滑也能开 · 点 ▶ 发到房间';

  // ---------------------------------------------------------------- 小工具

  function ls(key, fallback) {
    try {
      var v = window.localStorage.getItem(key);
      return v == null || v === '' ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function lsSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (e) {
      /* 隐私模式写不进去就算了 */
    }
  }

  // 与面板共用同一把 key：面板里改的开关，这里要能读到
  var SETTINGS_KEY = 'mk_panel_settings';
  var SETTINGS_DEFAULT = {
    ball: true,
    gesture: true,
    theme: 'auto',
    accent: 'blue',
    glass: false,
    compact: false,
    card: true,
  };
  function readSettings() {
    var out = {};
    for (var k in SETTINGS_DEFAULT) out[k] = SETTINGS_DEFAULT[k];
    try {
      var raw = window.localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        var saved = JSON.parse(raw);
        for (var j in saved) if (Object.prototype.hasOwnProperty.call(saved, j)) out[j] = saved[j];
      }
    } catch (e) {
      /* 解析不了就用默认值 */
    }
    return out;
  }

  function apiBase() {
    return String(ls(LS.api, API_DEFAULT)).replace(/\/+$/, '') || API_DEFAULT;
  }

  /** adapter 的 encode：& < > " ' / → HTML 实体（点播卡片里的字段要用它） */
  var ENTITY = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '/': '&#x2F;' };
  function enc(str) {
    return String(str == null ? '' : str).replace(/[&<>"'/]/g, function (ch) {
      return ENTITY[ch];
    });
  }

  function msgId() {
    return String(Date.now()).slice(-5) + String(Math.random()).slice(-7);
  }

  /** 163 的 picUrl 是 http，页面上要 https，否则混合内容会被拦 */
  function https(url) {
    if (!url) return '';
    return url.indexOf('http://') === 0 ? 'https://' + url.slice(7) : String(url);
  }

  function log() {
    try {
      console.info.apply(console, ['[music-iirose]'].concat([].slice.call(arguments)));
    } catch (e) {
      /* 忽略 */
    }
  }

  // ------------------------------------------------------------ 定位应用窗口

  /**
   * IIROSE 的应用可能跑在顶层，也可能在 #mainFrame 里。
   * 不管脚本被注入到哪一层，都要能找到那个握着 socket 和 uid 的 window。
   */
  function locateApp() {
    try {
      if (window.socket && window.uid) return window;
    } catch (e) {
      /* 忽略 */
    }
    var frames = [];
    try {
      var main = document.getElementById('mainFrame');
      if (main) frames.push(main);
    } catch (e) {
      /* 忽略 */
    }
    try {
      frames = frames.concat([].slice.call(document.querySelectorAll('iframe')));
    } catch (e) {
      /* 忽略 */
    }
    for (var i = 0; i < frames.length; i++) {
      try {
        var w = frames[i].contentWindow;
        if (w && w.socket && w.uid) return w;
      } catch (e) {
        // 跨域访问会抛；同源的话不会走到这里
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- 出站请求

  function qs(params) {
    var out = [];
    for (var k in params) {
      if (Object.prototype.hasOwnProperty.call(params, k) && params[k] != null) {
        out.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
      }
    }
    return out.length ? '?' + out.join('&') : '';
  }

  /**
   * base 可以显式给（中转地址），不给就用 ShadowSee。
   * 两个上游都只是 JSON 接口，几 KB，不需要 cookie。
   */
  function request(path, params, base) {
    var url = (base || apiBase()) + path + qs(params);
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () {
      if (ctrl) ctrl.abort();
    }, 12000);
    return fetch(url, {
      method: 'GET',
      credentials: 'omit',
      headers: { accept: 'application/json' },
      signal: ctrl ? ctrl.signal : undefined,
    })
      .then(function (res) {
        if (!res.ok) throw new Error('接口返回 HTTP ' + res.status);
        return res.json();
      })
      .then(function (json) {
        clearTimeout(timer);
        return json;
      })
      .catch(function (err) {
        clearTimeout(timer);
        throw err;
      });
  }

  /** 中转（可选）：配了这个才有酷狗 / B 站 */
  function relayBase() {
    var raw = String(ls(LS.relay, '') || '').trim().replace(/\/+$/, '');
    if (!raw) return '';
    return /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
  }

  // 点播卡片/媒体帧里的平台标记（对端客户端据此显示图标）
  var TYPE_MARK = { netease: '@0', kugou: '@4', bilibili: '=0', qq: '@2' };

  /** /cloudsearch 的一条结果 → 面板认得的 Song 形状 */
  function normalize(song) {
    var al = song.al || {};
    var ar = song.ar || [];
    var names = [];
    for (var i = 0; i < ar.length; i++) if (ar[i] && ar[i].name) names.push(ar[i].name);
    var fee = Number(song.fee);
    return {
      platform: 'netease',
      id: String(song.id),
      title: song.name || '',
      artists: names,
      album: al.name || '',
      durationMs: Number(song.dt) || null,
      cover: https(al.picUrl),
      vip: fee === 1 || fee === 4,
      playable: true, // 只是「搜索结果」，真能不能播由 songUrl 决定
      url: 'https://music.163.com/song?id=' + song.id,
    };
  }

  /** 没配中转时的兜底：ShadowSee（公共接口，无 Cookie，VIP 曲拿不到） */
  function shadowseeSearch(keyword, limit, page) {
    return request('/cloudsearch', {
      keywords: keyword,
      type: 1,
      limit: limit,
      offset: (page - 1) * limit,
    }).then(function (json) {
      var songs = (json && json.result && json.result.songs) || [];
      return songs.map(normalize);
    });
  }

  /**
   * 配了中转就**所有平台都走中转**（包括网易云）——
   * 中转那边可以带用户自己的 Cookie，VIP 曲才拿得到；
   * 中转失败时网易云再退回 ShadowSee。
   */
  function search(opts) {
    var platform = (opts && opts.platform) || 'netease';
    var keyword = String((opts && opts.keyword) || '').trim();
    var type = (opts && opts.type) || 'song';
    if (!keyword) return Promise.resolve([]);
    var limit = Math.min(30, Math.max(1, Number(opts.limit) || 20));
    var page = Math.max(1, Number((opts && opts.page) || 1));
    var base = relayBase();

    // 搜用户 / 歌单只有中转能做（公共接口没有这两类）
    if (type !== 'song') {
      if (!base) return Promise.reject(new Error('搜用户 / 歌单要走中转：先点右下角 ⚙ 配一下地址'));
      return request('/search', { platform: platform, kw: keyword, limit: limit, page: page, type: type }, base).then(
        function (out) {
          if (!out || out.ok !== true) throw new Error((out && out.error) || '中转返回异常');
          return out.data || [];
        },
      );
    }

    if (!base) {
      if (platform !== 'netease') {
        return Promise.reject(new Error('「' + platform + '」要走中转：先配中转地址（见 docs/iirose.md）'));
      }
      return shadowseeSearch(keyword, limit, page);
    }

    return request('/search', { platform: platform, kw: keyword, limit: limit, page: page }, base).then(function (out) {
      if (!out || out.ok !== true) throw new Error((out && out.error) || '中转返回异常');
      return out.data || [];
    }).catch(function (err) {
      if (platform === 'netease') return shadowseeSearch(keyword, limit, page);
      throw err;
    });
  }

  /** 歌单详情：{ playlist, songs } —— 面板用它做「全部入队」 */
  function playlistSongs(opts) {
    var base = relayBase();
    if (!base) return Promise.reject(new Error('读歌单要配中转地址'));
    return request('/playlist', { platform: (opts && opts.platform) || 'netease', id: (opts && opts.id) || '' }, base).then(
      function (out) {
        if (!out || out.ok !== true) throw new Error((out && out.error) || '中转返回异常');
        return out.data || { playlist: {}, songs: [] };
      },
    );
  }

  /** 某个用户创建的歌单 */
  function userPlaylists(opts) {
    var base = relayBase();
    if (!base) return Promise.reject(new Error('读用户歌单要配中转地址'));
    return request('/user', { platform: (opts && opts.platform) || 'netease', id: (opts && opts.id) || '' }, base).then(
      function (out) {
        if (!out || out.ok !== true) throw new Error((out && out.error) || '中转返回异常');
        return out.data || [];
      },
    );
  }

  function songUrl(opts) {
    var platform = (opts && opts.platform) || 'netease';
    var id = String((opts && opts.id) || '');
    var mode = (opts && opts.mode) === 'video' ? 'video' : 'audio';
    if (!id) return Promise.resolve({ playable: false, reason: 'no-id', note: '缺少歌曲 id' });
    var base = relayBase();

    if (base) {
      return request('/playurl', { platform: platform, id: id, mode: mode }, base).then(function (out) {
        if (!out || out.ok !== true) throw new Error((out && out.error) || '中转返回异常');
        var data = out.data || { playable: false, reason: 'no-data', note: '中转没有返回播放信息' };
        // 中转（没配 Cookie）拿不到 VIP 曲时，网易云再问一次公共接口，能拿到就拿到
        if (platform === 'netease' && data.playable === false) return shadowseeSongUrl(id);
        return data;
      }).catch(function (err) {
        if (platform === 'netease') return shadowseeSongUrl(id);
        throw err;
      });
    }

    if (platform !== 'netease') {
      return Promise.resolve({ playable: false, reason: 'need-relay', note: '这个平台要走中转：先配中转地址' });
    }
    return shadowseeSongUrl(id);
  }

  function shadowseeSongUrl(id) {
    return request('/song/url/v1', { id: id, level: 'standard' }).then(function (json) {
      var d = json && json.data && json.data[0];
      if (!d || !d.url) {
        return {
          playable: false,
          reason: 'no-url',
          note: '这首拿不到音频（版权锁 / 需要会员），可用「复制指令」让 IIROSE 自己解析',
        };
      }
      return {
        playable: true,
        streamUrl: https(d.url),
        ext: d.type || 'mp3',
        bitrate: d.br || null,
        size: d.size || null,
        expiresInSec: d.expi || null,
      };
    });
  }

  // ------------------------------------------------------------ 发到房间

  /**
   * 卡片颜色必须是 **6 位十六进制、不带 #**（IIROSE 客户端按 `m__4…>颜色>码率` 解析）。
   * 带 # 或 3 位简写会让客户端认不出这是点播卡片，退回成一条普通文字消息。
   */
  function normColor(raw) {
    var s = String(raw == null ? '' : raw).replace(/^#/, '').replace(/[^0-9a-fA-F]/g, '');
    if (s.length === 3) s = s.charAt(0) + s.charAt(0) + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2);
    if (s.length >= 6) return s.slice(0, 6);
    if (!s) return 'ff9800';
    return (s + 'ff9800').slice(0, 6);
  }

  /** 视频卡片里那格「时长文本」，客户端的视频卡片用它显示时长 */
  function durationText(song) {
    var sec = Math.round((Number(song && song.durationMs) || 0) / 1000);
    if (!sec) return '';
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + '分' + (s ? s + '秒' : '');
  }

  /**
   * 点播两帧：
   *   1. `&1{json}` 媒体数据 —— 真正把这首歌塞进房间播放列表；
   *   2. `m__4<来源>>标题>歌手>封面>颜色>码率` 卡片 —— 公屏/前端那张点播卡片。
   * 卡片消息就是普通公屏消息 `{m, mc, i}`（**不能带 g**，带 g 会变成私聊，只有自己看得到）。
   *
   * B 站视频换了标记：数据帧用 `!3`、卡片用 `*3`；音频仍是各平台标记（B 站音频 =0）。
   */
  function buildFrames(song, info, app) {
    var color = normColor(app && app.inputcolorhex);
    var artist = (song.artists || []).join(' & ');
    var cover = https(song.cover || '');
    var link = song.url || '';
    var isVideo = Boolean(info && info.mode === 'video');
    var bitrate = isVideo ? Number(info && info.qn) || '' : Math.round((Number(info && info.bitrate) || 320000) / 1000);
    // 音频用各平台标记（@0 网易 / @4 酷狗 / =0 B 站音频）；
    // 视频统一用「通用视频」=1：我们给的是一条普通 mp4 直链，不是 B 站播放器内部的地址，
    // 用 !3 会让对端按「B 站视频」去解析/校验，反而放不出来。
    var mark = isVideo ? '=1' : TYPE_MARK[song.platform] || '@0';
    var cardMark = isVideo ? '=1' : mark;

    var media =
      '&1' +
      JSON.stringify({
        s: String(info.streamUrl).slice(4), // https://x → s://x
        d: Math.round((Number(song.durationMs) || 0) / 1000),
        c: cover.slice(4),
        n: song.title,
        r: artist,
        b: mark,
        o: link.slice(4),
        l: null,
      });

    // 标题/歌手要做实体转义；封面和颜色**不能**转义 —— 封面里的 / 会被转成 &#x2F;，
    // 客户端拿到这种地址就加载不出来（房间歌单里就成了「没有图」）。
    // 视频卡片字段比音频多两格：`…>颜色>>码率>>时长文本`。
    var cardFields = isVideo
      ? [enc(song.title), enc(artist), cover, color, '', bitrate, '', durationText(song)]
      : [enc(song.title), enc(artist), cover, color, bitrate];
    var card = 'm__4' + cardMark + '>' + cardFields.join('>');

    var payload = { m: card, mc: color, i: msgId() };

    return [media, JSON.stringify(payload)];
  }

  function enqueue(song, info) {
    var app = locateApp();
    if (!app || !app.socket) {
      throw new Error('找不到房间连接：请先进房间并确认已登录（F5 之后再试）');
    }
    var frames = buildFrames(song, info, app);
    // 先发媒体数据（入队/播放），再发卡片；设置里关掉「发送点播卡片」时只发前者
    app.socket.send(frames[0]);
    diag.framesSent += 1;
    var withCard = readSettings().card !== false;
    if (withCard) {
      app.socket.send(frames[1]);
      diag.framesSent += 1;
    }
    diag.lastCard = withCard;
    diag.lastEnqueue = song.title + (song.artists && song.artists.length ? ' - ' + song.artists[0] : '');
    observeRoom(app);
    return { frames: frames, app: app };
  }

  /** 复制兜底指令：房间不让点播时，用户自己粘到聊天框，交给 IIROSE 自己的解析器 */
  function copyDirective(song) {
    var kw = [song.title].concat((song.artists || []).slice(0, 1)).filter(Boolean).join(' ');
    var text = '@@' + kw;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text).then(function () {
          return text;
        });
      }
    } catch (e) {
      /* 掉到下面的兜底 */
    }
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return Promise.resolve(text);
    } catch (e) {
      return Promise.reject(new Error('复制失败，请手动输入：' + text));
    }
  }

  // ------------------------------------------------------------ 监听房间播放

  var diag = {
    version: VERSION,
    mounted: false,
    state: 'boot',
    socketOk: false,
    framesSent: 0,
    lastError: null,
    lastEnqueue: null,
    roomNow: null,
    api: null,
    instances: window.__MUSIC_IIROSE_LOADS__ || 1,
    settings: null,
    gestureOn: null,
  };

  function parseMediaFrame(data) {
    if (typeof data !== 'string') return null;
    var i = data.indexOf('&1{');
    if (i < 0) return null;
    try {
      return JSON.parse(data.slice(i + 2));
    } catch (e) {
      return null;
    }
  }

  /**
   * 只「观察」不「拦截」：包一层 onmessage，先把消息交给原 handler，再顺手更新面板。
   * 绝不能返回别的值，否则会把 IIROSE 自己的消息处理搞坏。
   */
  function observeRoom(app) {
    if (!app || !app.socket || app.socket.__mkObserved) return;
    var orig = app.socket.onmessage;
    app.socket.onmessage = function (ev) {
      try {
        var media = parseMediaFrame(ev && ev.data);
        if (media && media.n) {
          var roomArtist = String(media.r || '').replace(/^@\d+/, '');
          diag.roomNow = media.n + (roomArtist ? ' - ' + roomArtist : '');
          if (panel) panel.setRoomNow('房间：' + media.n, roomArtist);
        }
      } catch (e) {
        /* 解析失败只影响展示 */
      }
      if (typeof orig === 'function') return orig.apply(this, arguments);
      return undefined;
    };
    try {
      app.socket.__mkObserved = true;
    } catch (e) {
      /* 忽略 */
    }
    diag.socketOk = true;
  }

  // ---------------------------------------------------------------- 热键

  function parseHotkey(spec) {
    var parts = String(spec || 'Alt+T').split('+');
    var out = { alt: false, ctrl: false, shift: false, meta: false, key: 't' };
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].trim().toLowerCase();
      if (!p) continue;
      if (p === 'alt') out.alt = true;
      else if (p === 'ctrl' || p === 'control') out.ctrl = true;
      else if (p === 'shift') out.shift = true;
      else if (p === 'meta' || p === 'cmd') out.meta = true;
      else out.key = p;
    }
    return out;
  }

  function matchHotkey(ev, spec) {
    if (!ev || !spec) return false;
    if (Boolean(ev.altKey) !== spec.alt) return false;
    if (Boolean(ev.ctrlKey) !== spec.ctrl) return false;
    if (Boolean(ev.shiftKey) !== spec.shift) return false;
    if (Boolean(ev.metaKey) !== spec.meta) return false;
    var code = String(ev.code || '');
    var key = String(ev.key || '').toLowerCase();
    return code === 'Key' + spec.key.toUpperCase() || key === spec.key;
  }

  /**
   * 页内配置：没有中转地址时，右下角多一个 ⚙，点开就能填 —— 不用开 F12。
   * （很多人开 DevTools 会被站点的反调试搞到页面反复刷新，这条路能绕过去。）
   */
  function showSetup() {
    var doc = document;
    if (doc.querySelector('[data-mk-setup]')) return;
    var wrap = doc.createElement('div');
    wrap.setAttribute('data-mk-setup', '1');
    wrap.style.cssText =
      'position:fixed;inset:0;z-index:2147483200;display:flex;align-items:center;justify-content:center;' +
      'background:rgba(6,9,14,.62);font:14px/1.7 -apple-system,"Microsoft YaHei","PingFang SC",system-ui,sans-serif';

    var card = doc.createElement('div');
    card.style.cssText =
      'width:min(560px,92vw);background:#141a24;color:#e9eef7;border:1px solid #2b3444;border-radius:16px;' +
      'padding:20px;box-shadow:0 24px 70px rgba(0,0,0,.55)';
    card.innerHTML =
      '<div style="font-size:16px;font-weight:700;margin-bottom:6px">配置中转地址</div>' +
      '<div style="font-size:12.5px;color:#93a1b8;line-height:1.7;margin-bottom:12px">' +
      '填你已经部署好的中转（Cloudflare Worker 或云函数），例如 ' +
      '<code style="color:#cfe6ff">https://music-relay.yeqiqiye.xyz</code>。<br>' +
      '配好后会多出「酷狗音乐」「B 站」两个 tab；如果中转里配了自己的 Cookie，网易云 VIP 曲也能放。' +
      '</div>' +
      '<input data-mk-input placeholder="https://music-relay.你的域名" ' +
      'style="width:100%;box-sizing:border-box;background:#1b2432;color:inherit;border:1px solid #2b3444;' +
      'border-radius:10px;padding:10px 12px;font-size:13px;outline:none">' +
      '<div data-mk-msg style="min-height:18px;margin-top:8px;font-size:12px;color:#ffc9cf"></div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">' +
      '<button data-mk-cancel style="background:transparent;color:inherit;border:1px solid #2b3444;border-radius:9px;' +
      'padding:7px 14px;font-size:13px;cursor:pointer">取消</button>' +
      '<button data-mk-save style="background:#173a5e;border:1px solid #2f6ea8;color:#cfe6ff;border-radius:9px;' +
      'padding:7px 14px;font-size:13px;cursor:pointer">保存并刷新</button>' +
      '</div>';

    wrap.appendChild(card);
    (doc.body || doc.documentElement).appendChild(wrap);

    var input = card.querySelector('[data-mk-input]');
    var msg = card.querySelector('[data-mk-msg]');
    input.value = relayBase() || '';

    function close() {
      wrap.remove();
    }
    card.querySelector('[data-mk-cancel]').addEventListener('click', close);
    wrap.addEventListener('click', function (ev) {
      if (ev.target === wrap) close();
    });
    card.querySelector('[data-mk-save]').addEventListener('click', function () {
      var value = String(input.value || '').trim().replace(/\/+$/, '');
      if (!value) {
        msg.textContent = '先填一个地址';
        return;
      }
      if (!/^https?:\/\//i.test(value)) value = 'https://' + value;
      try {
        // eslint-disable-next-line no-new
        new URL(value);
      } catch (e) {
        msg.textContent = '地址格式不对，示例：https://music-relay.xxx.xyz';
        return;
      }
      lsSet(LS.relay, value);
      msg.style.color = '#7ee0b8';
      msg.textContent = '已保存，正在刷新…';
      setTimeout(function () {
        location.reload();
      }, 300);
    });
    setTimeout(function () {
      input.focus();
    }, 0);
  }

  // ---------------------------------------------------------------- 启动

  var panel = null;
  var hostEl = null;
  var ballEl = null;
  var gearEl = null;

  function ensureCss(doc) {
    if (doc.querySelector('style[data-music-iirose]')) return;
    var style = doc.createElement('style');
    style.setAttribute('data-music-iirose', '1');
    style.textContent = [
      '.mk-iirose-gear{position:fixed;right:22px;bottom:96px;z-index:2147482990;width:34px;height:34px;',
      'border-radius:50%;border:1px solid #2b3444;background:#1e2836;color:#93a1b8;font-size:15px;',
      'cursor:pointer;font-family:inherit;line-height:1}',
      '.mk-iirose-gear:hover{color:#cfe6ff;border-color:#3f6ea8}',
      // 悬浮球：可拖动；要关掉它去 ⚙ 设置里关（球上不再挂「×」）
      '.mk-iirose-ball{position:fixed;right:18px;bottom:24px;z-index:2147482991;width:52px;height:52px;',
      'border-radius:50%;border:1px solid #2f6ea8;background:#173a5e;color:#cfe6ff;font-size:18px;',
      'box-shadow:0 8px 24px rgba(0,0,0,.45);font-family:inherit;display:flex;align-items:center;',
      'justify-content:center;touch-action:none;user-select:none;-webkit-user-select:none;cursor:grab}',
      '.mk-iirose-ball:active{cursor:grabbing}',
      '.mk-iirose-ball:hover{background:#1d4a76}',
      '.mk-iirose-ball.mk-room{box-shadow:0 0 0 3px rgba(126,224,184,.35),0 8px 24px rgba(0,0,0,.45)}',
      '@media (max-width:640px){.mk-iirose-ball{width:56px;height:56px;font-size:20px}}',
    ].join('\n');
    (doc.head || doc.documentElement).appendChild(style);
  }

  function ensurePanel() {
    if (typeof window.mountMusicPanel !== 'function') {
      throw new Error('面板没有就绪：构建产物里应该已经包含 panel-ui.js（重新跑 npm run build:iirose）');
    }
  }

  function api() {
    return {
      platforms: function () {
        var list = [{ id: 'netease', label: '网易云音乐', home: 'https://music.163.com/' }];
        // 酷狗 / B 站要中转才可用；没配就不显示 tab，免得点进去只看到报错
        if (relayBase()) {
          list.push({ id: 'kugou', label: '酷狗音乐', home: 'https://www.kugou.com/' });
          list.push({ id: 'bilibili', label: 'B 站（音频轨）', home: 'https://www.bilibili.com/' });
          list.push({ id: 'qq', label: 'QQ 音乐', home: 'https://y.qq.com/' });
        }
        return Promise.resolve(list);
      },
      search: search,
      playlist: playlistSongs,
      userPlaylists: userPlaylists,
      playurl: songUrl,
      session: function () {
        return Promise.resolve({ platform: 'netease', loggedIn: false, nickname: null });
      },
      login: function () {
        return Promise.reject(new Error('IIROSE 版用不到登录：搜索和点播都走平台自己的解析'));
      },
      logout: function () {
        return Promise.resolve({ loggedIn: false });
      },
    };
  }

  function mount() {
    var doc = document;
    // 上一次（或旧版本）留下的球 / ⚙ / 面板先清掉，避免一个页面两个入口
    removeStaleNodes(doc);
    ensureCss(doc);
    ensurePanel();
    hostEl = doc.createElement('div');
    hostEl.setAttribute('data-music-iirose', 'host');
    (doc.body || doc.documentElement).appendChild(hostEl);

    var mode = ls(LS.mode, 'room') === 'local' ? 'local' : 'room';
    panel = window.mountMusicPanel(hostEl, {
      api: api(),
      openOnMount: false,
      version: VERSION,
      playMode: mode,
      modeSwitch: true,
      // IIROSE 版没有「保存登录」这回事，登录按钮只会误导人
      hideLogin: true,
      // 搜用户 / 歌单要靠中转（网易云支持，其它平台会提示不支持）
      scopes: relayBase()
        ? [
            { id: 'song', label: '歌曲' },
            { id: 'user', label: '用户' },
            { id: 'playlist', label: '歌单' },
          ]
        : null,
      onEnqueue: function (song, info) {
        enqueue(song, info);
      },
      onFallback: copyDirective,
      onModeChange: function (m) {
        lsSet(LS.mode, m);
      },
      // 设置页底部那行「诊断」：能看出是不是有旧脚本还在跑、手势到底挂没挂
      diagnostics: function () {
        return {
          version: VERSION,
          instances: diag.instances,
          gesture: gestureOn,
          ball: !(ballEl && ballEl.style && ballEl.style.display === 'none'),
        };
      },
      // 面板里直接改中转地址（不用 F12，也不用记 localStorage 的 key）
      relayUrl: relayBase(),
      onRelayChange: function (url) {
        lsSet(LS.relay, url || '');
        diag.relay = url || null;
      },
      // 「原生」模式：把链接当普通公屏消息发出去，让 IIROSE 自己解析点播（和自带点歌台同一套）
      onNativeRequest: function (song) {
        var app = locateApp();
        if (!app || !app.socket) throw new Error('找不到房间连接：先进房间再试');
        var link = song.url || 'https://www.bilibili.com/video/' + song.id;
        var color = normColor(app.inputcolorhex);
        app.socket.send(JSON.stringify({ m: '@ ' + link, mc: color, i: msgId() }));
        diag.framesSent += 1;
        diag.lastEnqueue = 'native: ' + link;
      },
      onSettingsChange: function (s) {
        applyEntrySettings(s);
      },
    });

    // ---------- 悬浮球：可拖动 / 可关闭 ----------
    var BALL_SIZE = 52;
    function ballSaved() {
      try {
        var raw = ls(LS.ball, '');
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    }
    function placeBall(x, y) {
      var vw = window.innerWidth || 360;
      var vh = window.innerHeight || 640;
      var pad = 6;
      x = Math.min(Math.max(pad, x), Math.max(pad, vw - BALL_SIZE - pad));
      y = Math.min(Math.max(pad, y), Math.max(pad, vh - BALL_SIZE - pad));
      ballEl.style.left = Math.round(x) + 'px';
      ballEl.style.top = Math.round(y) + 'px';
      ballEl.style.right = 'auto';
      ballEl.style.bottom = 'auto';
      return { x: Math.round(x), y: Math.round(y) };
    }
    function showBall() {
      if (!ballEl) return;
      ballEl.style.display = '';
    }
    function hideBall() {
      if (!ballEl) return;
      ballEl.style.display = 'none';
    }

    /**
     * 设置的唯一入口：面板改了设置 / 别的实例改了 / storage 变了，全都走这里。
     * 「关掉双指上滑」= 真的把监听拆掉，而不是留个闭包变量假装关掉了。
     */
    var gestureOn = false;
    // 已经挂了手势的 document（顶层 + 同源 iframe），关手势时按这个清单逐个摘
    var gestureTargets = [];
    function applyEntrySettings(s) {
      panelSettings = s || readSettings();
      setGestureEnabled(panelSettings.gesture !== false);
      if (panelSettings.ball !== false) showBall();
      else hideBall();
      diag.settings = {
        ball: panelSettings.ball !== false,
        gesture: panelSettings.gesture !== false,
      };
      diag.gestureOn = gestureOn;
    }

    // 面板发 mk-settings、别的标签页写 storage：两边都能同步
    try {
      window.addEventListener('mk-settings', function (ev) {
        var d = ev && ev.detail;
        applyEntrySettings(d && d.settings);
      });
      window.addEventListener('storage', function (ev) {
        if (ev && ev.key && ev.key !== SETTINGS_KEY) return;
        applyEntrySettings();
      });
    } catch (e) {
      /* 没有 addEventListener 的老环境就算了 */
    }
    function togglePanel() {
      try {
        panel.toggle();
      } catch (e) {
        diag.lastError = String(e && e.message);
      }
    }
    function openPanel() {
      try {
        panel.open();
      } catch (e) {
        diag.lastError = String(e && e.message);
      }
    }

    ballEl = doc.createElement('div');
    ballEl.className = 'mk-iirose-ball';
    ballEl.title = '点歌台（' + HINT + '）· 按住可以拖动；要关掉它去面板右上角 ⚙';
    ballEl.innerHTML = '<span class="mk-ball-ico">♪</span>';
    (doc.body || doc.documentElement).appendChild(ballEl);

    var panelSettings = readSettings();
    var saved = ballSaved();
    if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') placeBall(saved.x, saved.y);
    applyEntrySettings(panelSettings);

    // 双指上滑时手指常常顺手落在右下角：那种「顺带的」抬起不算点球
    var activeTouches = 0;
    function trackTouches(ev) {
      if (ev && ev.touches) activeTouches = ev.touches.length || 0;
    }
    try {
      doc.addEventListener('touchstart', trackTouches, { passive: true });
      doc.addEventListener('touchmove', trackTouches, { passive: true });
      doc.addEventListener('touchend', trackTouches, { passive: true });
      doc.addEventListener('touchcancel', trackTouches, { passive: true });
    } catch (e) {
      /* 忽略 */
    }

    var drag = null;
    function pointOf(ev) {
      if (ev.touches && ev.touches.length) return { x: ev.touches[0].clientX, y: ev.touches[0].clientY };
      return { x: ev.clientX, y: ev.clientY };
    }
    function onBallDown(ev) {
      var p = pointOf(ev);
      drag = {
        sx: p.x,
        sy: p.y,
        ox: parseFloat(ballEl.style.left) || ballEl.offsetLeft || 0,
        oy: parseFloat(ballEl.style.top) || ballEl.offsetTop || 0,
        moved: false,
      };
      ballEl.classList.add('mk-touched');
      if (ballEl.setPointerCapture && ev.pointerId != null) {
        try {
          ballEl.setPointerCapture(ev.pointerId);
        } catch (e) {
          /* 某些老 WebView 不支持 */
        }
      }
    }
    function onBallMove(ev) {
      if (!drag) return;
      var p = pointOf(ev);
      var dx = p.x - drag.sx;
      var dy = p.y - drag.sy;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 6) drag.moved = true;
      if (drag.moved) {
        placeBall(drag.ox + dx, drag.oy + dy);
        if (ev.cancelable) ev.preventDefault();
      }
    }
    function onBallUp(ev) {
      if (!drag) return;
      var moved = drag.moved;
      drag = null;
      if (moved) {
        // 用 style 上的值（placeBall 已经夹过边界）；getBoundingClientRect 在个别 WebView 里拿不到布局
        var sx = parseFloat(ballEl.style.left);
        var sy = parseFloat(ballEl.style.top);
        if (!isFinite(sx) || !isFinite(sy)) {
          var r = ballEl.getBoundingClientRect();
          sx = r.left;
          sy = r.top;
        }
        lsSet(LS.ball, JSON.stringify({ x: sx, y: sy }));
        return;
      }
      // 多指触摸（比如双指上滑起手落在球上）不当作点击
      var touching = ev && ev.touches ? ev.touches.length : activeTouches;
      if (touching > 1) return;
      togglePanel();
    }

    if (window.PointerEvent) {
      ballEl.addEventListener('pointerdown', onBallDown);
      ballEl.addEventListener('pointermove', onBallMove);
      ballEl.addEventListener('pointerup', onBallUp);
      ballEl.addEventListener('pointercancel', function () {
        drag = null;
      });
    } else {
      ballEl.addEventListener('touchstart', onBallDown, { passive: true });
      ballEl.addEventListener('touchmove', onBallMove, { passive: false });
      ballEl.addEventListener('touchend', onBallUp);
      ballEl.addEventListener('mousedown', onBallDown);
      doc.addEventListener('mousemove', onBallMove);
      doc.addEventListener('mouseup', onBallUp);
    }

    // ---------- 双指上滑 = 打开点歌台 ----------
    // 手机上 Alt+T 用不了，悬浮球被关掉之后总得有个入口
    var gesture = null;
    function gestureStart(ev) {
      // 关掉时监听已经被摘掉了，这里再判一次兜底（防止某处漏摘）
      if (!gestureOn || !panelSettings || !panelSettings.gesture) return;
      if (ev.touches && ev.touches.length === 2) {
        gesture = {
          y: (ev.touches[0].clientY + ev.touches[1].clientY) / 2,
          t: Date.now(),
          fired: false,
        };
      } else if (!ev.touches || ev.touches.length === 0) {
        gesture = null;
      }
    }
    function gestureMove(ev) {
      if (!gestureOn || !gesture || gesture.fired || !ev.touches || ev.touches.length !== 2) return;
      var y = (ev.touches[0].clientY + ev.touches[1].clientY) / 2;
      if (gesture.y - y > 90 && Date.now() - gesture.t < 900) {
        gesture.fired = true;
        openPanel();
      }
    }
    function gestureEnd(ev) {
      if (!ev.touches || ev.touches.length < 2) gesture = null;
    }
    function attachGesture(target) {
      if (!target || !target.addEventListener) return;
      for (var i = 0; i < gestureTargets.length; i++) if (gestureTargets[i] === target) return;
      target.addEventListener('touchstart', gestureStart, { passive: true });
      target.addEventListener('touchmove', gestureMove, { passive: true });
      target.addEventListener('touchend', gestureEnd, { passive: true });
      target.addEventListener('touchcancel', gestureEnd, { passive: true });
      gestureTargets.push(target);
    }
    function detachGesture(target) {
      if (!target || !target.removeEventListener) return;
      target.removeEventListener('touchstart', gestureStart, { passive: true });
      target.removeEventListener('touchmove', gestureMove, { passive: true });
      target.removeEventListener('touchend', gestureEnd, { passive: true });
      target.removeEventListener('touchcancel', gestureEnd, { passive: true });
    }
    /** 页面上所有能挂手势的 document：顶层 + 同源 iframe（游戏在 #mainFrame 里时用得上） */
    function gestureDocs() {
      var out = [doc];
      try {
        var frames = doc.querySelectorAll('iframe');
        for (var fi = 0; fi < frames.length && fi < 4; fi++) {
          var fdoc = null;
          try {
            fdoc = frames[fi].contentDocument;
          } catch (e) {
            fdoc = null;
          }
          if (fdoc) out.push(fdoc);
        }
      } catch (e) {
        /* 跨域 iframe 就算了 */
      }
      return out;
    }
    /**
     * 开关手势：on=true 挂监听，on=false **逐个摘掉**。
     * 只靠一个布尔值判断「要不要响应」在真机上不够硬（页面里可能有多个 document），
     * 所以关掉时连监听都不留 —— 这样「关了就是关了」，不存在还能滑开。
     */
    function setGestureEnabled(on) {
      var targets = gestureTargets.slice();
      for (var i = 0; i < targets.length; i++) detachGesture(targets[i]);
      gestureTargets.length = 0;
      gestureOn = Boolean(on);
      gesture = null;
      if (!gestureOn) return;
      var docs = gestureDocs();
      for (var j = 0; j < docs.length; j++) attachGesture(docs[j]);
    }

    // 没配中转时多一个 ⚙：点开就是配置表单，完全不依赖 F12
    if (!relayBase()) {
      gearEl = doc.createElement('button');
      gearEl.className = 'mk-iirose-gear';
      gearEl.type = 'button';
      gearEl.title = '配置中转地址（不用开 F12）';
      gearEl.textContent = '⚙';
      gearEl.addEventListener('click', showSetup);
      (doc.body || doc.documentElement).appendChild(gearEl);
    }

    var spec = parseHotkey(ls(LS.hotkey, 'Alt+T'));
    function onHotkey(ev) {
      if (!matchHotkey(ev, spec)) return;
      ev.preventDefault();
      ev.stopPropagation();
      try {
        panel.toggle();
      } catch (e) {
        diag.lastError = String(e && e.message);
      }
    }
    doc.addEventListener('keydown', onHotkey, true);

    observeRoom(locateApp());

    diag.api = apiBase();
    diag.relay = relayBase();
    diag.mounted = true;
    diag.state = 'ready';
    diag.socketOk = Boolean(locateApp());
    diag.instances = window.__MUSIC_IIROSE_LOADS__ || 1;
    diag.gestureOn = gestureOn;
    diag.settings = {
      ball: panelSettings.ball !== false,
      gesture: panelSettings.gesture !== false,
    };
    /**
     * 换版 / 重复注入时的拆除钩子：新版会先调它，把这一套连监听一起清掉，
     * 免得出现「旧脚本还在响应双指上滑」。
     */
    diag.destroy = function () {
      try {
        setGestureEnabled(false);
      } catch (e) {
        /* 忽略 */
      }
      try {
        doc.removeEventListener('keydown', onHotkey, true);
      } catch (e) {
        /* 忽略 */
      }
      try {
        panel.dispose();
      } catch (e) {
        /* 忽略 */
      }
      [hostEl, ballEl, gearEl].forEach(function (el) {
        try {
          if (el && el.parentNode) el.parentNode.removeChild(el);
        } catch (e) {
          /* 忽略 */
        }
      });
      diag.mounted = false;
      diag.state = 'disposed';
    };
    // 留一个抓手：DevTools 里 __MUSIC_IIROSE__.panel.open() 能直接开面板
    diag.panel = panel;
    window.__MUSIC_IIROSE__ = diag;
    log('已就绪 v' + VERSION + '：' + HINT + '；接口=' + diag.api + '；socket=' + diag.socketOk);
  }

  // 面板源码里已经带了 copyDirective 需要的上下文，但复制指令挂在面板外：
  // 这里把兜底复制能力也挂到全局，方便 DevTools 里手动救急。
  window.__musicIroseCopyDirective = copyDirective;
  window.__musicIroseSetup = showSetup;

  try {
    mount();
  } catch (err) {
    diag.state = 'error';
    diag.lastError = String((err && err.message) || err);
    window.__MUSIC_IIROSE__ = diag;
    console.error('[music-iirose] 启动失败：' + diag.lastError);
  }
})();
