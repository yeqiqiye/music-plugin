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
    relay: 'mk_iirose_relay',
  };
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
    if (!keyword) return Promise.resolve([]);
    var limit = Math.min(30, Math.max(1, Number(opts.limit) || 20));
    var page = Math.max(1, Number((opts && opts.page) || 1));
    var base = relayBase();

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

  function songUrl(opts) {
    var platform = (opts && opts.platform) || 'netease';
    var id = String((opts && opts.id) || '');
    if (!id) return Promise.resolve({ playable: false, reason: 'no-id', note: '缺少歌曲 id' });
    var base = relayBase();

    if (base) {
      return request('/playurl', { platform: platform, id: id }, base).then(function (out) {
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

  /** 点播两帧：先媒体数据（真正入队），再卡片（公屏可见）。返回发出去的内容，方便测试断言。 */
  function buildFrames(song, info, app) {
    var color = (app && app.inputcolorhex) || '#ff9800';
    var artist = (song.artists || []).join(' & ');
    var cover = https(song.cover || '');
    var link = song.url || '';
    var bitrate = Math.round((Number(info && info.bitrate) || 320000) / 1000);
    // 对端客户端靠这个标记决定卡片图标/来源；酷狗 @4、B 站用通用音乐 =0
    var mark = TYPE_MARK[song.platform] || '@0';

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

    var card =
      'm__4' +
      mark +
      '>' +
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
      '.mk-iirose-ball{position:fixed;right:18px;bottom:18px;z-index:2147482990;width:52px;height:52px;',
      'border-radius:50%;border:1px solid #2f6ea8;background:#173a5e;color:#cfe6ff;font-size:18px;',
      'cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.45);font-family:inherit}',
      '.mk-iirose-ball:hover{background:#1d4a76}',
      '.mk-iirose-ball.mk-room{box-shadow:0 0 0 3px rgba(126,224,184,.35),0 8px 24px rgba(0,0,0,.45)}',
      '.mk-iirose-gear{position:fixed;right:22px;bottom:82px;z-index:2147482990;width:34px;height:34px;',
      'border-radius:50%;border:1px solid #2b3444;background:#1e2836;color:#93a1b8;font-size:15px;',
      'cursor:pointer;font-family:inherit;line-height:1}',
      '.mk-iirose-gear:hover{color:#cfe6ff;border-color:#3f6ea8}',
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
    diag.relay = relayBase();
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
