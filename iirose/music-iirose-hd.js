/*! music-iirose v3.0.0 (HD) —— IIROSE 点歌台（构建产物，别直接改；源码 iirose/main.js + client/panel-ui.js） */
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
    { id: 'netease', label: '网易云音乐', icon: '🎵', home: 'https://music.163.com/' },
    { id: 'qq', label: 'QQ 音乐', icon: '🎧', home: 'https://y.qq.com/' },
    { id: 'bilibili', label: 'B 站（Live / MV）', icon: '📺', home: 'https://www.bilibili.com/' },
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
  background-position:center;
  filter:blur(var(--mk-bg-blur,0px)) brightness(var(--mk-bg-bright,1));
  transform:scale(var(--mk-bg-zoom,1.06)) translate(var(--mk-bg-x,0%), var(--mk-bg-y,0%));
  opacity:var(--mk-alpha,1);transition:opacity .15s ease}
.mk-root[data-bg="1"] .mk-card>.mk-scrim{background:var(--mk-scrim);opacity:var(--mk-veil,0)}
.mk-root[data-bg="1"] .mk-head,.mk-root[data-bg="1"] .mk-body{background:transparent}
.mk-root[data-bg="1"]{--mk-bar:rgba(16,23,32,.82);--mk-pager-bg:rgba(15,22,31,.82)}
.mk-root[data-bg="1"][data-theme=light]{--mk-bar:rgba(238,243,250,.86);--mk-pager-bg:rgba(241,245,250,.86)}
.mk-backdrop{position:absolute;inset:0;background:var(--mk-scrim);backdrop-filter:blur(3px)}
.mk-card{position:relative;width:min(1000px,94vw);height:min(720px,90vh);display:flex;flex-direction:column;
  background:color-mix(in srgb, var(--mk-bg) calc(var(--mk-alpha, 1) * 100%), transparent);
  backdrop-filter:blur(calc((1 - var(--mk-alpha, 1)) * 12px));
  border:1px solid var(--mk-line);border-radius:16px;overflow:hidden;isolation:isolate;
  box-shadow:var(--mk-shadow)}
.mk-clock{font-variant-numeric:tabular-nums;font-size:12.5px;color:var(--mk-dim);padding:3px 9px;
  border:1px solid var(--mk-line);border-radius:8px;letter-spacing:.5px}
.mk-clock[hidden]{display:none}
.mk-bili{display:none;padding:0 16px 8px;gap:6px;flex-wrap:wrap;align-items:center}
.mk-bili.mk-on{display:flex}
.mk-bili .mk-bf-input{flex:1 1 120px;min-width:110px}
.mk-sel{width:15px;height:15px;accent-color:var(--mk-accent);margin:0 4px 0 0;flex:none;cursor:pointer}
.mk-range{width:100%;margin:8px 0 2px;accent-color:var(--mk-accent)}
.mk-lyric-float{position:fixed;left:50%;bottom:14%;transform:translateX(-50%);z-index:2147483000;display:none;
  width:min(86vw,var(--lf-w,520px));padding:10px 16px 12px;border-radius:12px;text-align:center;pointer-events:auto;
  background:rgba(10,14,20,.55);backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,.12);
  color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.9);font-size:var(--lf-fs,17px);line-height:1.5;user-select:none;cursor:grab}
.mk-lyric-float.mk-on{display:block}
.mk-lyric-float.mk-drag{cursor:grabbing}
.mk-lyric-float[data-lock="1"]{pointer-events:none;cursor:default}
.mk-lyric-float .lf-lines{display:flex;flex-direction:column;gap:2px;align-items:center}
.mk-lyric-float .lf-line{max-width:100%;white-space:pre-wrap;word-break:break-word;opacity:.4;
  transition:opacity .16s,transform .16s;transform:scale(.97)}
.mk-lyric-float .lf-line.on{opacity:1;font-weight:700;transform:scale(1)}
.mk-lyric-float .lf-tr{display:block;font-size:.76em;opacity:.8;font-weight:400;margin-top:1px}
.mk-lyric-float .lf-bar{position:absolute;right:0;top:-22px;display:flex;gap:3px;pointer-events:auto}
@media (hover:hover){
  .mk-lyric-float .lf-bar{opacity:0;transition:opacity .15s}
  .mk-lyric-float:hover .lf-bar{opacity:1}
}
.mk-lyric-float .lf-btn{background:rgba(10,14,20,.6);color:#fff;border:1px solid rgba(255,255,255,.16);
  border-radius:7px;padding:1px 7px;font-size:11.5px;line-height:17px;cursor:pointer;opacity:.62}
.mk-lyric-float .lf-btn:hover{opacity:1;border-color:rgba(255,255,255,.42)}
.mk-lyric-float[data-lock="1"] .lf-bar{top:2px;right:2px}
.mk-lyric-float[data-lock="1"] .lf-btn:not([data-lf=lock]){display:none}
.mk-lyric-float .lf-grip{position:absolute;right:0;bottom:0;width:20px;height:20px;cursor:nwse-resize;
  border-right:2px solid rgba(255,255,255,.45);border-bottom:2px solid rgba(255,255,255,.45);
  border-bottom-right-radius:11px;touch-action:none}
.mk-lyric-float[data-lock="1"] .lf-grip{display:none}
.mk-lyrics{display:none;padding:10px 16px 6px;max-height:24vh;overflow:auto;text-align:center;
  font-size:14px;line-height:1.65;color:var(--mk-dim);scroll-behavior:smooth}
.mk-lyrics.mk-on{display:block}
.mk-lyrics[data-size=sm]{font-size:12.5px}
.mk-lyrics[data-size=lg]{font-size:17px}
.mk-lyrics .ln{padding:2px 0;transition:color .12s,transform .12s;white-space:pre-wrap}
.mk-lyrics .ln.on{color:var(--mk-accent);font-weight:700;transform:scale(1.02)}
.mk-lyrics .tr{display:block;font-size:.85em;opacity:.72;font-weight:400}
.mk-lyrics .hint{opacity:.6;font-size:12px}
.mk-edit-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 14px;margin:2px 0 6px}
.mk-edit-grid label{display:flex;flex-direction:column;font-size:11.5px;color:var(--mk-dim);gap:2px}
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
/* 批量点歌的进度条（只在面板里，不往房间里刷） */
.mk-batch{display:none;align-items:center;gap:8px;margin:0 16px 8px;padding:6px 10px;border-radius:9px;
  background:var(--mk-raised);border:1px solid var(--mk-line);font-size:12px;color:var(--mk-dim)}
.mk-batch.mk-on{display:flex}
.mk-batch span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mk-batch b{color:var(--mk-accent);font-variant-numeric:tabular-nums}
.mk-batch .mk-btn{margin-left:auto;padding:2px 9px;font-size:11.5px;flex:none}
/* 表情面板：网格 + 角上的收藏 / 删除 */
.mk-sticker-bar{display:flex;gap:8px;padding:10px 16px 4px;align-items:center}
.mk-sticker-bar .mk-input{flex:1 1 auto;min-width:0;padding:8px 11px;font-size:13px}
.mk-sticker-sect{padding:10px 16px 0;color:var(--mk-dim);font-size:12px}
.mk-stickers{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:8px;padding:8px 12px 16px}
.mk-sticker{position:relative;border:1px solid var(--mk-line);border-radius:10px;overflow:hidden;
  background:var(--mk-raised);aspect-ratio:1/1;cursor:pointer;padding:0}
.mk-sticker:hover{border-color:var(--mk-accent)}
.mk-sticker img{width:100%;height:100%;object-fit:cover;display:block}
.mk-sticker .corner{position:absolute;right:3px;top:3px;width:22px;height:22px;border-radius:7px;
  background:rgba(8,12,18,.62);color:#fff;border:1px solid rgba(255,255,255,.18);font-size:12px;
  line-height:20px;text-align:center;padding:0;cursor:pointer}
.mk-sticker .corner.bottom{top:auto;bottom:3px}
.mk-stickers-empty{padding:14px 16px;color:var(--mk-dim);font-size:12.5px;line-height:1.6}
.mk-tab-ico{margin-right:4px;font-size:13px}
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
.mk-now{flex:1 1 170px;min-width:120px;display:flex;align-items:center;gap:9px;overflow:hidden}
.mk-now-art{width:38px;height:38px;border-radius:9px;overflow:hidden;flex:none;background:var(--mk-raised);
  border:1px solid var(--mk-line);display:flex;align-items:center;justify-content:center;color:var(--mk-dim);font-size:15px}
.mk-now-art img{width:100%;height:100%;object-fit:cover;display:block}
.mk-now-info{min-width:0;display:flex;flex-direction:column;justify-content:center}
.mk-now-title{font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mk-now-sub{color:var(--mk-dim);font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* 封面当背景：只在没自定义背景时出现，模糊 + 暗化，不抢文字 */
.mk-hero{position:absolute;z-index:-1;inset:-12% -6% auto -6%;height:220px;pointer-events:none;opacity:0;
  background-size:cover;background-position:center;filter:blur(34px) saturate(1.15);transition:opacity .5s ease;
  -webkit-mask-image:linear-gradient(to bottom,#000 0%,transparent 88%);mask-image:linear-gradient(to bottom,#000 0%,transparent 88%)}
.mk-hero.mk-on{opacity:.42}
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
/* ---- 背景图调整：预览框和面板同比例，先调好再放进去 ---- */
.mk-bgedit{position:fixed;inset:0;z-index:2147482000;display:flex;align-items:center;justify-content:center;
  padding:16px;background:rgba(6,9,13,.62);backdrop-filter:blur(2px)}
.mk-bgedit-box{width:min(560px,94vw);max-height:92vh;overflow:auto;background:var(--mk-bg);color:var(--mk-fg);
  border:1px solid var(--mk-line);border-radius:14px;box-shadow:var(--mk-shadow);padding:14px 16px 12px;
  display:flex;flex-direction:column;gap:9px}
.mk-bgedit-box h3{margin:0;font-size:14px}
.mk-bgedit-box h3 small{display:block;font-weight:400;color:var(--mk-dim);font-size:11.5px;margin-top:3px}
.mk-bgedit-stage{position:relative;margin:0 auto;border-radius:10px;overflow:hidden;background:#0b1017;
  border:1px solid var(--mk-line);cursor:grab;touch-action:none}
.mk-bgedit-stage.mk-drag{cursor:grabbing}
.mk-bgedit-img{position:absolute;inset:0;background-repeat:no-repeat;background-size:cover;
  background-position:center;will-change:transform}
.mk-bgedit-grid{position:absolute;inset:0;pointer-events:none;opacity:.5;
  background-image:linear-gradient(to right,rgba(255,255,255,.16) 1px,transparent 1px),
    linear-gradient(to bottom,rgba(255,255,255,.16) 1px,transparent 1px);
  background-size:33.34% 100%,100% 33.34%}
.mk-bgedit-row{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--mk-dim)}
.mk-bgedit-row b{color:var(--mk-accent);font-variant-numeric:tabular-nums;min-width:44px}
.mk-bgedit-row input[type=range]{flex:1;accent-color:var(--mk-accent)}
.mk-bgedit-note{margin:0;font-size:11.5px;color:var(--mk-dim);line-height:1.5}
.mk-bgedit-acts{display:flex;gap:8px;justify-content:flex-end}
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
  /* 顶栏按钮多了一个「歌单」，手机上排不下就换行，别把 ✕ 挤出去 */
  .mk-head{flex-wrap:wrap}
  .mk-right{flex-wrap:wrap;justify-content:flex-end;gap:6px;margin-left:auto}
  .mk-right .mk-btn{padding:6px 10px;font-size:12px}
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
            <button class="mk-btn mk-ghost" data-act="history" title="我点过的歌（存在本机）">历史</button>
            <button class="mk-btn mk-ghost" data-act="playlists" title="我的歌单（存在本机，可一键整批点）">歌单 <span data-el="pl-count"></span></button>
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
        <div class="mk-hero" data-el="hero"></div>
        <div class="mk-tabs" data-el="tabs"></div>
        <div class="mk-batch" data-el="batch">
          <span data-el="batch-txt"></span>
          <button class="mk-btn mk-ghost" data-act="batch-cancel">取消</button>
        </div>
        <div class="mk-scopes" data-el="scopes"></div>
        <div class="mk-bili" data-el="bili"></div>
        <div class="mk-body" data-el="body"></div>
        <div class="mk-pager" data-el="pager"></div>
        <div class="mk-player">
          <button class="mk-ctl" data-act="prev" title="上一首">⏮</button>
          <button class="mk-ctl mk-main" data-act="toggle-play" title="播放 / 暂停">▶</button>
          <button class="mk-ctl" data-act="next" title="下一首">⏭</button>
          <div class="mk-now" data-el="now">
            <div class="mk-now-art" data-el="now-art"><span>♪</span></div>
            <div class="mk-now-info">
              <div class="mk-now-title" data-el="now-title">未在播放</div>
              <div class="mk-now-sub" data-el="now-sub">点结果里的 ▶ 开始</div>
            </div>
          </div>
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
    const elLyrics = $('[data-el=lyrics]') || null;
    const elTabs = $('[data-el=tabs]') || stub();
    const elScopes = $('[data-el=scopes]') || null;
    const elBili = $('[data-el=bili]') || null;
    const elKw = $('[data-el=kw]') || stub();
    const elStat = $('[data-el=stat]') || stub();
    const elLoginBtn = $('[data-act=login]') || stub();
    const elNow = $('[data-el=now]') || stub();
    const elNowArt = $('[data-el=now-art]') || stub();
    const elNowTitle = $('[data-el=now-title]') || stub();
    const elNowSub = $('[data-el=now-sub]') || stub();
    const elHero = $('[data-el=hero]') || null;
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
    // B 站筛选项（排序 / 时长 / 发布时间 / 只看某 UP 主），只对 B 站 tab 生效
    const biliFilters = { order: 'totalrank', duration: '0', days: '0', author: '' };
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
    // 网易云音质档位（8 档，v1 接口的 level 值）
    const NET_LEVELS = [
      { id: 'standard', label: '标准' },
      { id: 'higher', label: '较高' },
      { id: 'exhigh', label: '极高' },
      { id: 'lossless', label: '无损' },
      { id: 'hires', label: 'Hi-Res' },
      { id: 'jyeffect', label: '环绕' },
      { id: 'sky', label: '沉浸' },
      { id: 'jymaster', label: '母带' },
    ];
    const SETTINGS_DEFAULT = {
      ball: true, gesture: true, theme: 'auto', accent: 'blue', compact: false,
      card: true, batchSummary: true, neteaseLevel: 'exhigh', coverBg: true, bili: 'video', quality: '720', bg: '', bgDim: 0.5, bgBlur: false,
      bgZoom: 1.06, bgX: 0, bgY: 0, bgBright: 1,
      lyric: true, lyricSize: 3, lyricFloat: true, lyricLock: false, lyricLines: 3, lyricW: 520,
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
      out.batchSummary = out.batchSummary !== false;
      out.coverBg = out.coverBg !== false;
      out.neteaseLevel = NET_LEVELS.some((x) => x.id === out.neteaseLevel) ? out.neteaseLevel : 'exhigh';
      out.bili =
        out.bili === 'video' || out.bili === 'native' || out.bili === 'link' ? out.bili : 'audio';
      out.bgBlur = Boolean(out.bgBlur);
      // 标准版没有 1080P：强制 720P（HD 版 opt-in）
      out.quality = opts.hd && out.quality === '1080' ? '1080' : '720';
      out.clock = out.clock !== false;
      out.lyric = out.lyric !== false;
      // 字号 5 档（数字）；老数据里的 sm/md/lg 映射过来
      const legacySize = { sm: 2, md: 3, lg: 4 };
      const sizeLevel = legacySize[out.lyricSize] || Math.round(Number(out.lyricSize) || 0);
      out.lyricSize = sizeLevel >= 1 && sizeLevel <= 5 ? sizeLevel : 3;
      // 歌词行数：1–9 行，拖动歌词窗右下角就能改（不再放设置页里）
      const lines = Math.round(Number(out.lyricLines) || 0);
      out.lyricLines = lines >= 1 && lines <= 9 ? lines : 3;
      out.lyricFloat = true;
      out.lyricLock = out.lyricLock === true;
      const lw = Number(out.lyricW);
      out.lyricW = Number.isFinite(lw) ? Math.min(900, Math.max(220, Math.round(lw))) : 520;
      const z = Number(out.bgZoom);
      out.bgZoom = Number.isFinite(z) ? Math.min(3, Math.max(1, z)) : SETTINGS_DEFAULT.bgZoom;
      const bx = Number(out.bgX);
      out.bgX = Number.isFinite(bx) ? Math.min(50, Math.max(-50, bx)) : 0;
      const by = Number(out.bgY);
      out.bgY = Number.isFinite(by) ? Math.min(50, Math.max(-50, by)) : 0;
      const br = Number(out.bgBright);
      out.bgBright = Number.isFinite(br) ? Math.min(1.6, Math.max(0.4, br)) : 1;
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

    var nowArtUrl = '';

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
      st.setProperty('--mk-bg-zoom', String(settings.bgZoom || 1.06));
      st.setProperty('--mk-bg-x', (settings.bgX || 0) + '%');
      st.setProperty('--mk-bg-y', (settings.bgY || 0) + '%');
      st.setProperty('--mk-bg-bright', String(settings.bgBright || 1));
      if (elHero) {
        const useIt = !bg && settings.coverBg !== false && Boolean(nowArtUrl);
        elHero.style.backgroundImage = useIt ? 'url("' + String(nowArtUrl).replace(/"/g, '%22') + '")' : '';
        elHero.classList.toggle('mk-on', useIt);
      }
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
      renderLyricFloat();
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
      const patch = { [group]: group === 'bgDim' || group === 'lyricLines' ? Number(value) : String(value) };
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
        if (d.media) {
          const m = d.media;
          bits.push(
            '房间音源 ' +
              (m.hooked ? (m.playing ? '已盯上（在响）' : '已盯上（没在响）') : '未找到') +
              (m.tracked ? ' · 播放器 ' + m.tracked : '') +
              (m.lastCut ? ' · 最近切歌 ' + m.lastCut : ''),
          );
        }
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
        sw('batchSummary', '点完发一条汇总', '整批点完后在房间里留一句：几首 / 总时长 / 哪几首没拿到音频（不带进度条刷屏）') +
        '<div class="mk-set-row"><div class="mk-meta"><b>B 站播放</b><small>音频轨最省流量；视频要「视频分享」房间，而且走中转流量</small></div></div>' +
        '<div class="mk-chips">' +
        chip('bili', 'audio', '音频轨') +
        chip('bili', 'video', '视频') +
        chip('bili', 'link', '外链') +
        chip('bili', 'native', '原生') +
        '</div>' +
        (opts.hd
          ? '<div class="mk-set-row"><div class="mk-meta"><b>B 站画质</b><small>1080P 需要中转用 FFmpeg 合流：首播多等几秒，流量约翻倍</small></div></div>' +
            '<div class="mk-chips">' +
            chip('quality', '720', '720P') +
            chip('quality', '1080', '1080P') +
            '</div>'
          : '') +
        (typeof opts.onRelayChange === 'function'
          ? '<div class="mk-set-row"><div class="mk-meta"><b>网易云音质</b><small>无损以上要会员；拿不到会退回 320k，不会放不出来</small></div></div>' +
            '<div class="mk-chips">' +
            NET_LEVELS.map((lv) => chip('neteaseLevel', lv.id, lv.label)).join('') +
            '</div>'
          : '') +
        '</div>' +
        '<div class="mk-set-group"><h4>外观</h4>' +
        sw('coverBg', '封面当背景', '正在播放的封面会在面板顶上做一层模糊背景；设了自定义背景时不生效') +
        sw('lyric', '显示歌词', '有歌词的曲目在悬浮窗里滚动，外语歌原文 + 译文双行') +
        '<p class="mk-note">歌词窗上直接调：<b>A− / A+</b> 字号（5 档）· 按住拖动位置 · 右下角斜着拉改大小（上下拉 = 多看 / 少看几行）· <b>🔒</b> 锁定后点击穿透 · <b>✕</b> 关掉。</p>' +
        '<div class="mk-bg-inputs"><button class="mk-btn mk-ghost" data-act="lyric-reset">重置歌词窗（位置 / 字号 / 解锁）</button></div>' +
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
        (settings.bg ? '；点「调整图片」先调位置 / 缩放，满意了再应用' : '；本机图片会先压缩再存进浏览器') +
        '</small></div>' +
        '<span class="mk-bg-prev" data-el="bg-prev"></span></div>' +
        '<div class="mk-bg-inputs">' +
        '<input class="mk-input" data-el="bg-url" type="text" inputmode="url" placeholder="粘图片链接 https://…">' +
        '<button class="mk-btn" data-act="bg-apply">用这个链接</button>' +
        '<button class="mk-btn" data-act="bg-file">选本机图片</button>' +
        '<button class="mk-btn mk-ghost" data-act="bg-clear">清除</button>' +
        '</div>' +
        '<input type="file" accept="image/*" data-el="bg-file" class="mk-hidden">' +
        (settings.bg
          ? '<div class="mk-bg-inputs"><button class="mk-btn mk-primary" data-act="bg-edit">调整图片（位置 / 缩放）</button>' +
            '<button class="mk-btn mk-ghost" data-act="bg-reset">恢复默认</button></div>'
          : '') +
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

    // ---------------------------------------------------- 背景图调整（先调好再放进去）
    // 为什么要有这一步：背景是 background-size:cover，图片一进来就被居中裁好，
    // 想露哪块只能靠事后那几个滑杆猜。这里给一个和面板等比的小预览，
    // 拖图 = 挪位置、拉缩放 = 裁范围，面板用的是同一套 transform，所见即所得。
    let bgEditor = null;

    function closeBgEditor() {
      if (bgEditor && bgEditor.parentNode) bgEditor.parentNode.removeChild(bgEditor);
      bgEditor = null;
    }

    function openBgEditor(url, opts) {
      const src = String(url || '').trim();
      if (!src || !isSafeBg(src)) {
        setStat('这个图片地址不支持');
        return null;
      }
      closeBgEditor();
      const options = opts || {};
      const before = {
        bg: settings.bg,
        bgZoom: settings.bgZoom,
        bgX: settings.bgX,
        bgY: settings.bgY,
        bgBright: settings.bgBright,
      };
      // 预览框跟面板同比例，这样裁出来的就是最终效果
      let aspect = 1000 / 720;
      try {
        const card = root.querySelector('.mk-card');
        const r = card && card.getBoundingClientRect ? card.getBoundingClientRect() : null;
        if (r && r.width > 60 && r.height > 60) aspect = r.width / r.height;
      } catch (e) {
        /* 用默认比例 */
      }
      const vw = (window.innerWidth || 1200) - 64;
      const vh = (window.innerHeight || 800) - 220;
      let sw = Math.round(Math.min(520, vw));
      let sh = Math.round(sw / aspect);
      if (sh > vh && vh > 120) {
        sh = Math.round(vh);
        sw = Math.round(sh * aspect);
      }
      sw = Math.max(160, sw);
      sh = Math.max(90, sh);

      const draft = {
        url: src,
        zoom: options.fresh ? 1.06 : Number(settings.bgZoom) || 1.06,
        x: options.fresh ? 0 : Number(settings.bgX) || 0,
        y: options.fresh ? 0 : Number(settings.bgY) || 0,
        bright: options.fresh ? 1 : Number(settings.bgBright) || 1,
      };

      const el = doc.createElement('div');
      el.className = 'mk-bgedit';
      el.innerHTML =
        '<div class="mk-bgedit-box">' +
        '<h3>调整背景图<small>拖动图片选位置；想挪得更多，先把缩放拉大</small></h3>' +
        '<div class="mk-bgedit-stage" data-el="bge-stage" style="width:' + sw + 'px;height:' + sh + 'px">' +
        '<div class="mk-bgedit-img" data-el="bge-img"></div><div class="mk-bgedit-grid"></div></div>' +
        '<label class="mk-bgedit-row">缩放<b data-el="bge-zoom-val">' + Math.round(draft.zoom * 100) + '%</b>' +
        '<input type="range" data-el="bge-zoom" min="100" max="300" step="1" value="' + Math.round(draft.zoom * 100) + '"></label>' +
        '<label class="mk-bgedit-row">亮度<b data-el="bge-bright-val">' + Math.round(draft.bright * 100) + '%</b>' +
        '<input type="range" data-el="bge-bright" min="40" max="160" step="1" value="' + Math.round(draft.bright * 100) + '"></label>' +
        '<p class="mk-bgedit-note">预览框和面板同比例，这里看到什么样，用上去就是什么样。</p>' +
        '<div class="mk-bgedit-acts">' +
        '<button class="mk-btn mk-ghost" data-bge="reset">重置</button>' +
        '<button class="mk-btn" data-bge="cancel">取消</button>' +
        '<button class="mk-btn mk-primary" data-bge="ok">用这张</button>' +
        '</div></div>';
      root.appendChild(el);
      bgEditor = el;

      const stage = el.querySelector('[data-el=bge-stage]');
      const img = el.querySelector('[data-el=bge-img]');

      /** 平移不能露出底色：能挪的上限就是放大出来的那一圈 */
      function clampPan() {
        const max = Math.min(50, Math.max(0, ((draft.zoom - 1) / 2) * 100));
        draft.x = Math.min(max, Math.max(-max, draft.x));
        draft.y = Math.min(max, Math.max(-max, draft.y));
      }

      function paint() {
        const st = img.style;
        st.backgroundImage = 'url("' + src.replace(/["\\\n\r\t]/g, '') + '")';
        st.backgroundSize = 'cover';
        st.backgroundPosition = 'center';
        st.filter = 'brightness(' + draft.bright + ')' + (settings.bgBlur ? ' blur(6px)' : '');
        st.transform = 'scale(' + draft.zoom + ') translate(' + draft.x + '%, ' + draft.y + '%)';
        const lab1 = el.querySelector('[data-el=bge-zoom-val]');
        if (lab1) lab1.textContent = Math.round(draft.zoom * 100) + '%';
        const lab2 = el.querySelector('[data-el=bge-bright-val]');
        if (lab2) lab2.textContent = Math.round(draft.bright * 100) + '%';
        const r1 = el.querySelector('[data-el=bge-zoom]');
        if (r1 && String(r1.value) !== String(Math.round(draft.zoom * 100))) r1.value = String(Math.round(draft.zoom * 100));
        const r2 = el.querySelector('[data-el=bge-bright]');
        if (r2 && String(r2.value) !== String(Math.round(draft.bright * 100))) r2.value = String(Math.round(draft.bright * 100));
      }

      function commit() {
        settings = normalizeSettings(
          Object.assign({}, settings, {
            bg: src,
            bgZoom: draft.zoom,
            bgX: draft.x,
            bgY: draft.y,
            bgBright: draft.bright,
          }),
        );
        const ok = saveSettings();
        applySettings();
        closeBgEditor();
        renderSettings();
        if (!ok) setStat('这张图太大，浏览器存不下（约 5MB）：本次生效，刷新会丢');
        else setStat('背景已应用（位置 / 缩放记在本机）');
      }

      let drag = false;
      let sx = 0;
      let sy = 0;
      let ox = 0;
      let oy = 0;
      if (stage) {
        stage.addEventListener('pointerdown', (ev) => {
          drag = true;
          sx = ev.clientX || 0;
          sy = ev.clientY || 0;
          ox = draft.x;
          oy = draft.y;
          stage.classList.add('mk-drag');
          try {
            stage.setPointerCapture(ev.pointerId);
          } catch (e) {
            /* 忽略 */
          }
          ev.preventDefault();
        });
        stage.addEventListener('pointermove', (ev) => {
          if (!drag) return;
          const dx = (ev.clientX || 0) - sx;
          const dy = (ev.clientY || 0) - sy;
          // 屏幕像素 → 百分比：translate 是先移再放大，所以 1% 在屏幕上等于 sw*zoom/100
          draft.x = ox + (dx / (sw * draft.zoom)) * 100;
          draft.y = oy + (dy / (sh * draft.zoom)) * 100;
          clampPan();
          paint();
        });
        const endDrag = () => {
          drag = false;
          stage.classList.remove('mk-drag');
        };
        stage.addEventListener('pointerup', endDrag);
        stage.addEventListener('pointercancel', endDrag);
      }

      el.addEventListener('input', (ev) => {
        const t = ev.target;
        const f = t && t.getAttribute ? t.getAttribute('data-el') : '';
        if (f === 'bge-zoom') {
          draft.zoom = Math.min(3, Math.max(1, (Number(t.value) || 106) / 100));
          clampPan();
          paint();
        } else if (f === 'bge-bright') {
          draft.bright = Math.min(1.6, Math.max(0.4, (Number(t.value) || 100) / 100));
          paint();
        }
      });

      el.addEventListener('click', (ev) => {
        const btn = ev.target && ev.target.closest ? ev.target.closest('[data-bge]') : null;
        if (!btn) return;
        const act = btn.getAttribute('data-bge');
        if (act === 'cancel') {
          settings = normalizeSettings(Object.assign({}, settings, before));
          applySettings();
          closeBgEditor();
          setStat('已取消，背景没变');
        } else if (act === 'reset') {
          draft.zoom = 1.06;
          draft.x = 0;
          draft.y = 0;
          draft.bright = 1;
          paint();
        } else if (act === 'ok') {
          commit();
        }
      });

      paint();
      return el;
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
    function onViewportChange() {
      clampLyricFloat();
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
      // 视口变了（旋转手机 / 改窗口大小）就把歌词窗夹回可见范围，别让它跑出去
      window.addEventListener('resize', onViewportChange);
      window.addEventListener('orientationchange', onViewportChange);
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
            `<button class="mk-tab${p.id === current ? ' mk-on' : ''}" data-tab="${esc(p.id)}">${p.icon ? '<span class="mk-tab-ico">' + esc(p.icon) + '</span>' : ''}${esc(p.label)}</button>`,
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

    /** B 站专属筛选：排序 / 时长 / 发布时间 / 只看某个 UP 主（和 B 站网页同一套参数） */
    function renderBiliFilters() {
      if (!elBili) return;
      const on = current === 'bilibili' && (scope === 'song' || !scopes);
      if (!on) {
        elBili.classList.remove('mk-on');
        elBili.innerHTML = '';
        return;
      }
      const chips = (group, list) =>
        list
          .map(
            ([v, label]) =>
              `<button class="mk-chip${String(biliFilters[group]) === v ? ' mk-on' : ''}" data-bf="${group}" data-bfv="${v}">${label}</button>`,
          )
          .join('');
      elBili.innerHTML =
        '<span class="mk-bf-label">排序</span>' +
        chips('order', [
          ['totalrank', '综合'],
          ['click', '最多播放'],
          ['pubdate', '最新发布'],
          ['dm', '最多弹幕'],
          ['stow', '最多收藏'],
        ]) +
        '<span class="mk-bf-label">时长</span>' +
        chips('duration', [
          ['0', '全部'],
          ['1', '&lt;10 分'],
          ['2', '10-30 分'],
          ['3', '30-60 分'],
          ['4', '&gt;60 分'],
        ]) +
        '<span class="mk-bf-label">发布</span>' +
        chips('days', [
          ['0', '全部'],
          ['1', '一天'],
          ['7', '一周'],
          ['180', '半年'],
        ]) +
        '<input class="mk-input mk-bf-input" data-el="bf-author" type="search" placeholder="只看 UP 主（如 JLRS，可留空）" value="' +
        esc(biliFilters.author) +
        '">' +
        '<button class="mk-btn" data-act="bf-apply">应用</button>';
      elBili.classList.add('mk-on');
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


    /** 正在播放的封面：有就显示，同时把它当面板顶部的模糊背景（可关） */
    function setNowArt(src) {
      const url = String(src || '');
      if (url === nowArtUrl) return;
      nowArtUrl = url;
      if (elNowArt) {
        elNowArt.innerHTML = url ? '<img src="' + esc(url) + '" alt="" loading="lazy">' : '<span>♪</span>';
      }
      if (elHero) {
        const useIt = url && settings.coverBg !== false && !settings.bg;
        elHero.style.backgroundImage = useIt ? 'url("' + url.replace(/"/g, '%22') + '")' : '';
        elHero.classList.toggle('mk-on', Boolean(useIt));
      }
    }

    function setNow(main, sub) {
      if (elNowTitle) elNowTitle.textContent = main || '未在播放';
      if (elNowSub) elNowSub.textContent = sub || '';
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
          const info = await api.playurl({ platform: song.platform, id: song.id, mode: 'video', quality: settings.quality, level: settings.neteaseLevel });
          if (!info || !info.playable || !info.streamUrl) {
            throw new Error((info && info.note) || '拿不到视频地址');
          }
          if (typeof opts.onExternalRequest !== 'function') throw new Error('当前环境不支持外链点播');
          await opts.onExternalRequest(song, info);
          setNow(label, '已发外链点播 · 等 IIROSE 解析出画面');
          setStat('已发外链点播：' + esc(song.title));
          markPlayed(song, 'link');
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
          markPlayed(song, 'native');
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
        const info = await api.playurl({ platform: song.platform, id: song.id, mode: playAs, quality: settings.quality, level: settings.neteaseLevel });
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
          markPlayed(song, 'room');
          // 记一笔「房间这首在放」：刷新后接得回来，放完自动收（含歌词）
          beginRoomNow({
            title: song.title,
            sub: (song.artists || []).join(' / '),
            artists: song.artists || [],
            durationMs: (info && info.durationSec ? Number(info.durationSec) * 1000 : 0) || Number(song.durationMs) || 0,
            platform: song.platform,
            id: song.id,
            cover: song.cover || '',
            startedAt: Date.now(),
            predicted: true,
          });
          return { played: true, mode: 'room' };
        }
        elAudio.src = info.streamUrl;
        elAudio.load();
        await elAudio.play();
        setNowArt(song.cover || '');
      setNow(label, '播放中 · ' + (info.ext || 'audio') + (info.bitrate ? ' · ' + Math.round(info.bitrate / 1000) + 'k' : ''));
        setPlayIcon(true);
        setStat('正在播放：' + esc(song.title));
        markPlayed(song, 'local');
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
        if (!t || typeof t.getAttribute !== 'function') return;
        const bgField = t.getAttribute('data-el');
        if (bgField === 'bg-zoom' || bgField === 'bg-x' || bgField === 'bg-y' || bgField === 'bg-bright') {
          const v = Number(t.value);
          const patch =
            bgField === 'bg-zoom'
              ? { bgZoom: v / 100 }
              : bgField === 'bg-x'
                ? { bgX: v }
                : bgField === 'bg-y'
                  ? { bgY: v }
                  : { bgBright: v / 100 };
          settings = normalizeSettings(Object.assign({}, settings, patch));
          saveSettings();
          applySettings();
          return;
        }
        if (t.getAttribute('data-el') !== 'opacity') return;
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
        const extra =
          current === 'bilibili' && type === 'song'
            ? {
                order: biliFilters.order,
                duration: biliFilters.duration,
                days: biliFilters.days,
                author: biliFilters.author,
              }
            : {};
        const data = await api.search(Object.assign({ platform: current, keyword: kw, limit, page: target, type }, extra));
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
            const tip =
              current === 'bilibili' && biliFilters.author
                ? '没找到这个 UP 主的视频：试试把名字加进关键词，或清空「只看 UP 主」再搜。'
                : '没有结果。换个关键词，或换一个平台试试。';
            elBody.innerHTML = '<div class="mk-empty">' + tip + '</div>';
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
          ? '<button class="mk-btn" data-act="pl-save" title="存到本机，以后一键整批点">收藏</button>' +
            '<button class="mk-btn" data-act="sel-all">全选</button>' +
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
      // 从「我的歌单」里点进来的，返回要回到歌单列表，而不是搜索结果
      if (back.to === 'playlists') {
        renderPlaylists();
        return;
      }
      page = back.page || 1;
      renderList(back.list, back.kind, labelOf(current) + ' · ' + (back.list || []).length + ' 条');
      renderPager();
      setStat('已返回搜索结果');
    }

    // ------------------------------------------------------------ 我的歌单（本机）
    // 存的是「歌单快照」：名字 + 歌（够点歌用），不联网、不上传。
    // 干两件事：把远端歌单收藏成自己的；把点歌历史打包成歌单。
    const PL_KEY = 'mk_playlists';
    const PL_MAX = 30;
    const PL_SONGS_MAX = 500;

    function loadPlaylists() {
      try {
        const raw = window.localStorage.getItem(PL_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return (Array.isArray(arr) ? arr : []).filter((p) => p && p.id && Array.isArray(p.songs)).slice(0, PL_MAX);
      } catch (e) {
        return [];
      }
    }

    let localPlaylists = loadPlaylists();
    paintPlCount();

    function paintPlCount() {
      const badge = $('[data-el=pl-count]');
      if (badge) badge.textContent = localPlaylists.length ? String(localPlaylists.length) : '';
    }

    function savePlaylists() {
      try {
        window.localStorage.setItem(PL_KEY, JSON.stringify(localPlaylists.slice(0, PL_MAX)));
      } catch (e) {
        setStat('存不下（浏览器约 5MB）：删几个旧歌单再试');
      }
      paintPlCount();
    }

    /** 只留下点歌需要的字段，省空间（歌手最多 3 个） */
    function songLite(s) {
      return {
        platform: s.platform,
        id: String(s.id),
        title: s.title || '',
        artists: (s.artists || []).slice(0, 3),
        album: s.album || '',
        durationMs: Number(s.durationMs) || 0,
        cover: s.cover || '',
        url: s.url || '',
      };
    }

    function songsDuration(list) {
      return (list || []).reduce((n, s) => n + (Number(s.durationMs) || 0), 0);
    }

    function fmtMinutes(ms) {
      if (!ms) return '';
      const min = ms / 60000;
      return (min >= 10 ? Math.round(min) : min.toFixed(1)) + ' 分钟';
    }

    /** 收藏 / 更新一个歌单；同一个远端歌单重复收藏就是更新 */
    function upsertPlaylist(meta) {
      const name = String(meta.name || '未命名歌单').trim().slice(0, 40) || '未命名歌单';
      const songs = (meta.songs || []).filter((s) => s && s.id).slice(0, PL_SONGS_MAX).map(songLite);
      if (!songs.length) {
        setStat('这个歌单里没有可存的歌');
        return null;
      }
      const same = meta.sourceId
        ? localPlaylists.find((p) => p.sourceId && p.sourceId === meta.sourceId)
        : null;
      if (same) {
        same.name = name;
        same.songs = songs;
        same.t = Date.now();
        if (meta.cover) same.cover = meta.cover;
        savePlaylists();
        return same;
      }
      const item = {
        id: 'pl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name,
        cover: meta.cover || '',
        platform: meta.platform || '',
        sourceId: meta.sourceId || '',
        songs,
        t: Date.now(),
      };
      localPlaylists.unshift(item);
      if (localPlaylists.length > PL_MAX) localPlaylists = localPlaylists.slice(0, PL_MAX);
      savePlaylists();
      return item;
    }

    function renderPlaylists() {
      if (!detailBack) detailBack = { list: lastResults, kind: listKind, page: page };
      inPlaylist = false;
      playlistCtx = null;
      queueOpen = false;
      const rows = localPlaylists.length
        ? localPlaylists
            .map((p, i) => {
              const sub = [p.songs.length + ' 首', fmtMinutes(songsDuration(p.songs)), fmtWhen(p.t) + ' 存']
                .filter(Boolean)
                .join(' · ');
              return (
                '<div class="mk-song mk-clickable" data-act="pl-open" data-i="' +
                i +
                '">' +
                '<button class="mk-play" data-act="pl-play" data-i="' +
                i +
                '" title="整批点这个歌单">▶</button>' +
                coverOf(p.cover, '♪') +
                '<div class="mk-meta"><div class="mk-name">' +
                esc(p.name) +
                '</div><div class="mk-sub">' +
                esc(sub) +
                '</div></div>' +
                '<div class="mk-acts"><button data-act="pl-del" data-i="' +
                i +
                '" title="从本机删掉这个歌单">✕</button></div></div>'
              );
            })
            .join('')
        : '<div class="mk-empty">还没有收藏的歌单。<br>① 范围选「歌单」搜一个 → 点进去 → 顶部「收藏」；<br>② 或者「历史」页里点「存成歌单」，把点过的歌打包。</div>';
      const head =
        '<div class="mk-detail-head"><div class="mk-meta"><div class="mk-name">我的歌单</div>' +
        '<div class="mk-sub">' +
        esc('共 ' + localPlaylists.length + ' 个 · 存在本机，不联网') +
        '</div></div><div class="mk-detail-acts">' +
        '<button class="mk-btn" data-act="pl-export" title="导出成 JSON 文件，换电脑/换浏览器再导入">导出</button>' +
        '<button class="mk-btn" data-act="pl-import" title="从导出的 JSON 文件合并进来">导入</button>' +
        '<input type="file" data-el="pl-file" accept=".json,application/json" hidden>' +
        '<button class="mk-btn" data-act="hist-to-pl">从历史建歌单</button>' +
        '<button class="mk-btn" data-act="back">‹ 返回</button></div></div>';
      elBody.innerHTML = head + rows;
      if (elPager && elPager.classList) elPager.classList.remove('mk-on');
      setStat('我的歌单 ' + localPlaylists.length + ' 个');
    }

    /** 打开本机歌单：用和远端歌单一样的详情页（全选 / 全部点歌 / 点选中的都可用） */
    function openLocalPlaylist(i) {
      const p = localPlaylists[i];
      if (!p) return;
      detailBack = { list: lastResults, kind: listKind, page: page, to: 'playlists' };
      inPlaylist = false;
      lastResults = p.songs.slice();
      lastLimit = Math.max(1, lastResults.length);
      page = 1;
      playlistCtx = {
        songs: lastResults,
        pl: { name: p.name, cover: p.cover, creator: '本机收藏' },
      };
      selected.clear();
      renderPlaylistDetail();
      if (elPager && elPager.classList) elPager.classList.remove('mk-on');
      setStat('「' + esc(p.name) + '」· ' + p.songs.length + ' 首');
    }

    function deleteLocalPlaylist(i) {
      const p = localPlaylists[i];
      if (!p) return;
      localPlaylists.splice(i, 1);
      savePlaylists();
      renderPlaylists();
      setStat('已删除歌单「' + p.name + '」');
    }

    // ---------------- 歌单导出 / 导入（换浏览器、换电脑不丢） ----------------
    function copyText(text) {
      return new Promise((resolve) => {
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => resolve(true), () => resolve(false));
            return;
          }
        } catch (e) { /* 老浏览器没有剪贴板 */ }
        resolve(false);
      });
    }

    function playlistsPayload() {
      return {
        app: 'music-plugin',
        kind: 'playlists',
        version: 1,
        exportedAt: new Date().toISOString(),
        playlists: localPlaylists.map((p) => ({
          name: p.name,
          cover: p.cover || '',
          platform: p.platform || '',
          sourceId: p.sourceId || '',
          t: p.t || Date.now(),
          songs: (p.songs || []).map(songLite),
        })),
      };
    }

    /** 导出：优先存成 .json 文件，浏览器不让下载就退回剪贴板 */
    function exportPlaylists() {
      if (!localPlaylists.length) {
        setStat('还没有歌单可导出');
        return '';
      }
      const text = JSON.stringify(playlistsPayload(), null, 2);
      const name = 'music-playlists-' + new Date().toISOString().slice(0, 10) + '.json';
      let ok = false;
      try {
        const url = global.URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const a = doc.createElement('a');
        a.href = url;
        a.download = name;
        doc.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => {
          try { global.URL.revokeObjectURL(url); } catch (e) { /* 忽略 */ }
        }, 5000);
        ok = true;
      } catch (e) {
        ok = false;
      }
      if (ok) {
        setStat('已导出 ' + localPlaylists.length + ' 个歌单（' + name + '）');
      } else {
        copyText(text).then((done) => setStat(done ? '浏览器不让下载：JSON 已复制到剪贴板' : '导出失败：请换浏览器再试'));
      }
      return text;
    }

    function readFileText(file) {
      return new Promise((resolve, reject) => {
        if (file && typeof file.text === 'function') {
          file.text().then(resolve, reject);
          return;
        }
        try {
          const fr = new global.FileReader();
          fr.onload = () => resolve(String(fr.result || ''));
          fr.onerror = () => reject(new Error('读取失败'));
          fr.readAsText(file);
        } catch (e) {
          reject(e);
        }
      });
    }

    /** 导入：合并进本机（同名且曲目完全一样视为重复，跳过） */
    function importPlaylists(text) {
      let data = null;
      try {
        data = JSON.parse(String(text || ''));
      } catch (e) {
        setStat('导入失败：不是合法的 JSON 文件');
        return { ok: false, why: 'json', added: 0, songs: 0, skipped: 0 };
      }
      const arr = Array.isArray(data) ? data : data && Array.isArray(data.playlists) ? data.playlists : null;
      if (!arr) {
        setStat('导入失败：文件里没有 playlists 列表');
        return { ok: false, why: 'shape', added: 0, songs: 0, skipped: 0 };
      }
      const sigOf = (list) => list.map((s) => s.platform + ':' + s.id).join(',');
      let added = 0;
      let songs = 0;
      let skipped = 0;
      for (const raw of arr.slice(0, PL_MAX)) {
        const list = ((raw && raw.songs) || []).filter((s) => s && s.id);
        if (!list.length) continue;
        const name = String((raw && raw.name) || '').trim();
        const sig = sigOf(list);
        const dup = localPlaylists.some((p) => p.name === name && sigOf(p.songs) === sig);
        if (dup) {
          skipped += 1;
          continue;
        }
        const item = upsertPlaylist({
          name,
          cover: raw.cover,
          platform: raw.platform,
          sourceId: raw.sourceId,
          songs: list,
        });
        if (item) {
          added += 1;
          songs += item.songs.length;
        }
      }
      savePlaylists();
      setStat(
        added
          ? '导入 ' + added + ' 个歌单 · ' + songs + ' 首' + (skipped ? '（跳过 ' + skipped + ' 个重复的）' : '')
          : skipped
            ? '本机已经有这些歌单了（跳过 ' + skipped + ' 个）'
            : '文件里没有可导入的歌',
      );
      if (added) renderPlaylists();
      return { ok: true, added, songs, skipped };
    }

    /** 把当前打开的远端歌单收藏到本机 */
    function savePlaylistCtx() {
      const ctx = playlistCtx;
      if (!ctx) return null;
      const pl = ctx.pl || {};
      const item = upsertPlaylist({
        name: pl.name || '未命名歌单',
        cover: pl.cover || '',
        platform: current,
        sourceId: pl.id ? current + ':' + pl.id : '',
        songs: ctx.songs,
      });
      if (item) {
        setStat('已收藏「' + item.name + '」· ' + item.songs.length + ' 首（存在本机）');
        renderPlaylistDetail();
      }
      return item;
    }

    /** 把点歌历史打包成歌单（历史本来就按歌去重过） */
    function historyToPlaylist() {
      if (!history.length) {
        setStat('历史还是空的，先点几首');
        return null;
      }
      const songs = history.map((h) => ({
        platform: h.platform,
        id: h.id,
        title: h.title,
        artists: h.artists || [],
        durationMs: h.durationMs || 0,
        cover: h.cover || '',
      }));
      const d = new Date();
      const p2 = (n) => String(n).padStart(2, '0');
      const name = '历史 ' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' · ' + songs.length + ' 首';
      // sourceId 固定：同一天再点「存成歌单」是更新，不会存出一堆「历史 xx」
      const item = upsertPlaylist({ name, songs, sourceId: 'history' });
      if (item) {
        setStat('已把 ' + songs.length + ' 首歌存成歌单「' + item.name + '」');
        renderPlaylists();
      }
      return item;
    }

    // ------------------------------------------------ 一次性点多首（房间模式）
    // 以前「全部点歌」只把第一首发进房间，其余留在本机队列里 —— 房间不会自己往下播，
    // 所以看起来「点了 34 首，房间里只有 1 首」。现在一首一首真发：
    //   · 每首发之前才解析地址（播放地址带 20 分钟签名，提前解析会过期）；
    //   · 中间留一点间隔，避免被服务器当刷屏限流；
    //   · 进度只显示在面板里（不往房间刷进度），随时能取消；
    //   · 点完可选发一条「基础信息」汇总（首数 / 总时长 / 没拿到音频的那几首）。
    const BATCH_GAP_MS = 420;
    const BATCH_MAX = 60;
    let batchToken = null;

    function sleep(ms) {
      return new Promise((r) => setTimeout(r, ms));
    }

    function setBatchText(html) {
      const bar = $('[data-el=batch]');
      const txt = $('[data-el=batch-txt]');
      if (txt) txt.innerHTML = html || '';
      if (bar && bar.classList) bar.classList.toggle('mk-on', Boolean(html));
    }

    function cancelBatch() {
      if (!batchToken) return;
      batchToken.cancelled = true;
      setStat('已取消：后面的不再点了（已经发出去的在房间队列里）');
    }

    /** 整批点歌时 B 站用哪种播法：外链/原生是「一次一条消息」，不适合整批，降级成音频轨 */
    function batchPlayAs(song) {
      if (song.platform !== 'bilibili') return 'audio';
      return settings.bili === 'video' ? 'video' : 'audio';
    }

    function batchSummaryText(label, ok, total, totalMs, failed) {
      const bits = [];
      bits.push('点歌' + (label ? '《' + label + '》' : '') + '：' + ok + ' / ' + total + ' 首进队列');
      if (totalMs) bits.push('约 ' + (totalMs / 60000).toFixed(1) + ' 分钟');
      if (failed.length) {
        bits.push(failed.length + ' 首没拿到音频（' + failed.slice(0, 3).map((f) => f.song.title).join(' / ') + (failed.length > 3 ? ' 等' : '') + '）');
      }
      return bits.join(' · ');
    }

    async function sendBatch(songs, label) {
      const list = [];
      const seen = new Set();
      (songs || []).forEach((s) => {
        if (!s || !s.id) return;
        const k = songKey(s);
        if (seen.has(k)) return; // 同一首只点一次
        seen.add(k);
        list.push(s);
      });
      if (!list.length) {
        setStat('这里没有可点的歌');
        return { ok: 0, failed: [], cancelled: false };
      }
      const queue = list.slice(0, BATCH_MAX);
      if (list.length > BATCH_MAX) setStat('一次最多点 ' + BATCH_MAX + ' 首，这次先点前 ' + BATCH_MAX + ' 首');

      const token = { cancelled: false };
      batchToken = token;
      playQueue = queue.slice();
      playIndex = 0;
      refreshRows();
      let ok = 0;
      let totalMs = 0;
      const failed = [];
      for (let i = 0; i < queue.length; i += 1) {
        if (token.cancelled) break;
        const song = queue[i];
        setBatchText('正在点 <b>' + (i + 1) + '/' + queue.length + '</b> · ' + esc(song.title));
        try {
          if (playMode !== 'room') throw new Error('本机试听模式不发房间');
          if (typeof opts.onEnqueue !== 'function') throw new Error('当前环境不支持点播到房间');
          let info = null;
          try {
            info = await api.playurl({
              platform: song.platform,
              id: song.id,
              mode: batchPlayAs(song),
              quality: settings.quality,
              level: settings.neteaseLevel,
            });
          } catch (e) {
            // 网络抖一下重试一次，别让整批因为一次超时就断掉
            await sleep(600);
            info = await api.playurl({
              platform: song.platform,
              id: song.id,
              mode: batchPlayAs(song),
              quality: settings.quality,
              level: settings.neteaseLevel,
            });
          }
          if (!info || !info.playable) throw new Error((info && info.note) || '拿不到播放地址');
          if (token.cancelled) break;
          await opts.onEnqueue(song, info);
          ok += 1;
          totalMs += Number(song.durationMs) || 0;
          markPlayed(song, 'room');
          if (i === 0) {
            beginRoomNow({
              title: song.title,
              sub: (song.artists || []).join(' / '),
              artists: song.artists || [],
              durationMs: Number(song.durationMs) || 0,
              platform: song.platform,
              id: song.id,
              cover: song.cover || '',
              startedAt: Date.now(),
              predicted: true,
            });
          }
        } catch (err) {
          failed.push({ song, why: String((err && err.message) || err) });
        }
        if (i < queue.length - 1 && !token.cancelled) await sleep(BATCH_GAP_MS);
      }
      const cancelled = token.cancelled;
      if (batchToken === token) batchToken = null;
      setBatchText('');
      setStat(
        '已点 ' + ok + '/' + queue.length + ' 首' +
          (failed.length ? ' · ' + failed.length + ' 首失败' : '') +
          (cancelled ? ' · 已取消' : ''),
      );
      // 房间里留一条“基础信息”，不然几十首点完谁也不知道点了什么
      if (settings.batchSummary !== false && ok >= 2 && playMode === 'room' && typeof opts.onNotice === 'function') {
        try {
          opts.onNotice(batchSummaryText(label, ok, queue.length, totalMs, failed));
        } catch (e) {
          /* 汇总发不出去不影响点歌 */
        }
      }
      return { ok, failed, cancelled };
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

    /** 全部点歌：房间里就是「一首一首真发」；本机试听还是走本地队列 */
    function playAll(list) {
      const songs = (list || []).filter((s) => s && s.id).slice(0, 100);
      if (!songs.length) {
        setStat('这里没有可点的歌');
        return Promise.resolve({ ok: 0, failed: [], cancelled: false });
      }
      if (playMode === 'room') {
        const label = (playlistCtx && playlistCtx.pl && playlistCtx.pl.name) || '';
        return sendBatch(songs, label);
      }
      playQueue = songs.slice();
      playIndex = 0;
      refreshRows();
      playSong(playQueue[0], { enqueue: false });
      setStat('整批点歌 ' + songs.length + ' 首，正在播第 1 首');
      return Promise.resolve({ ok: songs.length, failed: [], cancelled: false });
    }

    /** 点选中的：房间模式同样一首一首发，不是只发第一首 */
    function playSelected() {
      const picked = (lastResults || []).filter((s) => s && s.id && selected.has(songKey(s)));
      if (!picked.length) {
        setStat('还没勾选歌曲');
        return Promise.resolve({ ok: 0, failed: [], cancelled: false });
      }
      if (playMode === 'room') {
        const label = (playlistCtx && playlistCtx.pl && playlistCtx.pl.name) || '';
        return sendBatch(picked, label);
      }
      playQueue = picked.slice();
      playIndex = 0;
      refreshRows();
      playSong(playQueue[0], { enqueue: false });
      setStat('点选中的 ' + picked.length + ' 首，正在播第 1 首');
      return Promise.resolve({ ok: picked.length, failed: [], cancelled: false });
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

    // ------------------------------------------------------- 房间正在播放（记账 + 自动收尾）
    // IIROSE 在「开播 / 切歌」时会推一帧 `&1`（带时长，部分还带 LRC）。
    // 我们把这帧记进 localStorage，于是：
    //   · 刷新页面（F5）之后能接回来，不用再去设置里切一圈；
    //   · 到时长自动收（不再「歌放完了，歌词还挂在屏幕上」）。
    const NOW_KEY = 'mk_room_now';

    /** @type {null | {title:string, sub:string, artists:string[], startedAt:number, durationMs:number, platform:string, id:string, lrc:string}} */
    let roomNow = null;
    let roomNowTimer = null;

    function readNow() {
      try {
        const raw = window.localStorage.getItem(NOW_KEY);
        const o = raw ? JSON.parse(raw) : null;
        if (!o || !o.title || !Number(o.startedAt)) return null;
        return o;
      } catch (e) {
        return null;
      }
    }

    function writeNow(o) {
      try {
        if (o) window.localStorage.setItem(NOW_KEY, JSON.stringify(o));
        else window.localStorage.removeItem(NOW_KEY);
      } catch (e) {
        /* 存不下就算了：内存里这份照样会自己收尾 */
      }
    }

    /** 还剩多少毫秒；不知道时长就返回 null */
    function nowRemainMs() {
      if (!roomNow || !roomNow.durationMs) return null;
      return roomNow.startedAt + roomNow.durationMs - Date.now();
    }

    // ------------------------------- 盯着房间里真正在响的那个播放器
    // 服务器只在「开播 / 切歌」时推 &1。你自己点 切歌 / 暂停、或者队列播完最后一句，
    // 是没有任何报文的 —— 于是「播放信息 + 歌词」会一直挂着。
    //
    // 为什么第一版没生效：IIROSE 的播放器很可能是 `new Audio()` 这种「不挂到 DOM 上」的元素，
    // document.querySelectorAll('audio,video') 根本找不到它。所以现在从原型层面登记：
    //   · 给 HTMLMediaElement.prototype.play / pause / src 打补丁 —— 谁响过就记下来；
    //   · 包装 window.Audio 构造，新建的也记下来；
    //   · 监听到 http(s) 的切歌指令（socket.send 里发出去的 "cut"）也当成一个信号。
    //
    // 为什么不用 AudioContext 去「听」音源：房间音频来自 music.126.net 这类没有 CORS 头的地址，
    // MediaElementAudioSourceNode 接上去会被当成脏数据变静音，接回扬声器就把房间声音弄没了。
    // 只用播放/暂停事件 + 静音判断就够，不碰音频图。
    const mediaEls = [];
    const mediaDocs = []; // 已经挂过监听的 document（顶页 + 同源 iframe）
    let roomMediaEl = null;
    let roomMediaTimer = null;
    let stopGrace = null;
    let lastCutAt = 0;
    let lastCutKind = '';
    let frameSeq = 0; // 收到一帧就 +1：用来判断「切歌之后有没有新歌开播」
    const diagTick = { why: '' };
    // 尽早挂上：房间播放器可能是 new Audio()，也可能是 iframe 里创建的
    installMediaHooks();

    function frameName(url) {
      const tail = String(url || '').split(/[?#]/)[0];
      const parts = tail.split('/').filter(Boolean);
      return parts.length ? parts[parts.length - 1] : '';
    }

    function mediaSrc(el) {
      try {
        return String((el && (el.currentSrc || el.src)) || '');
      } catch (e) {
        return '';
      }
    }

    function isPlaying(el) {
      if (!el) return false;
      try {
        return !el.paused && !el.ended && (el.readyState || 0) >= 2;
      } catch (e) {
        return false;
      }
    }

    /** 像不像「房间那首歌」：名字对得上 > 音乐域 > 时长超过 30 秒（排除语音条） */
    function looksRoomAudio(el) {
      if (!el || el === elAudio) return false;
      const src = mediaSrc(el);
      if (roomNow && roomNow.src) {
        const n = frameName(roomNow.src);
        if (n && src && src.indexOf(n) >= 0) return true;
      }
      if (/music\.126\.net|bilivideo|hdslb|qqmusic|kugou|biliapi/i.test(src)) return true;
      try {
        return Number(el.duration) > 30;
      } catch (e) {
        return false;
      }
    }

    function cancelStopGrace() {
      if (stopGrace) {
        clearTimeout(stopGrace);
        stopGrace = null;
      }
    }

    /**
     * 收尾等多久，取决于「有多确定它停了」：
     *   · 客户端播放按钮都变回「播放」图标了 → 0.7 秒就收；
     *   · 只是元素停了（可能在缓冲/切歌）→ 1.2 秒；
     *   · 自然放完（下一首马上接上）→ 1.5 秒；
     *   · 其他不确定的情况 → 2.5 秒。
     */
    function stopGraceMs(why) {
      const btn = appButtonSaysPaused();
      const playing = isPlaying(roomMediaEl);
      if (btn === true && !playing) return 700;
      if (why === 'cut') return 900;
      if (!playing && roomMediaEl) return 1200;
      if (why === 'ended') return 1500;
      return 2500;
    }

    function armStopGrace(why) {
      if (!roomNow) return;
      if (stopGrace) return; // 已经挂着倒计时了，别每轮轮询都把它重置（否则永远数不到 0）
      const wait = stopGraceMs(why);
      stopGrace = setTimeout(() => {
        stopGrace = null;
        // 还在响 = 只是切歌时的短暂停顿，别收
        if (isPlaying(roomMediaEl)) return;
        diagTick.why = why;
        endRoomNow();
      }, wait);
    }

    function hookMedia(el) {
      if (!el || el.__mkMediaHooked) return;
      try {
        el.__mkMediaHooked = true;
      } catch (e) {
        return;
      }
      const mine = () => el === roomMediaEl;
      const onStop = (why) => {
        if (mine() || !roomMediaEl) armStopGrace(why);
      };
      try {
        el.addEventListener('ended', () => onStop('ended'));
        el.addEventListener('pause', () => onStop('pause'));
        el.addEventListener('emptied', () => onStop('emptied'));
        el.addEventListener('play', cancelStopGrace);
        el.addEventListener('playing', cancelStopGrace);
        el.addEventListener('loadstart', cancelStopGrace);
      } catch (e) {
        /* 挂不上就退回「只按时长收」 */
      }
    }

    function trackMedia(el) {
      if (!el || el === elAudio) return;
      if (mediaEls.indexOf(el) < 0) {
        mediaEls.push(el);
        if (mediaEls.length > 12) mediaEls.shift();
      }
      hookMedia(el);
      if (looksRoomAudio(el) && el !== roomMediaEl) roomMediaEl = el;
    }

    /**
     * 关键：IIROSE 的房间是在 iframe（#mainFrame）里跑的，播放器元素在**那个文档**里，
     * 顶部文档的 querySelectorAll 永远找不到。所以要把同源 iframe 也一并盯上。
     */
    function framesNow() {
      const out = [];
      const push = (w) => {
        if (w && w.document && out.indexOf(w) < 0) out.push(w);
      };
      push(window);
      try {
        const mains = [doc.getElementById && doc.getElementById('mainFrame')];
        const list = doc.querySelectorAll ? doc.querySelectorAll('iframe') : [];
        for (let i = 0; i < list.length; i += 1) mains.push(list[i]);
        for (let i = 0; i < mains.length; i += 1) {
          try {
            push(mains[i] && mains[i].contentWindow);
          } catch (e) {
            /* 跨域，跳过 */
          }
        }
      } catch (e) {
        /* 忽略 */
      }
      return out;
    }

    /** 给某个 window 的媒体元素原型打补丁（含 new Audio() 这种不挂 DOM 的） */
    function patchMediaProto(win) {
      try {
        const proto = win.HTMLMediaElement && win.HTMLMediaElement.prototype;
        if (proto && !proto.__mkPatched) {
          const play = proto.play;
          const pause = proto.pause;
          Object.defineProperty(proto, '__mkPatched', { value: true, configurable: true });
          proto.play = function () {
            try {
              trackMedia(this);
            } catch (e) {
              /* 忽略 */
            }
            return play.apply(this, arguments);
          };
          proto.pause = function () {
            try {
              trackMedia(this);
            } catch (e) {
              /* 忽略 */
            }
            return pause.apply(this, arguments);
          };
          const desc = Object.getOwnPropertyDescriptor(proto, 'src');
          if (desc && desc.set && desc.configurable !== false) {
            Object.defineProperty(proto, 'src', {
              configurable: true,
              enumerable: desc.enumerable,
              get: desc.get,
              set(value) {
                try {
                  trackMedia(this);
                } catch (e) {
                  /* 忽略 */
                }
                return desc.set.call(this, value);
              },
            });
          }
        }
      } catch (e) {
        /* 打不上补丁也不致命：还有 DOM 扫描 + 时长收尾 */
      }
      try {
        const Native = win.Audio;
        if (typeof Native === 'function' && !Native.__mkPatched) {
          const Wrapped = function (src) {
            const el = new Native(src);
            try {
              trackMedia(el);
            } catch (e) {
              /* 忽略 */
            }
            return el;
          };
          Wrapped.__mkPatched = true;
          win.Audio = Wrapped;
        }
      } catch (e) {
        /* 忽略 */
      }
    }

    /** 盯一个 window：文档级捕获监听（媒体事件不冒泡，但捕获能收到）+ 原型补丁 */
    function watchWindow(win) {
      let d = null;
      try {
        d = win && win.document;
      } catch (e) {
        return;
      }
      if (!d || mediaDocs.indexOf(d) >= 0) return;
      mediaDocs.push(d);
      const onEv = (ev) => {
        const t = ev && ev.target;
        if (!t || t === elAudio || !t.tagName) return;
        const tag = String(t.tagName).toUpperCase();
        if (tag !== 'AUDIO' && tag !== 'VIDEO') return;
        trackMedia(t);
        const type = ev.type;
        if (type === 'play' || type === 'playing' || type === 'loadstart') {
          cancelStopGrace();
          return;
        }
        if (type === 'pause' || type === 'ended' || type === 'emptied') {
          if (t === roomMediaEl || !roomMediaEl) armStopGrace(type);
        }
      };
      ['play', 'playing', 'pause', 'ended', 'emptied', 'loadstart'].forEach((type) => {
        try {
          d.addEventListener(type, onEv, true);
        } catch (e) {
          /* 忽略 */
        }
      });
      patchMediaProto(win);
    }

    function watchFrames() {
      const list = framesNow();
      for (let i = 0; i < list.length; i += 1) watchWindow(list[i]);
      return list.length;
    }

    /** 兼容旧名字：挂载时先盯一遍顶页（iframe 由 beginRoomMediaWatch 的轮询补上） */
    function installMediaHooks() {
      watchWindow(window);
      watchFrames();
    }

    /** 这个元素是不是「当前这首」的播放器（没有音源地址时只能按域/时长猜，就当是） */
    function mediaMatchesNow(el) {
      if (!el) return false;
      if (!roomNow || !roomNow.src) return true;
      const name = frameName(roomNow.src);
      if (!name) return true;
      return mediaSrc(el).indexOf(name) >= 0;
    }

    /** 切到新歌：如果盯着的元素对不上，就换成能对上的那个；都没有就先当「不知道」 */
    function rematchRoomMedia() {
      const name = frameName(roomNow && roomNow.src);
      if (!name) return;
      if (mediaMatchesNow(roomMediaEl)) return;
      let found = null;
      for (let i = 0; i < mediaEls.length && !found; i += 1) {
        if (mediaSrc(mediaEls[i]).indexOf(name) >= 0) found = mediaEls[i];
      }
      if (!found) {
        for (let i = 0; i < mediaDocs.length && !found; i += 1) {
          try {
            const list = mediaDocs[i].querySelectorAll ? mediaDocs[i].querySelectorAll('audio,video') : [];
            for (let j = 0; j < list.length && !found; j += 1) {
              if (list[j] !== elAudio && mediaSrc(list[j]).indexOf(name) >= 0) found = list[j];
            }
          } catch (e) {
            /* 忽略 */
          }
        }
      }
      if (found) {
        roomMediaEl = found;
        hookMedia(found);
      } else {
        roomMediaEl = null; // 新歌的播放器还没出现，别拿上一首的当准
      }
    }

    /**
     * IIROSE 客户端自己的房间播放器在 DOM 里是有名字的（别的插件也是这么用的）：
     *   #radioPlayer      —— 真正在响的元素（audio / video）
     *   #radioPlayButton  —— 旁边的播放/暂停按钮，class 在 mdi-pause / mdi-play 之间切
     * 所以优先认这两个，比按域名/时长猜可靠得多。
     */
    function appPlayerEl() {
      for (let i = 0; i < mediaDocs.length; i += 1) {
        try {
          const d = mediaDocs[i];
          const el = d.getElementById ? d.getElementById('radioPlayer') : null;
          if (!el) continue;
          const tag = String(el.tagName || '').toUpperCase();
          if (tag === 'AUDIO' || tag === 'VIDEO') return el;
        } catch (e) {
          /* 忽略 */
        }
      }
      return null;
    }

    /** true = 按钮显示「该播了」（也就是现在没在播）；null = 找不到按钮 */
    function appButtonSaysPaused() {
      for (let i = 0; i < mediaDocs.length; i += 1) {
        try {
          const b = mediaDocs[i].getElementById ? mediaDocs[i].getElementById('radioPlayButton') : null;
          if (!b) continue;
          const cls = String(b.className || '');
          if (cls.indexOf('mdi-pause') >= 0) return false;
          if (cls.indexOf('mdi-play') >= 0) return true;
          return null;
        } catch (e) {
          /* 忽略 */
        }
      }
      return null;
    }

    function scanRoomMedia() {
      if (!roomNow) return;
      const name = frameName(roomNow.src);
      // 0) 客户端自己的播放器：#radioPlayer —— 有就优先认它
      const appEl = appPlayerEl();
      if (appEl) {
        hookMedia(appEl);
        if (appEl !== roomMediaEl) roomMediaEl = appEl;
      }
      // 1) 每个文档（顶页 + 同源 iframe）里挂在 DOM 上的媒体元素
      for (let i = 0; i < mediaDocs.length; i += 1) {
        try {
          const list = mediaDocs[i].querySelectorAll ? mediaDocs[i].querySelectorAll('audio,video') : [];
          for (let j = 0; j < list.length; j += 1) trackMedia(list[j]);
        } catch (e) {
          /* 忽略 */
        }
      }
      // 2) 之前登记过的（new Audio() 不挂 DOM 也能盯上）
      for (let i = 0; i < mediaEls.length; i += 1) {
        const el = mediaEls[i];
        if (!el || el === elAudio) continue;
        if (!appEl && name && mediaSrc(el).indexOf(name) < 0) continue; // 有音源地址时只认对得上的
        if (!looksRoomAudio(el)) continue;
        if (el === roomMediaEl) continue;
        roomMediaEl = el;
        hookMedia(el);
      }
      // 3) 认准的那个要是已经停了，走宽限（别拿上一首的僵尸元素误判）
      if (mediaMatchesNow(roomMediaEl) && !isPlaying(roomMediaEl)) armStopGrace('poll');
      // 4) 客户端的播放按钮已经是「play」（说明暂停/停了）
      else if (appEl && appButtonSaysPaused() === true) armStopGrace('btn');
    }

    function beginRoomMediaWatch() {
      if (roomMediaTimer) return;
      installMediaHooks();
      // iframe 可能后建/重建：轮询时同时补挂监听
      roomMediaTimer = setInterval(() => {
        watchFrames();
        scanRoomMedia();
      }, 800);
      watchFrames();
      scanRoomMedia();
      setTimeout(() => {
        watchFrames();
        scanRoomMedia();
      }, 600);
      setTimeout(() => {
        watchFrames();
        scanRoomMedia();
      }, 1800);
    }

    /**
     * 宿主看到「切歌」指令（socket 往服务器发的 cut / cut all）时调这里。
     * 规则：2.6 秒内没有新的开播帧、播放器也没在响 → 当作停播。
     */
    function noteRoomCut(kind) {
      lastCutAt = Date.now();
      lastCutKind = kind || 'cut';
      cancelStopGrace();
      const at = lastCutAt;
      const seq = frameSeq;
      setTimeout(() => {
        if (lastCutAt !== at) return; // 又切了一次，交给后面那次
        if (frameSeq !== seq) return; // 切完有新帧 = 正常切歌，别收
        if (roomNow && roomNow.startedAt > at + 50) return;
        if (isPlaying(roomMediaEl)) return; // 播放器还在响
        diagTick.why = 'cut';
        endRoomNow();
      }, stopGraceMs('cut'));
    }

    function paintNow() {
      // 本机试听时这块归本机播放器，别让房间那首一直盖着
      if (playMode !== 'room') return;
      if (!roomNow) {
        setNow('未在播放', '点结果里的 ▶ 开始');
        setNowArt('');
        return;
      }
      const bits = [];
      if (roomNow.artists && roomNow.artists.length) bits.push(roomNow.artists.join(' / '));
      if (roomNow.platform) bits.push(labelOf(roomNow.platform));
      const left = nowRemainMs();
      if (left != null) bits.push('剩 ' + fmtDur(Math.max(0, left)));
      setNowArt(roomNow.cover || '');
      setNow('房间：' + roomNow.title, bits.join(' · '));
    }

    function stopNowTicker() {
      if (roomNowTimer) {
        clearInterval(roomNowTimer);
        roomNowTimer = null;
      }
    }

    function startNowTicker() {
      stopNowTicker();
      roomNowTimer = setInterval(() => {
        if (!roomNow) {
          stopNowTicker();
          return;
        }
        const left = nowRemainMs();
        // 多给 1.5s 余量：房间起播本身有延迟，别卡在最后一帧就收
        if (left != null && left < -1500) {
          endRoomNow();
          return;
        }
        paintNow();
      }, 1000);
    }

    /**
     * 房间开播 / 切歌。
     * 同一首在 8s 内被重复推帧（服务器有时候会补推）时不重置计时，只补全信息。
     */
    function beginRoomNow(info) {
      const title = String((info && info.title) || '').trim();
      if (!title) {
        endRoomNow();
        return null;
      }
      const prev = roomNow;
      const same = Boolean(prev && prev.title === title && Date.now() - prev.startedAt < 8000);
      // 点播时先按「我发出去的这一刻」预判；真正的开播帧到了再对齐一次（房间起播有 1-3 秒延迟，
      // 不对齐的话歌词会跑在房间前面）
      const fromFrame = !info || info.predicted !== true;
      if (fromFrame) frameSeq += 1;
      roomNow = {
        title,
        sub: (info && info.sub) || (same ? prev.sub : '') || '',
        artists: (info && info.artists && info.artists.length ? info.artists : same ? prev.artists : []) || [],
        startedAt:
          same && !(prev.predicted && fromFrame) ? prev.startedAt : Number(info && info.startedAt) || Date.now(),
        durationMs: Number(info && info.durationMs) || (same ? prev.durationMs : 0) || 0,
        platform: (info && info.platform) || (same ? prev.platform : '') || '',
        id: (info && info.id) || (same ? prev.id : '') || '',
        lrc: (info && info.lrc) || (same ? prev.lrc : '') || '',
        cover: (info && info.cover) || (same ? prev.cover : '') || '',
        src: (info && info.src) || (same ? prev.src : '') || '',
        predicted: same ? Boolean(prev.predicted && !fromFrame) : !fromFrame,
      };
      writeNow(roomNow);
      cancelStopGrace(); // 新的一帧来了：刚才那个 pause/ended 就是切歌，不是停播
      beginRoomMediaWatch();
      rematchRoomMedia();
      setTimeout(scanRoomMedia, 900);
      if (same && prev.predicted && fromFrame) {
        // 真的开播了：把歌词时间轴也对齐过来
        lyricT0 = roomNow.startedAt;
        if (lyricLines.length) tickLyric();
      }
      paintNow();
      startNowTicker();
      if (!same) {
        // 自己的歌：点播时 markPlayed 已经把歌词带起来了，这里不重来
        const already = currentLyricSong && roomNow.id && String(currentLyricSong.id) === String(roomNow.id);
        if (!already) {
          if (roomNow.lrc) loadLyricFromText(roomNow);
          else if (roomNow.platform && roomNow.id) startLyric(roomNow, roomNow.startedAt);
          else stopLyric(); // 别人的歌又没有帧内歌词：不瞎猜
        }
      }
      return roomNow;
    }

    /** 放完了（或房间清空了 / 被切掉了）：收起播放信息 + 歌词 */
    function endRoomNow() {
      roomNow = null;
      stopNowTicker();
      cancelStopGrace();
      writeNow(null);
      if (playMode === 'room') {
        setNow('未在播放', '点结果里的 ▶ 开始');
        stopLyric();
      }
      return null;
    }

    // ---------------------------------------------------------------- 歌词（悬浮窗）
    let lyricLines = [];
    let lyricTimer = null;
    let lyricT0 = 0;
    let lyricIndex = -1;
    let currentLyricSong = null;
    let lyricFloat = null;

    function lyricPosSaved() {
      try {
        const raw = window.localStorage.getItem('mk_lyric_pos');
        const p = raw ? JSON.parse(raw) : null;
        return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
      } catch (e) {
        return null;
      }
    }

    function saveLyricPos(x, y) {
      try {
        window.localStorage.setItem('mk_lyric_pos', JSON.stringify({ x: Math.round(x), y: Math.round(y) }));
      } catch (e) {
        /* 忽略 */
      }
    }

    // 极简环境（测试桩 / 老浏览器）里 el.style 可能不是 CSSStyleDeclaration
    function setCssVar(el, name, value) {
      if (!el || !el.style || typeof el.style.setProperty !== 'function') return;
      el.style.setProperty(name, value);
    }

    /** 字号 5 档：A− / A+ 就在歌词窗上点，不用进设置 */
    const LYRIC_SIZES = [13, 15, 17, 20, 24];
    function lyricFontPx() {
      const lv = Math.min(5, Math.max(1, Math.round(Number(settings.lyricSize) || 3)));
      return LYRIC_SIZES[lv - 1];
    }

    function bumpLyricSize(delta) {
      const cur = Math.min(5, Math.max(1, Math.round(Number(settings.lyricSize) || 3)));
      const next = Math.min(5, Math.max(1, cur + delta));
      if (next === cur) return;
      settings = normalizeSettings(Object.assign({}, settings, { lyricSize: next }));
      saveSettings();
      applySettings();
      setStat('歌词字号：' + LYRIC_SIZES[next - 1] + 'px（' + next + '/5）');
    }

    /** 歌词窗独立挂在 body 上：关掉点歌台它还在，可以拖到任意位置 */
    /** 歌词窗尺寸（jsdom / 刚创建时拿不到真实布局，就按设置估算） */
    function lyricFloatSize(el) {
      const w = (el && el.offsetWidth) || Math.round(Number(settings.lyricW) || 520);
      const lines = Math.min(9, Math.max(1, Math.round(Number(settings.lyricLines) || 3)));
      const h = (el && el.offsetHeight) || Math.round(lines * lyricFontPx() * 1.55 + 26);
      return { w, h };
    }

    /** 允许出现的位置：整块留在视口里，顶部还要给按钮条留出位置（不然锁定了点不到 🔓） */
    function lyricBounds(w, h) {
      const vw = window.innerWidth || 1024;
      const vh = window.innerHeight || 768;
      const pad = 8;
      const barPad = 30;
      const minX = pad;
      const maxX = Math.max(minX, vw - w - pad);
      const minY = barPad;
      const maxY = Math.max(minY, vh - h - pad);
      return { minX, maxX, minY, maxY };
    }

    /** 把当前位置夹回可见范围（窗口变小、旋转屏幕、旧位置越界时都靠它） */
    function clampLyricFloat() {
      const el = lyricFloat;
      if (!el || !el.style) return false;
      // 只有「手动定位过」的才夹，默认的居中偏下布局不动
      if (el.style.transform !== 'none') return false;
      const size = lyricFloatSize(el);
      const b = lyricBounds(size.w, size.h);
      const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      const x = rect && rect.width ? rect.left : parseFloat(el.style.left);
      const y = rect && rect.height ? rect.top : parseFloat(el.style.top);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
      const nx = Math.min(b.maxX, Math.max(b.minX, x));
      const ny = Math.min(b.maxY, Math.max(b.minY, y));
      if (Math.abs(nx - x) < 1 && Math.abs(ny - y) < 1) return false;
      el.style.left = Math.round(nx) + 'px';
      el.style.top = Math.round(ny) + 'px';
      saveLyricPos(nx, ny);
      return true;
    }

    function ensureLyricFloat() {
      if (lyricFloat) return lyricFloat;
      const el = doc.createElement('div');
      el.className = 'mk-lyric-float';
      el.innerHTML =
        '<div class="lf-lines"></div>' +
        '<div class="lf-bar">' +
        '<button class="lf-btn" data-lf="minus" title="字号小一档">A−</button>' +
        '<button class="lf-btn" data-lf="plus" title="字号大一档">A+</button>' +
        '<button class="lf-btn" data-lf="lock" title="锁定（锁定后点击穿透到房间）">🔒</button>' +
        '<button class="lf-btn" data-lf="close" title="关掉歌词（设置里能再打开）">✕</button>' +
        '</div>' +
        '<div class="lf-grip" title="拖动改大小：左右=宽度，上下=行数"></div>';
      setCssVar(el, '--lf-w', Math.round(settings.lyricW || 520) + 'px');
      setCssVar(el, '--lf-fs', lyricFontPx() + 'px');
      doc.body.appendChild(el);
      const pos = lyricPosSaved();
      if (pos) {
        el.style.left = pos.x + 'px';
        el.style.top = pos.y + 'px';
        el.style.bottom = 'auto';
        el.style.transform = 'none';
        lyricFloat = el;
        clampLyricFloat(); // 旧位置越界 / 换了屏幕：拉回可见范围
      }
      let dragging = false;
      let offX = 0;
      let offY = 0;
      const grip = el.querySelector('.lf-grip');
      const bar = el.querySelector('.lf-bar');
      const inBar = (t) => Boolean(t && t.closest && t.closest('.lf-bar'));
      el.addEventListener('pointerdown', (ev) => {
        if (settings.lyricLock) return;
        if (inBar(ev.target)) return;
        if (grip && (ev.target === grip || (ev.target.closest && ev.target.closest('.lf-grip')))) return;
        dragging = true;
        const r = el.getBoundingClientRect();
        offX = (ev.clientX || 0) - r.left;
        offY = (ev.clientY || 0) - r.top;
        el.style.left = r.left + 'px';
        el.style.top = r.top + 'px';
        el.style.bottom = 'auto';
        el.style.transform = 'none';
        el.classList.add('mk-drag');
        try {
          el.setPointerCapture(ev.pointerId);
        } catch (e) {
          /* 某些环境不支持 */
        }
        ev.preventDefault();
      });
      el.addEventListener('pointermove', (ev) => {
        if (!dragging) return;
        const size = lyricFloatSize(el);
        const b = lyricBounds(size.w, size.h);
        const x = Math.min(b.maxX, Math.max(b.minX, (ev.clientX || 0) - offX));
        const y = Math.min(b.maxY, Math.max(b.minY, (ev.clientY || 0) - offY));
        el.style.left = Math.round(x) + 'px';
        el.style.top = Math.round(y) + 'px';
      });
      const up = () => {
        if (!dragging) return;
        dragging = false;
        el.classList.remove('mk-drag');
        clampLyricFloat(); // 松手再夹一次：保证按钮条一定在屏幕里
        const r = el.getBoundingClientRect();
        if (r.width && r.height) saveLyricPos(r.left, r.top);
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);

      // A− / A+ / 锁定 / 关掉：四个按钮都长在歌词窗上
      if (bar) {
        bar.addEventListener('click', (ev) => {
          const btn = ev.target && ev.target.closest ? ev.target.closest('[data-lf]') : null;
          if (!btn) return;
          ev.preventDefault();
          ev.stopPropagation();
          const act = btn.getAttribute('data-lf');
          if (act === 'minus' || act === 'plus') {
            bumpLyricSize(act === 'plus' ? 1 : -1);
          } else if (act === 'lock') {
            settings = normalizeSettings(Object.assign({}, settings, { lyricLock: !settings.lyricLock }));
            saveSettings();
            applySettings();
            if (settings.lyricLock) clampLyricFloat(); // 锁之前先把窗子拉回可见范围，🔓 一定点得到
            setStat(settings.lyricLock ? '歌词窗已锁定（点击穿透；点右上角 🔓 解锁，设置里也能重置）' : '歌词窗已解锁，可以拖了');
          } else if (act === 'close') {
            settings = normalizeSettings(Object.assign({}, settings, { lyric: false }));
            saveSettings();
            applySettings();
            setStat('已关掉歌词（设置 → 外观 → 显示歌词 可以再打开）');
          }
        });
      }

      if (grip) {
        // 右下角斜着拉：左右 = 宽度，上下 = 行数（不是只能平着拉）
        let resizing = false;
        let startW = 0;
        let startX = 0;
        let startY = 0;
        let startLines = 3;
        let factor = 1;
        let pendingW = 0;
        let pendingLines = 0;
        grip.addEventListener('pointerdown', (ev) => {
          if (settings.lyricLock) return;
          resizing = true;
          startW = el.getBoundingClientRect().width || 520;
          startX = ev.clientX || 0;
          startY = ev.clientY || 0;
          startLines = Math.min(9, Math.max(1, Math.round(Number(settings.lyricLines) || 3)));
          factor = el.style.transform === 'none' ? 1 : 2;
          pendingW = 0;
          pendingLines = 0;
          try {
            grip.setPointerCapture(ev.pointerId);
          } catch (e) {
            /* 忽略 */
          }
          ev.preventDefault();
          ev.stopPropagation();
        });
        grip.addEventListener('pointermove', (ev) => {
          if (!resizing) return;
          const dx = (ev.clientX || 0) - startX;
          const dy = (ev.clientY || 0) - startY;
          const w = Math.round(Math.min(900, Math.max(220, startW + dx * factor)));
          // 一行大约 line-height + gap；往上拉 = 少几行
          const perLine = Math.max(18, lyricFontPx() * 1.62);
          const lines = Math.min(9, Math.max(1, startLines + Math.round(dy / perLine)));
          pendingW = w;
          pendingLines = lines;
          setCssVar(el, '--lf-w', w + 'px');
          if (lines !== settings.lyricLines) {
            settings = normalizeSettings(Object.assign({}, settings, { lyricLines: lines }));
            paintLyric(lyricIndex);
          }
          ev.stopPropagation();
        });
        const doneResize = () => {
          if (!resizing) return;
          resizing = false;
          if (pendingW || pendingLines) {
            settings = normalizeSettings(
              Object.assign({}, settings, pendingW ? { lyricW: pendingW } : {}, pendingLines ? { lyricLines: pendingLines } : {}),
            );
            saveSettings();
          }
        };
        grip.addEventListener('pointerup', doneResize);
        grip.addEventListener('pointercancel', doneResize);
      }
      lyricFloat = el;
      return el;
    }

    /** 按当前行号渲染窗口（1 / 3 / 5 行），当前行高亮 */
    function paintLyric(idx) {
      if (!lyricFloat) return;
      const wrap = lyricFloat.querySelector('.lf-lines');
      if (!wrap) return;
      if (!lyricLines.length) {
        if (wrap.innerHTML) wrap.innerHTML = '';
        return;
      }
      const n = Math.min(9, Math.max(1, Math.round(Number(settings.lyricLines) || 3)));
      const cur = idx < 0 ? 0 : idx;
      let start = cur - Math.floor(n / 2);
      if (start < 0) start = 0;
      if (start + n > lyricLines.length) start = Math.max(0, lyricLines.length - n);
      let html = '';
      for (let i = start; i < Math.min(lyricLines.length, start + n); i += 1) {
        const L = lyricLines[i];
        html +=
          '<div class="lf-line' +
          (i === idx ? ' on' : '') +
          '">' +
          esc(L.text) +
          (L.tr ? '<span class="lf-tr">' + esc(L.tr) + '</span>' : '') +
          '</div>';
      }
      if (wrap.innerHTML !== html) wrap.innerHTML = html;
    }

    function renderLyricFloat() {
      const el = ensureLyricFloat();
      const on =
        settings.lyric !== false &&
        settings.lyricFloat !== false &&
        Boolean(currentLyricSong) &&
        lyricLines.length > 0;
      setCssVar(el, '--lf-w', Math.round(settings.lyricW || 520) + 'px');
      setCssVar(el, '--lf-fs', lyricFontPx() + 'px');
      el.setAttribute('data-lock', settings.lyricLock ? '1' : '0');
      el.classList.toggle('mk-on', on);
      if (on) paintLyric(lyricIndex);
    }

    /** LRC → [{t, text, tr}]，支持一行多个时间戳 */
    function parseLrc(text) {
      const out = [];
      String(text || '')
        .split(/\r?\n/)
        .forEach((line) => {
          const stamps = line.match(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g);
          if (!stamps) return;
          const body = line.replace(/\[[^\]]*\]/g, '').trim();
          if (!body) return;
          stamps.forEach((s) => {
            const m = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/.exec(s);
            if (!m) return;
            out.push({
              t: Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number('0.' + m[3]) : 0),
              text: body,
              tr: '',
            });
          });
        });
      return out.sort((a, b) => a.t - b.t);
    }

    /** 翻译按时间对齐到原文（外语歌 = 原文一行 + 译文一行） */
    function mergeTranslation(lines, tText) {
      const tr = parseLrc(tText);
      if (!tr.length) return lines;
      const byT = new Map();
      tr.forEach((x) => byT.set(Math.round(x.t * 10), x.text));
      lines.forEach((l) => {
        const hit = byT.get(Math.round(l.t * 10));
        if (hit) l.tr = hit;
      });
      return lines;
    }

    function lyricTime() {
      if (playMode === 'local' && elAudio && !elAudio.paused) return Number(elAudio.currentTime) || 0;
      return (Date.now() - lyricT0) / 1000;
    }

    function tickLyric() {
      if (!lyricFloat || !lyricLines.length || !lyricFloat.classList.contains('mk-on')) return;
      const t = lyricTime();
      let idx = -1;
      for (let i = 0; i < lyricLines.length; i += 1) {
        if (lyricLines[i].t <= t + 0.2) idx = i;
        else break;
      }
      if (idx === lyricIndex) return;
      lyricIndex = idx;
      paintLyric(idx);
    }

    function stopLyric() {
      currentLyricSong = null;
      lyricLines = [];
      lyricIndex = -1;
      if (lyricTimer) {
        clearInterval(lyricTimer);
        lyricTimer = null;
      }
      if (lyricFloat) lyricFloat.classList.remove('mk-on');
    }

    /** 直接用帧里带回来的 LRC（房间推的 `&1` 里就有），不依赖中转 */
    function loadLyricFromText(rec) {
      if (!rec) return;
      currentLyricSong = rec;
      lyricLines = parseLrc(rec.lrc);
      lyricIndex = -1;
      lyricT0 = Number(rec.startedAt) || Date.now();
      if (lyricTimer) {
        clearInterval(lyricTimer);
        lyricTimer = null;
      }
      renderLyricFloat();
      if (!lyricLines.length) return;
      lyricTimer = setInterval(tickLyric, 250);
      tickLyric();
    }

    /**
     * 起播一首歌的歌词。
     * startedAt 由外面给（房间那首是「真的开始播的时刻」），刷新后恢复时也用它把歌词对上。
     */
    function startLyric(song, startedAt) {
      currentLyricSong = song || null;
      lyricLines = [];
      lyricIndex = -1;
      lyricT0 = Number(startedAt) || Date.now();
      if (lyricTimer) {
        clearInterval(lyricTimer);
        lyricTimer = null;
      }
      renderLyricFloat();
      if (!song) return;
      if (!song.platform || !song.id || typeof api.lyric !== 'function') {
        if (song.lrc) loadLyricFromText(song);
        return;
      }
      lyricTimer = setInterval(tickLyric, 250);
      api
        .lyric({ platform: song.platform, id: song.id })
        .then((d) => {
          if (!currentLyricSong || String(currentLyricSong.id) !== String(song.id)) return; // 已经切歌
          let lines = parseLrc(d && d.lrc);
          if (lines.length) lines = mergeTranslation(lines, d && d.tlrc);
          lyricLines = lines;
          lyricIndex = -1;
          renderLyricFloat();
          tickLyric();
        })
        .catch(() => {
          /* 没歌词就只留着空窗 */
        });
    }
    // ---------------------------------------------------------------- 点歌历史
    // 存在本机（localStorage），不联网、不上传：只记「我点过什么」。
    const HIST_KEY = 'mk_history';
    const HIST_MAX = 300;

    function loadHistory() {
      try {
        const raw = window.localStorage.getItem(HIST_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr.filter((x) => x && x.id && x.title) : [];
      } catch (e) {
        return [];
      }
    }

    function saveHistory() {
      try {
        window.localStorage.setItem(HIST_KEY, JSON.stringify(history.slice(0, HIST_MAX)));
      } catch (e) {
        /* 配额满了就只留内存里的 */
      }
    }

    let history = loadHistory();

    /** 记录一次真实发生的点歌（播放失败不会进来）；同一首歌只占一条，次数累加 */
    function markPlayed(song, mode) {
      if (!song || !song.id) return;
      const now = Date.now();
      const idx = history.findIndex((h) => h.platform === song.platform && h.id === song.id);
      if (idx >= 0) {
        const prev = history.splice(idx, 1)[0];
        prev.t = now;
        prev.mode = mode || prev.mode;
        prev.count = (prev.count || 1) + 1;
        prev.title = song.title || prev.title;
        prev.cover = song.cover || prev.cover;
        history.unshift(prev);
      } else {
        history.unshift({
          t: now,
          platform: song.platform,
          id: song.id,
          title: song.title,
          artists: song.artists || [],
          durationMs: song.durationMs || null,
          cover: song.cover || '',
          mode: mode || 'room',
          count: 1,
        });
      }
      startLyric(song);
      if (history.length > HIST_MAX) history = history.slice(0, HIST_MAX);
      saveHistory();
      const btn = root.querySelector('[data-act=history]');
      if (btn) btn.textContent = '历史 ' + history.length;
    }

    function fmtWhen(ts) {
      const d = new Date(ts);
      const p2 = (n) => String(n).padStart(2, '0');
      return p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
    }

    const MODE_LABEL = { room: '点播到房间', local: '本机试听', link: '外链', native: '原生' };

    /** 历史页：按时间倒序，可重播 / 删除；再给一个「总共点过多少首」的小统计 */
    function renderHistory() {
      if (!detailBack) {
        detailBack = { list: lastResults, kind: listKind, page: page };
      }
      const weekAgo = Date.now() - 7 * 86400000;
      const weekCount = history.filter((h) => h.t >= weekAgo).length;
      const rows = history.length
        ? history
            .map((h, i) => {
              const sub = [fmtWhen(h.t), MODE_LABEL[h.mode] || '', (h.artists || []).join(' / '), (h.count || 1) > 1 ? '×' + h.count : '']
                .filter(Boolean)
                .join(' · ');
              return (
                '<div class="mk-song">' +
                '<button class="mk-play" data-act="hist-play" data-i="' +
                i +
                '" title="再点一次">▶</button>' +
                '<div class="mk-idx">' +
                (i + 1) +
                '</div>' +
                coverOf(h.cover, '♪') +
                '<div class="mk-meta"><div class="mk-name">' +
                esc(h.title) +
                '</div><div class="mk-sub">' +
                esc(sub) +
                '</div></div>' +
                '<div class="mk-acts"><button data-act="hist-del" data-i="' +
                i +
                '" title="从历史里删掉">✕</button></div></div>'
              );
            })
            .join('')
        : '<div class="mk-empty">还没有点歌记录。点过一次之后就会记在这里（只存在本机）。</div>';
      const head =
        '<div class="mk-detail-head"><div class="mk-meta"><div class="mk-name">点歌历史</div>' +
        '<div class="mk-sub">' +
        esc('共 ' + history.length + ' 次 · 最近 7 天 ' + weekCount + ' 次 · 只存本机') +
        '</div></div><div class="mk-detail-acts">' +
        (history.length ? '<button class="mk-btn" data-act="hist-to-pl">存成歌单</button>' : '') +
        (history.length ? '<button class="mk-btn" data-act="hist-clear">清空</button>' : '') +
        '<button class="mk-btn" data-act="back">‹ 返回</button></div></div>';
      elBody.innerHTML = head + rows;
      if (elPager && elPager.classList) elPager.classList.remove('mk-on');
      setStat('历史 ' + history.length + ' 次');
    }

    // ------------------------------------------------------------ 表情包（网搜 + 收藏）
    // 图不落地：搜索走中转，发出去的是中转给的**带签名**地址（别人拼不出别的图），
    // 这样既绕过图床防盗链，又不会把我们的中转变成开放图片代理。
    const ST_KEY = 'mk_stickers';
    const ST_MAX = 60;
    const ST_GAP_MS = 2000;
    let stickerResults = [];
    let stickerSource = '';
    let stickerKw = '';
    let stickerFavs = loadStickerFavs();
    let lastStickerAt = 0;

    function loadStickerFavs() {
      try {
        const raw = window.localStorage.getItem(ST_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr.filter((x) => x && x.send).slice(0, ST_MAX) : [];
      } catch (e) {
        return [];
      }
    }

    function saveStickerFavs() {
      try {
        window.localStorage.setItem(ST_KEY, JSON.stringify(stickerFavs.slice(0, ST_MAX)));
      } catch (e) {
        /* 存不下就算了 */
      }
    }

    function addStickerFav(it) {
      if (!it || !it.send) return false;
      if (stickerFavs.some((x) => x.send === it.send)) return false;
      stickerFavs.unshift({ send: it.send, thumb: it.thumb || it.url || '', title: it.title || '', t: Date.now() });
      if (stickerFavs.length > ST_MAX) stickerFavs = stickerFavs.slice(0, ST_MAX);
      saveStickerFavs();
      return true;
    }

    function stickerTile(it, i, kind) {
      const img = it.thumb || it.url || '';
      const corner =
        kind === 'fav'
          ? '<button class="corner" data-act="sticker-unfav" data-i="' + i + '" title="从收藏里删掉">✕</button>'
          : '<button class="corner" data-act="sticker-fav" data-i="' + i + '" title="收藏">☆</button>';
      return (
        '<div class="mk-sticker" data-act="sticker-send" data-kind="' +
        kind +
        '" data-i="' +
        i +
        '" title="点一下发到房间">' +
        '<img src="' +
        esc(img) +
        '" alt="" loading="lazy" referrerpolicy="no-referrer">' +
        corner +
        '</div>'
      );
    }

    function renderStickers() {
      if (!detailBack) detailBack = { list: lastResults, kind: listKind, page: page };
      inPlaylist = false;
      playlistCtx = null;
      queueOpen = false;
      const head =
        '<div class="mk-detail-head"><div class="mk-meta"><div class="mk-name">表情包</div>' +
        '<div class="mk-sub">' +
        esc('搜索走中转；点一张就发到房间（' + ST_GAP_MS / 1000 + ' 秒一张，防刷屏）') +
        '</div></div><div class="mk-detail-acts"><button class="mk-btn" data-act="back">‹ 返回</button></div></div>';
      const bar =
        '<div class="mk-sticker-bar"><input class="mk-input" data-el="sticker-kw" placeholder="搜表情：猫 / 开心 / 无语…" value="' +
        esc(stickerKw) +
        '"><button class="mk-btn mk-primary" data-act="sticker-search">搜</button></div>';
      const favHtml = stickerFavs.length
        ? '<div class="mk-sticker-sect">收藏（' +
          stickerFavs.length +
          '）</div><div class="mk-stickers">' +
          stickerFavs.map((it, i) => stickerTile(it, i, 'fav')).join('') +
          '</div>'
        : '';
      const res = stickerResults.length
        ? '<div class="mk-sticker-sect">结果' +
          (stickerSource ? ' · 来自 ' + esc(stickerSource) : '') +
          '（' +
          stickerResults.length +
          ' 张）</div><div class="mk-stickers">' +
          stickerResults.map((it, i) => stickerTile(it, i, 'res')).join('') +
          '</div>'
        : '<div class="mk-stickers-empty">输个关键词搜一张试试。<br>发出去的是中转给的带签名地址，房间里直接显示图片。</div>';
      elBody.innerHTML = head + bar + favHtml + res;
      if (elPager && elPager.classList) elPager.classList.remove('mk-on');
      setStat('表情包');
    }

    async function searchStickers() {
      const input = elBody.querySelector('[data-el=sticker-kw]');
      const kw = String((input && input.value) || '').trim();
      if (!kw) {
        setStat('先输个关键词');
        return;
      }
      stickerKw = kw;
      if (typeof api.sticker !== 'function') {
        setStat('当前环境不支持表情搜索：要配中转');
        return;
      }
      setStat('正在搜：' + esc(kw));
      try {
        const out = await api.sticker({ kw: kw, page: 1 });
        stickerResults = (out && out.items) || [];
        stickerSource = (out && out.source) || '';
        renderStickers();
        setStat(stickerResults.length ? '找到 ' + stickerResults.length + ' 张' : '没搜到，换个词试试');
      } catch (e) {
        setStat('搜索失败：' + esc(String((e && e.message) || e)));
      }
    }

    async function sendSticker(it) {
      if (!it || !it.send) return;
      const now = Date.now();
      if (now - lastStickerAt < ST_GAP_MS) {
        setStat('慢一点：表情 ' + ST_GAP_MS / 1000 + ' 秒一张（防刷屏）');
        return;
      }
      lastStickerAt = now;
      try {
        if (typeof opts.onSticker !== 'function') throw new Error('当前环境不支持发表情');
        await opts.onSticker(it);
        addStickerFav(it);
        setStat('已发到房间' + (it.title ? '：' + esc(it.title) : ''));
      } catch (e) {
        setStat('发失败：' + esc(String((e && e.message) || e)));
      }
    }

    /** 听歌列表：本机试听 / 点播到房间都用这一份队列 */
    function renderQueue() {
      // 已经有「返回上一级」就沿用它（比如从歌单详情点开队列，返回要回到歌单列表）
      if (!detailBack) {
        detailBack = { list: lastResults, kind: listKind, page: page };
      }
      queueOpen = true;
      const rows = playQueue.length
        ? playQueue
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
            .join('')
        : '<div class="mk-empty">队列是空的。点结果里的「+ 队列」，或去歌单里「全部点歌」。</div>';
      const head =
        '<div class="mk-detail-head"><div class="mk-meta"><div class="mk-name">听歌列表</div>' +
        '<div class="mk-sub">' +
        esc(playQueue.length + ' 首 · 当前第 ' + (playIndex + 1) + ' 首') +
        '</div></div><div class="mk-detail-acts">' +
        '<button class="mk-btn" data-act="queue-clear">清空</button>' +
        '<button class="mk-btn" data-act="back">‹ 返回</button></div></div>';
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
      const bf = ev.target.closest('[data-bf]');
      if (bf) {
        biliFilters[bf.getAttribute('data-bf')] = bf.getAttribute('data-bfv');
        renderBiliFilters();
        doSearch(1);
        return;
      }
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
    renderBiliFilters();
      renderBiliFilters();
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
          const val = urlInput ? String(urlInput.value || '').trim() : '';
          if (!val || !isSafeBg(val)) {
            setStat('这个链接不支持：只认 http(s) 图片地址或本机图片');
            return;
          }
          // 先打开调整框：位置 / 缩放满意了点「用这张」才落盘
          openBgEditor(val, { fresh: true });
        } else if (name === 'bg-edit') {
          if (settings.bg) openBgEditor(settings.bg);
        } else if (name === 'bg-reset') {
          settings = normalizeSettings(
            Object.assign({}, settings, { bgZoom: 1.06, bgX: 0, bgY: 0, bgBright: 1 }),
          );
          saveSettings();
          applySettings();
          renderSettings();
          setStat('背景位置 / 缩放已恢复默认');
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
        else if (name === 'bf-apply') {
          const inp = elBili ? elBili.querySelector('[data-el=bf-author]') : null;
          biliFilters.author = inp ? String(inp.value || '').trim() : '';
          doSearch(1);
        } else if (name === 'batch') queueAll(lastResults);
        else if (name === 'batch-play') playAll(lastResults);
        else if (name === 'play-sel') playSelected();
        else if (name === 'batch-cancel') cancelBatch();
        else if (name === 'stickers') renderStickers();
        else if (name === 'sticker-search') searchStickers();
        else if (name === 'sticker-send') {
          const kind = act.getAttribute('data-kind');
          const idx = Number(act.getAttribute('data-i'));
          sendSticker(kind === 'fav' ? stickerFavs[idx] : stickerResults[idx]);
        } else if (name === 'sticker-fav') {
          if (addStickerFav(stickerResults[Number(act.getAttribute('data-i'))])) {
            renderStickers();
            setStat('已收藏这张');
          }
        } else if (name === 'sticker-unfav') {
          stickerFavs.splice(Number(act.getAttribute('data-i')), 1);
          saveStickerFavs();
          renderStickers();
        }
        else if (name === 'lyric-reset') {
          // 保底：不管锁在哪、拖到哪，一键回到默认位置 + 解锁 + 字号行数复位
          try {
            window.localStorage.removeItem('mk_lyric_pos');
          } catch (e) {
            /* 忽略 */
          }
          if (lyricFloat && lyricFloat.style) {
            lyricFloat.style.left = '';
            lyricFloat.style.top = '';
            lyricFloat.style.bottom = '';
            lyricFloat.style.transform = '';
          }
          settings = normalizeSettings(
            Object.assign({}, settings, { lyric: true, lyricLock: false, lyricSize: 3, lyricLines: 3, lyricW: 520 }),
          );
          saveSettings();
          applySettings();
          renderSettings();
          setStat('歌词窗已重置：回到默认位置、解锁、字号/行数复位');
        }
        else if (name === 'sel-all') toggleSelectAll();
        else if (name === 'queue') renderQueue();
        else if (name === 'history') renderHistory();
        else if (name === 'playlists') renderPlaylists();
        else if (name === 'pl-open') openLocalPlaylist(Number(act.getAttribute('data-i')));
        else if (name === 'pl-play') {
          const plp = localPlaylists[Number(act.getAttribute('data-i'))];
          if (plp) playAll(plp.songs);
        } else if (name === 'pl-del') deleteLocalPlaylist(Number(act.getAttribute('data-i')));
        else if (name === 'pl-save') savePlaylistCtx();
        else if (name === 'hist-to-pl') historyToPlaylist();
        else if (name === 'pl-export') exportPlaylists();
        else if (name === 'pl-import') {
          const inp = $('[data-el=pl-file]');
          if (inp) inp.click();
        }
        else if (name === 'hist-clear') {
          history = [];
          saveHistory();
          renderHistory();
          setStat('已清空点歌历史');
        } else if (name === 'hist-del') {
          const hi = Number(act.getAttribute('data-i'));
          if (hi >= 0 && hi < history.length) {
            history.splice(hi, 1);
            saveHistory();
            renderHistory();
          }
        } else if (name === 'hist-play') {
          const hp = history[Number(act.getAttribute('data-i'))];
          if (hp) playSong(hp, { enqueue: false });
        }
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
          if (playMode === 'room') {
            // 切回来：把（可能还在放的）房间这首接上，歌词没起过就顺手带起来
            paintNow();
            if (roomNow) {
              startNowTicker();
              if (!currentLyricSong) {
                if (roomNow.lrc) loadLyricFromText(roomNow);
                else if (roomNow.platform && roomNow.id) startLyric(roomNow, roomNow.startedAt);
              }
            }
          } else {
            stopNowTicker();
          }
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
        // 先给调整框：位置 / 缩放满意了点「用这张」才真正应用
        setStat('调整一下位置和缩放，再点「用这张」');
        openBgEditor(dataUrl, { fresh: true });
      } catch (err) {
        setStat('背景图失败：' + esc(String((err && err.message) || err)));
      }
    });

    root.addEventListener('change', async (ev) => {
      const t = ev.target;
      if (!t || !t.matches || !t.matches('[data-el=pl-file]')) return;
      const file = t.files && t.files[0];
      t.value = '';
      if (!file) return;
      try {
        const text = await readFileText(file);
        importPlaylists(text);
      } catch (err) {
        setStat('读取文件失败：' + esc(String((err && err.message) || err)));
      }
    });

    root.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        if (bgEditor) {
          // 调整框开着时，Esc 只关它，别把整个面板关了
          const cancelBtn = bgEditor.querySelector('[data-bge=cancel]');
          if (cancelBtn) cancelBtn.click();
          else closeBgEditor();
          return;
        }
        close();
      } else if (ev.key === 'Enter' && ev.target === elKw) {
        ev.preventDefault();
        doSearch();
      } else if (ev.key === 'Enter' && ev.target && ev.target.getAttribute && ev.target.getAttribute('data-el') === 'sticker-kw') {
        ev.preventDefault();
        searchStickers();
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
      renderBiliFilters();
      if (elKw && elKw.placeholder !== undefined) elKw.placeholder = placeholderOf();
      if (!elBody.childElementCount) {
        elBody.innerHTML =
          '<div class="mk-empty">输入关键词，回车搜索。<br>' +
          platforms.map((p) => esc(p.label)).join(' · ') +
          '</div>';
      }
      doc.addEventListener('keydown', onDocKey, true);
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
      closeBgEditor();
      if (clockTimer) {
        clearInterval(clockTimer);
        clockTimer = null;
      }
      stopNowTicker();
      cancelStopGrace();
      if (roomMediaTimer) {
        clearInterval(roomMediaTimer);
        roomMediaTimer = null;
      }
      if (lyricTimer) {
        clearInterval(lyricTimer);
        lyricTimer = null;
      }
      if (lyricFloat) {
        try {
          lyricFloat.remove();
        } catch (e) {
          /* 忽略 */
        }
        lyricFloat = null;
      }
      try {
        window.removeEventListener('mk-settings', onWindowSettings);
        window.removeEventListener('storage', onStorage);
        window.removeEventListener('resize', onViewportChange);
        window.removeEventListener('orientationchange', onViewportChange);
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

    // 刷新（F5）之后把「房间正在放的那首」接回来：还在放就继续走秒 + 续上歌词，
    // 早该放完的直接丢掉。这样不用再为了刷新状态去设置里切一遍开关。
    (function restoreRoomNow() {
      const saved = readNow();
      if (!saved) return;
      const left = saved.durationMs ? saved.startedAt + saved.durationMs - Date.now() : null;
      if (left != null && left < -1500) {
        writeNow(null);
        return;
      }
      roomNow = saved;
      // 本机试听模式下只记着、不上屏；切回「点播到房间」时再接上
      if (playMode !== 'room') return;
      paintNow();
      startNowTicker();
      beginRoomMediaWatch(); // 刷新后也要盯：不然用户切歌了这边还挂着歌词
      if (saved.lrc) loadLyricFromText(saved);
      else if (saved.platform && saved.id) startLyric(saved, saved.startedAt);
    })();

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
      setRoomNow(text, sub, meta) {
        // 宿主传的是显示文案（「房间：歌名」），这里把前缀剥掉当标题
        const title = String(text == null ? '' : text).replace(/^房间[:：]\s*/, '').trim();
        if (!title) {
          return endRoomNow();
        }
        return beginRoomNow(Object.assign({ title: title, sub: sub || '' }, meta || {}));
      },
      /** 房间那边的歌放完了 / 被切走了（宿主可以显式调） */
      clearRoomNow: () => endRoomNow(),
      /** 诊断：现在盯的是哪个播放器、有没有在响 */
      roomMedia: () => ({
        hooked: Boolean(roomMediaEl),
        paused: roomMediaEl ? Boolean(roomMediaEl.paused) : null,
        playing: isPlaying(roomMediaEl),
        src: roomMediaEl ? mediaSrc(roomMediaEl).slice(0, 120) : '',
        tracked: mediaEls.length,
        trackedPlaying: mediaEls.filter((el) => isPlaying(el)).length,
        docs: mediaDocs.length,
        lastCut: lastCutAt ? Math.round((Date.now() - lastCutAt) / 1000) + 's 前' : '',
        why: diagTick.why || '',
      }),
      /** 宿主监听到「切歌指令」时调（socket 发出去的 cut / cut all） */
      noteCut: (kind) => noteRoomCut(kind),
      // 给外面的测试/诊断用
      play: (song) => playSong(song || lastResults[0]),
      /** 整批点歌（给测试 / 诊断用；房间模式下就是上面那套节流发送） */
      playAll: (list) => playAll(list && list.length ? list : lastResults),
      batchState: () => (batchToken ? { running: true } : { running: false }),
      exportPlaylists: () => exportPlaylists(),
      importPlaylists: (text) => importPlaylists(text),
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

  var VERSION = '3.0.0';
  // 两个版本：std（默认，只有 720P）/ hd（可选 1080P）。
  // 构建时替换成具体值 —— 想给谁 1080P，就把 hd 版脚本的链接给他。
  var EDITION = 'hd';

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

    var extra = {};
    if (platform === 'bilibili') {
      // 面板上的 B 站筛选项：排序 / 时长 / 发布时间 / 只看某 UP 主
      if (opts.order) extra.order = opts.order;
      if (opts.duration) extra.duration = opts.duration;
      if (opts.days) extra.days = opts.days;
      if (opts.author) extra.author = opts.author;
    }
    return request('/search', Object.assign({ platform: platform, kw: keyword, limit: limit, page: page }, extra), base).then(function (out) {
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
    var quality = (opts && opts.quality) === '1080' ? '1080' : '720';
    // 网易云音质档位：标准/较高/极高/无损/Hi-Res/环绕/沉浸/母带（借 IIROSE-MEDIA-WEB 的 8 档）
    var level = String((opts && opts.level) || 'exhigh');
    if (!id) return Promise.resolve({ playable: false, reason: 'no-id', note: '缺少歌曲 id' });
    var base = relayBase();

    if (base) {
      return request('/playurl', { platform: platform, id: id, mode: mode, quality: quality, level: level }, base).then(function (out) {
        if (!out || out.ok !== true) throw new Error((out && out.error) || '中转返回异常');
        var data = out.data || { playable: false, reason: 'no-data', note: '中转没有返回播放信息' };
        // 中转（没配 Cookie）拿不到 VIP 曲时，网易云再问一次公共接口，能拿到就拿到
        if (platform === 'netease' && data.playable === false) return shadowseeSongUrl(id, level);
        return data;
      }).catch(function (err) {
        if (platform === 'netease') return shadowseeSongUrl(id, level);
        throw err;
      });
    }

    if (platform !== 'netease') {
      return Promise.resolve({ playable: false, reason: 'need-relay', note: '这个平台要走中转：先配中转地址' });
    }
    return shadowseeSongUrl(id, level);
  }

  function shadowseeSongUrl(id, level) {
    return request('/song/url/v1', { id: id, level: level || 'standard' }).then(function (json) {
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
  function buildFrames(song, info, app, lyrics) {
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
        // 整段 LRC：房间自带的歌词面板靠它同步（没歌词就 null，跟以前一样）
        l: lyrics ? String(lyrics) : null,
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

  /**
   * 房间歌词：IIROSE 客户端会读 `&1` 帧里的 `l` 字段（整段 LRC），
   * 有它就按时间轴滚自己的歌词面板 —— 这才是「音词同步」的正路
   * （别的插件 IIROSE-MEDIA-WEB 也是这么干的：l: lyrics）。
   * 有译文时合成一行 `[时间] 原文 | 译文`，跟它一样的格式。
   */
  function mergeLrcForRoom(lrc, tlrc) {
    var raw = String(lrc || '').trim();
    if (!raw) return '';
    var tr = String(tlrc || '').trim();
    if (!tr) return raw;
    var key = function (s) {
      var m = /\[(\d{1,2}):(\d{2})[.:](\d{1,3})\]/.exec(s);
      if (!m) return '';
      var cs = Math.round(Number('0.' + m[3]) * 100);
      return m[1] + ':' + m[2] + ':' + ('0' + cs).slice(-2);
    };
    var map = {};
    tr.split(/\r?\n/).forEach(function (line) {
      var k = key(line);
      if (!k) return;
      map[k] = line.replace(/\[[^\]]*\]/g, '').trim();
    });
    var out = [];
    raw.split(/\r?\n/).forEach(function (line) {
      var k = key(line);
      var text = line.replace(/\[[^\]]*\]/g, '').trim();
      if (!k || !text) return;
      var t = map[k];
      out.push('[' + line.slice(1, line.indexOf(']')) + '] ' + text + (t ? ' | ' + t : ''));
    });
    return out.length ? out.join('\n') : raw;
  }

  function lyricForRoom(platform, id) {
    var base = relayBase();
    // 目前只有网易云给歌词（中转对其它平台直接回空），别白跑一趟
    if (!base || !id || platform !== 'netease') return Promise.resolve('');
    return request('/lyric', { platform: platform, id: id }, base)
      .then(function (out) {
        var d = (out && out.data) || {};
        return mergeLrcForRoom(d.lrc, d.tlrc);
      })
      .catch(function () {
        return '';
      });
  }

  function enqueue(song, info) {
    var app = locateApp();
    if (!app || !app.socket) {
      throw new Error('找不到房间连接：请先进房间并确认已登录（F5 之后再试）');
    }
    // 先把歌词拿到手：整段 LRC 塞进 &1 的 l 字段，房间自带的歌词面板就能对上拍
    return lyricForRoom(song.platform, song.id).then(function (lrc) {
      var frames = buildFrames(song, info, app, lrc);
      // 先发媒体数据（入队/播放），再发卡片；设置里关掉「发送点播卡片」时只发前者
      app.socket.send(frames[0]);
      diag.framesSent += 1;
      var withCard = readSettings().card !== false;
      if (withCard) {
        app.socket.send(frames[1]);
        diag.framesSent += 1;
      }
      diag.lastCard = withCard;
      diag.lastLyric = lrc ? lrc.length : 0;
      diag.lastEnqueue = song.title + (song.artists && song.artists.length ? ' - ' + song.artists[0] : '');
      observeRoom(app);
      return { frames: frames, app: app, lyric: lrc };
    });
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
    lastLyric: 0,
    lastNotice: null,
    roomNow: null,
    api: null,
    instances: window.__MUSIC_IIROSE_LOADS__ || 1,
    settings: null,
    gestureOn: null,
  };

  /**
   * `&1` 有两种形态，统一归一化成 { n, r, d, s, o, b, lrc }：
   *   1. 客户端发出去的那种 JSON：`&1{"s":…,"d":…,"n":…}`
   *   2. 服务器广播的 `>` 分隔版（带时长，部分还带整段 LRC）：
   *      `&1://m10…mp3>s://music.163.com/…#163=1439814454>225.817333>歌名>@0歌手>点歌人>2>封面>头像>>[00:00.000] 作词…`
   * 形态 2 才是「房间真的开始放」的信号，也是刷新后能接回来的依据。
   */
  function parseMediaFrame(data) {
    if (typeof data !== 'string') return null;
    var at = data.indexOf('&1');
    if (at < 0) return null;
    var body = data.slice(at + 2);
    if (body.charAt(0) === '{') {
      try {
        var j = JSON.parse(body);
        return j && j.n ? j : null;
      } catch (e) {
        return null;
      }
    }
    var parts = body.split('>');
    var di = -1;
    for (var i = 0; i < Math.min(parts.length, 6); i += 1) {
      if (/^\d+(\.\d+)?$/.test(parts[i])) {
        di = i;
        break;
      }
    }
    if (di < 0 || !parts[di + 1]) return null;
    var out = {
      d: Number(parts[di]) || 0,
      n: parts[di + 1] || '',
      r: parts[di + 2] || '',
      b: '',
      s: parts[0] || '',
      o: parts[di - 1] || '',
      lrc: '',
    };
    // 歌词：从第一个 LRC 时间戳切起，前面的封面/头像段就不用管了
    var lm = /\[\d{1,2}:\d{2}[.:]\d{1,3}\]/.exec(body);
    if (lm) out.lrc = body.slice(lm.index).replace(/\\n/g, '\n');
    return out;
  }

  /** 从帧里的链接猜出平台 + id（帧里没有现成字段，只能从 o / s 里捞） */
  function guessSong(media) {
    var blob = [media && media.o, media && media.s, media && media.b, media && media.r].join(' ');
    var m = /(?:#163=|song\?id=)(\d{4,})/.exec(blob) || /music\.163\.com\/#?\/?song\?id=(\d+)/.exec(blob);
    if (m) return { platform: 'netease', id: m[1] };
    m = /songDetail\/([0-9A-Za-z]{8,})/.exec(blob);
    if (m) return { platform: 'qq', id: m[1] };
    m = /(BV[0-9A-Za-z]{10})/.exec(blob);
    if (m) return { platform: 'bilibili', id: m[1] };
    if (/@0/.test(blob)) return { platform: 'netease', id: '' };
    if (/@2/.test(blob)) return { platform: 'qq', id: '' };
    return { platform: '', id: '' };
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
        var raw = ev && ev.data;
        var obj = null;
        if (typeof raw === 'string') {
          try {
            obj = JSON.parse(raw);
          } catch (e2) {
            obj = null;
          }
        }
        var media = parseMediaFrame(raw);
        if (media && media.n) {
          var roomArtist = String(media.r || '').replace(/^[@=!][\d]*/, '').trim();
          diag.roomNow = media.n + (roomArtist ? ' - ' + roomArtist : '');
          if (panel) {
            var where = guessSong(media);
            // 时长和歌词都来自服务器这一帧：拿去让面板走秒、到点自动收
            panel.setRoomNow('房间：' + media.n, roomArtist, {
              durationMs: Math.round((Number(media.d) || 0) * 1000),
              artists: roomArtist ? [roomArtist] : [],
              lrc: media.lrc || '',
              // 音源地址：面板拿去和页面上的 <audio>/<video> 对上，用来判断「还在不在放」
              src: media.s || '',
              platform: where.platform,
              id: where.id,
              // 封面：帧里的 c 是 app 相对路径（/i/xxx.png），补成完整地址给面板做封面/背景
              cover: media.c ? https(media.c) : '',
              startedAt: Date.now(),
            });
          }
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
    // 切歌是「客户端 -> 服务器」的指令，收不到回声，所以也盯一下发出去的帧：
    // {"m":"cut",...} / {"m":"cut all",...} 都算。
    try {
      if (!app.socket.__mkSendHooked && typeof app.socket.send === 'function') {
        var origSend = app.socket.send;
        app.socket.send = function (frame) {
          try {
            var s = String(frame == null ? '' : frame);
            if (s.indexOf('"cut') >= 0 && /"m"\s*:\s*"cut(\s+all)?"/.test(s)) {
              if (panel && typeof panel.noteCut === 'function') {
                panel.noteCut(/cut\s+all/.test(s) ? 'cut-all' : 'cut');
              }
            }
          } catch (e) {
            /* 只是顺手看一眼，绝不能影响发送 */
          }
          return origSend.apply(this, arguments);
        };
        app.socket.__mkSendHooked = true;
      }
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
        // B 站 / QQ 要中转才可用；没配就不显示 tab，免得点进去只看到报错
        if (relayBase()) {
          list.push({ id: 'qq', label: 'QQ 音乐', home: 'https://y.qq.com/' });
          list.push({ id: 'bilibili', label: 'B 站（Live / MV）', home: 'https://www.bilibili.com/' });
        }
        return Promise.resolve(list);
      },
      search: search,
      playlist: playlistSongs,
      userPlaylists: userPlaylists,
      playurl: songUrl,
      lyric: function (opts) {
        var base = relayBase();
        if (!base) return Promise.resolve(null);
        return request('/lyric', { platform: (opts && opts.platform) || 'netease', id: (opts && opts.id) || '' }, base).then(function (out) {
          return (out && out.data) || null;
        });
      },
      // 表情包：搜索也在中转里（图床防盗链 + 白名单都收在中转那侧）
      sticker: function (opts) {
        var base = relayBase();
        if (!base) return Promise.reject(new Error('表情搜索要配中转'));
        var kw = String((opts && opts.kw) || '').trim();
        if (!kw) return Promise.reject(new Error('先输个关键词'));
        return request('/sticker', { kw: kw, page: (opts && opts.page) || 1 }, base).then(function (out) {
          if (!out || out.ok !== true) throw new Error((out && out.error) || '中转返回异常');
          return out.data || { items: [] };
        });
      },
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
      hd: EDITION === 'hd',
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
        var media = null;
        try {
          media = panel && panel.roomMedia ? panel.roomMedia() : null;
        } catch (e) {
          media = null;
        }
        return {
          version: VERSION,
          instances: diag.instances,
          gesture: gestureOn,
          ball: !(ballEl && ballEl.style && ballEl.style.display === 'none'),
          media: media,
        };
      },
      // 面板里直接改中转地址（不用 F12，也不用记 localStorage 的 key）
      relayUrl: relayBase(),
      onRelayChange: function (url) {
        lsSet(LS.relay, url || '');
        diag.relay = url || null;
      },
      // 「外链点播」：按 <标题 - 作者 - 封面#color=xx> [视频直链] 的格式发一条公屏消息，
      // 由 IIROSE 自己的外链点播功能解析成视频（绕开 &1 媒体帧那条路）
      onExternalRequest: function (song, info) {
        var app = locateApp();
        if (!app || !app.socket) throw new Error('找不到房间连接：先进房间再试');
        var url = String((info && info.streamUrl) || '');
        if (!url) throw new Error('没有可用的视频地址');
        var color = normColor(app.inputcolorhex);
        var cover = String(song.cover || '');
        var artist = (song.artists || []).join(' & ');
        var head =
          '<' + song.title + ' - ' + artist + (cover ? ' - ' + cover : '') + '#color=' + color + '>';
        app.socket.send(JSON.stringify({ m: head + ' [' + url + ']', mc: color, i: msgId() }));
        diag.framesSent += 1;
        diag.lastEnqueue = 'link: ' + url;
      },
      // 「原生」模式：把链接当普通公屏消息发出去，让 IIROSE 自己解析点播（和自带点歌台同一套）
      // B 站视频优先发 bilibilix 的转链：它 302 到 CDN mp4，IIROSE 自己解析时能播
      onNativeRequest: function (song) {
        var app = locateApp();
        if (!app || !app.socket) throw new Error('找不到房间连接：先进房间再试');
        var link =
          song.platform === 'bilibili' && song.id
            ? 'https://www.bilibilix.com/video/' + encodeURIComponent(song.id)
            : song.url || 'https://www.bilibili.com/video/' + song.id;
        var color = normColor(app.inputcolorhex);
        app.socket.send(JSON.stringify({ m: '@ ' + link, mc: color, i: msgId() }));
        diag.framesSent += 1;
        diag.lastEnqueue = 'native: ' + link;
      },
      // 整批点完后在房间里留一条「基础信息」（不带进度条刷屏）；由面板决定发不发
      onNotice: function (text) {
        var app = locateApp();
        if (!app || !app.socket) throw new Error('找不到房间连接：先进房间再试');
        var msg = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
        if (!msg) return;
        var color = normColor(app.inputcolorhex);
        app.socket.send(JSON.stringify({ m: msg, mc: color, i: msgId() }));
        diag.framesSent += 1;
        diag.lastNotice = msg;
      },
      // 发一张表情：IIROSE 的图片消息就是 `{m:"<url>#e"}`（#e = 按图片渲染）
      onSticker: function (item) {
        var app = locateApp();
        if (!app || !app.socket) throw new Error('找不到房间连接：先进房间再试');
        var url = String((item && item.send) || '');
        if (!url) throw new Error('这张图没有可发地址');
        var color = normColor(app.inputcolorhex);
        app.socket.send(JSON.stringify({ m: url + '#e', mc: color, i: msgId() }));
        diag.framesSent += 1;
        diag.lastSticker = url.slice(0, 80);
        observeRoom(app);
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
    // 掉线重连会换一个 socket 对象：每 3 秒补挂一次（observeRoom 自己幂等）
    var observeTimer = setInterval(function () {
      try {
        observeRoom(locateApp());
      } catch (e) {
        /* 忽略 */
      }
    }, 3000);

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
        clearInterval(observeTimer);
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
