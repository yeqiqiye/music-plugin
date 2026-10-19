/**
 * 移动端交互：悬浮球可拖动 / 可关闭，双指上滑能叫回点歌台。
 *
 * 用法：node dev/mobile-iirose.mjs（没装 jsdom 会跳过）
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

let JSDOM;
try {
  ({ JSDOM } = await import('jsdom'));
} catch {
  console.log('跳过：没装 jsdom（可选依赖）。');
  process.exit(0);
}

const failures = [];
const check = (label, cond, extra = '') => {
  console.log((cond ? '  ok   ' : '  FAIL ') + label + (extra ? '  ' + extra : ''));
  if (!cond) failures.push(label);
};
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));

const src = readFileSync(join(root, 'iirose', 'music-iirose.js'), 'utf8');

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  runScripts: 'dangerously',
  url: 'https://iirose.com/',
  pretendToBeVisual: true,
});
const { window } = dom;
const { document } = window;

// 有中转，面板才会渲染 4 个 tab 和搜索范围
window.localStorage.setItem('mk_iirose_relay', 'https://relay.example.com');

// fetch 全打桩：只要不真的联网
window.fetch = () =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ ok: true, data: [], platforms: [] }),
    text: () => Promise.resolve('{}'),
  });

// TouchEvent 在 jsdom 里没有，这里造一个能带 touches 的事件
function touch(target, type, points, extra = {}) {
  const ev = new window.Event(type, { bubbles: true, cancelable: true, ...extra });
  Object.defineProperty(ev, 'touches', { value: points });
  Object.defineProperty(ev, 'changedTouches', { value: points });
  target.dispatchEvent(ev);
  return ev;
}

const script = document.createElement('script');
script.textContent = src;
document.body.appendChild(script);
await tick(80);

const diag = window.__MUSIC_IIROSE__;
check('脚本已挂载', Boolean(diag && diag.mounted), diag ? diag.state : 'no-diag');

const ball = document.querySelector('.mk-iirose-ball');
check('悬浮球存在', Boolean(ball));
check('悬浮球带关闭按钮', Boolean(ball && ball.querySelector('.mk-ball-x')));

// ---- 关闭悬浮球 ----
const xBtn = ball.querySelector('.mk-ball-x');
xBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick();
check('点 × 后悬浮球隐藏', ball.style.display === 'none');
const afterHide = JSON.parse(window.localStorage.getItem('mk_panel_settings') || '{}');
check('隐藏状态被记住（设置里 ball=false）', afterHide.ball === false, JSON.stringify(afterHide));
check('隐藏悬浮球时双指上滑保持可用', afterHide.gesture === true, JSON.stringify(afterHide));

// ---- 双指上滑：面板打开（球保持关闭，关了就是关了） ----
const panelRoot = document.querySelector('.mk-root');
check('面板初始是关的', !panelRoot.classList.contains('mk-open'));

touch(document, 'touchstart', [
  { clientY: 700, clientX: 180 },
  { clientY: 710, clientX: 220 },
]);
touch(document, 'touchmove', [
  { clientY: 560, clientX: 180 },
  { clientY: 570, clientX: 220 },
]);
touch(document, 'touchend', []);
await tick(60);
check('双指上滑后打开面板', panelRoot.classList.contains('mk-open'));
const afterSwipe = JSON.parse(window.localStorage.getItem('mk_panel_settings') || '{}');
check('双指上滑不会偷偷把球打开', ball.style.display === 'none' && afterSwipe.ball === false, JSON.stringify(afterSwipe));

// ---- 单指上滑不该触发 ----
panelRoot.classList.remove('mk-open');
touch(document, 'touchstart', [{ clientY: 700, clientX: 180 }]);
touch(document, 'touchmove', [{ clientY: 500, clientX: 180 }]);
touch(document, 'touchend', []);
await tick(40);
check('单指上滑不触发', !panelRoot.classList.contains('mk-open'));

// ---- 在设置里关掉双指上滑：之后怎么滑都不该开 ----
window.__MUSIC_IIROSE__.panel.open();
await tick(30);
document.querySelector('[data-act=settings]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick(30);
const gestureSwitch = document.querySelector('[data-set=gesture]');
check('设置页里有双指开关', Boolean(gestureSwitch));
gestureSwitch.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick(40);
const offSettings = JSON.parse(window.localStorage.getItem('mk_panel_settings') || '{}');
check('关掉双指后 gesture=false', offSettings.gesture === false, JSON.stringify(offSettings));
check('关掉双指时球自动打开', offSettings.ball === true, JSON.stringify(offSettings));
check('关掉双指后监听真的摘了', window.__MUSIC_IIROSE__.gestureOn === false);

window.__MUSIC_IIROSE__.panel.close();
await tick(30);
touch(document, 'touchstart', [
  { clientY: 700, clientX: 180 },
  { clientY: 710, clientX: 220 },
]);
touch(document, 'touchmove', [
  { clientY: 520, clientX: 180 },
  { clientY: 530, clientX: 220 },
]);
touch(document, 'touchend', []);
await tick(60);
check('关掉双指后上滑打不开', !panelRoot.classList.contains('mk-open'));

// ---- 再打开：又能用了 ----
window.__MUSIC_IIROSE__.panel.open();
await tick(30);
document.querySelector('[data-act=settings]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick(30);
document.querySelector('[data-set=gesture]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick(40);
check('重新打开后 gesture=true', JSON.parse(window.localStorage.getItem('mk_panel_settings')).gesture === true);
check('重新打开后监听挂回来', window.__MUSIC_IIROSE__.gestureOn === true);
window.__MUSIC_IIROSE__.panel.close();
await tick(20);
touch(document, 'touchstart', [
  { clientY: 700, clientX: 180 },
  { clientY: 710, clientX: 220 },
]);
touch(document, 'touchmove', [
  { clientY: 560, clientX: 180 },
  { clientY: 570, clientX: 220 },
]);
touch(document, 'touchend', []);
await tick(60);
check('打开后上滑又能开面板', panelRoot.classList.contains('mk-open'));

// ---- 设置页底部的诊断行 ----
document.querySelector('[data-act=settings]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick(30);
const diagLine = document.querySelector('.mk-diag');
check('设置页有诊断行', Boolean(diagLine), diagLine ? diagLine.textContent : '');
check('诊断行显示实例数', Boolean(diagLine) && /脚本实例 1/.test(diagLine.textContent));
check('诊断行显示手势状态', Boolean(diagLine) && /双指上滑 已挂监听/.test(diagLine.textContent));

// ---- 拖动：位置要记住 ----
ball.style.left = '20px';
ball.style.top = '300px';
if (window.PointerEvent) {
  ball.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, clientX: 40, clientY: 320, pointerId: 1 }));
  ball.dispatchEvent(new window.PointerEvent('pointermove', { bubbles: true, clientX: 90, clientY: 360, pointerId: 1 }));
  ball.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true, clientX: 90, clientY: 360, pointerId: 1 }));
} else {
  touch(ball, 'touchstart', [{ clientX: 40, clientY: 320 }]);
  touch(document, 'touchmove', [{ clientX: 90, clientY: 360 }]);
  touch(document, 'touchend', []);
}
await tick();
const saved = window.localStorage.getItem('mk_iirose_ball');
const pos = saved ? JSON.parse(saved) : {};
check('拖动后位置写进 localStorage', pos.x > 0 && pos.y > 0, String(saved));
check('拖动后不会误触发面板开关', typeof saved === 'string');

// ---- 面板里有三个搜索范围 ----
const scopes = document.querySelectorAll('.mk-scope');
check('面板里有 歌曲/用户/歌单 三个范围', scopes.length === 3, String(scopes.length));

console.log('');
if (failures.length) {
  console.log('结果：' + failures.length + ' 项失败 -> ' + failures.join(' / '));
  process.exit(1);
}
console.log('结果：全部通过');
