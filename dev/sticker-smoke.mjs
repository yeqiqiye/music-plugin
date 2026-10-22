/**
 * 表情包脚本（iirose/sticker.js）的离线冒烟：jsdom 里跑真产物。
 *
 * 覆盖：载入 → 右下角球 → Alt+E 开关 → 搜索（假中转）→ 点图发出 `#e` 消息 → 2 秒限速 → 收藏落盘。
 *
 * 用法：node dev/sticker-smoke.mjs（没装 jsdom 会自跳过）
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
  console.log('跳过：没装 jsdom（可选依赖）');
  process.exit(0);
}

const failures = [];
const check = (label, cond, extra = '') => {
  console.log((cond ? '  ok   ' : '  FAIL ') + label + (extra ? '  ' + extra : ''));
  if (!cond) failures.push(label);
};
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'https://iirose.com/',
});
const { window } = dom;

const sent = [];
window.socket = {
  send(frame) {
    sent.push(frame);
  },
  onmessage: null,
};
window.uid = '688829143194';
window.inputcolorhex = '#4a8fd6';
window.localStorage.setItem('mk_iirose_relay', 'https://relay.example.com');

let fetchCount = 0;
window.fetch = async (url) => {
  fetchCount += 1;
  const u = String(url);
  if (u.includes('/sticker?')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        data: {
          source: 'test',
          items: [
            {
              url: 'https://img.soutula.com/large/cat.gif',
              thumb: 'https://img.soutula.com/bmiddle/cat.gif',
              title: '猫猫',
              send: 'https://relay.example.com/sticker/img?u=cat.gif&s=deadbeef',
            },
          ],
        },
      }),
    };
  }
  throw new Error('没预料到的请求：' + u);
};

const code = readFileSync(join(root, 'iirose', 'sticker.js'), 'utf8');
vm.runInContext(code, dom.getInternalVMContext(), { filename: 'sticker.js' });
await tick(30);

const doc = window.document;
const diag = window.__MUSIC_STICKER__;
check('脚本载入并暴露诊断', Boolean(diag) && diag.mounted === true, JSON.stringify(diag && diag.lastError));
check('右下角有 😀 悬浮球', Boolean(doc.querySelector('.sk-ball')));
check('面板默认是关的', !doc.querySelector('.sk-root').classList.contains('sk-open'));

// Alt+E 打开
doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'e', altKey: true, bubbles: true }));
await tick(30);
check('Alt+E 打开面板', doc.querySelector('.sk-root').classList.contains('sk-open'));

// 搜索
doc.querySelector('[data-sk=kw]').value = '猫';
doc.querySelector('[data-sk=search]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick(80);
check('搜索打到了中转', fetchCount >= 1);
const items = doc.querySelectorAll('.sk-item');
check('结果渲染成图块', items.length === 1, String(items.length));

// 点一下发出去
items[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick(30);
const msg = String(sent.slice(-1)[0] || '');
check('发出的是图片消息（…#e）', msg.includes('#e') && msg.includes('sticker/img'), msg.slice(0, 110));

// 限速
const before = sent.length;
const items2 = doc.querySelectorAll('.sk-item');
items2[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick(30);
check('2 秒内连点被限速', sent.length === before, 'new=' + (sent.length - before));

// 收藏
let favs = [];
try {
  favs = JSON.parse(window.localStorage.getItem('mk_stickers') || '[]');
} catch {
  favs = [];
}
check('发过的自动进收藏', favs.length === 1 && String(favs[0].send).includes('sticker/img'), JSON.stringify(favs).slice(0, 80));
check('收藏区渲染出来了', /收藏（1）/.test(doc.querySelector('[data-sk=body]').textContent));

// 关掉
doc.querySelector('[data-sk=close]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick(30);
check('✕ 能关掉面板', !doc.querySelector('.sk-root').classList.contains('sk-open'));

console.log('');
if (failures.length) {
  console.log('结果：' + failures.length + ' 项失败 -> ' + failures.join(' / '));
  process.exit(1);
}
console.log('结果：全部通过');
process.exit(0);
