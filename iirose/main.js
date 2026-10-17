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

  // 幂等：同一个页面被重复注入（改 URL 后没刷新、脚本列表里贴了两遍）时不挂第二套。
  if (window.__MUSIC_IIROSE__ && window.__MUSIC_IIROSE__.mounted) return;

  // 面板源码不在运行时注入：构建脚本把它拼在这个文件前面，直接就是同一个 <script>。
  // 这样不依赖「内联 <script> 能不能执行」——很多站点的 CSP 会拦 inline，但不会拦 <script src>。

  var API_DEFAULT = 'https://api.shadowsee.icu';
  var LS = {
    api: 'mk_iirose_api',
    hotkey: 'mk_iirose_hotkey',
    mode: 'mk_iirose_mode',
  };
  var CARD_PREFIX = 'm__4@0>'; // @0 = 网易云
  var HINT = 'Alt+T 开 / 关 · 点 ▶ 发到房间';

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

  // ---------------------------------------------------------------- ShadowSee

  function request(path, params) {
    var qs = [];
    for (var k in params) {
      if (Object.prototype.hasOwnProperty.call(params, k) && params[k] != null) {
        qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
      }
    }
    var url = apiBase() + path + (qs.length ? '?' + qs.join('&') : '');
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () {
      if (ctrl) ctrl.abort();
    }, 12000);
    return fetch(url, {
      method: 'GET',
      // 这个接口对 iirose.com 回显了 ACAO，不需要也不该带 cookie
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

  function search(opts) {
    var platform = (opts && opts.platform) || 'netease';
    if (platform !== 'netease') return Promise.reject(new Error('IIROSE 版只接了网易云：' + platform));
    var keyword = String((opts && opts.keyword) || '').trim();
    if (!keyword) return Promise.resolve([]);
    var limit = Math.min(30, Math.max(1, Number(opts.limit) || 20));
    return request('/cloudsearch', { keywords: keyword, type: 1, limit: limit }).then(function (json) {
      var songs = (json && json.result && json.result.songs) || [];
      return songs.map(normalize);
    });
  }

  function songUrl(opts) {
    var id = String((opts && opts.id) || '');
    if (!id) return Promise.resolve({ playable: false, reason: 'no-id', note: '缺少歌曲 id' });
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

  /** 点播两帧：先媒体数据（真正入队），再卡片（公屏可见）。返回发出去的内容，方便测试断言。 */
  function buildFrames(song, info, app) {
    var color = (app && app.inputcolorhex) || '#ff9800';
    var artist = (song.artists || []).join(' & ');
    var cover = https(song.cover || '');
    var link = song.url || '';
    var bitrate = Math.round((Number(info && info.bitrate) || 320000) / 1000);

    var media =
      '&1' +
      JSON.stringify({
        s: String(info.streamUrl).slice(4), // https://x → s://x
        d: Math.round((Number(song.durationMs) || 0) / 1000),
        c: cover.slice(4),
        n: song.title,
        r: artist,
        b: '@0',
        o: link.slice(4),
        l: null,
      });

    var card =
      CARD_PREFIX +
      [enc(song.title), enc(artist), enc(cover), enc(color), bitrate].join('>');

    var payload = { m: card, mc: color, i: msgId() };
    if (app && app.uid) payload.g = app.uid;

    return [media, JSON.stringify(payload)];
  }

  function enqueue(song, info) {
    var app = locateApp();
    if (!app || !app.socket) {
      throw new Error('找不到房间连接：请先进房间并确认已登录（F5 之后再试）');
    }
    var frames = buildFrames(song, info, app);
    app.socket.send(frames[0]);
    app.socket.send(frames[1]);
    diag.framesSent += 2;
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

  // ---------------------------------------------------------------- 启动

  var panel = null;
  var hostEl = null;
  var ballEl = null;

  function ensureCss(doc) {
    if (doc.querySelector('style[data-music-iirose]')) return;
    var style = doc.createElement('style');
    style.setAttribute('data-music-iirose', '1');
    style.textContent = [
      '.mk-iirose-ball{position:fixed;right:18px;bottom:18px;z-index:2147482990;width:52px;height:52px;',
      'border-radius:50%;border:1px solid #2f6ea8;background:#173a5e;color:#cfe6ff;font-size:18px;',
      'cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.45);font-family:inherit}',
      '.mk-iirose-ball:hover{background:#1d4a76}',
      '.mk-iirose-ball.mk-room{box-shadow:0 0 0 3px rgba(126,224,184,.35),0 8px 24px rgba(0,0,0,.45)}',
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
        return Promise.resolve([{ id: 'netease', label: '网易云音乐', home: 'https://music.163.com/' }]);
      },
      search: search,
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
      onEnqueue: function (song, info) {
        enqueue(song, info);
      },
      onFallback: copyDirective,
      onModeChange: function (m) {
        lsSet(LS.mode, m);
      },
    });

    // 悬浮球：浏览器抢走 Alt+T（Firefox 的工具栏）时的兜底入口
    ballEl = doc.createElement('button');
    ballEl.className = 'mk-iirose-ball';
    ballEl.type = 'button';
    ballEl.title = '点歌台（' + HINT + '）';
    ballEl.textContent = '♪';
    ballEl.addEventListener('click', function () {
      try {
        panel.toggle();
      } catch (e) {
        diag.lastError = String(e && e.message);
      }
    });
    (doc.body || doc.documentElement).appendChild(ballEl);

    var spec = parseHotkey(ls(LS.hotkey, 'Alt+T'));
    doc.addEventListener(
      'keydown',
      function (ev) {
        if (!matchHotkey(ev, spec)) return;
        ev.preventDefault();
        ev.stopPropagation();
        try {
          panel.toggle();
        } catch (e) {
          diag.lastError = String(e && e.message);
        }
      },
      true,
    );

    observeRoom(locateApp());

    diag.api = apiBase();
    diag.mounted = true;
    diag.state = 'ready';
    diag.socketOk = Boolean(locateApp());
    // 留一个抓手：DevTools 里 __MUSIC_IIROSE__.panel.open() 能直接开面板
    diag.panel = panel;
    window.__MUSIC_IIROSE__ = diag;
    log('已就绪 v' + VERSION + '：' + HINT + '；接口=' + diag.api + '；socket=' + diag.socketOk);
  }

  // 面板源码里已经带了 copyDirective 需要的上下文，但复制指令挂在面板外：
  // 这里把兜底复制能力也挂到全局，方便 DevTools 里手动救急。
  window.__musicIroseCopyDirective = copyDirective;

  try {
    mount();
  } catch (err) {
    diag.state = 'error';
    diag.lastError = String((err && err.message) || err);
    window.__MUSIC_IIROSE__ = diag;
    console.error('[music-iirose] 启动失败：' + diag.lastError);
  }
})();
