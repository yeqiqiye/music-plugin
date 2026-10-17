/**
 * 客户端 bundle 的离线冒烟测试：在 Node 里用假 DOM 跑一遍真正的 lib/client.js，
 * 验证「工厂能物化 → apply 不抛 → 预热注入面板脚本 → Alt+T 真的开关面板」。
 *
 * 这不是浏览器测试，但能抓住绝大多数低级错误（require 写错、插槽参数形状错、
 * 事件没注册、异常被吞、预热没跑完）。
 * 用法：node dev/smoke-client.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const code = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8');

const failures = [];
const check = (label, cond, extra = '') => {
  console.log((cond ? '  ok   ' : '  FAIL ') + label + (extra ? '  ' + extra : ''));
  if (!cond) failures.push(label);
};

// ---------- 把 HTML 字符串解析成假的子节点树 ----------
// 浏览器会把 innerHTML 解析成元素；假 DOM 想要 querySelector 能用，就得做同一件事。
// 只用最朴素的标签/属性扫描，够这个面板用（没有注释、没有异常嵌套）。
let docForParse = null; // 在下面 createElement 时补上，避免 el() 与 doc 的循环依赖
const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'source']);
function parseHTML(html, doc) {
  const out = [];
  const stack = [];
  const re = /<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g;
  let m;
  while ((m = re.exec(String(html)))) {
    const [, closing, tag, attrText] = m;
    if (closing) {
      stack.pop();
      continue;
    }
    const node = doc.createElement(tag);
    const attrRe = /([\w-]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    let a;
    while ((a = attrRe.exec(attrText))) {
      const name = a[1];
      const value = a[3] ?? a[4] ?? a[5] ?? '';
      if (name === 'class') node.className = value;
      else node.setAttribute(name, value);
    }
    const parent = stack.length ? stack[stack.length - 1] : null;
    if (parent) parent.children.push(node);
    else out.push(node);
    if (!VOID_TAGS.has(tag.toLowerCase()) && !/\/\s*$/.test(attrText)) stack.push(node);
  }
  return out;
}

// ---------- 极简 CSS 匹配（够跑面板里的 [data-el=..] / [data-act=..] 查询）----------
function matches(node, sel) {
  sel = sel.trim();
  if (sel === '*') return true;
  const attr = /^\[([\w-]+)(?:=("?)([^\]"]*)\2)?\]$/.exec(sel);
  if (attr) {
    const val = node.getAttribute(attr[1]);
    if (attr[3] === undefined) return val != null;
    return val === attr[3];
  }
  if (sel.startsWith('.')) {
    const cls = node.className || node.getAttribute?.('class') || '';
    return String(cls).split(/\s+/).includes(sel.slice(1));
  }
  return String(node.tagName).toLowerCase() === sel.toLowerCase();
}

function queryAll(root, sel) {
  const out = [];
  const walk = (node) => {
    for (const child of node.children || []) {
      if (matches(child, sel)) out.push(child);
      walk(child);
    }
  };
  walk(root);
  return out;
}

// ---------- 假 DOM ----------
function el(tag) {
  const e = {
    tagName: String(tag).toUpperCase(),
    children: [],
    attributes: {},
    style: {},
    id: '',
    textContent: '',
    className: '',
    value: '',
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
      toggle(c) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); },
    },
    get childElementCount() { return this.children.length; },
    focus() {},
    // 假 DOM 也要有 <audio> 的最小能力，否则播放链路测不下去
    play() { this.paused = false; return Promise.resolve(); },
    pause() { this.paused = true; },
    load() {},
    appendChild(c) {
      this.children.push(c);
      // 模拟浏览器：把一个 <script> 加进 head 就会执行它。
      // 不这么做的话，测试只能看到"注入了脚本"，看不到"脚本有没有跑通"。
      if (this.tagName === 'HEAD' && c.tagName === 'SCRIPT' && c.textContent) {
        try {
          vm.runInContext(String(c.textContent), sandbox, { filename: 'panel-ui.js' });
        } catch (err) {
          console.error('[smoke] 面板脚本执行失败：' + (err && err.message));
          sandbox.__panelScriptError = err;
        }
      }
      if (this.tagName === 'HEAD' && c.tagName === 'SCRIPT' && c._on && c._on.load) c._on.load();
      return c;
    },
    prepend(c) { this.children.unshift(c); return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); },
    remove() {},
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return this.attributes[k]; },
    addEventListener(type, fn) { (this._on ??= {})[type] = fn; },
    removeEventListener() {},
    querySelector(sel) {
      const found = queryAll(this, sel);
      return found.length ? found[0] : null;
    },
    querySelectorAll(sel) { return queryAll(this, sel); },
    closest() { return null; },
    dispatchEvent() {},
  };
  // innerHTML 要走解析，这样 $('[data-el=..]') 这类查询才有东西可查。
  Object.defineProperty(e, 'innerHTML', {
    get() { return this._html ?? ''; },
    set(v) {
      this._html = String(v);
      this.children = parseHTML(this._html, docForParse);
    },
  });
  return e;
}

const docListeners = {};
/** 记录 document 上的全部监听器（真实 DOM 允许同一事件挂多个；假 DOM 早期只存了一个，
 *  结果面板自己的 Esc 处理器把 bundle 的 Alt+T 处理器覆盖掉，测试直接假失败）。 */
const addDocListener = (type, fn) => { (docListeners[type] ??= []).push(fn); };
const removeDocListener = (type, fn) => {
  if (!docListeners[type]) return;
  docListeners[type] = docListeners[type].filter((f) => f !== fn);
};
/** 按注册顺序把事件派发给所有监听器，返回最后一个非 undefined 的返回值。 */
function fireDoc(type, ev) {
  let result;
  for (const fn of docListeners[type] || []) {
    const r = fn(ev);
    if (r !== undefined) result = r;
  }
  return result;
}
docForParse = {
  createElement: (t) => el(t),
};
const doc = {
  head: el('head'),
  body: el('body'),
  createElement: (t) => el(t),
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: addDocListener,
  removeEventListener: removeDocListener,
};
const win = { document: doc, console, addEventListener() {}, removeEventListener() {} };

// ---------- 假 module loader ----------
let loaded = null;
win.__ModuleLoader__ = { load(row) { loaded = row; } };

const sandbox = {
  window: win,
  document: doc,
  console,
  navigator: { clipboard: { writeText: async () => {} } },
  setTimeout,
  clearTimeout,
  // 假 fetch：只认 /music/api/playurl 这一条（面板播放链路要用）。
  // 返回形状必须与 host 路由一致：{ ok, data:{ playable, streamUrl, ... } }
  fetch: async (url) => {
    const u = String(url);
    if (u.includes('/music/api/playurl')) {
      const id = new URL('http://x' + u).searchParams.get('id');
      if (id === 'vip-locked') {
        return jsonResponse({ ok: true, data: { playable: false, reason: 'vip-locked', note: '需要 VIP' } });
      }
      return jsonResponse({
        ok: true,
        data: {
          playable: true,
          streamUrl: '/music/api/stream?platform=netease&url=https%3A%2F%2Fm701.music.126.net%2Fx.mp3',
          ext: 'mp3',
          bitrate: 128000,
        },
      });
    }
    if (u.includes('/music/api/search')) return jsonResponse({ ok: true, data: [] });
    if (u.includes('/music/api/platforms')) return jsonResponse({ ok: true, data: [] });
    return jsonResponse({ ok: false, error: 'smoke 里没有实现这个请求：' + u });
  },
  URL,
  URLSearchParams,
  Promise,
};
function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    async json() { return body; },
    async text() { return JSON.stringify(body); },
  };
}
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const drain = () => new Promise((r) => setTimeout(r, 0));

console.log('== 客户端 bundle 冒烟 ==');
vm.runInContext(code, sandbox, { filename: 'lib/client.js' });

check('bundle 注册到 __ModuleLoader__', loaded !== null && loaded.id === 'dsh-music-request');
if (!loaded) process.exit(1);

// ---------- 物化工厂 ----------
const requested = [];
const requireFn = (id) => {
  requested.push(id);
  throw new Error('smoke 里不应 require：' + id);
};

let exportsObj = null;
try {
  exportsObj = loaded.factory(requireFn);
  check('factory 物化不抛异常', true);
} catch (err) {
  check('factory 物化不抛异常', false, String(err && err.stack ? err.stack.split('\n')[0] : err));
}

if (exportsObj) {
  check('导出 name', exportsObj.name === 'music-request', exportsObj.name);
  check('导出 inject 含 slots', Array.isArray(exportsObj.inject) && exportsObj.inject.includes('slots'));
  check('导出 apply 是函数', typeof exportsObj.apply === 'function');

  // ---------- 跑 apply ----------
  const slotRegistrations = [];
  const effectCleanups = [];
  const ctx = {
    slots: {
      inject(name, gen) {
        slotRegistrations.push({ name, gen: typeof gen });
        if (typeof gen === 'function') {
          const it = gen();
          let step = it.next();
          while (!step.done) step = it.next(step.value);
        }
      },
      register(def, comp) {
        slotRegistrations.push({ registered: def, compType: typeof comp });
        return () => {};
      },
    },
    effect(fn, label) {
      const cleanup = fn();
      if (typeof cleanup === 'function') effectCleanups.push({ label, cleanup });
      return () => {};
    },
    get: () => undefined,
    logger: () => () => {},
  };

  try {
    exportsObj.apply(ctx);
    check('apply 不抛异常', true);
  } catch (err) {
    check('apply 不抛异常', false, String(err && err.message ? err.message : err));
  }

  // 预热是异步的，等一轮 microtask 再断言（等价于浏览器里"等一帧"）。
  await drain();
  await drain();

  check('通过 ctx.slots.inject 注册到 shell.overlay', slotRegistrations.some((r) => r.name === 'shell.overlay'));
  check(
    '注册了 shell.overlay 的具体条目',
    slotRegistrations.some((r) => r.registered && r.registered.name === 'shell.overlay' && r.registered.id === 'music-request'),
  );
  check('挂了 keydown 监听（Alt+T 的接收端）', Array.isArray(docListeners.keydown) && docListeners.keydown.length > 0, Object.keys(docListeners).join(','));
  check('注册了 ctx.effect 清理钩子', effectCleanups.length >= 1);

  // ---------- 预热结果 ----------
  const diag = win.__MUSIC_REQUEST__;
  check('暴露了 window.__MUSIC_REQUEST__ 诊断对象', Boolean(diag));
  if (diag) {
    check(
      '预热后 state=ready（面板脚本已注入并挂载）',
      diag.state === 'ready',
      'state=' + diag.state + (diag.lastError ? ' / err=' + diag.lastError : ''),
    );
    check('panelMounted=true', diag.panelMounted === true);
    check('body 上写了 data-dsh-music-request=ready', doc.body.attributes['data-dsh-music-request'] === 'ready');
  }

  const injected = doc.head.children.find((c) => c.tagName === 'SCRIPT');
  check('预热阶段注入了面板脚本', Boolean(injected));
  if (injected) check('面板脚本内容里带着 mountMusicPanel', String(injected.textContent).includes('mountMusicPanel'));
  check('面板脚本执行后 window.mountMusicPanel 可用', typeof win.mountMusicPanel === 'function');
  check(
    '面板 host 节点挂在 body 上',
    doc.body.children.some((c) => typeof c.getAttribute === 'function' && c.getAttribute('data-dsh-music-request') === 'host'),
  );

  // ---------- 模拟 Alt+T ----------
  if (Array.isArray(docListeners.keydown) && docListeners.keydown.length > 0) {
    let prevented = 0;
    const ret = fireDoc('keydown', {
      altKey: true, ctrlKey: false, metaKey: false, shiftKey: false,
      code: 'KeyT', key: 't',
      preventDefault: () => { prevented++; },
      stopPropagation: () => {},
    });
    check('Alt+T 处理器返回 Promise（便于测试 await）', ret && typeof ret.then === 'function');
    if (ret && typeof ret.then === 'function') await ret;
    await drain();
    check('Alt+T 第一次按下：面板进入 open', prevented === 1 && win.__panel && win.__panel.root.classList.contains('mk-open'));
    check('Alt+T 计入 openCount', diag && diag.openCount === 1, 'openCount=' + (diag && diag.openCount));
    check('按键被嗅探记录', diag && diag.keys.includes('Alt+KeyT'), JSON.stringify(diag && diag.keys));

    // 再按一次应该关闭（注意：这里必须给全 code/key，第一次的漏字段曾让这条断言假失败）
    let ret2;
    try {
      ret2 = fireDoc('keydown', {
        altKey: true, ctrlKey: false, metaKey: false, shiftKey: false,
        code: 'KeyT', key: 't',
        preventDefault: () => {},
        stopPropagation: () => {},
      });
    } catch (err) {
    }
    if (ret2 && typeof ret2.then === 'function') {
      try {
        await ret2;
      } catch (err) {
      }
    }
    await drain();
    check('Alt+T 第二次按下：面板关闭', win.__panel && !win.__panel.root.classList.contains('mk-open'));

    let prevented2 = 0;
    const ret3 = fireDoc('keydown', {
      altKey: false, ctrlKey: true, metaKey: false, shiftKey: false,
      code: 'KeyT', key: 't',
      preventDefault: () => { prevented2++; },
      stopPropagation: () => {},
    });
    check('Ctrl+T（无 Alt）不拦', prevented2 === 0 && ret3 === undefined);
  }

  // ---------- 播放器链路（直接调面板暴露的 play()，绕开假 DOM 的 closest 限制）----------
  if (win.__panel && typeof win.__panel.play === 'function') {
    const song = {
      platform: 'netease',
      id: '111',
      title: '测试曲目',
      artists: ['某歌手'],
      vip: false,
    };
    const out = await win.__panel.play(song);
    await drain();
    check('play() 返回 played=true（api.playurl 解析成功）', out && out.played === true, JSON.stringify(out));
    const st = win.__panel.state();
    check('播放器状态记录了当前曲目', st.current === 'netease:111', JSON.stringify(st));
    check('audio.src 指向同源代理地址', typeof st.src === 'string' && st.src.includes('/music/api/stream'), String(st.src));
    check('队列里有这首歌', st.queue.includes('netease:111'), JSON.stringify(st.queue));

    // 拿不到地址的歌：必须给出明确原因，而不是静默失败
    const locked = await win.__panel.play({ platform: 'netease', id: 'vip-locked', title: 'VIP 曲', artists: ['x'] });
    await drain();
    check('锁定曲目返回 played=false 且带原因', locked && locked.played === false && locked.reason === 'vip-locked', JSON.stringify(locked));
  }

  // ---------- 清理 ----------
  for (const { cleanup } of effectCleanups) {
    try {
      cleanup();
    } catch (err) {
      check('清理钩子不抛异常', false, String(err && err.message ? err.message : err));
    }
  }
  check('清理后 keydown 监听被移除', !docListeners.keydown || docListeners.keydown.length === 0);
  check('清理后 diag.state=disposed', win.__MUSIC_REQUEST__ && win.__MUSIC_REQUEST__.state === 'disposed');
}

console.log('');
if (failures.length) {
  console.log('结果：' + failures.length + ' 项失败 -> ' + failures.join(' / '));
  process.exit(1);
}
console.log('结果：全部通过');
