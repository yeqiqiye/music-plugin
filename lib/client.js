/**
 * dsh-music-request 客户端半侧（构建产物，别直接改这个文件）。
 * 源文件：client/panel-ui.js（UI）+ scripts/build.mjs（这一层壳）。
 *
 * 职责：
 *   1. 装 Alt+T 快捷键，开关点歌台面板
 *   2. 把面板挂进 DSH 的 shell.overlay 插槽
 *   3. 通过 /music/api/* 同源路由拿数据（搜索与登录都在 host 半侧）
 */
;(() => {
  const PANEL_SOURCE = "/**\n * 点歌面板 UI —— 纯 DOM，不依赖 React / 任何外部库。\n *\n * 为什么不用 React：插件里确实能 require('react')，但这段 UI 的主体是「表单 + 列表」，\n * 用原生 DOM 更短、更容易在浏览器里单独跑（dev/server.mjs 就把它原样发给页面），\n * 出问题时也能直接 DevTools 调试，不需要一层构建。\n *\n * 对外只暴露一个挂载函数：\n *   const panel = mountMusicPanel(container, { api: { search, platforms, login, session, logout } })\n *   panel.open() / panel.close() / panel.dispose()\n * `api` 刻意做成注入的：dev 版打本地 /api/*，插件版打 DSH web server 的 /music/api/*。\n */\n(function (global) {\n  'use strict';\n\n  const PLATFORM_FALLBACK = [\n    { id: 'netease', label: '网易云音乐', home: 'https://music.163.com/' },\n    { id: 'kugou', label: '酷狗音乐', home: 'https://www.kugou.com/' },\n    { id: 'qq', label: 'QQ 音乐', home: 'https://y.qq.com/' },\n    { id: 'bilibili', label: 'B 站（Live / MV）', home: 'https://www.bilibili.com/' },\n  ];\n\n  const CSS = `\n.mk-root{position:fixed;inset:0;z-index:2147483000;display:none;align-items:center;justify-content:center;\n  font:14px/1.6 \"Microsoft YaHei\",\"PingFang SC\",\"Segoe UI\",system-ui,sans-serif;color:var(--mk-fg,#e9eef7)}\n.mk-root.mk-open{display:flex}\n.mk-backdrop{position:absolute;inset:0;background:rgba(6,9,14,.62);backdrop-filter:blur(3px)}\n.mk-card{position:relative;width:min(1000px,94vw);height:min(720px,90vh);display:flex;flex-direction:column;\n  background:var(--mk-bg,#141a24);border:1px solid var(--mk-line,#2b3444);border-radius:16px;overflow:hidden;\n  box-shadow:0 24px 70px rgba(0,0,0,.55)}\n.mk-head{display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid var(--mk-line,#2b3444)}\n.mk-title{font-size:16px;font-weight:700;letter-spacing:.3px}\n.mk-title small{display:block;font-size:11px;font-weight:400;color:var(--mk-dim,#93a1b8);letter-spacing:0}\n.mk-right{margin-left:auto;display:flex;gap:8px;align-items:center}\n.mk-btn{background:var(--mk-btn,#202a39);color:inherit;border:1px solid var(--mk-line,#2b3444);border-radius:9px;\n  padding:6px 12px;font-size:13px;cursor:pointer;transition:.12s}\n.mk-btn:hover{border-color:#3f6ea8;background:#26344a}\n.mk-btn.mk-primary{background:#173a5e;border-color:#2f6ea8;color:#cfe6ff}\n.mk-btn.mk-ghost{background:transparent}\n.mk-close{font-size:18px;line-height:1;padding:4px 10px}\n.mk-search{display:flex;gap:10px;padding:14px 16px 10px;flex-wrap:wrap;align-items:center}\n.mk-input{flex:1 1 260px;min-width:180px;background:var(--mk-input,#1b2432);color:inherit;\n  border:1px solid var(--mk-line,#2b3444);border-radius:10px;padding:10px 13px;font-size:14px;outline:none}\n.mk-input:focus{border-color:#3f6ea8}\n.mk-select{background:var(--mk-input,#1b2432);color:inherit;border:1px solid var(--mk-line,#2b3444);\n  border-radius:10px;padding:10px 12px;font-size:13px;outline:none}\n.mk-tabs{display:flex;gap:6px;padding:0 16px 10px;flex-wrap:wrap;border-bottom:1px solid var(--mk-line,#2b3444)}\n.mk-tab{background:transparent;color:var(--mk-dim,#93a1b8);border:1px solid transparent;border-radius:8px;\n  padding:6px 12px;font-size:13px;cursor:pointer}\n.mk-tab:hover{color:var(--mk-fg,#e9eef7);background:#1c2533}\n.mk-tab.mk-on{color:#cfe6ff;background:#17324f;border-color:#2f6ea8}\n.mk-body{flex:1;overflow:auto;padding:8px 10px 16px}\n.mk-sect{display:flex;align-items:center;gap:8px;padding:10px 8px 6px;color:var(--mk-dim,#93a1b8);font-size:12px}\n.mk-sect::after{content:\"\";flex:1;height:1px;background:var(--mk-line,#2b3444)}\n.mk-song{display:flex;gap:12px;align-items:center;padding:9px 10px;border-radius:10px;border:1px solid transparent}\n.mk-song:hover{background:#1a2230;border-color:var(--mk-line,#2b3444)}\n.mk-song.mk-clickable{cursor:pointer}\n.mk-idx{width:26px;text-align:right;color:var(--mk-dim,#93a1b8);font-size:12px;flex:none}\n.mk-meta{flex:1;min-width:0}\n.mk-name{font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n.mk-sub{font-size:12px;color:var(--mk-dim,#93a1b8);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n.mk-tag{font-size:10px;border:1px solid var(--mk-line,#2b3444);border-radius:20px;padding:1px 7px;color:var(--mk-dim,#93a1b8);flex:none}\n.mk-tag.mk-free{color:#7ee0b8;border-color:#2c5f4c}\n.mk-tag.mk-vip{color:#ffd479;border-color:#6b5626}\n.mk-acts{display:flex;gap:6px;flex:none}\n.mk-acts a,.mk-acts button{font-size:12px;text-decoration:none;color:inherit;border:1px solid var(--mk-line,#2b3444);\n  border-radius:8px;padding:4px 10px;background:#1e2836;cursor:pointer;font-family:inherit}\n.mk-acts a:hover,.mk-acts button:hover{border-color:#3f6ea8;background:#26344a}\n.mk-song.mk-playing{background:#16304a;border-color:#2f6ea8}\n.mk-play{width:30px;height:30px;flex:none;border-radius:50%;border:1px solid var(--mk-line,#2b3444);\n  background:#1e2836;color:inherit;font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:center}\n.mk-play:hover{border-color:#3f6ea8;background:#26344a}\n.mk-play.mk-busy{opacity:.55;cursor:wait}\n.mk-play.mk-locked{opacity:.45;cursor:not-allowed}\n.mk-player{display:flex;align-items:center;gap:10px;padding:9px 16px;border-top:1px solid var(--mk-line,#2b3444);\n  background:#101720;flex-wrap:wrap}\n.mk-player .mk-ctl{width:32px;height:32px;border-radius:50%;border:1px solid var(--mk-line,#2b3444);\n  background:#1e2836;color:inherit;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;flex:none}\n.mk-player .mk-ctl:hover{border-color:#3f6ea8;background:#26344a}\n.mk-player .mk-ctl.mk-main{background:#173a5e;border-color:#2f6ea8;color:#cfe6ff;width:36px;height:36px}\n.mk-now{flex:1 1 150px;min-width:110px;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n.mk-now small{display:block;color:var(--mk-dim,#93a1b8);font-size:11.5px}\n.mk-seek{flex:2 1 190px;display:flex;align-items:center;gap:8px;min-width:150px}\n.mk-seek input[type=range]{flex:1;accent-color:#4a8fd6}\n.mk-time{font-size:11.5px;color:var(--mk-dim,#93a1b8);font-variant-numeric:tabular-nums;flex:none;min-width:80px;text-align:right}\n.mk-vol{display:flex;align-items:center;gap:6px;flex:none;color:var(--mk-dim,#93a1b8);font-size:12px}\n.mk-vol input[type=range]{width:70px;accent-color:#4a8fd6}\n.mk-queuebadge{font-size:10px;color:#7ee0b8;border:1px solid #2c5f4c;border-radius:20px;padding:1px 6px;flex:none}\n.mk-empty{padding:34px 16px;text-align:center;color:var(--mk-dim,#93a1b8);font-size:13px}\n.mk-err{margin:8px 10px;padding:10px 12px;border-radius:10px;background:#3a1f22;border:1px solid #6b3238;color:#ffc9cf;font-size:13px}\n.mk-stat{padding:6px 16px;border-top:1px solid var(--mk-line,#2b3444);color:var(--mk-dim,#93a1b8);font-size:12px;display:flex;gap:14px;align-items:center}\n.mk-load{display:inline-block;width:13px;height:13px;border:2px solid #3f6ea8;border-top-color:transparent;\n  border-radius:50%;animation:mk-spin .7s linear infinite;vertical-align:-2px}\n@keyframes mk-spin{to{transform:rotate(360deg)}}\n.mk-login{padding:16px;max-width:560px}\n.mk-login h3{margin:0 0 4px;font-size:15px}\n.mk-login p.note{color:var(--mk-dim,#93a1b8);font-size:12.5px;margin:0 0 14px}\n.mk-field{display:flex;flex-direction:column;gap:6px;margin-bottom:12px}\n.mk-field label{font-size:12.5px;color:var(--mk-dim,#93a1b8)}\n.mk-field textarea{min-height:96px;resize:vertical;font-family:ui-monospace,Consolas,monospace;font-size:12px;\n  background:var(--mk-input,#1b2432);color:inherit;border:1px solid var(--mk-line,#2b3444);border-radius:10px;padding:10px}\n.mk-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}\n.mk-warn{background:#3a3320;border:1px solid #6b5a26;color:#ffe6a8;border-radius:10px;padding:9px 11px;font-size:12.5px;margin-bottom:12px}\n.mk-pager{display:none;align-items:center;justify-content:center;gap:10px;padding:8px 16px;border-top:1px solid var(--mk-line,#2b3444);background:#0f161f;font-size:12.5px;color:var(--mk-dim,#93a1b8)}\n.mk-pager.mk-on{display:flex}\n.mk-pager button{font-size:12.5px;color:inherit;border:1px solid var(--mk-line,#2b3444);border-radius:8px;\n  padding:4px 10px;background:#1e2836;cursor:pointer;font-family:inherit}\n.mk-pager button:hover:not(:disabled){border-color:#3f6ea8;background:#26344a}\n.mk-pager button:disabled{opacity:.4;cursor:not-allowed}\n@media (max-width:640px){\n  .mk-card{width:100vw;height:100vh;border-radius:0}\n  .mk-acts{display:none}\n}\n`;\n\n  function injectCss(doc) {\n    if (doc.querySelector('style[data-music-panel]')) return;\n    const style = doc.createElement('style');\n    style.setAttribute('data-music-panel', '1');\n    style.textContent = CSS;\n    doc.head.appendChild(style);\n  }\n\n  const esc = (s) =>\n    String(s == null ? '' : s)\n      .replace(/&/g, '&amp;')\n      .replace(/</g, '&lt;')\n      .replace(/>/g, '&gt;')\n      .replace(/\"/g, '&quot;');\n\n  const fmtDur = (msv) => {\n    if (!Number.isFinite(msv) || msv <= 0) return '';\n    const total = Math.round(msv / 1000);\n    const m = Math.floor(total / 60);\n    const s = total % 60;\n    return m + ':' + String(s).padStart(2, '0');\n  };\n\n  function mountMusicPanel(container, options) {\n    const opts = options || {};\n    const doc = container.ownerDocument || document;\n    const api = opts.api || {};\n    injectCss(doc);\n\n    const root = doc.createElement('div');\n    root.className = 'mk-root';\n    root.innerHTML = `\n      <div class=\"mk-backdrop\"></div>\n      <div class=\"mk-card\" role=\"dialog\" aria-label=\"点歌台\">\n        <div class=\"mk-head\">\n          <div class=\"mk-title\">点歌台 <span data-el=\"ver\" style=\"font-size:11px;color:#7ee0b8;font-weight:600\"></span> <small>Alt+T 开 / 关 · Esc 关闭 · 点 ▶ 播放，点行复制歌名</small></div>\n          <div class=\"mk-right\">\n            ${opts.modeSwitch ? '<button class=\"mk-btn\" data-act=\"mode\" title=\"切换：点播到房间 / 只在本机听\">点播到房间</button>' : ''}\n            ${opts.hideLogin ? '' : '<button class=\"mk-btn\" data-act=\"login\">登录</button>'}\n            <button class=\"mk-btn mk-ghost mk-close\" data-act=\"close\" title=\"关闭 (Esc)\">✕</button>\n          </div>\n        </div>\n        <div class=\"mk-search\">\n          <input class=\"mk-input\" data-el=\"kw\" type=\"search\" placeholder=\"搜歌名 / 歌手，例如：晴天 周杰伦\" autocomplete=\"off\">\n          <select class=\"mk-select\" data-el=\"limit\">\n            <option value=\"10\">10 条</option>\n            <option value=\"20\" selected>20 条</option>\n            <option value=\"30\">30 条</option>\n          </select>\n          <button class=\"mk-btn mk-primary\" data-act=\"search\">搜索</button>\n        </div>\n        <div class=\"mk-tabs\" data-el=\"tabs\"></div>\n        <div class=\"mk-body\" data-el=\"body\"></div>\n        <div class=\"mk-pager\" data-el=\"pager\"></div>\n        <div class=\"mk-player\">\n          <button class=\"mk-ctl\" data-act=\"prev\" title=\"上一首\">⏮</button>\n          <button class=\"mk-ctl mk-main\" data-act=\"toggle-play\" title=\"播放 / 暂停\">▶</button>\n          <button class=\"mk-ctl\" data-act=\"next\" title=\"下一首\">⏭</button>\n          <div class=\"mk-now\" data-el=\"now\">未在播放<small>点结果里的 ▶ 开始</small></div>\n          <div class=\"mk-seek\">\n            <input type=\"range\" data-el=\"seek\" min=\"0\" max=\"1000\" value=\"0\" step=\"1\">\n            <span class=\"mk-time\" data-el=\"time\">0:00 / 0:00</span>\n          </div>\n          <div class=\"mk-vol\">🔊<input type=\"range\" data-el=\"vol\" min=\"0\" max=\"100\" value=\"90\"></div>\n        </div>\n        <div class=\"mk-stat\"><span data-el=\"stat\">等待搜索</span></div>\n      </div>`;\n    container.appendChild(root);\n\n    // 播放器本体（不放进 innerHTML，避免解析差异；直接创建元素更稳）\n    const audio = doc.createElement('audio');\n    audio.setAttribute('data-el', 'audio');\n    audio.preload = 'none';\n    root.appendChild(audio);\n\n    const $ = (sel) => root.querySelector(sel);\n    // 浏览器给元素赋值 innerHTML 后，子节点是异步/惰性解析的：紧接着 querySelector 在极少数环境里\n    // 会拿到 null。给一个\"哑元素\"兜底，坏消息是渲染不出来，好消息是不会把整个面板炸掉。\n    const stub = () => ({\n      innerHTML: '',\n      textContent: '',\n      value: '',\n      src: '',\n      currentTime: 0,\n      duration: 0,\n      volume: 1,\n      childElementCount: 0,\n      prepend() {},\n      appendChild() {},\n      addEventListener() {},\n      removeEventListener() {},\n      focus() {},\n      play: async () => {},\n      pause() {},\n      load() {},\n      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },\n    });\n    const elBody = $('[data-el=body]') || stub();\n    const elPager = $('[data-el=pager]') || stub();\n    const elTabs = $('[data-el=tabs]') || stub();\n    const elKw = $('[data-el=kw]') || stub();\n    const elLimit = $('[data-el=limit]') || stub();\n    const elStat = $('[data-el=stat]') || stub();\n    const elLoginBtn = $('[data-act=login]') || stub();\n    const elNow = $('[data-el=now]') || stub();\n    const elSeek = $('[data-el=seek]') || stub();\n    const elTime = $('[data-el=time]') || stub();\n    const elVol = $('[data-el=vol]') || stub();\n    const elPlayBtn = $('[data-act=toggle-play]') || stub();\n    const elAudio = root.querySelector('[data-el=audio]') || (function () {\n      const a = doc.createElement('audio');\n      root.appendChild(a);\n      return a;\n    })();\n    if (elVol && elVol.value !== undefined) {\n      elAudio.volume = (Number(elVol.value) || 90) / 100;\n    }\n\n    let platforms = Array.isArray(opts.platforms) && opts.platforms.length ? opts.platforms : PLATFORM_FALLBACK;\n    let current = opts.platform || platforms[0].id;\n    // 'local' = 面板自己用 <audio> 放（DSH 版）；'room' = 交给宿主点播到房间（IIROSE 版）\n    let playMode = opts.playMode === 'room' ? 'room' : 'local';\n    let session = null;\n    let busy = false;\n    let lastResults = [];\n    // 翻页状态：关键词/平台/条数变了就回到第 1 页\n    let page = 1;\n    let lastLimit = 20;\n    // 播放器状态（声明放在这里：songRow 在渲染时就要读它们，函数声明会提升、let 不会）\n    let playQueue = [];\n    let playIndex = -1;\n    let playCurrent = null;\n\n    // 版本号显示在标题旁边：刷新后一眼能确认「页面里跑的是新代码」。\n    const elVer = $('[data-el=ver]');\n    if (elVer && opts.version) elVer.textContent = 'v' + opts.version;\n\n    // 「点播到房间 / 仅本机试听」：只有宿主打开 modeSwitch 才渲染这个按钮。\n    // 房间模式下进度条、音量、时间没有意义（播的是房间播放器），一并收起。\n    const elModeBtn = $('[data-act=mode]');\n    function applyMode() {\n      if (elModeBtn) {\n        elModeBtn.textContent = playMode === 'room' ? '点播到房间' : '仅本机试听';\n        elModeBtn.classList.toggle('mk-primary', playMode === 'room');\n      }\n      const hideInRoom = playMode === 'room';\n      for (const el of [elSeek, elTime, elVol]) {\n        if (el && el.style) el.style.display = hideInRoom ? 'none' : '';\n      }\n    }\n    function notifyMode() {\n      if (typeof opts.onModeChange !== 'function') return;\n      try {\n        opts.onModeChange(playMode);\n      } catch {\n        /* 宿主的持久化失败不影响面板 */\n      }\n    }\n    applyMode();\n\n    function renderTabs() {\n      elTabs.innerHTML = platforms\n        .map(\n          (p) =>\n            `<button class=\"mk-tab${p.id === current ? ' mk-on' : ''}\" data-tab=\"${esc(p.id)}\">${esc(p.label)}</button>`,\n        )\n        .join('');\n    }\n\n    function setStat(text) {\n      elStat.innerHTML = text;\n    }\n\n    function showError(msg) {\n      const box = doc.createElement('div');\n      box.className = 'mk-err';\n      box.textContent = '出错了：' + msg;\n      elBody.prepend(box);\n    }\n\n    function songRow(s, i) {\n      // vip 可能是 null（平台没给这个字段，比如酷狗）——那就别标，省得误导「可听」其实要付费\n      const badge =\n        s.vip === true\n          ? '<span class=\"mk-tag mk-vip\">VIP/付费</span>'\n          : s.vip === false\n            ? '<span class=\"mk-tag mk-free\">可听</span>'\n            : '';\n      const dur = fmtDur(s.durationMs);\n      const sub = [s.artists && s.artists.join(' / '), s.album, dur].filter(Boolean).join(' · ');\n      const link = s.url\n        ? `<a href=\"${esc(s.url)}\" target=\"_blank\" rel=\"noopener\" title=\"在 ${esc(labelOf(s.platform))} 打开\">打开</a>`\n        : '';\n      const search =\n        '<a href=\"' +\n        esc(searchUrl(s)) +\n        '\" target=\"_blank\" rel=\"noopener\" title=\"在浏览器搜索这首歌\">搜</a>';\n      const inQueue = playQueue.some((x) => x.platform === s.platform && x.id === s.id);\n      const isCurrent = playCurrent && playCurrent.platform === s.platform && playCurrent.id === s.id;\n      // IIROSE 版的兜底：房间不让点播时，把 `@@歌名 歌手` 复制走，用户自己粘到聊天框\n      const directive =\n        typeof opts.onFallback === 'function'\n          ? `<button data-directive=\"${i}\" title=\"复制点播指令（房间不支持点播时用）\">指令</button>`\n          : '';\n      return `<div class=\"mk-song mk-clickable${isCurrent ? ' mk-playing' : ''}\" data-song=\"${i}\" title=\"点击复制「歌名 - 歌手」\">\n        <button class=\"mk-play${isCurrent ? ' mk-busy' : ''}\" data-play=\"${i}\" title=\"直接播放\">${isCurrent ? '♪' : '▶'}</button>\n        <div class=\"mk-idx\">${i + 1}</div>\n        <div class=\"mk-meta\"><div class=\"mk-name\">${esc(s.title)}</div><div class=\"mk-sub\">${esc(sub)}</div></div>\n        ${inQueue ? '<span class=\"mk-queuebadge\">已入列</span>' : ''}\n        ${badge}\n        <div class=\"mk-acts\">\n          <button data-queue=\"${i}\" title=\"加入播放队列\">+ 队列</button>\n          ${directive}\n          ${link}${search}\n        </div>\n      </div>`;\n    }\n\n    function labelOf(id) {\n      const p = platforms.find((x) => x.id === id);\n      return p ? p.label : id;\n    }\n\n    // ==================== 播放器 ====================\n    // 设计取舍：\n    //   · 只有\"能直连拿到音频\"的歌才播（163 的 fee=1 是版权锁，拿不到就是拿不到）；\n    //   · 拿不到时给一行明确原因 + 「跳转平台」，不装作在加载；\n    //   · 一个 <audio> + 队列，播完自动下一首。\n    function songKey(s) {\n      return s.platform + ':' + s.id;\n    }\n\n    function setNow(main, sub) {\n      elNow.innerHTML = esc(main || '未在播放') + (sub ? '<small>' + esc(sub) + '</small>' : '');\n    }\n\n    function setPlayIcon(playing) {\n      elPlayBtn.textContent = playing ? '⏸' : '▶';\n    }\n\n    function refreshRows() {\n      // 只更新状态，不重渲染整个列表（避免正在输入/滚动位置被重置）\n      const rows = root.querySelectorAll('.mk-song');\n      rows.forEach((row) => {\n        const i = Number(row.dataset.song);\n        const s = lastResults[i];\n        if (!s) return;\n        const isCurrent = playCurrent && playCurrent.platform === s.platform && playCurrent.id === s.id;\n        row.classList.toggle('mk-playing', Boolean(isCurrent));\n        const btn = row.querySelector('.mk-play');\n        if (btn) btn.textContent = isCurrent ? '♪' : '▶';\n      });\n    }\n\n    async function playSong(song, { enqueue = true } = {}) {\n      if (!song) return;\n      if (enqueue) {\n        const key = songKey(song);\n        const existing = playQueue.findIndex((x) => songKey(x) === key);\n        if (existing >= 0) playIndex = existing;\n        else {\n          playQueue.push(song);\n          playIndex = playQueue.length - 1;\n        }\n      }\n      playCurrent = song;\n      const label = song.title + (song.artists && song.artists.length ? ' - ' + song.artists.join('/') : '');\n      setNow(label, '解析播放地址…');\n      refreshRows();\n      try {\n        if (typeof api.playurl !== 'function') throw new Error('当前环境不支持直接播放（缺 api.playurl）');\n        const info = await api.playurl({ platform: song.platform, id: song.id });\n        if (!info || !info.playable) {\n          const why = (info && info.note) || (info && info.reason) || '拿不到可播放地址';\n          setNow(label, '⚠ ' + why + '（可用「打开」跳去平台）');\n          setStat('无法直接播放：' + esc(why));\n          return { played: false, reason: (info && info.reason) || 'unplayable' };\n        }\n        if (playMode === 'room') {\n          // 房间模式：不碰 <audio>（否则会和房间播放器双声），把解析结果交给宿主去发点播帧\n          if (typeof opts.onEnqueue !== 'function') throw new Error('当前环境不支持点播到房间（缺 onEnqueue）');\n          await opts.onEnqueue(song, info);\n          setNow(label, '已点播到房间 · 等房间开始播');\n          setPlayIcon(true);\n          setStat('已点播：' + esc(song.title));\n          return { played: true, mode: 'room' };\n        }\n        elAudio.src = info.streamUrl;\n        elAudio.load();\n        await elAudio.play();\n        setNow(label, '播放中 · ' + (info.ext || 'audio') + (info.bitrate ? ' · ' + Math.round(info.bitrate / 1000) + 'k' : ''));\n        setPlayIcon(true);\n        setStat('正在播放：' + esc(song.title));\n        return { played: true };\n      } catch (err) {\n        const msg = String((err && err.message) || err);\n        setNow(label, '播放失败：' + msg);\n        setPlayIcon(false);\n        return { played: false, reason: msg };\n      }\n    }\n\n    function togglePlay() {\n      if (playMode === 'room') {\n        // 房间里「播放/暂停」没有意义，这里当成「重发当前这首」\n        const target = playCurrent || lastResults[0];\n        if (!target) {\n          setStat('先搜索，再点 ▶');\n          return;\n        }\n        playSong(target, { enqueue: false });\n        return;\n      }\n      if (!elAudio.src) {\n        // 还没选歌：拿当前平台第一条结果开播\n        if (lastResults[0]) playSong(lastResults[0]);\n        else setStat('先搜索，再点 ▶');\n        return;\n      }\n      if (elAudio.paused) {\n        elAudio.play().then(() => setPlayIcon(true)).catch(() => setPlayIcon(false));\n      } else {\n        elAudio.pause();\n        setPlayIcon(false);\n      }\n    }\n\n    function step(delta) {\n      if (!playQueue.length) return;\n      playIndex = (playIndex + delta + playQueue.length) % playQueue.length;\n      playSong(playQueue[playIndex], { enqueue: false });\n    }\n\n    elAudio.addEventListener('timeupdate', () => {\n      const d = elAudio.duration || 0;\n      const t = elAudio.currentTime || 0;\n      if (!elSeek.dragging) {\n        elSeek.value = d ? String(Math.round((t / d) * 1000)) : '0';\n      }\n      elTime.textContent = fmtDur(t * 1000) + ' / ' + fmtDur(d * 1000);\n    });\n    elAudio.addEventListener('ended', () => step(1));\n    elAudio.addEventListener('error', () => {\n      setNow('播放出错', '换一首试试，或点「打开」去平台听');\n      setPlayIcon(false);\n    });\n    elSeek.addEventListener('input', () => { elSeek.dragging = true; });\n    elSeek.addEventListener('change', () => {\n      elSeek.dragging = false;\n      const d = elAudio.duration || 0;\n      if (d) elAudio.currentTime = (Number(elSeek.value) / 1000) * d;\n    });\n    elVol.addEventListener('input', () => {\n      elAudio.volume = Math.min(1, Math.max(0, (Number(elVol.value) || 0) / 100));\n    });\n\n    /** 面板状态导出：给自己/测试用，一眼看出播放器在干什么 */\n    function playerState() {\n      return {\n        mode: playMode,\n        queue: playQueue.map((s) => songKey(s)),\n        index: playIndex,\n        current: playCurrent ? songKey(playCurrent) : null,\n        src: elAudio.src ? String(elAudio.src).slice(0, 120) : null,\n        paused: elAudio.paused,\n      };\n    }\n\n    function searchUrl(s) {\n      const kw = [s.title, (s.artists || [])[0]].filter(Boolean).join(' ');\n      const home = (platforms.find((x) => x.id === s.platform) || {}).home || '';\n      if (s.platform === 'netease') return 'https://music.163.com/#/search/m/?s=' + encodeURIComponent(kw);\n      if (s.platform === 'kugou') return 'https://www.kugou.com/yy/html/search.html#searchType=song&searchKeyWord=' + encodeURIComponent(kw);\n      if (s.platform === 'qq') return 'https://y.qq.com/n/ryqq/search?w=' + encodeURIComponent(kw);\n      if (s.platform === 'bilibili') return 'https://search.bilibili.com/all?keyword=' + encodeURIComponent(kw);\n      return home;\n    }\n\n    function renderLogin() {\n      const who = session && session.nickname ? session.nickname : null;\n      const loggedIn = Boolean(session && session.loggedIn);\n      elBody.innerHTML = `\n        <div class=\"mk-login\">\n          <h3>${loggedIn ? '已登录' : '登录（可选）'}</h3>\n          <p class=\"note\">${loggedIn\n            ? '当前身份：' + esc(who || '已登录用户') + '（' + esc(session.platform || 'netease') + '）'\n            : '搜索不需要登录。登录只是为了在结果里标注「你的收藏 / 你常听」，以及后续做歌单导入。'}</p>\n          <div class=\"mk-warn\">凭据只写进本机 <code>DSH_HOME/music-plugin/credentials.json</code>（权限 600），\n            不会发给任何第三方；插件也不会把它打印到日志或列表里。公共电脑上建议别存。</div>\n          <div class=\"mk-field\">\n            <label>网易云 Cookie（浏览器登录 music.163.com 后，F12 → 网络 → 任意请求 → 复制 Cookie 请求头）</label>\n            <textarea data-el=\"cookie\" placeholder=\"MUSIC_U=...; __csrf=...;\"></textarea>\n          </div>\n          <div class=\"mk-row\">\n            <button class=\"mk-btn mk-primary\" data-act=\"save-login\">保存并验证</button>\n            <button class=\"mk-btn\" data-act=\"logout\" ${loggedIn ? '' : 'disabled'}>退出登录</button>\n            <span data-el=\"login-stat\" class=\"mk-sub\"></span>\n          </div>\n          <p class=\"note\" style=\"margin-top:14px\">为什么不做账号密码登录：那要求你把账号密码交给一个第三方插件，\n            风险和收益完全不成比例；扫码登录需要走官方 App 的私有接口，同样不适合。</p>\n        </div>`;\n    }\n\n    /** 翻页条：只在有结果时出现；「下一页」按 lastResults.length < lastLimit 判死 */\n    function renderPager() {\n      if (!elPager.classList) return;\n      if (!lastResults.length) {\n        elPager.innerHTML = '';\n        elPager.classList.remove('mk-on');\n        return;\n      }\n      const more = lastResults.length >= lastLimit;\n      elPager.innerHTML =\n        `<button data-act=\"page\" data-page=\"${page - 1}\" ${page <= 1 ? 'disabled' : ''}>‹ 上一页</button>` +\n        `<span>第 ${page} 页</span>` +\n        `<button data-act=\"page\" data-page=\"${page + 1}\" ${more ? '' : 'disabled'}>下一页 ›</button>`;\n      elPager.classList.add('mk-on');\n    }\n\n    async function doSearch(nextPage) {\n      if (busy) return;\n      const kw = elKw.value.trim();\n      if (!kw) {\n        elBody.innerHTML = '<div class=\"mk-empty\">先输入歌名或歌手</div>';\n        elPager.innerHTML = '';\n        elPager.classList.remove('mk-on');\n        return;\n      }\n      // 换了关键词/平台就从第 1 页开始；只有显式给页码才翻页\n      const target = Number(nextPage) || 1;\n      const limit = Number(elLimit.value) || 20;\n      busy = true;\n      setStat('<span class=\"mk-load\"></span> 正在搜 ' + esc(labelOf(current)) + (target > 1 ? ' · 第 ' + target + ' 页' : ''));\n      elBody.innerHTML = '<div class=\"mk-empty\">搜索中…</div>';\n      try {\n        const data = await api.search({ platform: current, keyword: kw, limit, page: target });\n        const list = data || [];\n        if (!list.length) {\n          if (target > 1) {\n            // 翻过头了：留在原页，别把用户已经看到的结果清掉\n            setStat('没有更多了 · 第 ' + page + ' 页');\n            elBody.innerHTML =\n              '<div class=\"mk-sect\">' + esc(labelOf(current)) + ' · ' + lastResults.length + ' 条</div>' +\n              lastResults.map(songRow).join('');\n            renderPager();\n          } else {\n            lastResults = [];\n            page = 1;\n            lastLimit = limit;\n            elBody.innerHTML = '<div class=\"mk-empty\">没有结果。换个关键词，或换一个平台试试。</div>';\n            setStat('0 条 · ' + esc(labelOf(current)));\n            renderPager();\n          }\n        } else {\n          lastResults = list;\n          page = target;\n          lastLimit = limit;\n          elBody.innerHTML =\n            '<div class=\"mk-sect\">' + esc(labelOf(current)) + ' · ' + lastResults.length + ' 条</div>' +\n            lastResults.map(songRow).join('');\n          setStat(lastResults.length + ' 条 · 第 ' + page + ' 页 · ' + esc(labelOf(current)));\n          renderPager();\n        }\n      } catch (err) {\n        elBody.innerHTML = '';\n        showError(String((err && err.message) || err));\n        setStat('失败');\n      } finally {\n        busy = false;\n      }\n    }\n\n    // 顶栏「登录 / 已登录」按钮跟着 session 走：登录、退出、刷新会话都要过这里，\n    // 否则会出现「已经登录了但按钮还写着登录」的不一致。\n    function applyLoginState() {\n      const loggedIn = Boolean(session && session.loggedIn);\n      elLoginBtn.textContent = loggedIn ? '已登录' : '登录';\n      elLoginBtn.classList.toggle('mk-primary', loggedIn);\n    }\n\n    async function refreshSession() {\n      if (typeof api.session !== 'function') return;\n      try {\n        session = await api.session();\n      } catch {\n        session = null;\n      }\n      applyLoginState();\n    }\n\n    // ---- 事件 ----\n    root.addEventListener('click', async (ev) => {\n      const tab = ev.target.closest('[data-tab]');\n      if (tab) {\n        current = tab.dataset.tab;\n        renderTabs();\n        if (elKw.value.trim()) doSearch();\n        return;\n      }\n      // 播放 / 入队 / 播放器控制（这些要放在 act 之前判断，优先级最高）\n      const playBtn = ev.target.closest('[data-play]');\n      if (playBtn) {\n        const s = lastResults[Number(playBtn.dataset.play)];\n        if (s) {\n          playBtn.classList.add('mk-busy');\n          await playSong(s);\n          playBtn.classList.remove('mk-busy');\n        }\n        return;\n      }\n      const queueBtn = ev.target.closest('[data-queue]');\n      if (queueBtn) {\n        const s = lastResults[Number(queueBtn.dataset.queue)];\n        if (s && !playQueue.some((x) => songKey(x) === songKey(s))) {\n          playQueue.push(s);\n          setStat('已加入队列（' + playQueue.length + ' 首）：' + esc(s.title));\n          refreshRows();\n        }\n        return;\n      }\n      const dirBtn = ev.target.closest('[data-directive]');\n      if (dirBtn) {\n        const s = lastResults[Number(dirBtn.dataset.directive)];\n        if (s && typeof opts.onFallback === 'function') {\n          try {\n            const text = await opts.onFallback(s);\n            setStat('已复制指令「' + esc(text) + '」，粘到聊天框发送即可');\n          } catch (err) {\n            setStat('复制指令失败：' + esc(String((err && err.message) || err)));\n          }\n        }\n        return;\n      }\n      const act = ev.target.closest('[data-act]');\n      if (act) {\n        const name = act.dataset.act;\n        if (name === 'close') close();\n        else if (name === 'search') doSearch();\n        else if (name === 'page') doSearch(Number(act.dataset.page));\n        else if (name === 'mode') {\n          playMode = playMode === 'room' ? 'local' : 'room';\n          if (playMode === 'room') {\n            try {\n              elAudio.pause();\n            } catch {\n              /* 没在放就无所谓 */\n            }\n          }\n          applyMode();\n          notifyMode();\n          setStat(playMode === 'room' ? '已切到「点播到房间」' : '已切到「仅本机试听」');\n        }\n        else if (name === 'prev') step(-1);\n        else if (name === 'next') step(1);\n        else if (name === 'toggle-play') togglePlay();\n        else if (name === 'login') {\n          renderLogin();\n          setStat('登录设置');\n        } else if (name === 'save-login') {\n          const cookie = root.querySelector('[data-el=cookie]').value.trim();\n          const stat = root.querySelector('[data-el=login-stat]');\n          stat.textContent = '验证中…';\n          try {\n            if (typeof api.login !== 'function') throw new Error('当前环境不支持保存登录');\n            session = await api.login({ platform: 'netease', cookie });\n            stat.textContent = session && session.loggedIn ? '验证通过，已登录' : '已保存（未能确认登录态）';\n            applyLoginState();\n            if (session && session.loggedIn) renderLogin();\n          } catch (err) {\n            stat.textContent = '失败：' + String((err && err.message) || err);\n          }\n        } else if (name === 'logout') {\n          try {\n            if (typeof api.logout === 'function') await api.logout();\n          } catch { /* 退出失败也让 UI 回到未登录 */ }\n          session = null;\n          applyLoginState();\n          renderLogin();\n        }\n        return;\n      }\n      // 点行空白处 = 复制歌名；点行里的 ▶ = 直接播（上面已处理）\n      const row = ev.target.closest('[data-song]');\n      if (row && !ev.target.closest('a') && !ev.target.closest('button')) {\n        const s = lastResults[Number(row.dataset.song)];\n        if (!s) return;\n        const text = s.title + ' - ' + (s.artists || []).join('/');\n        try {\n          await navigator.clipboard.writeText(text);\n          setStat('已复制：' + esc(text));\n        } catch {\n          setStat('复制失败，请手动选择文本');\n        }\n      }\n    });\n\n    root.addEventListener('keydown', (ev) => {\n      if (ev.key === 'Escape') {\n        ev.stopPropagation();\n        close();\n      } else if (ev.key === 'Enter' && ev.target === elKw) {\n        ev.preventDefault();\n        doSearch();\n      }\n    });\n\n    function onDocKey(ev) {\n      if (ev.key === 'Escape' && root.classList.contains('mk-open')) close();\n    }\n\n    function open() {\n      root.classList.add('mk-open');\n      renderTabs();\n      if (!elBody.childElementCount) {\n        elBody.innerHTML =\n          '<div class=\"mk-empty\">输入关键词，回车搜索。<br>' +\n          platforms.map((p) => esc(p.label)).join(' · ') +\n          '</div>';\n      }\n      doc.addEventListener('keydown', onDocKey, true);\n      setTimeout(() => elKw.focus(), 0);\n      refreshSession();\n    }\n\n    function close() {\n      root.classList.remove('mk-open');\n      doc.removeEventListener('keydown', onDocKey, true);\n    }\n\n    function toggle() {\n      if (root.classList.contains('mk-open')) close();\n      else open();\n    }\n\n    function dispose() {\n      close();\n      root.remove();\n    }\n\n    if (typeof api.platforms === 'function') {\n      api.platforms()\n        .then((list) => {\n          if (Array.isArray(list) && list.length) {\n            platforms = list;\n            renderTabs();\n          }\n        })\n        .catch(() => {});\n    }\n\n    if (opts.openOnMount !== false) open();\n    return {\n      open,\n      close,\n      toggle,\n      dispose,\n      root,\n      audio: elAudio,\n      setPlatform(id) { current = id; renderTabs(); },\n      /** 宿主（IIROSE 版）可以在运行时切模式，例如读 localStorage 的偏好 */\n      setMode(mode) {\n        playMode = mode === 'room' ? 'room' : 'local';\n        applyMode();\n        notifyMode();\n        return playMode;\n      },\n      getMode: () => playMode,\n      /** 宿主把「房间正在播放」推回面板（IIROSE 版监听 &1 帧后调用） */\n      setRoomNow(text, sub) {\n        setNow(text || '未在播放', sub || '');\n      },\n      // 给外面的测试/诊断用\n      play: (song) => playSong(song || lastResults[0]),\n      queue: () => playQueue.slice(),\n      results: () => lastResults.slice(),\n      state: playerState,\n    };\n  }\n\n  global.mountMusicPanel = mountMusicPanel;\n  if (typeof module !== 'undefined' && module.exports) module.exports = { mountMusicPanel };\n})(typeof window !== 'undefined' ? window : globalThis);\n";

  const STYLE_ID = 'dsh-music-request-panel';

  function ensurePanelScript(doc) {
    // 用 window 而不是 doc.defaultView：后者在内嵌/沙箱场景里可能是 undefined，
    // 而这段代码本来就跑在页面主世界，window 永远是对的（这个坑是冒烟测试抓出来的）。
    if (typeof window.mountMusicPanel === 'function') return Promise.resolve();
    const existing = doc.getElementById(STYLE_ID + '-script');
    if (existing) {
      return new Promise((resolve, reject) => {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error('内联脚本执行失败')), { once: true });
      });
    }
    return new Promise((resolve, reject) => {
      const script = doc.createElement('script');
      script.id = STYLE_ID + '-script';
      script.textContent = PANEL_SOURCE;
      script.addEventListener('load', () => resolve(), { once: true });
      script.addEventListener('error', () => reject(new Error('内联脚本执行失败')), { once: true });
      doc.head.appendChild(script);
      // 内联脚本 load 事件在某些情况下不派发；执行完成即可认为就绪。
      if (typeof window.mountMusicPanel === 'function') resolve();
    });
  }

  function makeApi() {
    async function call(path, init) {
      const res = await fetch(path, Object.assign({ headers: { accept: 'application/json' } }, init || {}));
      let out;
      try {
        out = await res.json();
      } catch {
        throw new Error('host 路由没有返回 JSON（HTTP ' + res.status + '）');
      }
      if (!out || out.ok !== true) throw new Error((out && out.error) || 'HTTP ' + res.status);
      return out.data;
    }
    return {
      search({ platform, keyword, limit, page }) {
        const qs = new URLSearchParams({
          platform,
          kw: keyword,
          limit: String(limit || 20),
          page: String(page || 1),
        });
        return call('/music/api/search?' + qs.toString());
      },
      /** 解析「能不能直接播 / 播哪个同源代理地址」，播放器的唯一入口 */
      playurl({ platform, id }) {
        const qs = new URLSearchParams({ platform, id: String(id) });
        return call('/music/api/playurl?' + qs.toString());
      },
      platforms() {
        return call('/music/api/platforms');
      },
      session() {
        return call('/music/api/session');
      },
      login(payload) {
        return call('/music/api/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload || {}),
        });
      },
      logout() {
        return call('/music/api/logout', { method: 'POST' });
      },
    };
  }

  function makeFactory() {
    return (require) => {
      const module = { exports: {} };
      const name = 'music-request';
      const inject = ['slots'];
      const VERSION = '0.2.0';

      /**
       * 诊断三件套（留着，别再删）：
       *   1. document.body[data-dsh-music-request] —— DevTools 里一眼看出客户端半侧有没有跑
       *   2. window.__MUSIC_REQUEST__ —— 面板是否挂上、最近一次错误、最近 5 次按键
       *   3. 按键嗅探 —— 排查「Alt+T 到底有没有送到 DOM」
       */
      function makeDiag() {
        const diag = {
          version: VERSION,
          state: 'loading',
          panelMounted: false,
          lastError: null,
          keys: [],
          openCount: 0,
          note: 'state=ready 表示客户端半侧已跑起来；keys 会记下最近 5 次按键',
        };
        diag.put = () => {
          try {
            if (document.body) document.body.setAttribute('data-dsh-music-request', diag.state);
          } catch {
            /* 忽略 */
          }
        };
        diag.put();
        try {
          window.__MUSIC_REQUEST__ = diag;
        } catch {
          /* 忽略 */
        }
        return diag;
      }

      function apply(ctx) {
        const doc = document;
        const diag = makeDiag();
        let panel = null;
        let host = null;

        function ensurePanel() {
          if (panel) return Promise.resolve(panel);
          return ensurePanelScript(doc).then(() => {
            const mount = window.mountMusicPanel;
            if (typeof mount !== 'function') throw new Error('面板脚本未注册 mountMusicPanel');
            host = doc.createElement('div');
            host.setAttribute('data-dsh-music-request', 'host');
            doc.body.appendChild(host);
            panel = mount(host, { api: makeApi(), openOnMount: false, version: VERSION });
            diag.panelMounted = true;
            diag.state = 'ready';
            diag.put();
            try {
              window.__panel = panel; // 方便在 DevTools 里直接 __panel.open()
            } catch {
              /* 忽略 */
            }
            return panel;
          });
        }

        function fail(where, err) {
          diag.state = 'error:' + where;
          diag.lastError = String((err && err.message) || err);
          if (err && err.stack) diag.lastStack = String(err.stack).split('\n').slice(0, 4).join(' | ');
          diag.put();
          console.error('[music-request] ' + where + ' 失败：' + diag.lastError + '  @@ ' + (diag.lastStack || ''));
        }

        // shell.overlay 插槽注册：面板本体是 body 直属节点，这里只是占个位
        // （将来要在「设置」里加一个打开入口时，这个 entry 就是挂载点）。
        try {
          ctx.slots.inject('shell.overlay', function* () {
            yield ctx.slots.register({ name: 'shell.overlay', id: 'music-request', order: 1010 }, () => null);
          });
        } catch (err) {
          console.warn('[music-request] shell.overlay 注册失败（不影响 Alt+T）：' + err);
        }

        // Alt+T：直接监听 keydown，不走 ctx.shortcuts ——
        //   · 用户点名要 Alt+T，不做成可配置项；
        //   · Web 上快捷键服务对 Alt 组合另有约束，DOM 监听更直接、也更好排查。
        function onKeyDown(ev) {
          try {
            diag.keys.push(
              (ev.altKey ? 'Alt+' : '') + (ev.ctrlKey ? 'Ctrl+' : '') + (ev.metaKey ? 'Meta+' : '') +
                (ev.shiftKey ? 'Shift+' : '') + (ev.code || ev.key),
            );
            if (diag.keys.length > 5) diag.keys.shift();
          } catch {
            /* 忽略 */
          }
          if (!ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
          if (ev.code !== 'KeyT' && String(ev.key).toLowerCase() !== 't') return;
          ev.preventDefault();
          ev.stopPropagation();
          // 返回这个 Promise：浏览器不在乎，但离线冒烟测试要 await 它，
          // 否则断言会跑在面板真正打开之前（这个坑也踩过）。
          return ensurePanel()
            .then((p) => {
              diag.openCount++;
              p.toggle();
            })
            .catch((err) => fail('open', err));
        }

        doc.addEventListener('keydown', onKeyDown, true);

        ctx.effect(() => () => {
          doc.removeEventListener('keydown', onKeyDown, true);
          try {
            if (panel) panel.dispose();
          } catch {}
          try {
            if (host) host.remove();
          } catch {}
          panel = null;
          host = null;
          diag.state = 'disposed';
          diag.put();
        }, 'dsh-music-request: panel');

        // 预热：加载后就把面板注入好（但不打开）。首次 Alt+T 立刻出画面，
        // 同时 data-dsh-music-request 会从 loading 变 ready —— 一眼看出客户端半侧跑没跑。
        ensurePanel()
          .then(() => console.info('[music-request] v' + VERSION + ' 就绪：按 Alt+T 打开点歌台'))
          .catch((err) => fail('warmup', err));
      }

      module.exports = { apply, inject, name };
      return module.exports;
    };
  }

  window.__ModuleLoader__.load({ id: 'dsh-music-request', factory: makeFactory() });
})();
