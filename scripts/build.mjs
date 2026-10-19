/**
 * 构建 lib/client.js —— 把 client/panel-ui.js 以字符串内联进客户端 bundle。
 *
 * 为什么是字符串内联而不是直接 import：
 *   panel-ui.js 必须在**页面主世界**里执行（它要 document、要挂 style），而 DSH 的客户端模块
 *   是懒加载 CJS 工厂；内联成字符串 + 动态 <script> 注入是最不容易出岔子的一种做法，
 *   而且产物只有一个文件，不依赖 /plugins/<pkg>/ 下的其它静态资源是否可达。
 *
 * 运行：node scripts/build.mjs
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const panelSource = await readFile(join(root, 'client', 'panel-ui.js'), 'utf8');
// 版本号从 package.json 来：别让客户端里的诊断和发版号对不上
const pkg = JSON.parse((await readFile(join(root, 'package.json'), 'utf8')).replace(/^\uFEFF/, ''));
// 用 JSON 编码塞进字符串字面量：单双引号、换行、反引号都不用手工转义。
const panelLiteral = JSON.stringify(panelSource);

const bundle = `/**
 * dsh-music-request 客户端半侧（构建产物，别直接改这个文件）。
 * 源文件：client/panel-ui.js（UI）+ scripts/build.mjs（这一层壳）。
 *
 * 职责：
 *   1. 装 Alt+T 快捷键，开关点歌台面板
 *   2. 把面板挂进 DSH 的 shell.overlay 插槽
 *   3. 通过 /music/api/* 同源路由拿数据（搜索与登录都在 host 半侧）
 */
;(() => {
  const PANEL_SOURCE = ${panelLiteral};

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
      const VERSION = '${pkg.version}';

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
          if (err && err.stack) diag.lastStack = String(err.stack).split('\\n').slice(0, 4).join(' | ');
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
`;

await mkdir(join(root, 'lib'), { recursive: true });
await writeFile(join(root, 'lib', 'client.js'), bundle, 'utf8');
console.log('built lib/client.js  (' + bundle.length + ' bytes, panel source ' + panelSource.length + ' bytes)');
