/*! music-iirose v0.3.5 —— IIROSE 点歌台（构建产物，别直接改；源码 iirose/main.js + client/panel-ui.js） */
/*! music-iirose v0.3.5 —— IIROSE 点歌台（构建产物，别直接改；源码 iirose/main.js + client/panel-ui.js） */
;/**
 * 点歌面板 UI —— 纯 DOM，不依赖 React / 任何外部库。
 *
 * 为什么不用 React：插件里确实能 require('react')，但这段 UI 的主体是「表单 + 列表」，
 * 用原生 DOM 更短、更容易在浏览器里单独跑（dev/server.mjs 就把它原样发给页面），
 * 出问题时也能直接 DevTools 调试，不需要一层构建。
 *
 * 对外只暴露一个挂载函数：
 *   const panel = mountMusicPanel(container, { api: { search, platforms, login, session, logout } })
 *   panel.open() / panel.close() / panel.dispose()
 * `api` 刻意做成注入的：dev 版打本地 /api/*，插件版打 DSH web server 的 /music/api/*。
 */
(function (global) {
  'use strict';

  const PLATFORM_FALLBACK = [
    { id: 'netease', label: '网易云音乐', home: 'https://music.163.com/' },
    { id: 'kugou', label: '酷狗音乐', home: 'https://www.kugou.com/' },
    { id: 'qq', label: 'QQ 音乐', home: 'https://y.qq.com/' },
    { id: 'bilibili', label: 'B 站（Live / MV）', home: 'https://www.bilibili.com/' },
  ];

  const CSS = `
.mk-root{position:fixed;inset:0;z-index:2147483000;display:none;align-items:center;justify-content:center;
  font:14px/1.6 "Microsoft YaHei","PingFang SC","Segoe UI",system-ui,sans-serif;color:var(--mk-fg,#e9eef7)}
.mk-root.mk-open{display:flex}
/* ---- 外观设置：主题 / 强调色 / 毛玻璃 / 紧凑 ---- */
.mk-root[data-theme=light]{--mk-bg:#f6f8fc;--mk-fg:#1b2432;--mk-dim:#5f6d82;--mk-line:#d7dfea;
  --mk-input:#fff;--mk-btn:#eef2f8;--mk-accent:#2f6ea8}
.mk-root[data-accent=teal]{--mk-accent:#2fb59a}
.mk-root[data-accent=violet]{--mk-accent:#8a7cf0}
.mk-root[data-accent=pink]{--mk-accent:#e26aa8}
.mk-root[data-accent=blue]{--mk-accent:#4a8fd6}
.mk-root.mk-glass .mk-backdrop{backdrop-filter:blur(12px);background:rgba(6,9,14,.42)}
.mk-root.mk-glass .mk-card{backdrop-filter:blur(18px)}
.mk-root.mk-compact .mk-song{padding:4px 10px}
.mk-root.mk-compact .mk-sub{font-size:11px}
.mk-root .mk-tab.mk-on,.mk-root .mk-scope.mk-on{border-color:var(--mk-accent,#2f6ea8)}
.mk-root .mk-input:focus,.mk-root .mk-entity:hover{border-color:var(--mk-accent,#2f6ea8)}
.mk-root .mk-song.mk-playing{border-color:var(--mk-accent,#2f6ea8)}
.mk-root .mk-pager button:hover:not(:disabled){border-color:var(--mk-accent,#2f6ea8)}
.mk-backdrop{position:absolute;inset:0;background:rgba(6,9,14,.62);backdrop-filter:blur(3px)}
.mk-card{position:relative;width:min(1000px,94vw);height:min(720px,90vh);display:flex;flex-direction:column;
  background:var(--mk-bg,#141a24);border:1px solid var(--mk-line,#2b3444);border-radius:16px;overflow:hidden;
  box-shadow:0 24px 70px rgba(0,0,0,.55)}
.mk-head{display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid var(--mk-line,#2b3444)}
.mk-title{font-size:16px;font-weight:700;letter-spacing:.3px}
.mk-title small{display:block;font-size:11px;font-weight:400;color:var(--mk-dim,#93a1b8);letter-spacing:0}
.mk-right{margin-left:auto;display:flex;gap:8px;align-items:center}
.mk-btn{background:var(--mk-btn,#202a39);color:inherit;border:1px solid var(--mk-line,#2b3444);border-radius:9px;
  padding:6px 12px;font-size:13px;cursor:pointer;transition:.12s}
.mk-btn:hover{border-color:#3f6ea8;background:#26344a}
.mk-btn.mk-primary{background:#173a5e;border-color:#2f6ea8;color:#cfe6ff}
.mk-btn.mk-ghost{background:transparent}
.mk-close{font-size:18px;line-height:1;padding:4px 10px}
.mk-search{display:flex;gap:10px;padding:14px 16px 10px;flex-wrap:wrap;align-items:center}
.mk-input{flex:1 1 260px;min-width:180px;background:var(--mk-input,#1b2432);color:inherit;
  border:1px solid var(--mk-line,#2b3444);border-radius:10px;padding:10px 13px;font-size:14px;outline:none}
.mk-input:focus{border-color:#3f6ea8}
.mk-select{background:var(--mk-input,#1b2432);color:inherit;border:1px solid var(--mk-line,#2b3444);
  border-radius:10px;padding:10px 12px;font-size:13px;outline:none}
.mk-tabs{display:flex;gap:6px;padding:0 16px 10px;flex-wrap:wrap;border-bottom:1px solid var(--mk-line,#2b3444)}
.mk-tab{background:transparent;color:var(--mk-dim,#93a1b8);border:1px solid transparent;border-radius:8px;
  padding:6px 12px;font-size:13px;cursor:pointer}
.mk-tab:hover{color:var(--mk-fg,#e9eef7);background:#1c2533}
.mk-tab.mk-on{color:#cfe6ff;background:#17324f;border-color:#2f6ea8}
.mk-body{flex:1;overflow:auto;padding:8px 10px 16px}
.mk-sect{display:flex;align-items:center;gap:8px;padding:10px 8px 6px;color:var(--mk-dim,#93a1b8);font-size:12px}
.mk-sect::after{content:"";flex:1;height:1px;background:var(--mk-line,#2b3444)}
.mk-song{display:flex;gap:12px;align-items:center;padding:9px 10px;border-radius:10px;border:1px solid transparent}
.mk-song:hover{background:#1a2230;border-color:var(--mk-line,#2b3444)}
.mk-song.mk-clickable{cursor:pointer}
.mk-idx{width:26px;text-align:right;color:var(--mk-dim,#93a1b8);font-size:12px;flex:none}
.mk-meta{flex:1;min-width:0}
.mk-name{font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mk-sub{font-size:12px;color:var(--mk-dim,#93a1b8);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mk-tag{font-size:10px;border:1px solid var(--mk-line,#2b3444);border-radius:20px;padding:1px 7px;color:var(--mk-dim,#93a1b8);flex:none}
.mk-tag.mk-free{color:#7ee0b8;border-color:#2c5f4c}
.mk-tag.mk-vip{color:#ffd479;border-color:#6b5626}
.mk-acts{display:flex;gap:6px;flex:none}
.mk-acts a,.mk-acts button{font-size:12px;text-decoration:none;color:inherit;border:1px solid var(--mk-line,#2b3444);
  border-radius:8px;padding:4px 10px;background:#1e2836;cursor:pointer;font-family:inherit}
.mk-acts a:hover,.mk-acts button:hover{border-color:#3f6ea8;background:#26344a}
.mk-song.mk-playing{background:#16304a;border-color:#2f6ea8}
.mk-play{width:30px;height:30px;flex:none;border-radius:50%;border:1px solid var(--mk-line,#2b3444);
  background:#1e2836;color:inherit;font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:center}
.mk-play:hover{border-color:#3f6ea8;background:#26344a}
.mk-play.mk-busy{opacity:.55;cursor:wait}
.mk-play.mk-locked{opacity:.45;cursor:not-allowed}
.mk-player{display:flex;align-items:center;gap:10px;padding:9px 16px;border-top:1px solid var(--mk-line,#2b3444);
  background:#101720;flex-wrap:wrap}
.mk-player .mk-ctl{width:32px;height:32px;border-radius:50%;border:1px solid var(--mk-line,#2b3444);
  background:#1e2836;color:inherit;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;flex:none}
.mk-player .mk-ctl:hover{border-color:#3f6ea8;background:#26344a}
.mk-player .mk-ctl.mk-main{background:#173a5e;border-color:#2f6ea8;color:#cfe6ff;width:36px;height:36px}
.mk-now{flex:1 1 150px;min-width:110px;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mk-now small{display:block;color:var(--mk-dim,#93a1b8);font-size:11.5px}
.mk-seek{flex:2 1 190px;display:flex;align-items:center;gap:8px;min-width:150px}
.mk-seek input[type=range]{flex:1;accent-color:#4a8fd6}
.mk-time{font-size:11.5px;color:var(--mk-dim,#93a1b8);font-variant-numeric:tabular-nums;flex:none;min-width:80px;text-align:right}
.mk-vol{display:flex;align-items:center;gap:6px;flex:none;color:var(--mk-dim,#93a1b8);font-size:12px}
.mk-vol input[type=range]{width:70px;accent-color:#4a8fd6}
.mk-queuebadge{font-size:10px;color:#7ee0b8;border:1px solid #2c5f4c;border-radius:20px;padding:1px 6px;flex:none}
.mk-empty{padding:34px 16px;text-align:center;color:var(--mk-dim,#93a1b8);font-size:13px}
.mk-err{margin:8px 10px;padding:10px 12px;border-radius:10px;background:#3a1f22;border:1px solid #6b3238;color:#ffc9cf;font-size:13px}
.mk-stat{padding:6px 16px;border-top:1px solid var(--mk-line,#2b3444);color:var(--mk-dim,#93a1b8);font-size:12px;display:flex;gap:14px;align-items:center}
.mk-load{display:inline-block;width:13px;height:13px;border:2px solid #3f6ea8;border-top-color:transparent;
  border-radius:50%;animation:mk-spin .7s linear infinite;vertical-align:-2px}
@keyframes mk-spin{to{transform:rotate(360deg)}}
.mk-login{padding:16px;max-width:560px}
.mk-login h3{margin:0 0 4px;font-size:15px}
.mk-login p.note{color:var(--mk-dim,#93a1b8);font-size:12.5px;margin:0 0 14px}
.mk-field{display:flex;flex-direction:column;gap:6px;margin-bottom:12px}
.mk-field label{font-size:12.5px;color:var(--mk-dim,#93a1b8)}
.mk-field textarea{min-height:96px;resize:vertical;font-family:ui-monospace,Consolas,monospace;font-size:12px;
  background:var(--mk-input,#1b2432);color:inherit;border:1px solid var(--mk-line,#2b3444);border-radius:10px;padding:10px}
.mk-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.mk-warn{background:#3a3320;border:1px solid #6b5a26;color:#ffe6a8;border-radius:10px;padding:9px 11px;font-size:12.5px;margin-bottom:12px}
.mk-pager{display:none;align-items:center;justify-content:center;gap:10px;padding:8px 16px;border-top:1px solid var(--mk-line,#2b3444);background:#0f161f;font-size:12.5px;color:var(--mk-dim,#93a1b8)}
.mk-pager.mk-on{display:flex}
.mk-pager button{font-size:12.5px;color:inherit;border:1px solid var(--mk-line,#2b3444);border-radius:8px;
  padding:4px 10px;background:#1e2836;cursor:pointer;font-family:inherit}
.mk-pager button:hover:not(:disabled){border-color:#3f6ea8;background:#26344a}
.mk-pager button:disabled{opacity:.4;cursor:not-allowed}
/* ---------- 搜用户 / 搜歌单（移动端批量点歌主要靠这块） ---------- */
.mk-scopes{display:flex;gap:6px;padding:0 16px 8px;overflow-x:auto;-webkit-overflow-scrolling:touch}
.mk-scope{background:transparent;color:var(--mk-dim,#93a1b8);border:1px solid var(--mk-line,#2b3444);
  border-radius:999px;padding:5px 13px;font-size:12.5px;cursor:pointer;white-space:nowrap;font-family:inherit;flex:none}
.mk-scope:hover{color:var(--mk-fg,#e9eef7)}
.mk-scope.mk-on{color:#cfe6ff;background:#17324f;border-color:#2f6ea8}
.mk-entity{display:flex;gap:12px;align-items:center;padding:10px;border-radius:10px;border:1px solid transparent;cursor:pointer}
.mk-entity:hover{background:#1a2230;border-color:var(--mk-line,#2b3444)}
.mk-cover{width:44px;height:44px;border-radius:9px;flex:none;object-fit:cover;background:#1e2836}
.mk-cover.mk-ph{display:flex;align-items:center;justify-content:center;color:#93a1b8;font-size:17px}
.mk-detail-head{display:flex;gap:12px;align-items:center;padding:10px 8px 12px;border-bottom:1px solid var(--mk-line,#2b3444);margin-bottom:8px}
.mk-detail-head .mk-cover{width:58px;height:58px}
.mk-detail-acts{display:flex;gap:8px;flex-wrap:wrap;margin-left:auto}
/* ---------- 设置页 ---------- */
.mk-set{padding:14px 16px 20px;max-width:620px}
.mk-set h3{margin:0 0 10px;font-size:15px}
.mk-set-group{margin-bottom:14px}
.mk-set-group h4{margin:0 0 6px;font-size:11.5px;color:var(--mk-dim,#93a1b8);font-weight:700;letter-spacing:.4px}
.mk-set-row{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--mk-line,#2b3444)}
.mk-set-row:last-child{border-bottom:0}
.mk-set-row .mk-meta{flex:1;min-width:0}
.mk-set-row b{display:block;font-weight:600;font-size:13.5px}
.mk-set-row small{display:block;color:var(--mk-dim,#93a1b8);font-size:11.5px;line-height:1.45}
.mk-sw{width:46px;height:26px;border-radius:999px;border:1px solid var(--mk-line,#2b3444);background:#1e2836;
  position:relative;cursor:pointer;flex:none;transition:.15s;padding:0}
.mk-sw::after{content:"";position:absolute;left:3px;top:3px;width:18px;height:18px;border-radius:50%;background:#93a1b8;transition:.15s}
.mk-sw.mk-on{background:var(--mk-accent,#2f6ea8);border-color:var(--mk-accent,#2f6ea8)}
.mk-sw.mk-on::after{left:23px;background:#fff}
.mk-chips{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 2px}
.mk-chip{border:1px solid var(--mk-line,#2b3444);border-radius:999px;padding:6px 12px;font-size:12.5px;background:#1e2836;
  color:inherit;cursor:pointer;font-family:inherit}
.mk-chip.mk-on{border-color:var(--mk-accent,#2f6ea8);color:#eaf3ff}
.mk-chip .dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px;vertical-align:1px}
.mk-set .mk-note{color:var(--mk-dim,#93a1b8);font-size:11.5px;margin:8px 0 0;line-height:1.5}
@media (max-width:640px){
  /* 手机上是「底部抽屉」：占中长高度，不再铺满整屏 */
  .mk-root{align-items:flex-end}
  .mk-card{width:100vw;height:min(74dvh,680px);min-height:360px;border-radius:18px 18px 0 0;border-bottom:0;
    box-shadow:0 -12px 40px rgba(0,0,0,.5)}
  .mk-card::before{content:"";position:absolute;left:50%;top:7px;transform:translateX(-50%);width:44px;height:4px;
    border-radius:2px;background:var(--mk-line,#3a4657);opacity:.9}
  .mk-head{padding:16px 12px 10px;gap:8px}
  .mk-title{font-size:15px}
  .mk-title small{display:none}
  .mk-search{padding:8px 12px 6px;gap:8px}
  .mk-input{flex:1 1 100%;min-width:0;padding:11px 13px;font-size:16px}
  .mk-tabs,.mk-scopes{padding-left:12px;padding-right:12px}
  .mk-body{padding:6px 6px 14px}
  .mk-song{padding:10px 6px;gap:9px}
  .mk-play{width:36px;height:36px;font-size:13px}
  .mk-idx{width:18px}
  .mk-acts a{display:none}
  .mk-acts button{padding:7px 9px;font-size:12px}
  .mk-player{padding:8px 10px}
  .mk-seek,.mk-vol{display:none}
  .mk-pager{padding:10px}
  .mk-pager button{padding:9px 16px;font-size:13px}
  .mk-detail-head{flex-wrap:wrap}
  .mk-detail-acts{margin-left:0;width:100%}
  .mk-entity{padding:12px 8px}
  .mk-cover{width:48px;height:48px}
}
`;

  function injectCss(doc) {
    if (doc.querySelector('style[data-music-panel]')) return;
    const style = doc.createElement('style');
    style.setAttribute('data-music-panel', '1');
    style.textContent = CSS;
    doc.head.appendChild(style);
  }

  const esc = (s) =>
    String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const fmtDur = (msv) => {
    if (!Number.isFinite(msv) || msv <= 0) return '';
    const total = Math.round(msv / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m + ':' + String(s).padStart(2, '0');
  };

  function mountMusicPanel(container, options) {
    const opts = options || {};
    const doc = container.ownerDocument || document;
    const api = opts.api || {};
    injectCss(doc);

    const root = doc.createElement('div');
    root.className = 'mk-root';
    root.innerHTML = `
      <div class="mk-backdrop"></div>
      <div class="mk-card" role="dialog" aria-label="点歌台">
        <div class="mk-head">
          <div class="mk-title">点歌台 <span data-el="ver" style="font-size:11px;color:#7ee0b8;font-weight:600"></span> <small>Alt+T 开 / 关 · Esc 关闭 · 点 ▶ 播放，点行复制歌名</small></div>
          <div class="mk-right">
            ${opts.modeSwitch ? '<button class="mk-btn" data-act="mode" title="切换：点播到房间 / 只在本机听">点播到房间</button>' : ''}
            ${opts.hideLogin ? '' : '<button class="mk-btn" data-act="login">登录</button>'}
            <button class="mk-btn mk-ghost" data-act="settings" title="设置">⚙</button>
            <button class="mk-btn mk-ghost mk-close" data-act="close" title="关闭 (Esc)">✕</button>
          </div>
        </div>
        <div class="mk-search">
          <input class="mk-input" data-el="kw" type="search" placeholder="搜歌名 / 歌手，例如：晴天 周杰伦" autocomplete="off">
          <select class="mk-select" data-el="limit">
            <option value="10">10 条</option>
            <option value="20" selected>20 条</option>
            <option value="30">30 条</option>
          </select>
          <button class="mk-btn mk-primary" data-act="search">搜索</button>
        </div>
        <div class="mk-tabs" data-el="tabs"></div>
        <div class="mk-scopes" data-el="scopes"></div>
        <div class="mk-body" data-el="body"></div>
        <div class="mk-pager" data-el="pager"></div>
        <div class="mk-player">
          <button class="mk-ctl" data-act="prev" title="上一首">⏮</button>
          <button class="mk-ctl mk-main" data-act="toggle-play" title="播放 / 暂停">▶</button>
          <button class="mk-ctl" data-act="next" title="下一首">⏭</button>
          <div class="mk-now" data-el="now">未在播放<small>点结果里的 ▶ 开始</small></div>
          <div class="mk-seek">
            <input type="range" data-el="seek" min="0" max="1000" value="0" step="1">
            <span class="mk-time" data-el="time">0:00 / 0:00</span>
          </div>
          <div class="mk-vol">🔊<input type="range" data-el="vol" min="0" max="100" value="90"></div>
        </div>
        <div class="mk-stat"><span data-el="stat">等待搜索</span></div>
      </div>`;
    container.appendChild(root);

    // 播放器本体（不放进 innerHTML，避免解析差异；直接创建元素更稳）
    const audio = doc.createElement('audio');
    audio.setAttribute('data-el', 'audio');
    audio.preload = 'none';
    root.appendChild(audio);

    const $ = (sel) => root.querySelector(sel);
    // 浏览器给元素赋值 innerHTML 后，子节点是异步/惰性解析的：紧接着 querySelector 在极少数环境里
    // 会拿到 null。给一个"哑元素"兜底，坏消息是渲染不出来，好消息是不会把整个面板炸掉。
    const stub = () => ({
      innerHTML: '',
      textContent: '',
      value: '',
      src: '',
      currentTime: 0,
      duration: 0,
      volume: 1,
      childElementCount: 0,
      prepend() {},
      appendChild() {},
      addEventListener() {},
      removeEventListener() {},
      focus() {},
      play: async () => {},
      pause() {},
      load() {},
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    });
    const elBody = $('[data-el=body]') || stub();
    const elPager = $('[data-el=pager]') || stub();
    const elTabs = $('[data-el=tabs]') || stub();
    const elScopes = $('[data-el=scopes]') || null;
    const elKw = $('[data-el=kw]') || stub();
    const elLimit = $('[data-el=limit]') || stub();
    const elStat = $('[data-el=stat]') || stub();
    const elLoginBtn = $('[data-act=login]') || stub();
    const elNow = $('[data-el=now]') || stub();
    const elSeek = $('[data-el=seek]') || stub();
    const elTime = $('[data-el=time]') || stub();
    const elVol = $('[data-el=vol]') || stub();
    const elPlayBtn = $('[data-act=toggle-play]') || stub();
    const elAudio = root.querySelector('[data-el=audio]') || (function () {
      const a = doc.createElement('audio');
      root.appendChild(a);
      return a;
    })();
    if (elVol && elVol.value !== undefined) {
      elAudio.volume = (Number(elVol.value) || 90) / 100;
    }

    let platforms = Array.isArray(opts.platforms) && opts.platforms.length ? opts.platforms : PLATFORM_FALLBACK;
    let current = opts.platform || platforms[0].id;
    // 'local' = 面板自己用 <audio> 放（DSH 版）；'room' = 交给宿主点播到房间（IIROSE 版）
    let playMode = opts.playMode === 'room' ? 'room' : 'local';
    let session = null;
    let busy = false;
    let lastResults = [];
    // 翻页状态：关键词/平台/条数变了就回到第 1 页
    let page = 1;
    let lastLimit = 20;
    // 播放器状态（声明放在这里：songRow 在渲染时就要读它们，函数声明会提升、let 不会）
    let playQueue = [];
    let playIndex = -1;
    let playCurrent = null;
    // 搜歌 / 搜用户 / 搜歌单
    const scopes = Array.isArray(opts.scopes) && opts.scopes.length ? opts.scopes : null;
    let scope = scopes && scopes[0].id ? scopes[0].id : 'song';
    let listKind = 'song';
    // 打开歌单/用户详情前记一下原来的列表，返回时还原
    let detailBack = null;

    // ---------- 设置（外观 / 入口开关）----------
    // 同一份设置也存 localStorage：宿主（IIROSE）读同一把 key 来决定悬浮球和手势要不要挂
    const SETTINGS_KEY = opts.settingsKey || 'mk_panel_settings';
    const SETTINGS_DEFAULT = { ball: true, gesture: true, theme: 'dark', accent: 'blue', glass: false, compact: false };
    let settings = Object.assign({}, SETTINGS_DEFAULT, opts.settings || {});
    (function loadSettings() {
      try {
        const raw = window.localStorage.getItem(SETTINGS_KEY);
        if (raw) settings = Object.assign({}, SETTINGS_DEFAULT, JSON.parse(raw));
      } catch {
        /* 隐私模式读不到就用默认值 */
      }
    })();

    function notifySettings() {
      if (typeof opts.onSettingsChange !== 'function') return;
      try {
        opts.onSettingsChange(settings);
      } catch {
        /* 宿主应用失败不影响面板 */
      }
    }

    function saveSettings() {
      try {
        window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      } catch {
        /* 写不进去就算了，当前会话仍然生效 */
      }
      notifySettings();
    }

    function applySettings() {
      root.setAttribute('data-theme', settings.theme === 'light' ? 'light' : 'dark');
      root.setAttribute('data-accent', settings.accent || 'blue');
      root.classList.toggle('mk-glass', Boolean(settings.glass));
      root.classList.toggle('mk-compact', Boolean(settings.compact));
    }

    /**
     * 开关：悬浮球 / 双指上滑「只允许关一个」——
     * 关掉其中一个时自动把另一个打开，避免两个入口全没了、面板再也叫不出来。
     */
    function setSwitch(name, on) {
      const next = Object.assign({}, settings);
      next[name] = Boolean(on);
      if (!next.ball && !next.gesture) {
        if (name === 'ball') next.gesture = true;
        else next.ball = true;
      }
      settings = next;
      saveSettings();
      applySettings();
      renderSettings();
      if (!settings.ball || !settings.gesture) {
        setStat(settings.ball ? '已关闭双指上滑（悬浮球还能用）' : '已隐藏悬浮球（双指上滑还能用）');
      }
    }

    function renderSettings() {
      const sw = (name, label, desc) =>
        `<div class="mk-set-row"><div class="mk-meta"><b>${label}</b><small>${desc}</small></div>` +
        `<button class="mk-sw${settings[name] ? ' mk-on' : ''}" data-set="${name}" role="switch" ` +
        `aria-checked="${settings[name] ? 'true' : 'false'}" title="点击切换"></button></div>`;
      const chip = (group, value, label, color) =>
        `<button class="mk-chip${settings[group] === value ? ' mk-on' : ''}" data-set-group="${group}" data-set-value="${value}">` +
        (color ? `<span class="dot" style="background:${color}"></span>` : '') +
        label +
        '</button>';
      elBody.innerHTML =
        '<div class="mk-set">' +
        '<h3>设置</h3>' +
        '<div class="mk-set-group"><h4>入口</h4>' +
        sw('ball', '悬浮球', '右下角 ♪，可拖动；关掉后双指上滑还留着') +
        sw('gesture', '双指上滑', '手机上从页面底部双指向上滑，打开点歌台') +
        '<p class="mk-note">两个入口至少留一个：关掉其中一个，另一个会自动打开。</p></div>' +
        '<div class="mk-set-group"><h4>外观</h4>' +
        '<div class="mk-set-row"><div class="mk-meta"><b>主题</b><small>深色更配房间，浅色白天看着舒服</small></div></div>' +
        '<div class="mk-chips">' +
        chip('theme', 'dark', '深色') +
        chip('theme', 'light', '浅色') +
        '</div>' +
        '<div class="mk-set-row"><div class="mk-meta"><b>强调色</b><small>选中项、播放中、按钮描边</small></div></div>' +
        '<div class="mk-chips">' +
        chip('accent', 'blue', '蓝', '#4a8fd6') +
        chip('accent', 'teal', '青', '#2fb59a') +
        chip('accent', 'violet', '紫', '#8a7cf0') +
        chip('accent', 'pink', '粉', '#e26aa8') +
        '</div>' +
        sw('glass', '毛玻璃背景', '面板半透明 + 背景模糊，性能差的手机建议关') +
        sw('compact', '紧凑列表', '一行更矮，一屏能多看几首') +
        '</div>' +
        '<div class="mk-set-row"><div class="mk-meta"><b>完成</b><small>回到搜索</small></div>' +
        '<button class="mk-btn mk-primary" data-act="settings-done">完成</button></div>' +
        '</div>';
      if (elPager.classList) elPager.classList.remove('mk-on');
      setStat('设置');
    }

    // 版本号显示在标题旁边：刷新后一眼能确认「页面里跑的是新代码」。
    const elVer = $('[data-el=ver]');
    if (elVer && opts.version) elVer.textContent = 'v' + opts.version;

    // 「点播到房间 / 仅本机试听」：只有宿主打开 modeSwitch 才渲染这个按钮。
    // 房间模式下进度条、音量、时间没有意义（播的是房间播放器），一并收起。
    const elModeBtn = $('[data-act=mode]');
    function applyMode() {
      if (elModeBtn) {
        elModeBtn.textContent = playMode === 'room' ? '点播到房间' : '仅本机试听';
        elModeBtn.classList.toggle('mk-primary', playMode === 'room');
      }
      const hideInRoom = playMode === 'room';
      for (const el of [elSeek, elTime, elVol]) {
        if (el && el.style) el.style.display = hideInRoom ? 'none' : '';
      }
    }
    function notifyMode() {
      if (typeof opts.onModeChange !== 'function') return;
      try {
        opts.onModeChange(playMode);
      } catch {
        /* 宿主的持久化失败不影响面板 */
      }
    }
    applyMode();

    function renderTabs() {
      elTabs.innerHTML = platforms
        .map(
          (p) =>
            `<button class="mk-tab${p.id === current ? ' mk-on' : ''}" data-tab="${esc(p.id)}">${esc(p.label)}</button>`,
        )
        .join('');
    }

    // ---------- 歌曲 / 用户 / 歌单 ----------
    // 只有宿主给了 scopes 才显示这一排；不支持搜用户/歌单的平台由中转返回「不支持」提示。
    function renderScopes() {
      if (!elScopes || !Array.isArray(scopes) || !scopes.length) {
        if (elScopes && elScopes.style) elScopes.style.display = 'none';
        return;
      }
      elScopes.innerHTML = scopes
        .map(
          (s) =>
            `<button class="mk-scope${s.id === scope ? ' mk-on' : ''}" data-scope="${esc(s.id)}">${esc(s.label)}</button>`,
        )
        .join('');
    }

    const coverOf = (src, ph) =>
      src
        ? `<img class="mk-cover" src="${esc(src)}" alt="" loading="lazy">`
        : `<div class="mk-cover mk-ph">${ph}</div>`;

    function fmtCount(n) {
      const v = Number(n);
      if (!Number.isFinite(v) || v <= 0) return '';
      if (v >= 100000000) return (v / 100000000).toFixed(1) + ' 亿';
      if (v >= 10000) return (v / 10000).toFixed(1) + ' 万';
      return String(v);
    }

    function userRow(u, i) {
      const sub = [u.followers != null ? '粉丝 ' + fmtCount(u.followers) : '', u.signature || '']
        .filter(Boolean)
        .join(' · ');
      return `<div class="mk-entity" data-open-user="${i}" title="看 TA 的歌单">
        ${coverOf(u.avatar, '👤')}
        <div class="mk-meta"><div class="mk-name">${esc(u.name || '(无名)')}</div><div class="mk-sub">${esc(sub)}</div></div>
        <div class="mk-acts"><button data-open-user="${i}">歌单 ›</button></div>
      </div>`;
    }

    function playlistRow(p, i) {
      const sub = [
        p.trackCount != null ? p.trackCount + ' 首' : '',
        p.creator ? 'by ' + p.creator : '',
        p.playCount != null ? fmtCount(p.playCount) + ' 播放' : '',
      ]
        .filter(Boolean)
        .join(' · ');
      return `<div class="mk-entity" data-open-pl="${i}" title="打开歌单">
        ${coverOf(p.cover, '♪')}
        <div class="mk-meta"><div class="mk-name">${esc(p.name || '(未命名歌单)')}</div><div class="mk-sub">${esc(sub)}</div></div>
        <div class="mk-acts"><button data-open-pl="${i}">打开 ›</button></div>
      </div>`;
    }

    /** 统一渲染：songs / users / playlists 三种行 */
    function renderList(list, kind, title) {
      lastResults = list || [];
      listKind = kind || 'song';
      const rows =
        listKind === 'user'
          ? lastResults.map(userRow)
          : listKind === 'playlist'
            ? lastResults.map(playlistRow)
            : lastResults.map(songRow);
      elBody.innerHTML = (title ? '<div class="mk-sect">' + esc(title) + '</div>' : '') + rows.join('');
    }

    function setStat(text) {
      elStat.innerHTML = text;
    }

    function showError(msg) {
      const box = doc.createElement('div');
      box.className = 'mk-err';
      box.textContent = '出错了：' + msg;
      elBody.prepend(box);
    }

    function songRow(s, i) {
      // vip 可能是 null（平台没给这个字段，比如酷狗）——那就别标，省得误导「可听」其实要付费
      const badge =
        s.vip === true
          ? '<span class="mk-tag mk-vip">VIP/付费</span>'
          : s.vip === false
            ? '<span class="mk-tag mk-free">可听</span>'
            : '';
      const dur = fmtDur(s.durationMs);
      const sub = [s.artists && s.artists.join(' / '), s.album, dur].filter(Boolean).join(' · ');
      const link = s.url
        ? `<a href="${esc(s.url)}" target="_blank" rel="noopener" title="在 ${esc(labelOf(s.platform))} 打开">打开</a>`
        : '';
      const search =
        '<a href="' +
        esc(searchUrl(s)) +
        '" target="_blank" rel="noopener" title="在浏览器搜索这首歌">搜</a>';
      const inQueue = playQueue.some((x) => x.platform === s.platform && x.id === s.id);
      const isCurrent = playCurrent && playCurrent.platform === s.platform && playCurrent.id === s.id;
      // IIROSE 版的兜底：房间不让点播时，把 `@@歌名 歌手` 复制走，用户自己粘到聊天框
      const directive =
        typeof opts.onFallback === 'function'
          ? `<button data-directive="${i}" title="复制点播指令（房间不支持点播时用）">指令</button>`
          : '';
      return `<div class="mk-song mk-clickable${isCurrent ? ' mk-playing' : ''}" data-song="${i}" title="点击复制「歌名 - 歌手」">
        <button class="mk-play${isCurrent ? ' mk-busy' : ''}" data-play="${i}" title="直接播放">${isCurrent ? '♪' : '▶'}</button>
        <div class="mk-idx">${i + 1}</div>
        <div class="mk-meta"><div class="mk-name">${esc(s.title)}</div><div class="mk-sub">${esc(sub)}</div></div>
        ${inQueue ? '<span class="mk-queuebadge">已入列</span>' : ''}
        ${badge}
        <div class="mk-acts">
          <button data-queue="${i}" title="加入播放队列">+ 队列</button>
          ${directive}
          ${link}${search}
        </div>
      </div>`;
    }

    function labelOf(id) {
      const p = platforms.find((x) => x.id === id);
      return p ? p.label : id;
    }

    // ==================== 播放器 ====================
    // 设计取舍：
    //   · 只有"能直连拿到音频"的歌才播（163 的 fee=1 是版权锁，拿不到就是拿不到）；
    //   · 拿不到时给一行明确原因 + 「跳转平台」，不装作在加载；
    //   · 一个 <audio> + 队列，播完自动下一首。
    function songKey(s) {
      return s.platform + ':' + s.id;
    }

    function setNow(main, sub) {
      elNow.innerHTML = esc(main || '未在播放') + (sub ? '<small>' + esc(sub) + '</small>' : '');
    }

    function setPlayIcon(playing) {
      elPlayBtn.textContent = playing ? '⏸' : '▶';
    }

    function refreshRows() {
      // 只更新状态，不重渲染整个列表（避免正在输入/滚动位置被重置）
      const rows = root.querySelectorAll('.mk-song');
      rows.forEach((row) => {
        const i = Number(row.dataset.song);
        const s = lastResults[i];
        if (!s) return;
        const isCurrent = playCurrent && playCurrent.platform === s.platform && playCurrent.id === s.id;
        row.classList.toggle('mk-playing', Boolean(isCurrent));
        const btn = row.querySelector('.mk-play');
        if (btn) btn.textContent = isCurrent ? '♪' : '▶';
      });
    }

    async function playSong(song, { enqueue = true } = {}) {
      if (!song) return;
      if (enqueue) {
        const key = songKey(song);
        const existing = playQueue.findIndex((x) => songKey(x) === key);
        if (existing >= 0) playIndex = existing;
        else {
          playQueue.push(song);
          playIndex = playQueue.length - 1;
        }
      }
      playCurrent = song;
      const label = song.title + (song.artists && song.artists.length ? ' - ' + song.artists.join('/') : '');
      setNow(label, '解析播放地址…');
      refreshRows();
      try {
        if (typeof api.playurl !== 'function') throw new Error('当前环境不支持直接播放（缺 api.playurl）');
        const info = await api.playurl({ platform: song.platform, id: song.id });
        if (!info || !info.playable) {
          const why = (info && info.note) || (info && info.reason) || '拿不到可播放地址';
          setNow(label, '⚠ ' + why + '（可用「打开」跳去平台）');
          setStat('无法直接播放：' + esc(why));
          return { played: false, reason: (info && info.reason) || 'unplayable' };
        }
        if (playMode === 'room') {
          // 房间模式：不碰 <audio>（否则会和房间播放器双声），把解析结果交给宿主去发点播帧
          if (typeof opts.onEnqueue !== 'function') throw new Error('当前环境不支持点播到房间（缺 onEnqueue）');
          await opts.onEnqueue(song, info);
          setNow(label, '已点播到房间 · 等房间开始播');
          setPlayIcon(true);
          setStat('已点播：' + esc(song.title));
          return { played: true, mode: 'room' };
        }
        elAudio.src = info.streamUrl;
        elAudio.load();
        await elAudio.play();
        setNow(label, '播放中 · ' + (info.ext || 'audio') + (info.bitrate ? ' · ' + Math.round(info.bitrate / 1000) + 'k' : ''));
        setPlayIcon(true);
        setStat('正在播放：' + esc(song.title));
        return { played: true };
      } catch (err) {
        const msg = String((err && err.message) || err);
        setNow(label, '播放失败：' + msg);
        setPlayIcon(false);
        return { played: false, reason: msg };
      }
    }

    function togglePlay() {
      if (playMode === 'room') {
        // 房间里「播放/暂停」没有意义，这里当成「重发当前这首」
        const target = playCurrent || lastResults[0];
        if (!target) {
          setStat('先搜索，再点 ▶');
          return;
        }
        playSong(target, { enqueue: false });
        return;
      }
      if (!elAudio.src) {
        // 还没选歌：拿当前平台第一条结果开播
        if (lastResults[0]) playSong(lastResults[0]);
        else setStat('先搜索，再点 ▶');
        return;
      }
      if (elAudio.paused) {
        elAudio.play().then(() => setPlayIcon(true)).catch(() => setPlayIcon(false));
      } else {
        elAudio.pause();
        setPlayIcon(false);
      }
    }

    function step(delta) {
      if (!playQueue.length) return;
      playIndex = (playIndex + delta + playQueue.length) % playQueue.length;
      playSong(playQueue[playIndex], { enqueue: false });
    }

    elAudio.addEventListener('timeupdate', () => {
      const d = elAudio.duration || 0;
      const t = elAudio.currentTime || 0;
      if (!elSeek.dragging) {
        elSeek.value = d ? String(Math.round((t / d) * 1000)) : '0';
      }
      elTime.textContent = fmtDur(t * 1000) + ' / ' + fmtDur(d * 1000);
    });
    elAudio.addEventListener('ended', () => step(1));
    elAudio.addEventListener('error', () => {
      setNow('播放出错', '换一首试试，或点「打开」去平台听');
      setPlayIcon(false);
    });
    elSeek.addEventListener('input', () => { elSeek.dragging = true; });
    elSeek.addEventListener('change', () => {
      elSeek.dragging = false;
      const d = elAudio.duration || 0;
      if (d) elAudio.currentTime = (Number(elSeek.value) / 1000) * d;
    });
    elVol.addEventListener('input', () => {
      elAudio.volume = Math.min(1, Math.max(0, (Number(elVol.value) || 0) / 100));
    });

    /** 面板状态导出：给自己/测试用，一眼看出播放器在干什么 */
    function playerState() {
      return {
        mode: playMode,
        queue: playQueue.map((s) => songKey(s)),
        index: playIndex,
        current: playCurrent ? songKey(playCurrent) : null,
        src: elAudio.src ? String(elAudio.src).slice(0, 120) : null,
        paused: elAudio.paused,
      };
    }

    function searchUrl(s) {
      const kw = [s.title, (s.artists || [])[0]].filter(Boolean).join(' ');
      const home = (platforms.find((x) => x.id === s.platform) || {}).home || '';
      if (s.platform === 'netease') return 'https://music.163.com/#/search/m/?s=' + encodeURIComponent(kw);
      if (s.platform === 'kugou') return 'https://www.kugou.com/yy/html/search.html#searchType=song&searchKeyWord=' + encodeURIComponent(kw);
      if (s.platform === 'qq') return 'https://y.qq.com/n/ryqq/search?w=' + encodeURIComponent(kw);
      if (s.platform === 'bilibili') return 'https://search.bilibili.com/all?keyword=' + encodeURIComponent(kw);
      return home;
    }

    function renderLogin() {
      const who = session && session.nickname ? session.nickname : null;
      const loggedIn = Boolean(session && session.loggedIn);
      elBody.innerHTML = `
        <div class="mk-login">
          <h3>${loggedIn ? '已登录' : '登录（可选）'}</h3>
          <p class="note">${loggedIn
            ? '当前身份：' + esc(who || '已登录用户') + '（' + esc(session.platform || 'netease') + '）'
            : '搜索不需要登录。登录只是为了在结果里标注「你的收藏 / 你常听」，以及后续做歌单导入。'}</p>
          <div class="mk-warn">凭据只写进本机 <code>DSH_HOME/music-plugin/credentials.json</code>（权限 600），
            不会发给任何第三方；插件也不会把它打印到日志或列表里。公共电脑上建议别存。</div>
          <div class="mk-field">
            <label>网易云 Cookie（浏览器登录 music.163.com 后，F12 → 网络 → 任意请求 → 复制 Cookie 请求头）</label>
            <textarea data-el="cookie" placeholder="MUSIC_U=...; __csrf=...;"></textarea>
          </div>
          <div class="mk-row">
            <button class="mk-btn mk-primary" data-act="save-login">保存并验证</button>
            <button class="mk-btn" data-act="logout" ${loggedIn ? '' : 'disabled'}>退出登录</button>
            <span data-el="login-stat" class="mk-sub"></span>
          </div>
          <p class="note" style="margin-top:14px">为什么不做账号密码登录：那要求你把账号密码交给一个第三方插件，
            风险和收益完全不成比例；扫码登录需要走官方 App 的私有接口，同样不适合。</p>
        </div>`;
    }

    /** 翻页条：只在有结果时出现；「下一页」按 lastResults.length < lastLimit 判死 */
    function renderPager() {
      if (!elPager.classList) return;
      if (!lastResults.length) {
        elPager.innerHTML = '';
        elPager.classList.remove('mk-on');
        return;
      }
      const more = lastResults.length >= lastLimit;
      elPager.innerHTML =
        `<button data-act="page" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>‹ 上一页</button>` +
        `<span>第 ${page} 页</span>` +
        `<button data-act="page" data-page="${page + 1}" ${more ? '' : 'disabled'}>下一页 ›</button>`;
      elPager.classList.add('mk-on');
    }

    const scopeLabel = () => {
      const s = (scopes || []).find((x) => x.id === scope);
      return s ? s.label : '歌曲';
    };
    const placeholderOf = () =>
      scope === 'user' ? '搜用户 / 昵称，例如：晴天' : scope === 'playlist' ? '搜歌单，例如：周杰伦 精选' : '搜歌名 / 歌手，例如：晴天 周杰伦';

    async function doSearch(nextPage) {
      if (busy) return;
      const kw = elKw.value.trim();
      if (!kw) {
        elBody.innerHTML = '<div class="mk-empty">先输入关键词</div>';
        elPager.innerHTML = '';
        elPager.classList.remove('mk-on');
        return;
      }
      // 换了关键词/平台就从第 1 页开始；只有显式给页码才翻页
      const target = Number(nextPage) || 1;
      const limit = Number(elLimit.value) || 20;
      const type = scope || 'song';
      busy = true;
      setStat('<span class="mk-load"></span> 正在搜' + esc(scopeLabel()) + ' · ' + esc(labelOf(current)) + (target > 1 ? ' · 第 ' + target + ' 页' : ''));
      elBody.innerHTML = '<div class="mk-empty">搜索中…</div>';
      try {
        const data = await api.search({ platform: current, keyword: kw, limit, page: target, type });
        const list = data || [];
        if (!list.length) {
          if (target > 1) {
            // 翻过头了：留在原页，别把用户已经看到的结果清掉
            setStat('没有更多了 · 第 ' + page + ' 页');
            renderList(lastResults, listKind, labelOf(current) + ' · ' + lastResults.length + ' 条');
            renderPager();
          } else {
            lastResults = [];
            listKind = type;
            page = 1;
            lastLimit = limit;
            elBody.innerHTML = '<div class="mk-empty">没有结果。换个关键词，或换一个平台试试。</div>';
            setStat('0 条 · ' + esc(labelOf(current)));
            renderPager();
          }
        } else {
          page = target;
          lastLimit = limit;
          renderList(list, type, labelOf(current) + ' · ' + list.length + ' 条');
          setStat(list.length + ' 条 · 第 ' + page + ' 页 · ' + esc(labelOf(current)));
          renderPager();
        }
      } catch (err) {
        elBody.innerHTML = '';
        showError(String((err && err.message) || err));
        setStat('失败');
      } finally {
        busy = false;
      }
    }

    /** 打开歌单：一次拿到「歌单信息 + 歌曲」，再给「全部入队」 */
    async function openPlaylist(p) {
      if (busy || typeof api.playlist !== 'function') {
        setStat('当前环境不支持读歌单');
        return;
      }
      busy = true;
      setStat('<span class="mk-load"></span> 正在打开：' + esc(p.name));
      try {
        const d = await api.playlist({ platform: current, id: p.id });
        const songs = (d && d.songs) || [];
        const pl = Object.assign({}, p, (d && d.playlist) || {});
        detailBack = { list: lastResults, kind: listKind, page: page };
        page = 1;
        lastLimit = Math.max(1, songs.length);
        renderList(songs, 'song');
        const head =
          '<div class="mk-detail-head">' +
          coverOf(pl.cover, '♪') +
          '<div class="mk-meta"><div class="mk-name">' + esc(pl.name || p.name) + '</div><div class="mk-sub">' +
          esc([songs.length + ' 首', pl.creator ? 'by ' + pl.creator : ''].filter(Boolean).join(' · ')) +
          '</div></div>' +
          '<div class="mk-detail-acts">' +
          (songs.length ? '<button class="mk-btn mk-primary" data-act="batch">全部入队（' + songs.length + '）</button>' : '') +
          '<button class="mk-btn" data-act="back">‹ 返回</button></div></div>';
        if (elBody.insertAdjacentHTML) elBody.insertAdjacentHTML('afterbegin', head);
        if (elPager.classList) elPager.classList.remove('mk-on');
        setStat('歌单「' + esc(pl.name || p.name) + '」· ' + songs.length + ' 首');
      } catch (err) {
        elBody.innerHTML = '';
        showError(String((err && err.message) || err));
        setStat('打开歌单失败');
      } finally {
        busy = false;
      }
    }

    /** 打开某个用户：列出 TA 的歌单 */
    async function openUser(u) {
      if (busy || typeof api.userPlaylists !== 'function') {
        setStat('当前环境不支持读用户歌单');
        return;
      }
      busy = true;
      setStat('<span class="mk-load"></span> 正在读 ' + esc(u.name) + ' 的歌单');
      try {
        const list = (await api.userPlaylists({ platform: current, id: u.id })) || [];
        detailBack = { list: lastResults, kind: listKind, page: page };
        page = 1;
        lastLimit = list.length;
        renderList(list, 'playlist', '');
        const head =
          '<div class="mk-detail-head">' +
          coverOf(u.avatar, '👤') +
          '<div class="mk-meta"><div class="mk-name">' + esc(u.name) + '</div><div class="mk-sub">' +
          esc(list.length + ' 个歌单') + '</div></div>' +
          '<div class="mk-detail-acts"><button class="mk-btn" data-act="back">‹ 返回</button></div></div>';
        if (elBody.insertAdjacentHTML) elBody.insertAdjacentHTML('afterbegin', head);
        elPager.classList.remove('mk-on');
        setStat(u.name + ' · ' + list.length + ' 个歌单');
      } catch (err) {
        elBody.innerHTML = '';
        showError(String((err && err.message) || err));
        setStat('读取失败');
      } finally {
        busy = false;
      }
    }

    /** 从歌单/用户详情返回原来的搜索结果 */
    function goBack() {
      if (!detailBack) return;
      const back = detailBack;
      detailBack = null;
      page = back.page || 1;
      renderList(back.list, back.kind, labelOf(current) + ' · ' + (back.list || []).length + ' 条');
      renderPager();
      setStat('已返回搜索结果');
    }

    /** 批量入队（最多 100 首，避免一口气把队列塞爆） */
    function queueAll(list) {
      let added = 0;
      for (const s of (list || []).slice(0, 100)) {
        if (!s || !s.id) continue;
        if (playQueue.some((x) => songKey(x) === songKey(s))) continue;
        playQueue.push(s);
        added += 1;
      }
      refreshRows();
      setStat('已加入队列 ' + added + ' 首（队列共 ' + playQueue.length + ' 首）');
      return added;
    }

    // 顶栏「登录 / 已登录」按钮跟着 session 走：登录、退出、刷新会话都要过这里，
    // 否则会出现「已经登录了但按钮还写着登录」的不一致。
    function applyLoginState() {
      const loggedIn = Boolean(session && session.loggedIn);
      elLoginBtn.textContent = loggedIn ? '已登录' : '登录';
      elLoginBtn.classList.toggle('mk-primary', loggedIn);
    }

    async function refreshSession() {
      if (typeof api.session !== 'function') return;
      try {
        session = await api.session();
      } catch {
        session = null;
      }
      applyLoginState();
    }

    // ---- 事件 ----
    root.addEventListener('click', async (ev) => {
      const tab = ev.target.closest('[data-tab]');
      if (tab) {
        current = tab.dataset.tab;
        renderTabs();
        if (elKw.value.trim()) doSearch();
        return;
      }
      // 播放 / 入队 / 播放器控制（这些要放在 act 之前判断，优先级最高）
      const playBtn = ev.target.closest('[data-play]');
      if (playBtn) {
        const s = lastResults[Number(playBtn.dataset.play)];
        if (s) {
          playBtn.classList.add('mk-busy');
          await playSong(s);
          playBtn.classList.remove('mk-busy');
        }
        return;
      }
      const queueBtn = ev.target.closest('[data-queue]');
      if (queueBtn) {
        const s = lastResults[Number(queueBtn.dataset.queue)];
        if (s && !playQueue.some((x) => songKey(x) === songKey(s))) {
          playQueue.push(s);
          setStat('已加入队列（' + playQueue.length + ' 首）：' + esc(s.title));
          refreshRows();
        }
        return;
      }
      const dirBtn = ev.target.closest('[data-directive]');
      if (dirBtn) {
        const s = lastResults[Number(dirBtn.dataset.directive)];
        if (s && typeof opts.onFallback === 'function') {
          try {
            const text = await opts.onFallback(s);
            setStat('已复制指令「' + esc(text) + '」，粘到聊天框发送即可');
          } catch (err) {
            setStat('复制指令失败：' + esc(String((err && err.message) || err)));
          }
        }
        return;
      }
      // 点遮罩关面板（手机上比找 ✕ 顺手）
      if (ev.target && ev.target.classList && ev.target.classList.contains('mk-backdrop')) {
        close();
        return;
      }
      const scopeBtn = ev.target.closest('[data-scope]');
      if (scopeBtn) {
        scope = scopeBtn.dataset.scope || 'song';
        renderScopes();
        if (elKw && elKw.placeholder !== undefined) elKw.placeholder = placeholderOf();
        if (elKw.value.trim()) doSearch();
        else setStat('切到「' + scopeLabel() + '」，输入关键词搜索');
        return;
      }
      const openPlBtn = ev.target.closest('[data-open-pl]');
      if (openPlBtn) {
        const p = lastResults[Number(openPlBtn.dataset.openPl)];
        if (p) await openPlaylist(p);
        return;
      }
      const openUserBtn = ev.target.closest('[data-open-user]');
      if (openUserBtn) {
        const u = lastResults[Number(openUserBtn.dataset.openUser)];
        if (u) await openUser(u);
        return;
      }
      const setSwitchBtn = ev.target.closest('[data-set]');
      if (setSwitchBtn) {
        const n = setSwitchBtn.dataset.set;
        setSwitch(n, !settings[n]);
        return;
      }
      const setChipBtn = ev.target.closest('[data-set-group]');
      if (setChipBtn) {
        const patch = {};
        patch[setChipBtn.dataset.setGroup] = setChipBtn.dataset.setValue;
        settings = Object.assign({}, settings, patch);
        saveSettings();
        applySettings();
        renderSettings();
        return;
      }
      const act = ev.target.closest('[data-act]');
      if (act) {
        const name = act.dataset.act;
        if (name === 'settings') renderSettings();
        else if (name === 'settings-done') {
          if (lastResults.length) {
            renderList(lastResults, listKind, labelOf(current) + ' · ' + lastResults.length + ' 条');
            renderPager();
            setStat(lastResults.length + ' 条 · ' + esc(labelOf(current)));
          } else {
            elBody.innerHTML = '<div class="mk-empty">输入关键词，回车搜索。</div>';
            setStat('等待搜索');
          }
        }
        else if (name === 'batch') queueAll(lastResults);
        else if (name === 'back') goBack();
        else if (name === 'close') close();
        else if (name === 'search') doSearch();
        else if (name === 'page') doSearch(Number(act.dataset.page));
        else if (name === 'mode') {
          playMode = playMode === 'room' ? 'local' : 'room';
          if (playMode === 'room') {
            try {
              elAudio.pause();
            } catch {
              /* 没在放就无所谓 */
            }
          }
          applyMode();
          notifyMode();
          setStat(playMode === 'room' ? '已切到「点播到房间」' : '已切到「仅本机试听」');
        }
        else if (name === 'prev') step(-1);
        else if (name === 'next') step(1);
        else if (name === 'toggle-play') togglePlay();
        else if (name === 'login') {
          renderLogin();
          setStat('登录设置');
        } else if (name === 'save-login') {
          const cookie = root.querySelector('[data-el=cookie]').value.trim();
          const stat = root.querySelector('[data-el=login-stat]');
          stat.textContent = '验证中…';
          try {
            if (typeof api.login !== 'function') throw new Error('当前环境不支持保存登录');
            session = await api.login({ platform: 'netease', cookie });
            stat.textContent = session && session.loggedIn ? '验证通过，已登录' : '已保存（未能确认登录态）';
            applyLoginState();
            if (session && session.loggedIn) renderLogin();
          } catch (err) {
            stat.textContent = '失败：' + String((err && err.message) || err);
          }
        } else if (name === 'logout') {
          try {
            if (typeof api.logout === 'function') await api.logout();
          } catch { /* 退出失败也让 UI 回到未登录 */ }
          session = null;
          applyLoginState();
          renderLogin();
        }
        return;
      }
      // 点行空白处 = 复制歌名；点行里的 ▶ = 直接播（上面已处理）
      const row = ev.target.closest('[data-song]');
      if (row && !ev.target.closest('a') && !ev.target.closest('button')) {
        const s = lastResults[Number(row.dataset.song)];
        if (!s) return;
        const text = s.title + ' - ' + (s.artists || []).join('/');
        try {
          await navigator.clipboard.writeText(text);
          setStat('已复制：' + esc(text));
        } catch {
          setStat('复制失败，请手动选择文本');
        }
      }
    });

    root.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        close();
      } else if (ev.key === 'Enter' && ev.target === elKw) {
        ev.preventDefault();
        doSearch();
      }
    });

    function onDocKey(ev) {
      if (ev.key === 'Escape' && root.classList.contains('mk-open')) close();
    }

    function open() {
      root.classList.add('mk-open');
      applySettings();
      renderTabs();
      renderScopes();
      if (elKw && elKw.placeholder !== undefined) elKw.placeholder = placeholderOf();
      if (!elBody.childElementCount) {
        elBody.innerHTML =
          '<div class="mk-empty">输入关键词，回车搜索。<br>' +
          platforms.map((p) => esc(p.label)).join(' · ') +
          '</div>';
      }
      doc.addEventListener('keydown', onDocKey, true);
      setTimeout(() => elKw.focus(), 0);
      refreshSession();
    }

    function close() {
      root.classList.remove('mk-open');
      doc.removeEventListener('keydown', onDocKey, true);
    }

    function toggle() {
      if (root.classList.contains('mk-open')) close();
      else open();
    }

    function dispose() {
      close();
      root.remove();
    }

    if (typeof api.platforms === 'function') {
      api.platforms()
        .then((list) => {
          if (Array.isArray(list) && list.length) {
            platforms = list;
            renderTabs();
          }
        })
        .catch(() => {});
    }

    if (opts.openOnMount !== false) open();
    return {
      open,
      close,
      toggle,
      dispose,
      root,
      audio: elAudio,
      setPlatform(id) { current = id; renderTabs(); },
      /** 宿主（IIROSE 版）可以在运行时切模式，例如读 localStorage 的偏好 */
      setMode(mode) {
        playMode = mode === 'room' ? 'room' : 'local';
        applyMode();
        notifyMode();
        return playMode;
      },
      getMode: () => playMode,
      /** 宿主把「房间正在播放」推回面板（IIROSE 版监听 &1 帧后调用） */
      setRoomNow(text, sub) {
        setNow(text || '未在播放', sub || '');
      },
      // 给外面的测试/诊断用
      play: (song) => playSong(song || lastResults[0]),
      queue: () => playQueue.slice(),
      results: () => lastResults.slice(),
      state: playerState,
    };
  }

  global.mountMusicPanel = mountMusicPanel;
  if (typeof module !== 'undefined' && module.exports) module.exports = { mountMusicPanel };
})(typeof window !== 'undefined' ? window : globalThis);

;/**
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

  var VERSION = '0.3.5';

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
    ball: 'mk_iirose_ball',
    ballHidden: 'mk_iirose_ball_hidden',
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
  var SETTINGS_DEFAULT = { ball: true, gesture: true, theme: 'dark', accent: 'blue', glass: false, compact: false };
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
  function writeSettings(next) {
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch (e) {
      /* 隐私模式写不进去 */
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
      '.mk-iirose-gear{position:fixed;right:22px;bottom:96px;z-index:2147482990;width:34px;height:34px;',
      'border-radius:50%;border:1px solid #2b3444;background:#1e2836;color:#93a1b8;font-size:15px;',
      'cursor:pointer;font-family:inherit;line-height:1}',
      '.mk-iirose-gear:hover{color:#cfe6ff;border-color:#3f6ea8}',
      // 悬浮球：可拖动、可关掉；手机上给大一点的圆和「×」
      '.mk-iirose-ball{position:fixed;right:18px;bottom:24px;z-index:2147482991;width:52px;height:52px;',
      'border-radius:50%;border:1px solid #2f6ea8;background:#173a5e;color:#cfe6ff;font-size:18px;',
      'box-shadow:0 8px 24px rgba(0,0,0,.45);font-family:inherit;display:flex;align-items:center;',
      'justify-content:center;touch-action:none;user-select:none;-webkit-user-select:none;cursor:grab}',
      '.mk-iirose-ball:active{cursor:grabbing}',
      '.mk-iirose-ball:hover{background:#1d4a76}',
      '.mk-iirose-ball.mk-room{box-shadow:0 0 0 3px rgba(126,224,184,.35),0 8px 24px rgba(0,0,0,.45)}',
      '.mk-iirose-ball .mk-ball-x{position:absolute;right:-7px;top:-7px;width:21px;height:21px;border-radius:50%;',
      'background:#2b3444;border:1px solid #3f4b5e;color:#93a1b8;font-size:13px;line-height:19px;text-align:center;',
      'cursor:pointer;display:none;touch-action:none}',
      '.mk-iirose-ball:hover .mk-ball-x,.mk-iirose-ball.mk-touched .mk-ball-x{display:block}',
      '.mk-iirose-ball .mk-ball-x:hover{background:#6b3238;color:#ffc9cf;border-color:#a04b53}',
      '@media (max-width:640px){.mk-iirose-ball{width:56px;height:56px;font-size:20px}',
      '.mk-iirose-ball .mk-ball-x{display:block;width:22px;height:22px;line-height:20px}}',
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
      onSettingsChange: function (s) {
        panelSettings = s;
        if (s && s.ball) showBall();
        else hideBall();
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
      // 双指上滑把球叫回来时，也要把设置改回去，不然刷新又藏起来了
      var s = readSettings();
      if (!s.ball) {
        s.ball = true;
        writeSettings(s);
        panelSettings = s;
      }
    }
    function hideBall() {
      if (!ballEl) return;
      lsSet(LS.ballHidden, '1');
      ballEl.style.display = 'none';
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
    ballEl.title = '点歌台（' + HINT + '）· 按住可以拖动';
    ballEl.innerHTML =
      '<span class="mk-ball-ico">♪</span><span class="mk-ball-x" title="隐藏悬浮球（双指上滑可以再叫出来）">×</span>';
    (doc.body || doc.documentElement).appendChild(ballEl);

    var panelSettings = readSettings();
    var saved = ballSaved();
    if (!panelSettings.ball) ballEl.style.display = 'none';
    if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') placeBall(saved.x, saved.y);

    var drag = null;
    function pointOf(ev) {
      if (ev.touches && ev.touches.length) return { x: ev.touches[0].clientX, y: ev.touches[0].clientY };
      return { x: ev.clientX, y: ev.clientY };
    }
    function onBallDown(ev) {
      // 点「×」不算拖拽
      if (ev.target && ev.target.classList && ev.target.classList.contains('mk-ball-x')) return;
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
    function onBallUp() {
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
      } else {
        togglePanel();
      }
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

    var ballX = ballEl.querySelector('.mk-ball-x');
    if (ballX) {
      ballX.addEventListener('click', function (ev) {
        ev.stopPropagation();
        ev.preventDefault();
        var next = readSettings();
        next.ball = false;
        // 只允许关一个：悬浮球关了，就把双指上滑打开
        if (!next.gesture) next.gesture = true;
        panelSettings = next;
        writeSettings(next);
        hideBall();
      });
    }

    // ---------- 双指上滑 = 打开点歌台 ----------
    // 手机上 Alt+T 用不了，悬浮球被关掉之后总得有个入口
    var gesture = null;
    function gestureStart(ev) {
      if (!panelSettings || !panelSettings.gesture) return;
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
      if (!gesture || gesture.fired || !ev.touches || ev.touches.length !== 2) return;
      var y = (ev.touches[0].clientY + ev.touches[1].clientY) / 2;
      if (gesture.y - y > 90 && Date.now() - gesture.t < 900) {
        gesture.fired = true;
        showBall();
        openPanel();
      }
    }
    function gestureEnd(ev) {
      if (!ev.touches || ev.touches.length < 2) gesture = null;
    }
    function attachGesture(target) {
      if (!target || !target.addEventListener) return;
      target.addEventListener('touchstart', gestureStart, { passive: true });
      target.addEventListener('touchmove', gestureMove, { passive: true });
      target.addEventListener('touchend', gestureEnd, { passive: true });
      target.addEventListener('touchcancel', gestureEnd, { passive: true });
    }
    attachGesture(doc);
    // 有些布局会把游戏塞进同源 iframe，那边也要能双指上滑
    try {
      var frames = doc.querySelectorAll('iframe');
      for (var fi = 0; fi < frames.length && fi < 4; fi++) {
        var fdoc = null;
        try {
          fdoc = frames[fi].contentDocument;
        } catch (e) {
          fdoc = null;
        }
        if (fdoc) attachGesture(fdoc);
      }
    } catch (e) {
      /* 跨域 iframe 就算了 */
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
