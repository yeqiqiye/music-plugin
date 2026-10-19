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
    { id: 'qq', label: 'QQ 音乐', home: 'https://y.qq.com/' },
    { id: 'bilibili', label: 'B 站（Live / MV）', home: 'https://www.bilibili.com/' },
  ];

  const CSS = `
.mk-root{position:fixed;inset:0;z-index:2147483000;display:none;align-items:center;justify-content:center;
  font:14px/1.6 "Microsoft YaHei","PingFang SC","Segoe UI",system-ui,sans-serif;color:var(--mk-fg);
  /* ---- 配色 token：深色是默认，浅色只在 [data-theme=light] 里覆盖 ---- */
  --mk-bg:#141a24;--mk-fg:#e9eef7;--mk-dim:#93a1b8;--mk-line:#2b3444;
  --mk-input:#1b2432;--mk-btn:#202a39;
  --mk-hover:#1a2230;--mk-hover-strong:#26344a;--mk-raised:#1e2836;
  --mk-bar:#101720;--mk-pager-bg:#0f161f;
  --mk-on-bg:#17324f;--mk-on-fg:#cfe6ff;--mk-on-line:#2f6ea8;
  --mk-primary-bg:#173a5e;--mk-primary-fg:#cfe6ff;
  --mk-playing:#16304a;
  --mk-err-bg:#3a1f22;--mk-err-fg:#ffc9cf;--mk-err-line:#6b3238;
  --mk-warn-bg:#3a3320;--mk-warn-fg:#ffe6a8;--mk-warn-line:#6b5a26;
  --mk-ok-fg:#7ee0b8;--mk-ok-line:#2c5f4c;
  --mk-vip-fg:#ffd479;--mk-vip-line:#6b5626;
  --mk-scrim:rgba(6,9,14,.62);
  --mk-shadow:0 24px 70px rgba(0,0,0,.55);
  --mk-accent:#4a8fd6;
  color-scheme:dark}
.mk-root.mk-open{display:flex}
/* ---- 外观设置：主题 / 强调色 / 毛玻璃 / 紧凑 / 背景 ---- */
.mk-root[data-theme=light]{
  --mk-bg:#f7f9fc;--mk-fg:#18212e;--mk-dim:#5a6a80;--mk-line:#dfe6f0;
  --mk-input:#fff;--mk-btn:#edf1f7;
  --mk-hover:#eef3fa;--mk-hover-strong:#e3ecf7;--mk-raised:#f1f5fa;
  --mk-bar:#eef3fa;--mk-pager-bg:#f1f5fa;
  --mk-on-bg:#e2edfa;--mk-on-fg:#0d4a73;--mk-on-line:#7fb0dd;
  --mk-primary-bg:#dcebfa;--mk-primary-fg:#0f4a73;
  --mk-playing:#e6f1fd;
  --mk-err-bg:#fdecec;--mk-err-fg:#8a2028;--mk-err-line:#f0b4b2;
  --mk-warn-bg:#fff7e3;--mk-warn-fg:#7a5a10;--mk-warn-line:#efd79a;
  --mk-ok-fg:#0f6b55;--mk-ok-line:#b6e3d5;
  --mk-vip-fg:#8a5c00;--mk-vip-line:#efd79a;
  --mk-scrim:rgba(226,232,242,.62);
  --mk-shadow:0 24px 70px rgba(20,32,52,.18);
  color-scheme:light}
/* 强调色按「主题 × 颜色」成对给值：浅色底上太亮的蓝会看不清 */
.mk-root[data-accent=blue]{--mk-accent:#4a8fd6}
.mk-root[data-accent=teal]{--mk-accent:#2fb59a}
.mk-root[data-accent=violet]{--mk-accent:#8a7cf0}
.mk-root[data-accent=pink]{--mk-accent:#e26aa8}
.mk-root[data-theme=light][data-accent=blue]{--mk-accent:#2f6ea8}
.mk-root[data-theme=light][data-accent=teal]{--mk-accent:#149e83}
.mk-root[data-theme=light][data-accent=violet]{--mk-accent:#6a5be0}
.mk-root[data-theme=light][data-accent=pink]{--mk-accent:#d24b8c}
.mk-root.mk-compact .mk-song{padding:4px 10px}
.mk-root.mk-compact .mk-sub{font-size:11px}
.mk-root .mk-tab.mk-on,.mk-root .mk-scope.mk-on{border-color:var(--mk-accent)}
.mk-root .mk-input:focus,.mk-root .mk-entity:hover{border-color:var(--mk-accent)}
.mk-root .mk-song.mk-playing{border-color:var(--mk-accent)}
.mk-root .mk-pager button:hover:not(:disabled){border-color:var(--mk-accent)}
/* ---- 自定义背景：.mk-bgimg 放图，.mk-scrim 压一层遮罩 ---- */
.mk-bgimg,.mk-scrim{display:none}
.mk-root[data-bg="1"] .mk-card>*{position:relative;z-index:1}
.mk-root[data-bg="1"] .mk-card>.mk-bgimg,
.mk-root[data-bg="1"] .mk-card>.mk-scrim{display:block;position:absolute;inset:0;z-index:0;pointer-events:none}
.mk-root[data-bg="1"] .mk-card>.mk-bgimg{background-image:var(--mk-bg-img,none);background-size:cover;
  background-position:center;filter:blur(var(--mk-bg-blur,0px));transform:scale(1.06)}
.mk-root[data-bg="1"] .mk-card>.mk-scrim{background:var(--mk-scrim);opacity:var(--mk-veil,0)}
.mk-root[data-bg="1"] .mk-head,.mk-root[data-bg="1"] .mk-body{background:transparent}
.mk-root[data-bg="1"]{--mk-bar:rgba(16,23,32,.82);--mk-pager-bg:rgba(15,22,31,.82)}
.mk-root[data-bg="1"][data-theme=light]{--mk-bar:rgba(238,243,250,.86);--mk-pager-bg:rgba(241,245,250,.86)}
.mk-backdrop{position:absolute;inset:0;background:var(--mk-scrim);backdrop-filter:blur(3px)}
.mk-card{position:relative;width:min(1000px,94vw);height:min(720px,90vh);display:flex;flex-direction:column;
  background:color-mix(in srgb, var(--mk-bg) calc(var(--mk-alpha, 1) * 100%), transparent);
  backdrop-filter:blur(calc((1 - var(--mk-alpha, 1)) * 12px));
  border:1px solid var(--mk-line);border-radius:16px;overflow:hidden;
  box-shadow:var(--mk-shadow)}
.mk-clock{font-variant-numeric:tabular-nums;font-size:12.5px;color:var(--mk-dim);padding:3px 9px;
  border:1px solid var(--mk-line);border-radius:8px;letter-spacing:.5px}
.mk-clock[hidden]{display:none}
.mk-sel{width:15px;height:15px;accent-color:var(--mk-accent);margin:0 4px 0 0;flex:none;cursor:pointer}
.mk-range{width:100%;margin:8px 0 2px;accent-color:var(--mk-accent)}
.mk-badge{font-size:12px;color:var(--mk-accent);font-variant-numeric:tabular-nums;font-weight:600}
.mk-head{display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid var(--mk-line)}
.mk-title{font-size:16px;font-weight:700;letter-spacing:.3px}
.mk-title small{display:block;font-size:11px;font-weight:400;color:var(--mk-dim);letter-spacing:0}
.mk-right{margin-left:auto;display:flex;gap:8px;align-items:center}
.mk-btn{background:var(--mk-btn);color:inherit;border:1px solid var(--mk-line);border-radius:9px;
  padding:6px 12px;font-size:13px;cursor:pointer;transition:.12s}
.mk-btn:hover{border-color:var(--mk-accent);background:var(--mk-hover-strong)}
.mk-btn.mk-primary{background:var(--mk-primary-bg);border-color:var(--mk-on-line);color:var(--mk-primary-fg)}
.mk-btn.mk-ghost{background:transparent}
.mk-close{font-size:18px;line-height:1;padding:4px 10px}
.mk-search{display:flex;gap:10px;padding:14px 16px 10px;flex-wrap:wrap;align-items:center}
.mk-input{flex:1 1 260px;min-width:180px;background:var(--mk-input);color:inherit;
  border:1px solid var(--mk-line);border-radius:10px;padding:10px 13px;font-size:14px;outline:none}
.mk-input:focus{border-color:var(--mk-accent)}
.mk-select{background:var(--mk-input);color:inherit;border:1px solid var(--mk-line);
  border-radius:10px;padding:10px 12px;font-size:13px;outline:none}
.mk-tabs{display:flex;gap:6px;padding:0 16px 10px;flex-wrap:wrap;border-bottom:1px solid var(--mk-line)}
.mk-tab{background:transparent;color:var(--mk-dim);border:1px solid transparent;border-radius:8px;
  padding:6px 12px;font-size:13px;cursor:pointer}
.mk-tab:hover{color:var(--mk-fg);background:var(--mk-hover)}
.mk-tab.mk-on{color:var(--mk-on-fg);background:var(--mk-on-bg);border-color:var(--mk-on-line)}
.mk-body{flex:1;overflow:auto;padding:8px 10px 16px}
.mk-sect{display:flex;align-items:center;gap:8px;padding:10px 8px 6px;color:var(--mk-dim);font-size:12px}
.mk-sect::after{content:"";flex:1;height:1px;background:var(--mk-line)}
.mk-song{display:flex;gap:10px;align-items:center;padding:11px 10px;border-radius:10px;border:1px solid transparent}
.mk-song:hover{background:var(--mk-hover);border-color:var(--mk-line)}
.mk-song .mk-cover{width:44px;height:44px;border-radius:8px}
.mk-song .mk-cover.mk-ph{font-size:15px}
.mk-song.mk-clickable{cursor:pointer}
.mk-idx{width:26px;text-align:right;color:var(--mk-dim);font-size:12px;flex:none}
.mk-meta{flex:1;min-width:0}
.mk-name{font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mk-sub{font-size:12px;color:var(--mk-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mk-tag{font-size:10px;border:1px solid var(--mk-line);border-radius:20px;padding:1px 7px;color:var(--mk-dim);flex:none}
.mk-tag.mk-free{color:var(--mk-ok-fg);border-color:var(--mk-ok-line)}
.mk-tag.mk-vip{color:var(--mk-vip-fg);border-color:var(--mk-vip-line)}
.mk-acts{display:flex;gap:6px;flex:none}
.mk-acts a,.mk-acts button{font-size:12px;text-decoration:none;color:inherit;border:1px solid var(--mk-line);
  border-radius:8px;padding:4px 10px;background:var(--mk-raised);cursor:pointer;font-family:inherit}
.mk-acts a:hover,.mk-acts button:hover{border-color:var(--mk-accent);background:var(--mk-hover-strong)}
.mk-song.mk-playing{background:var(--mk-playing);border-color:var(--mk-accent)}
.mk-play{width:30px;height:30px;flex:none;border-radius:50%;border:1px solid var(--mk-line);
  background:var(--mk-raised);color:inherit;font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:center}
.mk-play:hover{border-color:var(--mk-accent);background:var(--mk-hover-strong)}
.mk-play.mk-busy{opacity:.55;cursor:wait}
.mk-play.mk-locked{opacity:.45;cursor:not-allowed}
.mk-player{display:flex;align-items:center;gap:10px;padding:9px 16px;border-top:1px solid var(--mk-line);
  background:var(--mk-bar);flex-wrap:wrap}
.mk-player .mk-ctl{width:32px;height:32px;border-radius:50%;border:1px solid var(--mk-line);
  background:var(--mk-raised);color:inherit;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;flex:none}
.mk-player .mk-ctl:hover{border-color:var(--mk-accent);background:var(--mk-hover-strong)}
.mk-player .mk-ctl.mk-main{background:var(--mk-primary-bg);border-color:var(--mk-on-line);color:var(--mk-primary-fg);width:36px;height:36px}
.mk-now{flex:1 1 150px;min-width:110px;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mk-now small{display:block;color:var(--mk-dim);font-size:11.5px}
.mk-seek{flex:2 1 190px;display:flex;align-items:center;gap:8px;min-width:150px}
.mk-seek input[type=range]{flex:1;accent-color:var(--mk-accent)}
.mk-time{font-size:11.5px;color:var(--mk-dim);font-variant-numeric:tabular-nums;flex:none;min-width:80px;text-align:right}
.mk-vol{display:flex;align-items:center;gap:6px;flex:none;color:var(--mk-dim);font-size:12px}
.mk-vol input[type=range]{width:70px;accent-color:var(--mk-accent)}
.mk-queuebadge{font-size:10px;color:var(--mk-ok-fg);border:1px solid var(--mk-ok-line);border-radius:20px;padding:1px 6px;flex:none}
.mk-empty{padding:34px 16px;text-align:center;color:var(--mk-dim);font-size:13px}
.mk-err{margin:8px 10px;padding:10px 12px;border-radius:10px;background:var(--mk-err-bg);
  border:1px solid var(--mk-err-line);color:var(--mk-err-fg);font-size:13px}
.mk-stat{padding:6px 16px;border-top:1px solid var(--mk-line);color:var(--mk-dim);font-size:12px;display:flex;gap:14px;align-items:center}
.mk-load{display:inline-block;width:13px;height:13px;border:2px solid var(--mk-accent);border-top-color:transparent;
  border-radius:50%;animation:mk-spin .7s linear infinite;vertical-align:-2px}
@keyframes mk-spin{to{transform:rotate(360deg)}}
.mk-login{padding:16px;max-width:560px}
.mk-login h3{margin:0 0 4px;font-size:15px}
.mk-login p.note{color:var(--mk-dim);font-size:12.5px;margin:0 0 14px}
.mk-field{display:flex;flex-direction:column;gap:6px;margin-bottom:12px}
.mk-field label{font-size:12.5px;color:var(--mk-dim)}
.mk-field textarea{min-height:96px;resize:vertical;font-family:ui-monospace,Consolas,monospace;font-size:12px;
  background:var(--mk-input);color:inherit;border:1px solid var(--mk-line);border-radius:10px;padding:10px}
.mk-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.mk-warn{background:var(--mk-warn-bg);border:1px solid var(--mk-warn-line);color:var(--mk-warn-fg);
  border-radius:10px;padding:9px 11px;font-size:12.5px;margin-bottom:12px}
.mk-pager{display:none;align-items:center;justify-content:center;gap:10px;padding:8px 16px;border-top:1px solid var(--mk-line);background:var(--mk-pager-bg);font-size:12.5px;color:var(--mk-dim)}
.mk-pager.mk-on{display:flex}
.mk-pager button{font-size:12.5px;color:inherit;border:1px solid var(--mk-line);border-radius:8px;
  padding:4px 10px;background:var(--mk-raised);cursor:pointer;font-family:inherit}
.mk-pager button:hover:not(:disabled){border-color:var(--mk-accent);background:var(--mk-hover-strong)}
.mk-pager button:disabled{opacity:.4;cursor:not-allowed}
/* ---------- 搜用户 / 搜歌单（移动端批量点歌主要靠这块） ---------- */
.mk-scopes{display:flex;gap:6px;padding:0 16px 8px;overflow-x:auto;-webkit-overflow-scrolling:touch}
.mk-scope{background:transparent;color:var(--mk-dim);border:1px solid var(--mk-line);
  border-radius:999px;padding:5px 13px;font-size:12.5px;cursor:pointer;white-space:nowrap;font-family:inherit;flex:none}
.mk-scope:hover{color:var(--mk-fg)}
.mk-scope.mk-on{color:var(--mk-on-fg);background:var(--mk-on-bg);border-color:var(--mk-on-line)}
.mk-entity{display:flex;gap:12px;align-items:center;padding:10px;border-radius:10px;border:1px solid transparent;cursor:pointer}
.mk-entity:hover{background:var(--mk-hover);border-color:var(--mk-line)}
.mk-cover{width:44px;height:44px;border-radius:9px;flex:none;object-fit:cover;background:var(--mk-raised)}
.mk-cover.mk-ph{display:flex;align-items:center;justify-content:center;color:var(--mk-dim);font-size:17px}
.mk-detail-head{display:flex;gap:12px;align-items:center;padding:10px 8px 12px;border-bottom:1px solid var(--mk-line);margin-bottom:8px}
.mk-detail-head .mk-cover{width:58px;height:58px}
.mk-detail-acts{display:flex;gap:8px;flex-wrap:wrap;margin-left:auto}
/* ---------- 设置页 ---------- */
.mk-set{padding:14px 16px 20px;max-width:620px}
.mk-set h3{margin:0 0 10px;font-size:15px}
.mk-set-group{margin-bottom:14px}
.mk-set-group h4{margin:0 0 6px;font-size:11.5px;color:var(--mk-dim);font-weight:700;letter-spacing:.4px}
.mk-set-row{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--mk-line)}
.mk-set-row:last-child{border-bottom:0}
.mk-set-row .mk-meta{flex:1;min-width:0}
.mk-set-row b{display:block;font-weight:600;font-size:13.5px}
.mk-set-row small{display:block;color:var(--mk-dim);font-size:11.5px;line-height:1.45}
.mk-sw{width:46px;height:26px;border-radius:999px;border:1px solid var(--mk-line);background:var(--mk-raised);
  position:relative;cursor:pointer;flex:none;transition:.15s;padding:0}
.mk-sw::after{content:"";position:absolute;left:3px;top:3px;width:18px;height:18px;border-radius:50%;background:var(--mk-dim);transition:.15s}
.mk-sw.mk-on{background:var(--mk-accent);border-color:var(--mk-accent)}
.mk-sw.mk-on::after{left:23px;background:#fff}
.mk-chips{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 2px}
.mk-chip{border:1px solid var(--mk-line);border-radius:999px;padding:6px 12px;font-size:12.5px;background:var(--mk-raised);
  color:inherit;cursor:pointer;font-family:inherit}
.mk-chip.mk-on{border-color:var(--mk-accent);background:var(--mk-on-bg);color:var(--mk-on-fg)}
.mk-chip .dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px;vertical-align:1px}
.mk-set .mk-note{color:var(--mk-dim);font-size:11.5px;margin:8px 0 0;line-height:1.5}
/* 背景图：预览方块 + 一行输入 */
.mk-bg-row{gap:10px}
.mk-bg-prev{width:52px;height:52px;flex:none;border-radius:10px;border:1px solid var(--mk-line);
  background-color:var(--mk-raised);background-image:none;background-size:cover;background-position:center}
.mk-bg-inputs{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 4px}
.mk-bg-inputs .mk-input{flex:1 1 200px;min-width:0;padding:8px 11px;font-size:13px}
.mk-hidden{position:absolute;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none}
.mk-diag{color:var(--mk-dim);font-size:11px;margin-top:12px;padding-top:10px;border-top:1px dashed var(--mk-line);line-height:1.6}
.mk-check{white-space:pre-wrap;word-break:break-all;font-size:11.5px;line-height:1.55;color:var(--mk-dim);
  margin:6px 0 0;padding:8px 10px;border:1px solid var(--mk-line);border-radius:8px;background:var(--mk-raised);
  min-height:0;font-family:ui-monospace,Consolas,monospace}
.mk-check:empty{display:none}
@media (max-width:640px){
  /* 手机上也是「居中窗口」，不是底部抽屉：整块面板可以按住标题栏拖动 */
  .mk-root{align-items:center;justify-content:center}
  .mk-card{width:min(94vw,560px);height:min(80dvh,660px);min-height:320px;border-radius:16px;
    box-shadow:0 20px 60px rgba(0,0,0,.5)}
  .mk-root[data-theme=light] .mk-card{box-shadow:0 20px 60px rgba(20,32,52,.2)}
  .mk-head{cursor:move;cursor:grab;touch-action:none;padding:14px 12px 10px;gap:8px}
  .mk-head:active{cursor:grabbing}
  .mk-title{font-size:15px}
  .mk-title small{display:none}
  .mk-search{padding:8px 12px 6px;gap:8px}
  .mk-input{flex:1 1 100%;min-width:0;padding:11px 13px;font-size:16px}
  .mk-tabs,.mk-scopes{padding-left:12px;padding-right:12px}
  .mk-body{padding:6px 6px 14px}
  .mk-song{padding:10px 6px;gap:9px}
  .mk-song .mk-cover{width:44px;height:44px}
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
  /* 设置页里的背景图一行：手机上输入框独占一行，按钮换行排 */
  .mk-set{padding:12px 12px 18px}
  .mk-set-row{gap:8px;flex-wrap:wrap}
  .mk-bg-inputs .mk-input{flex:1 1 100%}
  .mk-bg-inputs .mk-btn{flex:1 1 auto}
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
        <div class="mk-bgimg"></div>
        <div class="mk-scrim"></div>
        <div class="mk-head">
          <div class="mk-title">点歌台 <span data-el="ver" style="font-size:11px;color:#7ee0b8;font-weight:600"></span> <small>Alt+T 开 / 关 · Esc 关闭 · 点 ▶ 播放，点行复制歌名</small></div>
          <span class="mk-clock" data-el="clock" hidden></span>
          <div class="mk-right">
            <button class="mk-btn mk-ghost" data-act="queue" title="听歌列表（队列）">队列</button>
            ${opts.modeSwitch ? '<button class="mk-btn" data-act="mode" title="切换：点播到房间 / 只在本机听">点播到房间</button>' : ''}
            ${opts.hideLogin ? '' : '<button class="mk-btn" data-act="login">登录</button>'}
            <button class="mk-btn mk-ghost" data-act="settings" title="设置">⚙</button>
            <button class="mk-btn mk-ghost mk-close" data-act="close" title="关闭 (Esc)">✕</button>
          </div>
        </div>
        <div class="mk-search">
          <input class="mk-input" data-el="kw" type="search" placeholder="搜歌名 / 歌手，例如：晴天 周杰伦" autocomplete="off">
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
    const elCard = root.querySelector('.mk-card');
    // 手机端「居中窗口」的拖动位移：只在本次页面会话里记着，不写 localStorage
    const cardOffset = { x: 0, y: 0 };
    const elPager = $('[data-el=pager]') || stub();
    const elTabs = $('[data-el=tabs]') || stub();
    const elScopes = $('[data-el=scopes]') || null;
    const elKw = $('[data-el=kw]') || stub();
    const elStat = $('[data-el=stat]') || stub();
    const elLoginBtn = $('[data-act=login]') || stub();
    const elNow = $('[data-el=now]') || stub();
    const elSeek = $('[data-el=seek]') || stub();
    const elTime = $('[data-el=time]') || stub();
    const elVol = $('[data-el=vol]') || stub();
    const elClock = $('[data-el=clock]') || null;
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
    // 歌单详情里才有勾选；selected 存 songKey，切换列表时清空
    let inPlaylist = false;
    let queueOpen = false;
    const selected = new Set();
    let playCurrent = null;
    // 搜歌 / 搜用户 / 搜歌单
    const scopes = Array.isArray(opts.scopes) && opts.scopes.length ? opts.scopes : null;
    let scope = scopes && scopes[0].id ? scopes[0].id : 'song';
    let listKind = 'song';
    // 打开歌单/用户详情前记一下原来的列表，返回时还原
    let detailBack = null;

    // ---------- 设置（外观 / 入口开关 / 背景）----------
    // 同一份设置也存 localStorage：宿主（IIROSE）读同一把 key 来决定悬浮球和手势要不要挂
    const SETTINGS_KEY = opts.settingsKey || 'mk_panel_settings';
    const ACCENTS = ['blue', 'teal', 'violet', 'pink'];
    const SETTINGS_DEFAULT = {
      ball: true, gesture: true, theme: 'auto', accent: 'blue', compact: false,
      card: true, bili: 'video', bg: '', bgDim: 0.5, bgBlur: false,
      opacity: 1, clock: true,
    };
    // 同一页面里可能有两个实例（extJs 里留了旧链接），事件要能区分「是不是自己发的」
    const instanceId = Math.random().toString(36).slice(2, 8);

    /** 背景只接受 http(s) 链接和本机压缩出来的 data:image（挡掉 javascript: 之类） */
    function isSafeBg(v) {
      const s = String(v == null ? '' : v).trim();
      if (!s) return false;
      if (/^https?:\/\/\S+$/i.test(s)) return true;
      return /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(s);
    }

    function normalizeSettings(raw) {
      const out = Object.assign({}, SETTINGS_DEFAULT, raw || {});
      if (out.theme !== 'dark' && out.theme !== 'light') out.theme = 'auto';
      if (ACCENTS.indexOf(out.accent) < 0) out.accent = 'blue';
      out.ball = out.ball !== false;
      out.gesture = out.gesture !== false;
      // 两个入口不能同时是关的：老数据/手改 localStorage 弄成双关时，把球放回来兜底
      if (!out.ball && !out.gesture) out.ball = true;
      out.compact = Boolean(out.compact);
      out.card = out.card !== false;
      out.bili =
        out.bili === 'video' || out.bili === 'native' || out.bili === 'link' ? out.bili : 'audio';
      out.bgBlur = Boolean(out.bgBlur);
      out.clock = out.clock !== false;
      const alpha = Number(out.opacity);
      // 0.55 是能看清字的下限；1 = 完全不透明
      out.opacity = Number.isFinite(alpha) ? Math.min(1, Math.max(0.55, alpha)) : SETTINGS_DEFAULT.opacity;
      const dim = Number(out.bgDim);
      out.bgDim = Number.isFinite(dim) ? Math.min(1, Math.max(0, dim)) : SETTINGS_DEFAULT.bgDim;
      out.bg = isSafeBg(out.bg) ? String(out.bg).trim() : '';
      return out;
    }

    let settings = normalizeSettings(opts.settings || {});

    /** 回读 localStorage：× 隐藏悬浮球之类「别的实例改的」也能同步过来 */
    function reloadSettings() {
      let next = normalizeSettings(settings);
      try {
        const raw = window.localStorage.getItem(SETTINGS_KEY);
        if (raw) next = normalizeSettings(JSON.parse(raw));
      } catch {
        /* 读不到／解析不了就保留当前内存值 */
      }
      const changed = JSON.stringify(next) !== JSON.stringify(settings);
      settings = next;
      return changed;
    }
    reloadSettings();

    function notifySettings() {
      if (typeof opts.onSettingsChange === 'function') {
        try {
          opts.onSettingsChange(settings);
        } catch {
          /* 宿主应用失败不影响面板 */
        }
      }
      // 广播给同页面的其它实例 / 宿主脚本（它们各自监听 mk-settings）
      try {
        window.dispatchEvent(
          new CustomEvent('mk-settings', { detail: { settings: settings, source: instanceId } }),
        );
      } catch {
        /* 没有 CustomEvent 的老环境就只走回调 */
      }
    }

    /** 返回 true 表示存进浏览器了；false = 存不下（几乎都是背景图把 localStorage 撑爆） */
    function saveSettings() {
      let ok = true;
      try {
        window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      } catch {
        ok = false;
      }
      notifySettings();
      return ok;
    }

    function resolvedTheme() {
      if (settings.theme === 'light' || settings.theme === 'dark') return settings.theme;
      try {
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
      } catch {
        /* 老 WebView 没有 matchMedia */
      }
      return 'dark';
    }

    function applyBackground() {
      const bg = settings.bg || '';
      root.setAttribute('data-bg', bg ? '1' : '0');
      const st = root.style;
      if (!st || typeof st.setProperty !== 'function') return;
      if (bg) {
        st.setProperty('--mk-bg-img', 'url("' + bg.replace(/["\\\n\r\t]/g, '') + '")');
      } else if (typeof st.removeProperty === 'function') {
        st.removeProperty('--mk-bg-img');
      }
      st.setProperty('--mk-veil', String(settings.bgDim || 0));
      st.setProperty('--mk-bg-blur', settings.bgBlur ? '10px' : '0px');
    }

    function applySettings() {
      root.setAttribute('data-theme', resolvedTheme());
      root.setAttribute('data-accent', settings.accent || 'blue');
      root.classList.toggle('mk-compact', Boolean(settings.compact));
      const st = root.style;
      if (st && typeof st.setProperty === 'function') {
        // 面板背景透明度：CSS 里用 color-mix 把这层 alpha 混进去，字不受影响
        st.setProperty('--mk-alpha', String(settings.opacity == null ? 1 : settings.opacity));
      }
      applyBackground();
      applyClock();
    }

    /** 顶栏时钟（精确到秒），可在设置里关掉 */
    let clockTimer = null;
    function applyClock() {
      const show = settings.clock !== false;
      if (elClock && elClock.setAttribute) {
        if (show) elClock.removeAttribute('hidden');
        else elClock.setAttribute('hidden', '');
      }
      if (clockTimer) {
        clearInterval(clockTimer);
        clockTimer = null;
      }
      if (!show || !elClock) return;
      const tick = () => {
        // 面板被移除后自愈，别让定时器一直跑
        if (elClock && elClock.isConnected === false) {
          clearInterval(clockTimer);
          clockTimer = null;
          return;
        }
        const d = new Date();
        const p2 = (n) => String(n).padStart(2, '0');
        const txt = p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
        if (elClock.textContent !== txt) elClock.textContent = txt;
      };
      tick();
      clockTimer = setInterval(tick, 1000);
    }

    /**
     * 开关：悬浮球 / 双指上滑 各自独立，但**不能两个都关**（不然手机上面板就叫不出来）。
     * 以前是「关一个自动开另一个」，用起来像自己变回去了；现在改成直接拒绝并说明原因。
     */
    function setSwitch(name, on) {
      const next = Object.assign({}, settings, { [name]: Boolean(on) });
      if ((name === 'ball' || name === 'gesture') && !next.ball && !next.gesture) {
        renderSettings();
        setStat('至少留一个入口：先把「' + (name === 'ball' ? '双指上滑' : '悬浮球') + '」打开，再关这个');
        return;
      }
      settings = normalizeSettings(next);
      const ok = saveSettings();
      applySettings();
      renderSettings();
      if (name === 'ball' || name === 'gesture') {
        if (!settings.ball || !settings.gesture) {
          setStat(settings.ball ? '已关闭双指上滑（悬浮球还能用）' : '已隐藏悬浮球（双指上滑还能用）');
        }
      } else if (!ok) {
        setStat('存不进浏览器（多半是背景图太大），本次生效、刷新会丢');
      }
    }

    function themeLabel(t) {
      return t === 'dark' ? '深色' : t === 'light' ? '浅色' : '跟随系统';
    }

    function setChip(group, value) {
      const patch = { [group]: group === 'bgDim' ? Number(value) : String(value) };
      settings = normalizeSettings(Object.assign({}, settings, patch));
      const ok = saveSettings();
      applySettings();
      renderSettings();
      if (!ok) setStat('存不进浏览器（多半是背景图太大），本次生效、刷新会丢');
      else if (group === 'theme') setStat('主题：' + themeLabel(settings.theme));
      else if (group === 'bgDim') setStat('背景遮罩：' + Math.round(settings.bgDim * 100) + '%');
    }

    /** 诊断行：宿主传了 diagnostics() 才显示 —— 用来一眼看出「是不是有旧脚本还在跑」 */
    function diagText() {
      if (typeof opts.diagnostics !== 'function') return '';
      try {
        const d = opts.diagnostics();
        if (!d) return '';
        const bits = [];
        if (d.version) bits.push('v' + d.version);
        if (d.instances) bits.push('脚本实例 ' + d.instances);
        if (d.gesture !== undefined) bits.push('双指上滑 ' + (d.gesture ? '已挂监听' : '已卸载监听'));
        if (d.ball !== undefined) bits.push('悬浮球 ' + (d.ball ? '显示中' : '已隐藏'));
        if (opts.relayUrl) {
          bits.push('中转 ' + String(opts.relayUrl).replace(/^https?:\/\//, '').replace(/\/+$/, '').slice(0, 40));
        }
        return bits.length ? '诊断：' + bits.join(' · ') : '';
      } catch {
        return '';
      }
    }

    /** 设置页里的「测一下」：直接问中转能不能用，不依赖 F12 */
    async function runSelfCheck() {
      const box = elBody.querySelector('[data-el=relay-check]');
      if (!box) return;
      const input = elBody.querySelector('[data-el=relay-url]');
      const base = String((input && input.value) || opts.relayUrl || '').trim().replace(/\/+$/, '');
      if (!base) {
        box.textContent = '先填中转地址';
        return;
      }
      box.textContent = '检查中…';
      const lines = [];
      try {
        const h = await fetch(base + '/health', { cache: 'no-store' }).then((r) => r.json());
        lines.push('health: ' + (h && h.ok ? 'OK · ' + (h.platforms || []).join('/') : '失败'));
        // 老版本中转没有 features：直接点出来，避免对着旧地址反复试
        if (h && h.ok && !(Array.isArray(h.features) && h.features.indexOf('bilibili-video') >= 0)) {
          lines.push('⚠ 这台中转是老版本（不支持 B 站视频），请换成新版地址');
        }
      } catch (err) {
        lines.push('health: 连不上（' + String((err && err.message) || err) + '）');
      }
      try {
        const p = await fetch(base + '/playurl?platform=bilibili&id=BV1BZbSzZEGT&mode=video', {
          cache: 'no-store',
        }).then((r) => r.json());
        const d = (p && p.data) || {};
        if (!d.playable) {
          lines.push('B 站视频: 不可播 · ' + (d.note || d.reason || ''));
        } else {
          lines.push(
            'B 站视频: ' +
              (d.qn ? d.qn + 'P' : '可播') +
              ' · ' +
              (d.size ? Math.round(d.size / 1048576) + 'MB' : d.source === 'bilibilix' ? '直链(302)' : '—'),
          );
          try {
            const r = await fetch(d.streamUrl, { headers: { range: 'bytes=0-1024' }, cache: 'no-store' });
            lines.push('拉流: HTTP ' + r.status + ' · ' + (r.headers.get('content-type') || '?'));
          } catch (err2) {
            lines.push('拉流: 失败（' + String((err2 && err2.message) || err2) + '）');
          }
          // 用同一个页面、同一个浏览器内核解一下这个视频：
          // 这里能出画面 → 地址没问题，是 IIROSE 播放器的事；这里也报错 → 地址/解码被拦
          try {
            const probe = document.createElement('video');
            probe.muted = true;
            probe.preload = 'metadata';
            probe.setAttribute('playsinline', '');
            probe.style.cssText = 'position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0';
            document.body.appendChild(probe);
            const verdict = await new Promise((resolve) => {
              let settled = false;
              const done = (text) => {
                if (settled) return;
                settled = true;
                resolve(text);
              };
              probe.addEventListener('loadedmetadata', () =>
                done(
                  'ok ' + probe.videoWidth + 'x' + probe.videoHeight + ' ' + Math.round(probe.duration) + 's',
                ),
              );
              probe.addEventListener('error', () => {
                const e = probe.error;
                done('错误 code=' + (e && e.code) + (e && e.message ? ' ' + e.message : ''));
              });
              setTimeout(() => done('超时 readyState=' + probe.readyState), 8000);
              probe.src = d.streamUrl;
              probe.load();
            });
            probe.remove();
            lines.push('本机解码: ' + verdict);
          } catch (err3) {
            lines.push('本机解码: 测试失败（' + String((err3 && err3.message) || err3) + '）');
          }
        }
      } catch (err) {
        lines.push('B 站视频: 请求失败（' + String((err && err.message) || err) + '）');
      }
      box.textContent = lines.join('\n');
    }

    function renderSettings() {
      // 每次进设置页都先回读一次：× 隐藏悬浮球之后，这里的开关要跟实际状态一致
      reloadSettings();
      applySettings();
      const sw = (name, label, desc) =>
        `<div class="mk-set-row"><div class="mk-meta"><b>${label}</b><small>${desc}</small></div>` +
        `<button class="mk-sw${settings[name] ? ' mk-on' : ''}" data-set="${name}" role="switch" ` +
        `aria-checked="${settings[name] ? 'true' : 'false'}" title="点击切换"></button></div>`;
      const chip = (group, value, label, color) =>
        `<button class="mk-chip${settings[group] === value ? ' mk-on' : ''}" data-set-group="${group}" data-set-value="${value}">` +
        (color ? `<span class="dot" style="background:${color}"></span>` : '') +
        label +
        '</button>';
      const bgKind = !settings.bg ? '未设置' : settings.bg.indexOf('data:') === 0 ? '本机图片' : '图片链接';
      const diag = diagText();
      elBody.innerHTML =
        '<div class="mk-set">' +
        '<h3>设置</h3>' +
        '<div class="mk-set-group"><h4>入口</h4>' +
        sw('ball', '悬浮球', '右下角 ♪，可拖动；关掉后双指上滑还留着') +
        sw('gesture', '双指上滑', '手机上双指向上滑开面板；关掉会真的卸载监听') +
        '<p class="mk-note">两个入口至少留一个：想关掉这个，先把另一个打开（不会再自动帮你打开别的）。</p></div>' +
        '<div class="mk-set-group"><h4>点歌</h4>' +
        sw('card', '发送点播卡片', '关掉后只发媒体数据：歌照播，但公屏/前端不再出现那张点播卡片') +
        '<div class="mk-set-row"><div class="mk-meta"><b>B 站播放</b><small>音频轨最省流量；视频要「视频分享」房间，而且走中转流量</small></div></div>' +
        '<div class="mk-chips">' +
        chip('bili', 'audio', '音频轨') +
        chip('bili', 'video', '视频') +
        chip('bili', 'link', '外链') +
        chip('bili', 'native', '原生') +
        '</div>' +
        '</div>' +
        '<div class="mk-set-group"><h4>外观</h4>' +
        '<div class="mk-set-row"><div class="mk-meta"><b>主题</b><small>跟随系统会按手机的深 / 浅色自动切</small></div></div>' +
        '<div class="mk-chips">' +
        chip('theme', 'auto', '跟随系统') +
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
        sw('compact', '紧凑列表', '一行更矮，一屏能多看几首') +
        sw('clock', '顶栏时钟', '显示时:分:秒，关掉更清爽') +
        '<div class="mk-set-row"><div class="mk-meta"><b>面板透明度</b><small>100% 不透明；调低能透出后面的房间</small></div>' +
        '<span class="mk-badge" data-el="opacity-val">' + Math.round((settings.opacity == null ? 1 : settings.opacity) * 100) + '%</span></div>' +
        '<input class="mk-range" data-el="opacity" type="range" min="55" max="100" step="1" value="' +
        Math.round((settings.opacity == null ? 1 : settings.opacity) * 100) +
        '">'
        +
        '</div>' +
        '<div class="mk-set-group"><h4>背景</h4>' +
        '<div class="mk-set-row mk-bg-row"><div class="mk-meta"><b>背景图</b><small>当前：' +
        esc(bgKind) +
        '；本机图片会先压缩再存进浏览器</small></div>' +
        '<span class="mk-bg-prev" data-el="bg-prev"></span></div>' +
        '<div class="mk-bg-inputs">' +
        '<input class="mk-input" data-el="bg-url" type="text" inputmode="url" placeholder="粘图片链接 https://…">' +
        '<button class="mk-btn" data-act="bg-apply">用这个链接</button>' +
        '<button class="mk-btn" data-act="bg-file">选本机图片</button>' +
        '<button class="mk-btn mk-ghost" data-act="bg-clear">清除</button>' +
        '</div>' +
        '<input type="file" accept="image/*" data-el="bg-file" class="mk-hidden">' +
        '<div class="mk-set-row"><div class="mk-meta"><b>遮罩</b><small>压暗一层，字更清楚</small></div></div>' +
        '<div class="mk-chips">' +
        chip('bgDim', 0, '无') +
        chip('bgDim', 0.25, '轻') +
        chip('bgDim', 0.5, '中') +
        chip('bgDim', 0.72, '重') +
        '</div>' +
        sw('bgBlur', '背景模糊', '图片糊一层，更像毛玻璃') +
        '</div>' +
        (typeof opts.onRelayChange === 'function'
          ? '<div class="mk-set-group"><h4>中转</h4>' +
            '<div class="mk-set-row"><div class="mk-meta"><b>中转地址</b><small>' +
            '搜索/播放都走它；换完建议刷新一次（「用户 / 歌单」两个 tab 要重新读配置）</small></div></div>' +
            '<div class="mk-bg-inputs">' +
            '<input class="mk-input" data-el="relay-url" type="text" inputmode="url" placeholder="https://music-relay.xxx.fcapp.run">' +
            '<button class="mk-btn" data-act="relay-save">保存</button>' +
            '<button class="mk-btn mk-ghost" data-act="relay-clear">清空</button>' +
            '</div>' +
            '<div class="mk-bg-inputs"><button class="mk-btn" data-act="relay-check">测一下</button></div>' +
            '<pre class="mk-check" data-el="relay-check"></pre>' +
            '</div>'
          : '') +
        '<div class="mk-set-row"><div class="mk-meta"><b>完成</b><small>回到搜索</small></div>' +
        '<button class="mk-btn mk-primary" data-act="settings-done">完成</button></div>' +
        (diag ? '<div class="mk-diag">' + esc(diag) + '</div>' : '') +
        '</div>';
      // innerHTML 里塞 url("…") 容易被引号搞坏，预览和输入框都用 DOM 属性赋值
      const prev = elBody.querySelector('[data-el=bg-prev]');
      if (prev && prev.style && settings.bg) {
        prev.style.backgroundImage = 'url("' + settings.bg.replace(/["\\\n\r]/g, '') + '")';
      }
      const urlInput = elBody.querySelector('[data-el=bg-url]');
      if (urlInput) {
        urlInput.value = settings.bg && settings.bg.indexOf('data:') !== 0 ? settings.bg : '';
      }
      // 中转地址：宿主传了 relayUrl 就回填（设置页每次重绘都要重新填）
      const relayInput = elBody.querySelector('[data-el=relay-url]');
      if (relayInput) relayInput.value = opts.relayUrl || '';
      if (elPager.classList) elPager.classList.remove('mk-on');
      setStat('设置');
    }

    function setBackground(raw) {
      const value = String(raw == null ? '' : raw).trim();
      if (value && !isSafeBg(value)) {
        setStat('只支持 http(s) 图片链接或本机图片，这个链接不支持');
        return;
      }
      settings = normalizeSettings(Object.assign({}, settings, { bg: value }));
      applySettings();
      const ok = saveSettings();
      renderSettings();
      if (!ok) {
        setStat('这张图太大，浏览器存不下（约 5MB 上限）：本次生效、刷新会丢，建议改用图片链接');
      } else if (!value) {
        setStat('已清除背景');
      } else {
        setStat(value.indexOf('data:') === 0 ? '背景已设为本机图片' : '背景已设为该链接');
      }
    }

    /** 本机图片 → 压成 JPEG data URL（最长边 1600，不够就降到 900，目标 ≤900KB） */
    function shrinkImage(file) {
      return new Promise((resolve, reject) => {
        if (!file || !/^image\//i.test(file.type || '')) {
          reject(new Error('这不是图片'));
          return;
        }
        let objectUrl = '';
        try {
          objectUrl = window.URL.createObjectURL(file);
        } catch {
          reject(new Error('读不到这个文件'));
          return;
        }
        const cleanup = () => {
          try {
            window.URL.revokeObjectURL(objectUrl);
          } catch {
            /* 忽略 */
          }
        };
        const img = new window.Image();
        img.onerror = () => {
          cleanup();
          reject(new Error('这张图打不开'));
        };
        img.onload = () => {
          try {
            let maxSide = 1600;
            let quality = 0.82;
            let dataUrl = '';
            for (let i = 0; i < 6; i++) {
              const side = Math.max(img.width || 0, img.height || 0) || 1200;
              const scale = Math.min(1, maxSide / side);
              const w = Math.max(1, Math.round((img.width || 800) * scale));
              const h = Math.max(1, Math.round((img.height || 600) * scale));
              const canvas = doc.createElement('canvas');
              canvas.width = w;
              canvas.height = h;
              const c2d = canvas.getContext && canvas.getContext('2d');
              if (!c2d) throw new Error('这个浏览器不支持压缩图片');
              c2d.drawImage(img, 0, 0, w, h);
              dataUrl = canvas.toDataURL('image/jpeg', quality);
              if (dataUrl.length <= 900000) break;
              if (i % 2 === 0) quality = Math.max(0.5, quality - 0.12);
              else maxSide = Math.max(640, Math.round(maxSide * 0.72));
            }
            cleanup();
            if (!dataUrl) {
              reject(new Error('压缩失败'));
            } else if (dataUrl.length > 900000) {
              reject(new Error('图片太大（压缩后仍超过 900KB），换小一点或用图片链接'));
            } else {
              resolve(dataUrl);
            }
          } catch (err) {
            cleanup();
            reject(err);
          }
        };
        img.src = objectUrl;
      });
    }

    // 别的实例 / 宿主改了设置：回读并重绘（自己发的事件直接跳过，免得来回刷）
    function onExternalSettings() {
      if (!reloadSettings()) return;
      applySettings();
      if (elBody.querySelector && elBody.querySelector('.mk-set')) renderSettings();
    }
    function onWindowSettings(ev) {
      const d = ev && ev.detail;
      if (d && d.source === instanceId) return;
      onExternalSettings();
    }
    function onStorage(ev) {
      if (ev && ev.key && ev.key !== SETTINGS_KEY) return;
      onExternalSettings();
    }
    function onSchemeChange() {
      if (settings.theme === 'auto') applySettings();
    }
    let mqList = null;
    try {
      mqList = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
    } catch {
      mqList = null;
    }
    try {
      window.addEventListener('mk-settings', onWindowSettings);
      window.addEventListener('storage', onStorage);
    } catch {
      /* 忽略 */
    }
    if (mqList) {
      if (typeof mqList.addEventListener === 'function') mqList.addEventListener('change', onSchemeChange);
      else if (typeof mqList.addListener === 'function') mqList.addListener(onSchemeChange);
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
      // B 站可以音频/视频两种播法：这里给一个「换一种」的按钮，不用去设置里改
      const biliAlt = s.platform === 'bilibili' ? (settings.bili === 'video' ? 'audio' : 'video') : '';
      const modeBtn = biliAlt
        ? `<button data-pm="${i}" data-mode="${biliAlt}" title="${
            biliAlt === 'video' ? '这条用视频播（需要视频分享房间）' : '这条用音频轨播（省流量）'
          }">${biliAlt === 'video' ? '🎬' : '🎵'}</button>`
        : '';
      return `<div class="mk-song mk-clickable${isCurrent ? ' mk-playing' : ''}" data-song="${i}" title="点击复制「歌名 - 歌手」">
        ${inPlaylist ? `<input type="checkbox" class="mk-sel" data-sel="${i}"${selected.has(songKey(s)) ? ' checked' : ''} title="勾选后点「点选中的」">` : ''}
        <button class="mk-play${isCurrent ? ' mk-busy' : ''}" data-play="${i}" title="直接播放">${isCurrent ? '♪' : '▶'}</button>
        <div class="mk-idx">${i + 1}</div>
        ${coverOf(s.cover, '♪')}
        <div class="mk-meta"><div class="mk-name">${esc(s.title)}</div><div class="mk-sub">${esc(sub)}</div></div>
        ${inQueue ? '<span class="mk-queuebadge">已入列</span>' : ''}
        ${badge}
        <div class="mk-acts">
          ${modeBtn}
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

    async function playSong(song, { enqueue = true, mode } = {}) {
      if (!song) return;
      // B 站可以选音频轨/视频；其它平台只有音频
      const playAs = mode || (song.platform === 'bilibili' ? settings.bili || 'audio' : 'audio');
      const asVideo = playAs === 'video';
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
      // 外链点播：先拿视频地址，再按 IIROSE「外链点播」格式发一条聊天消息（视频链接用 [] 包住）
      if (playAs === 'link' && song.platform === 'bilibili') {
        setNow(label, '解析视频地址…');
        refreshRows();
        try {
          if (typeof api.playurl !== 'function') throw new Error('当前环境不支持直接播放（缺 api.playurl）');
          const info = await api.playurl({ platform: song.platform, id: song.id, mode: 'video' });
          if (!info || !info.playable || !info.streamUrl) {
            throw new Error((info && info.note) || '拿不到视频地址');
          }
          if (typeof opts.onExternalRequest !== 'function') throw new Error('当前环境不支持外链点播');
          await opts.onExternalRequest(song, info);
          setNow(label, '已发外链点播 · 等 IIROSE 解析出画面');
          setStat('已发外链点播：' + esc(song.title));
          return { played: true, mode: 'link' };
        } catch (err) {
          setNow(label, '外链点播失败：' + String((err && err.message) || err));
          setStat('外链点播失败：' + esc(String((err && err.message) || err)));
          return { played: false, reason: String((err && err.message) || err) };
        }
      }
      // 原生模式：不经过中转，直接把链接发给 IIROSE 让它自己解析（自带点歌台就是这么做的）
      if (playAs === 'native' && song.platform === 'bilibili') {
        if (typeof opts.onNativeRequest !== 'function') throw new Error('当前环境不支持原生点播');
        setNow(label, '交给 IIROSE 原生解析…');
        refreshRows();
        try {
          await opts.onNativeRequest(song);
          setNow(label, '已发给 IIROSE 原生点播 · 等房间解析');
          setStat('已发送原生点播：' + esc(song.title));
          return { played: true, mode: 'native' };
        } catch (err) {
          setNow(label, '原生点播失败：' + String((err && err.message) || err));
          return { played: false, reason: String((err && err.message) || err) };
        }
      }
      setNow(label, '解析播放地址…' + (song.platform === 'bilibili' ? '（' + (asVideo ? '视频' : '音频轨') + '）' : ''));
      refreshRows();
      try {
        if (typeof api.playurl !== 'function') throw new Error('当前环境不支持直接播放（缺 api.playurl）');
        const info = await api.playurl({ platform: song.platform, id: song.id, mode: playAs });
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
          setNow(label, '已点播到房间（' + (info.mode === 'video' ? '视频' : '音频') + '）· 等房间开始播');
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
    // 设置页里的「面板透明度」滑杆（设置页每次重绘，所以用事件委托）
    if (elBody.addEventListener) {
      elBody.addEventListener('input', (ev) => {
        const t = ev.target;
        if (!t || typeof t.getAttribute !== 'function' || t.getAttribute('data-el') !== 'opacity') return;
        const pct = Math.min(100, Math.max(55, Math.round(Number(t.value) || 100)));
        settings = normalizeSettings(Object.assign({}, settings, { opacity: pct / 100 }));
        saveSettings();
        applySettings();
        const lab = elBody.querySelector('[data-el=opacity-val]');
        if (lab) lab.textContent = pct + '%';
      });
    }

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
      // 每页固定 20 条（不再给 10/20/30 的选择项：翻页已经够用了）
      const limit = 20;
      const type = scope || 'song';
      inPlaylist = false;
      selected.clear();
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
    let playlistCtx = null;

    /** 歌单详情：头部（全选/全部点歌/点选中的）+ 歌曲行；勾选变化后整体重画，保证头部还在 */
    function renderPlaylistDetail() {
      const ctx = playlistCtx;
      if (!ctx) return;
      inPlaylist = true;
      const songs = ctx.songs || [];
      const pl = ctx.pl || {};
      renderList(songs, 'song');
      const head =
        '<div class="mk-detail-head">' +
        coverOf(pl.cover, '♪') +
        '<div class="mk-meta"><div class="mk-name">' +
        esc(pl.name || '歌单') +
        '</div><div class="mk-sub">' +
        esc([songs.length + ' 首', pl.creator ? 'by ' + pl.creator : ''].filter(Boolean).join(' · ')) +
        '</div></div>' +
        '<div class="mk-detail-acts">' +
        (songs.length
          ? '<button class="mk-btn" data-act="sel-all">全选</button>' +
            '<button class="mk-btn mk-primary" data-act="batch-play">全部点歌（' + songs.length + '）</button>' +
            '<button class="mk-btn" data-act="play-sel">点选中的（' + selected.size + '）</button>'
          : '') +
        '<button class="mk-btn" data-act="back">‹ 返回</button></div></div>';
      if (elBody.insertAdjacentHTML) elBody.insertAdjacentHTML('afterbegin', head);
    }

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
        playlistCtx = { songs, pl };
        selected.clear();
        renderPlaylistDetail();
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
      inPlaylist = false;
      queueOpen = false;
      playlistCtx = null;
      selected.clear();
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

    /** 全部点歌：整批入队 + 从第一首开始播（不重复塞已经在队列里的） */
    function playAll(list) {
      const songs = (list || []).filter((s) => s && s.id).slice(0, 100);
      if (!songs.length) {
        setStat('这里没有可点的歌');
        return;
      }
      playQueue = songs.slice();
      playIndex = 0;
      refreshRows();
      playSong(playQueue[0], { enqueue: false });
      setStat('整批点歌 ' + songs.length + ' 首，正在播第 1 首');
    }

    /** 点选中的：把勾选的几首依次入队并播第一首 */
    function playSelected() {
      const picked = (lastResults || []).filter((s) => s && s.id && selected.has(songKey(s)));
      if (!picked.length) {
        setStat('还没勾选歌曲');
        return;
      }
      playQueue = picked.slice();
      playIndex = 0;
      refreshRows();
      playSong(playQueue[0], { enqueue: false });
      setStat('点选中的 ' + picked.length + ' 首，正在播第 1 首');
    }

    function toggleSelectAll() {
      const all = (lastResults || []).filter((s) => s && s.id);
      const every = all.length > 0 && all.every((s) => selected.has(songKey(s)));
      selected.clear();
      if (!every) all.forEach((s) => selected.add(songKey(s)));
      if (inPlaylist && playlistCtx) renderPlaylistDetail();
      else renderList(lastResults, 'song');
      syncSelCount();
    }

    function syncSelCount() {
      const btn = elBody.querySelector('[data-act=play-sel]');
      if (btn) btn.textContent = '点选中的（' + selected.size + '）';
      const all = elBody.querySelector('[data-act=sel-all]');
      if (all) all.textContent = selected.size && selected.size === (lastResults || []).length ? '取消全选' : '全选';
    }

    function removeFromQueue(i) {
      if (i < 0 || i >= playQueue.length) return;
      playQueue.splice(i, 1);
      if (playIndex > i) playIndex -= 1;
      else if (playIndex === i) playIndex = Math.min(playIndex, playQueue.length - 1);
      renderQueue();
    }

    /** 听歌列表：本机试听 / 点播到房间都用这一份队列 */
    function renderQueue() {
      // 已经有「返回上一级」就沿用它（比如从歌单详情点开队列，返回要回到歌单列表）
      if (!detailBack) {
        detailBack = { list: lastResults, kind: listKind, page: page };
      }
      queueOpen = true;
      if (!playQueue.length) {
        elBody.innerHTML =
          '<div class="mk-detail-head"><div class="mk-meta"><div class="mk-name">听歌列表</div>' +
          '<div class="mk-sub">队列 0 首</div></div>' +
          '<div class="mk-detail-acts"><button class="mk-btn" data-act="back">‹ 返回</button></div></div>' +
          '<div class="mk-empty">队列还是空的。点结果里的「+ 队列」，或去歌单里「全部点歌」。</div>';
        if (elPager && elPager.classList) elPager.classList.remove('mk-on');
        setStat('队列 0 首');
        return;
      }
      const head =
        '<div class="mk-detail-head"><div class="mk-meta"><div class="mk-name">听歌列表</div>' +
        '<div class="mk-sub">' +
        esc(playQueue.length + ' 首 · 当前第 ' + (playIndex + 1) + ' 首') +
        '</div></div><div class="mk-detail-acts">' +
        '<button class="mk-btn" data-act="queue-clear">清空</button>' +
        '<button class="mk-btn" data-act="back">‹ 返回</button></div></div>';
      const rows = playQueue
        .map((s, i) => {
          const cur = i === playIndex;
          const sub = [labelOf(s.platform), (s.artists || []).join(' / '), fmtDur(s.durationMs)]
            .filter(Boolean)
            .join(' · ');
          return (
            '<div class="mk-song' +
            (cur ? ' mk-playing' : '') +
            '">' +
            '<button class="mk-play' +
            (cur ? ' mk-busy' : '') +
            '" data-act="qplay" data-i="' +
            i +
            '">' +
            (cur ? '♪' : '▶') +
            '</button>' +
            '<div class="mk-idx">' +
            (i + 1) +
            '</div>' +
            coverOf(s.cover, '♪') +
            '<div class="mk-meta"><div class="mk-name">' +
            esc(s.title) +
            '</div><div class="mk-sub">' +
            esc(sub) +
            '</div></div>' +
            '<div class="mk-acts"><button data-act="qdel" data-i="' +
            i +
            '" title="从队列移除">✕</button></div></div>'
          );
        })
        .join('');
      elBody.innerHTML = head + rows;
      if (elPager && elPager.classList) elPager.classList.remove('mk-on');
      setStat('队列 ' + playQueue.length + ' 首');
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

    // ---- 拖动面板（手机上是居中窗口，按住标题栏可以挪；位置只在本次页面会话里记着） ----
    function isMobileWidth() {
      try {
        if (window.matchMedia && window.matchMedia('(max-width:640px)').matches) return true;
      } catch {
        /* 没有 matchMedia 就退回窗口宽度 */
      }
      return (window.innerWidth || 0) <= 640;
    }
    function applyCardOffset() {
      if (!elCard || !elCard.style) return;
      elCard.style.transform =
        cardOffset.x === 0 && cardOffset.y === 0
          ? ''
          : 'translate(' + Math.round(cardOffset.x) + 'px,' + Math.round(cardOffset.y) + 'px)';
    }
    function clampCardOffset() {
      if (!elCard || typeof elCard.getBoundingClientRect !== 'function') return;
      const r = elCard.getBoundingClientRect();
      // 还没布局（隐藏 / jsdom）时 rect 全是 0，别拿它瞎夹
      if (!r.width || !r.height) return;
      const vw = window.innerWidth || 360;
      const vh = window.innerHeight || 640;
      const pad = 8;
      let dx = 0;
      let dy = 0;
      if (r.left < pad) dx = pad - r.left;
      else if (r.right > vw - pad) dx = vw - pad - r.right;
      if (r.top < pad) dy = pad - r.top;
      else if (r.bottom > vh - pad) dy = vh - pad - r.bottom;
      if (dx || dy) {
        cardOffset.x += dx;
        cardOffset.y += dy;
        applyCardOffset();
      }
    }
    let dragState = null;
    function dragPoint(ev) {
      if (ev.touches && ev.touches.length) return { x: ev.touches[0].clientX, y: ev.touches[0].clientY };
      return { x: ev.clientX, y: ev.clientY };
    }
    function onCardDown(ev) {
      if (!elCard || !isMobileWidth()) return;
      const t = ev.target;
      if (!t || !t.closest) return;
      if (t.closest('button') || t.closest('a') || t.closest('input') || t.closest('select')) return;
      if (!t.closest('.mk-head')) return;
      const p = dragPoint(ev);
      dragState = { sx: p.x, sy: p.y, ox: cardOffset.x, oy: cardOffset.y, moved: false };
      if (elCard.classList) elCard.classList.add('mk-dragging');
      if (elCard.setPointerCapture && ev.pointerId != null) {
        try {
          elCard.setPointerCapture(ev.pointerId);
        } catch {
          /* 老 WebView 不支持 */
        }
      }
    }
    function onCardMove(ev) {
      if (!dragState) return;
      const p = dragPoint(ev);
      const dx = p.x - dragState.sx;
      const dy = p.y - dragState.sy;
      if (!dragState.moved && Math.abs(dx) + Math.abs(dy) > 5) dragState.moved = true;
      if (!dragState.moved) return;
      if (ev.cancelable) ev.preventDefault();
      cardOffset.x = dragState.ox + dx;
      cardOffset.y = dragState.oy + dy;
      applyCardOffset();
    }
    function onCardUp() {
      if (!dragState) return;
      const moved = dragState.moved;
      dragState = null;
      if (elCard && elCard.classList) elCard.classList.remove('mk-dragging');
      if (moved) clampCardOffset();
    }
    if (elCard) {
      if (window.PointerEvent) {
        elCard.addEventListener('pointerdown', onCardDown);
        elCard.addEventListener('pointermove', onCardMove);
        elCard.addEventListener('pointerup', onCardUp);
        elCard.addEventListener('pointercancel', onCardUp);
      } else {
        elCard.addEventListener('touchstart', onCardDown, { passive: true });
        elCard.addEventListener('touchmove', onCardMove, { passive: false });
        elCard.addEventListener('touchend', onCardUp);
        elCard.addEventListener('mousedown', onCardDown);
      }
      try {
        window.addEventListener('resize', clampCardOffset);
      } catch {
        /* 忽略 */
      }
    }

    // ---- 事件 ----
    // 歌单多选：勾选状态存在 selected 里，改完顺手更新按钮上的计数
    root.addEventListener('change', (ev) => {
      const box = ev.target;
      if (!box || typeof box.getAttribute !== 'function') return;
      const idx = box.getAttribute('data-sel');
      if (idx == null) return;
      const s = (lastResults || [])[Number(idx)];
      if (!s) return;
      if (box.checked) selected.add(songKey(s));
      else selected.delete(songKey(s));
      syncSelCount();
    });

    root.addEventListener('click', async (ev) => {
      const tab = ev.target.closest('[data-tab]');
      if (tab) {
        current = tab.dataset.tab;
        renderTabs();
        if (elKw.value.trim()) doSearch();
        return;
      }
      // 播放 / 入队 / 播放器控制（这些要放在 act 之前判断，优先级最高）
      const pmBtn = ev.target.closest('[data-pm]');
      if (pmBtn) {
        const s = lastResults[Number(pmBtn.dataset.pm)];
        if (s) {
          pmBtn.classList.add('mk-busy');
          await playSong(s, { mode: pmBtn.dataset.mode });
          pmBtn.classList.remove('mk-busy');
        }
        return;
      }
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
        setChip(setChipBtn.dataset.setGroup, setChipBtn.dataset.setValue);
        return;
      }
      const act = ev.target.closest('[data-act]');
      if (act) {
        const name = act.dataset.act;
        if (name === 'settings') renderSettings();
        else if (name === 'bg-apply') {
          const urlInput = elBody.querySelector('[data-el=bg-url]');
          setBackground(urlInput ? urlInput.value : '');
        } else if (name === 'bg-file') {
          const fileInput = elBody.querySelector('[data-el=bg-file]');
          if (fileInput && fileInput.click) fileInput.click();
          else setStat('这个浏览器选不了本地图片，改用图片链接');
        } else if (name === 'bg-clear') {
          setBackground('');
        } else if (name === 'relay-check') {
          runSelfCheck();
        } else if (name === 'relay-save') {
          const input = elBody.querySelector('[data-el=relay-url]');
          const val = input ? String(input.value || '').trim().replace(/\/+$/, '') : '';
          if (val && !/^https?:\/\/\S+$/i.test(val)) {
            setStat('中转地址要以 http(s):// 开头');
            return;
          }
          try {
            opts.onRelayChange(val);
            opts.relayUrl = val;
            setStat(val ? '已保存中转地址（刷新一次后「用户 / 歌单」才会出现）' : '已清空中转地址');
          } catch (err) {
            setStat('保存失败：' + esc(String((err && err.message) || err)));
          }
        } else if (name === 'relay-clear') {
          try {
            opts.onRelayChange('');
            opts.relayUrl = '';
            const input = elBody.querySelector('[data-el=relay-url]');
            if (input) input.value = '';
            setStat('已清空中转地址');
          } catch (err) {
            setStat('清空失败：' + esc(String((err && err.message) || err)));
          }
        } else if (name === 'settings-done') {
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
        else if (name === 'batch-play') playAll(lastResults);
        else if (name === 'play-sel') playSelected();
        else if (name === 'sel-all') toggleSelectAll();
        else if (name === 'queue') renderQueue();
        else if (name === 'queue-clear') {
          playQueue = [];
          playIndex = -1;
          renderQueue();
          setStat('已清空听歌列表');
        } else if (name === 'qplay') {
          const qi = Number(act.getAttribute('data-i'));
          if (playQueue[qi]) {
            playIndex = qi;
            playSong(playQueue[qi], { enqueue: false });
          }
        } else if (name === 'qdel') {
          removeFromQueue(Number(act.getAttribute('data-i')));
        }
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

    // 选本机图片：压缩 → data URL → 存设置（input 每次 renderSettings 都会重建，所以用委托）
    root.addEventListener('change', async (ev) => {
      const t = ev.target;
      if (!t || !t.matches || !t.matches('[data-el=bg-file]')) return;
      const file = t.files && t.files[0];
      if (!file) return;
      setStat('正在压缩图片…');
      try {
        const dataUrl = await shrinkImage(file);
        setBackground(dataUrl);
      } catch (err) {
        setStat('背景图失败：' + esc(String((err && err.message) || err)));
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
      // 打开时回读一次：别的地方（悬浮球 ×）可能已经改过设置
      reloadSettings();
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
      if (clockTimer) {
        clearInterval(clockTimer);
        clockTimer = null;
      }
      try {
        window.removeEventListener('mk-settings', onWindowSettings);
        window.removeEventListener('storage', onStorage);
      } catch {
        /* 忽略 */
      }
      if (mqList) {
        try {
          if (typeof mqList.removeEventListener === 'function') mqList.removeEventListener('change', onSchemeChange);
          else if (typeof mqList.removeListener === 'function') mqList.removeListener('change', onSchemeChange);
        } catch {
          /* 忽略 */
        }
      }
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
