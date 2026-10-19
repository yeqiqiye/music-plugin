/**
 * 面板新功能：搜用户 / 搜歌单 / 歌单详情 / 批量入队 / 移动端样式。
 *
 * 用法：node dev/scopes-jsdom.mjs
 * 没装 jsdom 会跳过（CI 里会装）。
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
  console.log('跳过：没装 jsdom（可选依赖）。npm i -D jsdom 后可以本地跑。');
  process.exit(0);
}

const failures = [];
const check = (label, cond, extra = '') => {
  console.log((cond ? '  ok   ' : '  FAIL ') + label + (extra ? '  ' + extra : ''));
  if (!cond) failures.push(label);
};
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

const src = readFileSync(join(root, 'client', 'panel-ui.js'), 'utf8');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only', url: 'https://iirose.com/' });
const { window } = dom;
window.eval(src);

const SONG = (id, title) => ({
  platform: 'netease',
  id: String(id),
  title,
  artists: ['周杰伦'],
  album: '叶惠美',
  durationMs: 269000,
  cover: '',
  vip: true,
  playable: true,
  url: 'https://music.163.com/song?id=' + id,
});

const calls = [];
const played = [];
const api = {
  platforms: () => Promise.resolve([{ id: 'netease', label: '网易云音乐' }]),
  search: (o) => {
    calls.push(o);
    if (o.type === 'playlist') {
      return Promise.resolve([
        { platform: 'netease', id: '6792103822', name: '周杰伦精选', cover: '', trackCount: 143, creator: 'Buradarrr', playCount: 120000 },
        { platform: 'netease', id: '17745261207', name: '周杰伦歌单', cover: '', trackCount: 29, creator: '双鱼不困', playCount: 3000 },
      ]);
    }
    if (o.type === 'user') {
      return Promise.resolve([{ platform: 'netease', id: '1356470103', name: '次元晴天', avatar: '', followers: 18240, signature: '听歌' }]);
    }
    return Promise.resolve([SONG(1, '晴天'), SONG(2, '七里香')]);
  },
  playlist: (o) => {
    calls.push({ playlist: o });
    return Promise.resolve({
      playlist: { platform: 'netease', id: o.id, name: '周杰伦精选', cover: '', trackCount: 2, creator: 'Buradarrr' },
      songs: [SONG(11, '晴天'), SONG(12, '夜曲')],
    });
  },
  userPlaylists: () => Promise.resolve([{ platform: 'netease', id: '1', name: 'TA 的歌单', trackCount: 3 }]),
  playurl: (o) => {
    played.push(o);
    return Promise.resolve({ playable: true, streamUrl: 'https://example.com/a.mp3', ext: 'mp3' });
  },
  session: () => Promise.resolve({ loggedIn: false }),
  login: () => Promise.resolve({ loggedIn: false }),
  logout: () => Promise.resolve({ loggedIn: false }),
};

const host = window.document.createElement('div');
window.document.body.appendChild(host);
const panel = window.mountMusicPanel(host, {
  api,
  openOnMount: true,
  version: 'test',
  hideLogin: true,
  scopes: [
    { id: 'song', label: '歌曲' },
    { id: 'user', label: '用户' },
    { id: 'playlist', label: '歌单' },
  ],
});
await tick();

const rootEl = host.querySelector('.mk-root');
check('面板已打开', rootEl.classList.contains('mk-open'));
check('渲染出 3 个搜索范围', rootEl.querySelectorAll('.mk-scope').length === 3);
check('默认在「歌曲」', rootEl.querySelector('.mk-scope').classList.contains('mk-on'));

// ---- 切到歌单并搜索 ----
rootEl.querySelector('[data-el=kw]').value = '周杰伦';
rootEl.querySelectorAll('.mk-scope')[2].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick();
const lastSearch = calls.filter((c) => c && c.type).pop();
check('切歌单后带 type=playlist 搜索', Boolean(lastSearch) && lastSearch.type === 'playlist', JSON.stringify(lastSearch));
await tick();
check('渲染出歌单行', rootEl.querySelectorAll('.mk-entity').length === 2);
check('歌单行有曲目数', /143 首/.test(rootEl.querySelector('.mk-entity').textContent));

// ---- 打开歌单 ----
rootEl.querySelector('.mk-entity').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick(60);
check('调用了 api.playlist', calls.some((c) => c && c.playlist));
check('出现歌单头', Boolean(rootEl.querySelector('.mk-detail-head')));
check('歌单头有「全部入队」', /全部入队/.test(rootEl.querySelector('.mk-detail-head').textContent));
check('歌单里渲染出 2 首歌', rootEl.querySelectorAll('.mk-song').length === 2);
check('每行都有封面位（没有封面就显示占位）', rootEl.querySelectorAll('.mk-song .mk-cover').length === 2);
check('不再有 10/20/30 条选择器', !rootEl.querySelector('[data-el=limit]'));

// ---- 批量入队 ----
rootEl.querySelector('[data-act=batch]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick();
check('批量入队提示 2 首', /已加入队列 2 首/.test(rootEl.querySelector('[data-el=stat]').textContent), rootEl.querySelector('[data-el=stat]').textContent);

// ---- 返回 ----
rootEl.querySelector('[data-act=back]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick();
check('返回后回到歌单列表', rootEl.querySelectorAll('.mk-entity').length === 2);

// ---- 搜用户 → 用户歌单 ----
rootEl.querySelectorAll('.mk-scope')[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick();
check('切用户后带 type=user 搜索', (calls.filter((c) => c && c.type).pop() || {}).type === 'user');
check('渲染出用户行', rootEl.querySelectorAll('.mk-entity').length === 1);
rootEl.querySelector('.mk-entity').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick(60);
check('用户详情里是歌单行', rootEl.querySelectorAll('.mk-entity').length === 1 && /歌单/.test(rootEl.querySelector('.mk-entity').textContent));

// ---- 移动端样式 ----
const css = window.document.querySelector('style[data-music-panel]').textContent;
check('有 <=640px 的媒体查询', css.includes('@media (max-width:640px)'));
check('手机上不再整块隐藏操作按钮', !/\.mk-acts\{display:none\}/.test(css));
check('手机上只隐藏次要链接', /\.mk-acts a\{display:none\}/.test(css));
check('手机上不是底部抽屉（居中窗口）', !/\.mk-root\{align-items:flex-end\}/.test(css) && css.includes('width:min(94vw,560px)'));
check('手机上面板可拖动（标题栏 cursor:move + touch-action）', /\.mk-head\{[^}]*cursor:move/.test(css) && css.includes('touch-action:none'));
check('毛玻璃开关已去掉', !css.includes('mk-glass'));
check('有设置页样式', css.includes('.mk-set') && css.includes('.mk-sw'));
check('有搜索范围样式', css.includes('.mk-scope'));
check('有歌单/用户行样式', css.includes('.mk-entity'));

// ---- 浅色主题：配色必须是 token，不能留深色写死值 ----
check('深色 token 齐全', ['--mk-hover', '--mk-raised', '--mk-bar', '--mk-on-bg', '--mk-err-bg'].every((t) => css.includes(t + ':')));
check('浅色块覆盖了悬停色', /\.mk-root\[data-theme=light\]\{[\s\S]*?--mk-hover:#eef3fa/.test(css));
check('浅色块覆盖了播放条', /\.mk-root\[data-theme=light\]\{[\s\S]*?--mk-bar:#eef3fa/.test(css));
check('浅色块覆盖了选中态', /\.mk-root\[data-theme=light\]\{[\s\S]*?--mk-on-bg:#e2edfa/.test(css));
check('原生控件跟随主题（color-scheme）', css.includes('color-scheme:dark') && css.includes('color-scheme:light'));
check('chip 选中态不再用白字', /\.mk-chip\.mk-on\{[^}]*var\(--mk-on-fg\)/.test(css));
check('浅色强调色单独给值', css.includes('.mk-root[data-theme=light][data-accent=blue]'));
check('有背景图样式', css.includes('.mk-bgimg') && css.includes('--mk-veil'));

// ---- 设置页：入口开关互斥 + 外观 + 背景 ----
rootEl.querySelector('[data-act=settings]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick();
check('打开设置页', Boolean(rootEl.querySelector('.mk-set')));
const switchNames = Array.from(rootEl.querySelectorAll('.mk-sw')).map((b) => b.dataset.set);
check(
  '开关是 悬浮球/双指/点歌卡片/紧凑/背景模糊（毛玻璃已去掉）',
  ['ball', 'gesture', 'card', 'compact', 'bgBlur'].every((n) => switchNames.includes(n)) && !switchNames.includes('glass'),
  switchNames.join(','),
);

// 关掉「发送点播卡片」：写进设置，宿主发帧时读它
rootEl.querySelector('[data-set=card]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick();
const noCard = JSON.parse(window.localStorage.getItem('mk_panel_settings') || '{}');
check('关掉点播卡片后 card=false', noCard.card === false, JSON.stringify(noCard));
rootEl.querySelector('[data-set=card]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick();

rootEl.querySelector('[data-set=ball]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick();
const savedSettings = JSON.parse(window.localStorage.getItem('mk_panel_settings') || '{}');
check('关悬浮球后写进 localStorage', savedSettings.ball === false, JSON.stringify(savedSettings));
check('关悬浮球不影响双指上滑', savedSettings.gesture === true, JSON.stringify(savedSettings));

// 只剩双指一个入口时，再想关双指：直接拒绝，不偷偷把球打开（这就是「关了又自己回来」的根源）
rootEl.querySelector('[data-set=gesture]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick();
const saved2 = JSON.parse(window.localStorage.getItem('mk_panel_settings') || '{}');
check('两个都关会被拒绝（gesture 仍为 true）', saved2.gesture === true, JSON.stringify(saved2));
check('拒绝时不会偷偷把球打开', saved2.ball === false, JSON.stringify(saved2));
check(
  '拒绝时提示「至少留一个入口」',
  /至少留一个入口/.test(rootEl.querySelector('[data-el=stat]').textContent),
  rootEl.querySelector('[data-el=stat]').textContent,
);
check('拒绝后开关仍是「关」', rootEl.querySelector('[data-set=gesture]').getAttribute('aria-checked') === 'true');

// 反过来：球打开之后，关双指是允许的（球还留着）
rootEl.querySelector('[data-set=ball]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick();
rootEl.querySelector('[data-set=gesture]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick();
const saved3 = JSON.parse(window.localStorage.getItem('mk_panel_settings') || '{}');
check('球开着时关双指能成功', saved3.gesture === false && saved3.ball === true, JSON.stringify(saved3));
rootEl.querySelector('[data-set=gesture]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick();

// ---- 手机端拖动面板：按住标题栏移位 ----
const cardEl = rootEl.querySelector('.mk-card');
check('有卡片节点', Boolean(cardEl));
const usePointer = Boolean(window.PointerEvent);
const drag = (target, type, x, y) => {
  const ev = new window.Event(type, { bubbles: true, cancelable: true });
  const pts = type === 'touchend' || type === 'pointerup' ? [] : [{ clientX: x, clientY: y }];
  Object.defineProperty(ev, 'touches', { value: pts });
  Object.defineProperty(ev, 'clientX', { value: x });
  Object.defineProperty(ev, 'clientY', { value: y });
  Object.defineProperty(ev, 'pointerId', { value: 1 });
  target.dispatchEvent(ev);
};
const vw = window.innerWidth;
const vh = window.innerHeight;
window.innerWidth = 390;
window.innerHeight = 844;
const headEl = rootEl.querySelector('.mk-head');
const downType = usePointer ? 'pointerdown' : 'touchstart';
const moveType = usePointer ? 'pointermove' : 'touchmove';
const upType = usePointer ? 'pointerup' : 'touchend';
drag(headEl, downType, 200, 300);
drag(headEl, moveType, 240, 360);
drag(headEl, upType, 240, 360);
check('拖动后卡片带 translate', /translate\(40px,60px\)/.test(cardEl.style.transform || ''), cardEl.style.transform);
// 桌面上不该拖（窗口还原成宽屏后按标题栏移动无效）
const beforeDesktop = cardEl.style.transform;
window.innerWidth = 1280;
window.innerHeight = 900;
drag(headEl, downType, 100, 100);
drag(headEl, moveType, 180, 220);
drag(headEl, upType, 180, 220);
check('宽屏下拖不动', cardEl.style.transform === beforeDesktop, cardEl.style.transform);
window.innerWidth = vw;
window.innerHeight = vh;

const chipOf = (group, value) =>
  Array.from(rootEl.querySelectorAll('[data-set-group=' + group + ']')).find((b) => b.dataset.setValue === value);
check('主题有三档（跟随系统/深/浅）', ['auto', 'dark', 'light'].every((v) => Boolean(chipOf('theme', v))));

chipOf('theme', 'light').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick();
check('切浅色后 root 带 data-theme=light', rootEl.getAttribute('data-theme') === 'light', String(rootEl.getAttribute('data-theme')));
chipOf('theme', 'auto').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick();
check(
  '跟随系统会解析成 dark / light',
  ['dark', 'light'].includes(rootEl.getAttribute('data-theme')),
  String(rootEl.getAttribute('data-theme')),
);

chipOf('accent', 'violet').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick();
check('切强调色后 root 带 data-accent=violet', rootEl.getAttribute('data-accent') === 'violet', String(rootEl.getAttribute('data-accent')));

// ---- 自定义背景 ----
const bgUrl = rootEl.querySelector('[data-el=bg-url]');
check('背景输入框存在', Boolean(bgUrl));
bgUrl.value = 'https://example.com/cover.jpg';
rootEl.querySelector('[data-act=bg-apply]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick();
check('应用链接后 data-bg=1', rootEl.getAttribute('data-bg') === '1', String(rootEl.getAttribute('data-bg')));
check(
  'CSS 变量 --mk-bg-img 指向这张图',
  rootEl.style.getPropertyValue('--mk-bg-img').includes('https://example.com/cover.jpg'),
  rootEl.style.getPropertyValue('--mk-bg-img'),
);
check('背景写进 localStorage', JSON.parse(window.localStorage.getItem('mk_panel_settings')).bg === 'https://example.com/cover.jpg');
check('预览方块用上了这张图', (rootEl.querySelector('[data-el=bg-prev]').style.backgroundImage || '').includes('cover.jpg'));

// 遮罩
chipOf('bgDim', '0.72').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick();
check('遮罩选中「重」', JSON.parse(window.localStorage.getItem('mk_panel_settings')).bgDim === 0.72);
check('遮罩写成 --mk-veil', rootEl.style.getPropertyValue('--mk-veil') === '0.72', rootEl.style.getPropertyValue('--mk-veil'));

// 非法链接要被挡掉
rootEl.querySelector('[data-el=bg-url]').value = 'javascript:alert(1)';
rootEl.querySelector('[data-act=bg-apply]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick();
check('javascript: 链接被拒绝', JSON.parse(window.localStorage.getItem('mk_panel_settings')).bg === 'https://example.com/cover.jpg');
check('拒绝时有提示', /不支持/.test(rootEl.querySelector('[data-el=stat]').textContent), rootEl.querySelector('[data-el=stat]').textContent);

// 清除
rootEl.querySelector('[data-act=bg-clear]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick();
check('清除后 data-bg=0', rootEl.getAttribute('data-bg') === '0', String(rootEl.getAttribute('data-bg')));
check('清除后 localStorage 里 bg 为空', JSON.parse(window.localStorage.getItem('mk_panel_settings')).bg === '');

// ---- 外部改了设置（模拟悬浮球 ×）：面板要能同步 ----
window.localStorage.setItem(
  'mk_panel_settings',
  JSON.stringify(Object.assign({}, JSON.parse(window.localStorage.getItem('mk_panel_settings')), { ball: false, gesture: true })),
);
window.dispatchEvent(new window.CustomEvent('mk-settings', { detail: { settings: { ball: false, gesture: true }, source: 'x' } }));
await tick();
check('外部改了设置后面板开关跟着变', rootEl.querySelector('[data-set=ball]').getAttribute('aria-checked') === 'false');

rootEl.querySelector('[data-act=settings-done]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick();
check('完成后回到列表', Boolean(rootEl.querySelector('.mk-entity') || rootEl.querySelector('.mk-song') || rootEl.querySelector('.mk-empty')));

panel.dispose();
console.log('');
if (failures.length) {
  console.log('结果：' + failures.length + ' 项失败 -> ' + failures.join(' / '));
  process.exit(1);
}
console.log('结果：全部通过');
