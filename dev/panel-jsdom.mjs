/**
 * 面板 UI 的真实 DOM 冒烟（jsdom）——补上假 DOM 测不出来的那一层。
 *
 *   node dev/panel-jsdom.mjs
 *
 * 覆盖：挂载 → 渲染 tabs/空态 → 切平台 → 搜索（桩 API）→ 渲染结果行 → 登录页渲染 →
 *       Esc 关闭 → dispose 清理。不联网。
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

let JSDOM;
try {
  ({ JSDOM } = await import('jsdom'));
} catch {
  console.log('跳过：没装 jsdom（可选依赖）。想跑这个测试就 npm i -D jsdom。');
  process.exit(0);
}

const failures = [];
const check = (label, cond, extra = '') => {
  console.log((cond ? '  ok   ' : '  FAIL ') + label + (extra ? '  ' + extra : ''));
  if (!cond) failures.push(label);
};

const dom = new JSDOM('<!doctype html><html><head></head><body><div id="host"></div></body></html>', {
  // getInternalVMContext() 要求显式允许脚本执行（jsdom >= 16 行为）；
  // outside-only 只允许我们用 vm 手动注入，页面自身不执行任何脚本。
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  url: 'http://127.0.0.1:3080/',
});
const { window } = dom;
const { document } = window;
// jsdom 没有 clipboard，补一个桩，避免点行时报错。
Object.defineProperty(window.navigator, 'clipboard', {
  value: { writeText: async () => {} },
  configurable: true,
});

const panelCode = readFileSync(join(root, 'client', 'panel-ui.js'), 'utf8');
vm.runInContext(panelCode, dom.getInternalVMContext(), { filename: 'panel-ui.js' });
const mount = window.mountMusicPanel;
check('panel-ui.js 暴露 mountMusicPanel', typeof mount === 'function');

const calls = [];
const api = {
  async search({ platform, keyword, limit }) {
    calls.push({ platform, keyword, limit });
    return [
      { platform, id: '1', title: '晴天', artists: ['周杰伦'], album: '叶惠美', durationMs: 269000, vip: true, url: 'https://example.com/1' },
      { platform, id: '2', title: '七里香', artists: ['周杰伦'], album: '七里香', durationMs: 299000, vip: false, url: 'https://example.com/2' },
    ];
  },
  async platforms() {
    return [
      { id: 'netease', label: '网易云音乐', home: 'https://music.163.com/' },
      { id: 'kugou', label: '酷狗音乐', home: 'https://www.kugou.com/' },
    ];
  },
  async session() { return { loggedIn: false, nickname: null }; },
  async login() { return { loggedIn: true, nickname: '测试用户' }; },
  async logout() { return { loggedIn: false }; },
};

const panel = mount(document.getElementById('host'), { api, openOnMount: true });
await new Promise((r) => setTimeout(r, 20));

const rootEl = panel.root;
check('面板以 open 状态挂载', rootEl.classList.contains('mk-open'));
check('渲染出平台 tab', rootEl.querySelectorAll('.mk-tab').length >= 2);
check('空态提示存在', /输入关键词|等待搜索/.test(rootEl.querySelector('.mk-body').textContent));
check(
  'host 上有面板节点',
  document.body.querySelectorAll('[data-el=host], .mk-root').length >= 1,
);

// ---- 搜索 ----
rootEl.querySelector('[data-el=kw]').value = '晴天';
rootEl.querySelector('[data-act=search]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 30));
check('搜索调用了 api.search', calls.length === 1, JSON.stringify(calls));
check('结果渲染了 2 行', rootEl.querySelectorAll('.mk-song').length === 2);
check('VIP 标记出现', rootEl.innerHTML.includes('VIP/付费'));
check('状态栏显示条数', /2 条/.test(rootEl.querySelector('[data-el=stat]').textContent));

// ---- 切平台 ----
// 注意：renderTabs() 会重写整段 innerHTML，切之前抓到的节点会变成游离节点，
// 所以高亮必须在切换之后重新查一次。
rootEl.querySelectorAll('.mk-tab')[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 30));
check('切平台后再次搜索', calls.length === 2 && calls[1].platform === 'kugou', JSON.stringify(calls[1]));
const activeTab = rootEl.querySelectorAll('.mk-tab')[1];
check(
  '切中的 tab 高亮',
  activeTab.classList.contains('mk-on') && !rootEl.querySelectorAll('.mk-tab')[0].classList.contains('mk-on'),
);

// ---- 登录页 ----
rootEl.querySelector('[data-act=login]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 10));
check('登录页渲染出 Cookie 输入框', Boolean(rootEl.querySelector('[data-el=cookie]')));
rootEl.querySelector('[data-el=cookie]').value = 'MUSIC_U=fake';
rootEl.querySelector('[data-act=save-login]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 20));
check('保存登录后顶部按钮变成「已登录」', /已登录/.test(rootEl.querySelector('[data-act=login]').textContent));

// ---- Esc 关闭 ----
document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
await new Promise((r) => setTimeout(r, 10));
check('Esc 关闭面板', !rootEl.classList.contains('mk-open'));

// ---- dispose ----
panel.dispose();
check('dispose 后节点被移除', !document.body.contains(rootEl));

console.log('');
if (failures.length) {
  console.log('结果：' + failures.length + ' 项失败 -> ' + failures.join(' / '));
  process.exit(1);
}
console.log('结果：全部通过');
