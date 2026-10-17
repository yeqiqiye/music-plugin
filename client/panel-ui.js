/**
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
@media (max-width:640px){
  .mk-card{width:100vw;height:100vh;border-radius:0}
  .mk-acts{display:none}
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
          <div class="mk-title">点歌台 <span data-el="ver" style="font-size:11px;color:#7ee0b8;font-weight:600"></span> <small>Alt+T 开 / 关 · Esc 关闭 · 点 ▶ 直接播，点行复制歌名</small></div>
          <div class="mk-right">
            <button class="mk-btn" data-act="login">登录</button>
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
        <div class="mk-body" data-el="body"></div>
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
    const elTabs = $('[data-el=tabs]') || stub();
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
    let session = null;
    let busy = false;
    let lastResults = [];
    // 播放器状态（声明放在这里：songRow 在渲染时就要读它们，函数声明会提升、let 不会）
    let playQueue = [];
    let playIndex = -1;
    let playCurrent = null;

    // 版本号显示在标题旁边：刷新后一眼能确认「页面里跑的是新代码」。
    const elVer = $('[data-el=ver]');
    if (elVer && opts.version) elVer.textContent = 'v' + opts.version;

    function renderTabs() {
      elTabs.innerHTML = platforms
        .map(
          (p) =>
            `<button class="mk-tab${p.id === current ? ' mk-on' : ''}" data-tab="${esc(p.id)}">${esc(p.label)}</button>`,
        )
        .join('');
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
      const badge = s.vip
        ? '<span class="mk-tag mk-vip">VIP/付费</span>'
        : '<span class="mk-tag mk-free">可听</span>';
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
      return `<div class="mk-song mk-clickable${isCurrent ? ' mk-playing' : ''}" data-song="${i}" title="点击复制「歌名 - 歌手」">
        <button class="mk-play${isCurrent ? ' mk-busy' : ''}" data-play="${i}" title="直接播放">${isCurrent ? '♪' : '▶'}</button>
        <div class="mk-idx">${i + 1}</div>
        <div class="mk-meta"><div class="mk-name">${esc(s.title)}</div><div class="mk-sub">${esc(sub)}</div></div>
        ${inQueue ? '<span class="mk-queuebadge">已入列</span>' : ''}
        ${badge}
        <div class="mk-acts">
          <button data-queue="${i}" title="加入播放队列">+ 队列</button>
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

    async function doSearch() {
      if (busy) return;
      const kw = elKw.value.trim();
      if (!kw) {
        elBody.innerHTML = '<div class="mk-empty">先输入歌名或歌手</div>';
        return;
      }
      busy = true;
      setStat('<span class="mk-load"></span> 正在搜 ' + esc(labelOf(current)));
      elBody.innerHTML = '<div class="mk-empty">搜索中…</div>';
      try {
        const data = await api.search({ platform: current, keyword: kw, limit: Number(elLimit.value) || 20 });
        lastResults = data || [];
        if (!lastResults.length) {
          elBody.innerHTML = '<div class="mk-empty">没有结果。换个关键词，或换一个平台试试。</div>';
          setStat('0 条 · ' + esc(labelOf(current)));
        } else {
          elBody.innerHTML =
            '<div class="mk-sect">' + esc(labelOf(current)) + ' · ' + lastResults.length + ' 条</div>' +
            lastResults.map(songRow).join('');
          setStat(lastResults.length + ' 条 · ' + esc(labelOf(current)));
        }
      } catch (err) {
        elBody.innerHTML = '';
        showError(String((err && err.message) || err));
        setStat('失败');
      } finally {
        busy = false;
      }
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
      const act = ev.target.closest('[data-act]');
      if (act) {
        const name = act.dataset.act;
        if (name === 'close') close();
        else if (name === 'search') doSearch();
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
      renderTabs();
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
