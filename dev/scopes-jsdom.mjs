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
check('手机上不是整屏（底部抽屉）', css.includes('74dvh') && css.includes('border-radius:18px 18px 0 0'));
check('有设置页样式', css.includes('.mk-set') && css.includes('.mk-sw'));
check('有搜索范围样式', css.includes('.mk-scope'));
check('有歌单/用户行样式', css.includes('.mk-entity'));

// ---- 设置页：入口开关互斥 + 外观 ----
rootEl.querySelector('[data-act=settings]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick();
check('打开设置页', Boolean(rootEl.querySelector('.mk-set')));
check('有 4 个开关（悬浮球/双指/毛玻璃/紧凑）', rootEl.querySelectorAll('.mk-sw').length === 4, String(rootEl.querySelectorAll('.mk-sw').length));

rootEl.querySelector('[data-set=ball]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick();
const savedSettings = JSON.parse(window.localStorage.getItem('mk_panel_settings') || '{}');
check('关悬浮球后写进 localStorage', savedSettings.ball === false, JSON.stringify(savedSettings));
check('关掉悬浮球时自动打开双指上滑', savedSettings.gesture === true, JSON.stringify(savedSettings));

rootEl.querySelectorAll('[data-set-group]')[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true })); // 浅色
await tick();
check('切浅色后 root 带 data-theme=light', rootEl.getAttribute('data-theme') === 'light', String(rootEl.getAttribute('data-theme')));

const accentBtn = Array.from(rootEl.querySelectorAll('[data-set-group]')).find((b) => b.dataset.setValue === 'violet');
accentBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick();
check('切强调色后 root 带 data-accent=violet', rootEl.getAttribute('data-accent') === 'violet', String(rootEl.getAttribute('data-accent')));

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
