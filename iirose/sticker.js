/*!
 * sticker-iirose —— IIROSE 表情包面板（独立脚本，和点歌台互不依赖）
 *
 * 为什么单独一个脚本：
 *   · 点歌台的包已经 240KB 了，表情这点功能不值得再塞进去；
 *   · 表情比点歌更容易踩房间规则，分开就能「只发给某几个人」或随时摘掉；
 *   · 两者只共享一个东西：中转地址（localStorage 的 mk_iirose_relay）和收藏（mk_stickers）。
 *
 * 用了什么：
 *   GET  <relay>/sticker?kw=猫          → { data: { source, items:[{send, thumb, title}] } }
 *   POST socket {"m":"<send>#e", mc, i} → IIROSE 按图片渲染（#e 是图片标记）
 *
 * Alt+E 开关；右下角 😀 也能开。构建：node scripts/build-sticker.mjs
 */
(function () {
  'use strict';

  var VERSION = '3.0.0';
  var LS = {
    relay: 'mk_iirose_relay',
    favs: 'mk_stickers',
    ball: 'mk_sticker_ball',
  };
  var FAV_MAX = 60;
  var GAP_MS = 2000;

  if (window.__MUSIC_STICKER__ && window.__MUSIC_STICKER__.version === VERSION) return;

  var diag = {
    version: VERSION,
    mounted: false,
    socketOk: false,
    relay: '',
    lastQuery: '',
    lastCount: 0,
    lastError: null,
    sent: 0,
    favourites: 0,
  };
  window.__MUSIC_STICKER__ = diag;

  function ls(key, dflt) {
    try {
      var v = window.localStorage.getItem(key);
      return v == null ? dflt : v;
    } catch (e) {
      return dflt;
    }
  }
  function lsSet(key, val) {
    try {
      window.localStorage.setItem(key, String(val));
    } catch (e) {
      /* 忽略 */
    }
  }

  function relayBase() {
    return String(ls(LS.relay, '') || '').trim().replace(/\/+$/, '');
  }

  // ---------------------------------------------------------------- 连接
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
      frames = frames.concat([].slice.call(document.querySelectorAll('iframe')));
    } catch (e) {
      /* 忽略 */
    }
    for (var i = 0; i < frames.length; i++) {
      try {
        var w = frames[i].contentWindow;
        if (w && w.socket && w.uid) return w;
      } catch (e) {
        /* 跨域 */
      }
    }
    return null;
  }

  function msgId() {
    return String(Date.now()) + String(Math.floor(Math.random() * 900) + 100);
  }

  function normColor(raw) {
    var s = String(raw == null ? '' : raw).replace(/^#/, '').replace(/[^0-9a-fA-F]/g, '');
    if (s.length === 3) s = s.charAt(0) + s.charAt(0) + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2);
    if (s.length >= 6) return s.slice(0, 6);
    return 'ff9800';
  }

  // ---------------------------------------------------------------- 收藏
  function loadFavs() {
    try {
      var arr = JSON.parse(ls(LS.favs, '[]') || '[]');
      return Array.isArray(arr) ? arr.filter(function (x) { return x && x.send; }).slice(0, FAV_MAX) : [];
    } catch (e) {
      return [];
    }
  }
  var favs = loadFavs();
  diag.favourites = favs.length;

  function saveFavs() {
    try {
      window.localStorage.setItem(LS.favs, JSON.stringify(favs.slice(0, FAV_MAX)));
    } catch (e) {
      /* 忽略 */
    }
    diag.favourites = favs.length;
  }

  function addFav(it) {
    if (!it || !it.send) return false;
    for (var i = 0; i < favs.length; i++) if (favs[i].send === it.send) return false;
    favs.unshift({ send: it.send, thumb: it.thumb || '', title: it.title || '', t: Date.now() });
    if (favs.length > FAV_MAX) favs = favs.slice(0, FAV_MAX);
    saveFavs();
    return true;
  }

  // ---------------------------------------------------------------- 样式
  function injectCss() {
    if (document.querySelector('style[data-sticker-panel]')) return;
    var css = [
      '.sk-root{position:fixed;inset:0;z-index:2147482000;display:none;align-items:center;justify-content:center;background:rgba(6,9,13,.55)}',
      '.sk-root.sk-open{display:flex}',
      '.sk-card{width:min(560px,94vw);height:min(620px,86vh);display:flex;flex-direction:column;',
      '  background:#111820;color:#e8eef5;border:1px solid rgba(255,255,255,.14);border-radius:14px;overflow:hidden;',
      '  box-shadow:0 20px 60px rgba(0,0,0,.5);font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}',
      '.sk-head{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.1)}',
      '.sk-title{font-weight:700}',
      '.sk-title small{display:block;font-weight:400;font-size:11px;opacity:.6}',
      '.sk-right{margin-left:auto;display:flex;gap:6px;align-items:center}',
      '.sk-btn{background:#1b2530;color:inherit;border:1px solid rgba(255,255,255,.16);border-radius:8px;',
      '  padding:5px 10px;font-size:12px;cursor:pointer}',
      '.sk-btn:hover{border-color:#4a8fd6}',
      '.sk-btn.sk-primary{background:#1d4a76;border-color:#2f6ea8}',
      '.sk-bar{display:flex;gap:8px;padding:10px 14px 6px}',
      '.sk-input{flex:1;min-width:0;background:#0d141b;color:inherit;border:1px solid rgba(255,255,255,.16);',
      '  border-radius:8px;padding:8px 11px;font-size:13px;outline:none}',
      '.sk-input:focus{border-color:#4a8fd6}',
      '.sk-body{flex:1;overflow:auto;padding-bottom:12px}',
      '.sk-sect{padding:8px 14px 0;font-size:12px;opacity:.62}',
      '.sk-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:8px;padding:8px 12px}',
      '.sk-item{position:relative;border:1px solid rgba(255,255,255,.12);border-radius:10px;overflow:hidden;',
      '  background:#0d141b;aspect-ratio:1/1;cursor:pointer;padding:0}',
      '.sk-item:hover{border-color:#4a8fd6}',
      '.sk-item img{width:100%;height:100%;object-fit:cover;display:block}',
      '.sk-corner{position:absolute;right:3px;top:3px;width:22px;height:22px;border-radius:7px;',
      '  background:rgba(8,12,18,.62);color:#fff;border:1px solid rgba(255,255,255,.2);font-size:12px;',
      '  line-height:20px;text-align:center;padding:0;cursor:pointer}',
      '.sk-empty{padding:16px;font-size:12.5px;opacity:.66;line-height:1.7}',
      '.sk-stat{margin-top:auto;padding:8px 14px;border-top:1px solid rgba(255,255,255,.1);font-size:12px;opacity:.72}',
      '.sk-ball{position:fixed;right:18px;bottom:88px;width:52px;height:52px;border-radius:50%;',
      '  background:#1d4a76;color:#fff;border:1px solid rgba(255,255,255,.2);font-size:24px;line-height:50px;',
      '  text-align:center;cursor:grab;z-index:2147481000;box-shadow:0 8px 24px rgba(0,0,0,.45);user-select:none;',
      '  touch-action:none}',
      '.sk-ball:active{cursor:grabbing}',
      '@media (max-width:640px){.sk-card{width:96vw;height:82dvh}.sk-grid{grid-template-columns:repeat(auto-fill,minmax(80px,1fr))}}',
    ].join('\n');
    var st = document.createElement('style');
    st.setAttribute('data-sticker-panel', '1');
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  // ---------------------------------------------------------------- UI
  var state = { open: false, kw: '', items: [], source: '', busy: false, lastAt: 0 };
  var els = {};

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function setStat(text) {
    if (els.stat) els.stat.textContent = text || '';
  }

  function tile(it, i, kind) {
    var corner =
      kind === 'fav'
        ? '<button class="sk-corner" data-sk="unfav" data-i="' + i + '" title="删掉">✕</button>'
        : '<button class="sk-corner" data-sk="fav" data-i="' + i + '" title="收藏">☆</button>';
    return (
      '<div class="sk-item" data-sk="send" data-kind="' + kind + '" data-i="' + i + '" title="点一下发到房间">' +
      '<img src="' + esc(it.thumb || it.url || '') + '" alt="" loading="lazy" referrerpolicy="no-referrer">' +
      corner +
      '</div>'
    );
  }

  function render() {
    if (!els.body) return;
    var relay = relayBase();
    var favHtml = favs.length
      ? '<div class="sk-sect">收藏（' + favs.length + '）</div><div class="sk-grid">' +
        favs.map(function (it, i) { return tile(it, i, 'fav'); }).join('') +
        '</div>'
      : '';
    var body;
    if (!relay) {
      body =
        '<div class="sk-empty">还没配中转地址。<br>点右上角「中转」，粘上你的中转地址（和点歌台用同一个）。</div>';
    } else if (state.items.length) {
      body =
        '<div class="sk-sect">结果' + (state.source ? ' · 来自 ' + esc(state.source) : '') + '（' + state.items.length + ' 张）</div>' +
        '<div class="sk-grid">' + state.items.map(function (it, i) { return tile(it, i, 'res'); }).join('') + '</div>';
    } else {
      body =
        '<div class="sk-empty">输个关键词搜一张试试：<b>猫</b> / <b>开心</b> / <b>无语</b> / <b>狗头</b>。<br>' +
        '点一张就发到房间（' + GAP_MS / 1000 + ' 秒一张，防刷屏）。</div>';
    }
    els.body.innerHTML = favHtml + body;
  }

  function open() {
    if (!els.root) return;
    els.root.classList.add('sk-open');
    state.open = true;
    render();
    if (els.kw && els.kw.focus) {
      try { els.kw.focus(); } catch (e) { /* 手机可能不给焦点 */ }
    }
  }

  function close() {
    if (!els.root) return;
    els.root.classList.remove('sk-open');
    state.open = false;
  }

  function toggle() {
    if (state.open) close();
    else open();
  }

  // ---------------------------------------------------------------- 搜索 / 发送
  function search() {
    var relay = relayBase();
    if (!relay) {
      setStat('先点右上角「中转」配一下地址');
      return;
    }
    var kw = String((els.kw && els.kw.value) || '').trim();
    if (!kw) {
      setStat('先输个关键词');
      return;
    }
    state.kw = kw;
    diag.lastQuery = kw;
    setStat('正在搜：' + kw);
    var url = relay + '/sticker?kw=' + encodeURIComponent(kw) + '&page=1';
    fetch(url, { credentials: 'omit' })
      .then(function (r) {
        return r.json();
      })
      .then(function (out) {
        if (!out || out.ok !== true) throw new Error((out && out.error) || '中转返回异常');
        var data = out.data || {};
        state.items = data.items || [];
        state.source = data.source || '';
        diag.lastCount = state.items.length;
        render();
        setStat(state.items.length ? '找到 ' + state.items.length + ' 张 · 点一下发到房间' : '没搜到，换个词试试');
      })
      .catch(function (e) {
        diag.lastError = String((e && e.message) || e);
        setStat('搜索失败：' + diag.lastError);
      });
  }

  function send(it) {
    if (!it || !it.send) return;
    var now = Date.now();
    if (now - state.lastAt < GAP_MS) {
      setStat('慢一点：' + GAP_MS / 1000 + ' 秒一张（防刷屏）');
      return;
    }
    var app = locateApp();
    if (!app || !app.socket) {
      setStat('找不到房间连接：先进房间再试');
      return;
    }
    try {
      var color = normColor(app.inputcolorhex);
      app.socket.send(JSON.stringify({ m: it.send + '#e', mc: color, i: msgId() }));
      state.lastAt = now;
      diag.sent += 1;
      diag.socketOk = true;
      if (addFav(it)) render();
      setStat('已发到房间' + (it.title ? '：' + it.title : ''));
    } catch (e) {
      setStat('发送失败：' + String((e && e.message) || e));
    }
  }

  // ---------------------------------------------------------------- 中转设置
  function setupRelay() {
    var cur = relayBase();
    var val = window.prompt('中转地址（和点歌台填同一个，留空则清空）', cur);
    if (val === null) return;
    var v = String(val).trim().replace(/\/+$/, '');
    if (v && !/^https?:\/\//i.test(v)) {
      setStat('要以 http(s):// 开头');
      return;
    }
    lsSet(LS.relay, v);
    diag.relay = v;
    setStat(v ? '已保存中转地址' : '已清空中转地址');
    render();
  }

  // ---------------------------------------------------------------- 挂载
  function mount() {
    injectCss();
    var root = document.createElement('div');
    root.className = 'sk-root';
    root.innerHTML =
      '<div class="sk-card">' +
      '<div class="sk-head"><div class="sk-title">表情包<small>Alt+E 开关 · 点一张就发到房间</small></div>' +
      '<div class="sk-right"><button class="sk-btn" data-sk="relay">中转</button>' +
      '<button class="sk-btn" data-sk="close">✕</button></div></div>' +
      '<div class="sk-bar"><input class="sk-input" data-sk="kw" type="search" placeholder="搜表情：猫 / 开心 / 无语…" autocomplete="off">' +
      '<button class="sk-btn sk-primary" data-sk="search">搜</button></div>' +
      '<div class="sk-body" data-sk="body"></div>' +
      '<div class="sk-stat" data-sk="stat"></div>' +
      '</div>';
    document.body.appendChild(root);

    var ball = document.createElement('div');
    ball.className = 'sk-ball';
    ball.title = '表情包（Alt+E）';
    ball.textContent = '😀';
    document.body.appendChild(ball);

    els = {
      root: root,
      body: root.querySelector('[data-sk=body]'),
      kw: root.querySelector('[data-sk=kw]'),
      stat: root.querySelector('[data-sk=stat]'),
      ball: ball,
    };

    root.addEventListener('click', function (ev) {
      var t = ev.target && ev.target.closest ? ev.target.closest('[data-sk]') : null;
      if (!t) {
        // 点卡片外面关掉
        if (ev.target === root) close();
        return;
      }
      var act = t.getAttribute('data-sk');
      if (act === 'close') return close();
      if (act === 'relay') return setupRelay();
      if (act === 'search') return search();
      if (act === 'send') {
        var kind = t.getAttribute('data-kind');
        var idx = Number(t.getAttribute('data-i'));
        return send(kind === 'fav' ? favs[idx] : state.items[idx]);
      }
      if (act === 'fav') {
        if (addFav(state.items[Number(t.getAttribute('data-i'))])) {
          render();
          setStat('已收藏这张');
        }
        return;
      }
      if (act === 'unfav') {
        favs.splice(Number(t.getAttribute('data-i')), 1);
        saveFavs();
        render();
        setStat('已从收藏里删掉');
      }
    });

    els.kw.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        search();
      }
    });

    // 球：可拖动 + 点击开关
    var dragging = false;
    var moved = false;
    var offX = 0;
    var offY = 0;
    ball.addEventListener('pointerdown', function (ev) {
      dragging = true;
      moved = false;
      var r = ball.getBoundingClientRect();
      offX = (ev.clientX || 0) - r.left;
      offY = (ev.clientY || 0) - r.top;
      ball.style.left = r.left + 'px';
      ball.style.top = r.top + 'px';
      ball.style.right = 'auto';
      ball.style.bottom = 'auto';
      try { ball.setPointerCapture(ev.pointerId); } catch (e) { /* 忽略 */ }
      ev.preventDefault();
    });
    ball.addEventListener('pointermove', function (ev) {
      if (!dragging) return;
      moved = true;
      var x = Math.min(window.innerWidth - 56, Math.max(4, (ev.clientX || 0) - offX));
      var y = Math.min(window.innerHeight - 56, Math.max(4, (ev.clientY || 0) - offY));
      ball.style.left = x + 'px';
      ball.style.top = y + 'px';
    });
    ball.addEventListener('pointerup', function () {
      if (!dragging) return;
      dragging = false;
      if (!moved) toggle();
    });

    document.addEventListener('keydown', function (ev) {
      if (ev.altKey && (ev.key === 'e' || ev.key === 'E')) {
        ev.preventDefault();
        toggle();
      }
    });

    diag.mounted = true;
    diag.relay = relayBase();
    diag.socketOk = Boolean(locateApp());
    render();
    setStat('Alt+E 开关 · 右下角 😀 也能开');
  }

  try {
    mount();
  } catch (e) {
    diag.lastError = String((e && e.message) || e);
    console.error('[sticker-iirose] 启动失败：' + diag.lastError);
  }
})();
