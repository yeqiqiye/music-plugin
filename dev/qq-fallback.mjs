/**
 * QQ 放不出来时自动换网易云 + 面板里填 Cookie。
 *
 * 用法：node dev/qq-fallback.mjs
 * 两段：① 中转侧认 x-qq-cookie 请求头；② 面板侧 vip → 找网易云同名曲 → 换过去播。
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const check = (label, cond, extra = '') => {
  console.log((cond ? '  ok   ' : '  FAIL ') + label + (extra ? '  ' + extra : ''));
  if (!cond) process.exitCode = 1;
};
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

/* ---------------- ① 中转：认 x-qq-cookie ---------------- */
{
  const { worker } = await import('../relay/worker.js');
  const realFetch = globalThis.fetch;
  const seen = [];

  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('musicu.fcg')) {
      seen.push(String((init.headers && (init.headers.cookie || init.headers.Cookie)) || ''));
      return new Response(
        JSON.stringify({
          req_0: { code: 0, data: { sip: ['http://aqqmusic.tc.qq.com/'], midurlinfo: [{ result: 0, purl: 'M800x.m4a?vkey=1' }] } },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(null, { status: 206, headers: { 'content-length': '10' } });
  };

  const call = (id, cookie) =>
    worker.fetch(
      new Request('https://relay.test/playurl?platform=qq&id=' + id + '&level=standard', {
        headers: cookie ? { 'x-qq-cookie': cookie } : {},
      }),
      { QQ_COOKIE: 'env-from-cloud', QQ_UIN: '1' },
    );

  const r1 = await call('idHdr001', 'uin=42; qm_keyst=from-panel');
  const body1 = await r1.json();
  check('请求头里的 Cookie 被用作上游 Cookie', seen.some((c) => c.includes('from-panel')), JSON.stringify(seen));
  check('仍然给出可播地址', body1.ok === true && Boolean(body1.data && body1.data.streamUrl), JSON.stringify(body1).slice(0, 120));

  seen.length = 0;
  const r2 = await call('idHdr002', 'uin=7; qm_keyst=other-user');
  await r2.json();
  check('换个 Cookie 走的是它自己的上游', seen.some((c) => c.includes('other-user')), JSON.stringify(seen));

  // 同一首歌、不同 Cookie：不能命中别人的缓存
  const a = await (await call('idHdr003', 'uin=1; qm_keyst=aaaa1111')).json();
  const b = await (await call('idHdr003', 'uin=2; qm_keyst=bbbb2222')).json();
  check('不同 Cookie 不共用 playCache', b.ok === true && b.cached !== true, JSON.stringify(b).slice(0, 120));
  check('同 Cookie 第二次才命中缓存', a.ok === true && a.cached !== true, JSON.stringify(a).slice(0, 120));

  globalThis.fetch = realFetch;
}

/* ---------------- ② 面板：vip → 换网易云 ---------------- */
let JSDOM;
try {
  ({ JSDOM } = await import('jsdom'));
} catch {
  console.error('缺少 jsdom：先跑 npm install（jsdom 已写进 devDependencies）');
  process.exit(1);
}

const src = readFileSync(join(root, 'client', 'panel-ui.js'), 'utf8');
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  runScripts: 'outside-only',
  url: 'https://iirose.com/',
});
const { window } = dom;
// jsdom 没实现媒体播放：本地试听分支会调 load()/play()，补成空实现（否则刷一屏 "Not implemented"）
window.HTMLMediaElement.prototype.load = function () {};
window.HTMLMediaElement.prototype.play = function () {
  return Promise.resolve();
};
window.HTMLMediaElement.prototype.pause = function () {};
window.eval(src);

const qqSong = {
  platform: 'qq',
  id: '0039MnYb0qxYhV',
  title: '晴天',
  artists: ['周杰伦'],
  album: '叶惠美',
  durationMs: 269000,
  cover: '',
  vip: true,
  playable: true,
  url: 'https://y.qq.com/n/ryqq/songDetail/0039MnYb0qxYhV',
};
const twin = {
  platform: 'netease',
  id: '186016',
  title: '晴天',
  artists: ['周杰伦'],
  album: '叶惠美',
  durationMs: 269000,
  cover: '',
  vip: false,
  playable: true,
  url: 'https://music.163.com/song?id=186016',
};

const calls = [];
let qqWorks = false;
let neteaseWorks = true;
const api = {
  platforms: () => Promise.resolve([{ id: 'netease', label: '网易云音乐' }, { id: 'qq', label: 'QQ 音乐' }]),
  search: (o) => {
    calls.push({ kind: 'search', ...o });
    if (o.type === 'playlist' || o.type === 'user') return Promise.resolve([]);
    if (o.platform === 'netease') return Promise.resolve([twin]);
    return Promise.resolve([qqSong]);
  },
  playlist: () => Promise.resolve({ playlist: {}, songs: [] }),
  userPlaylists: () => Promise.resolve([]),
  playurl: (o) => {
    calls.push({ kind: 'playurl', ...o });
    if (o.platform === 'qq') {
      return qqWorks
        ? Promise.resolve({ playable: true, streamUrl: 'https://ws.stream.qqmusic.qq.com/q.m4a', ext: 'm4a' })
        : Promise.resolve({ playable: false, reason: 'vip', note: 'QQ 音乐没给地址' });
    }
    return neteaseWorks
      ? Promise.resolve({ playable: true, streamUrl: 'https://m7.music.126.net/n.mp3', ext: 'mp3' })
      : Promise.resolve({ playable: false, reason: 'no-url', note: '有 Cookie 仍拿不到' });
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
  scopes: [{ id: 'song', label: '歌曲' }],
});
await tick();
const rootEl = host.querySelector('.mk-root');

// 搜一首 QQ 的歌并点播
rootEl.querySelectorAll('.mk-tab')[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick();
rootEl.querySelector('[data-el=kw]').value = '晴天';
rootEl.querySelector('[data-act=search]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick(80);

const rows = rootEl.querySelectorAll('.mk-song');
check('搜出 QQ 结果', rows.length === 1, String(rows.length));

rootEl.querySelector('[data-play]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick(120);

const playCalls = calls.filter((c) => c.kind === 'playurl');
check('先按 QQ 解析过一次', playCalls[0] && playCalls[0].platform === 'qq', JSON.stringify(playCalls[0] || {}));
check('QQ 不可播后搜了网易云同名曲', calls.some((c) => c.kind === 'search' && c.platform === 'netease' && /晴天/.test(c.keyword || '')));
check('换到网易云又解析一次', playCalls.some((c) => c.platform === 'netease'), JSON.stringify(playCalls.map((c) => c.platform)));
check('QQ 失效后 tab 亮红点', Boolean(rootEl.querySelector('.mk-tab.mk-warn')));
const statText = (rootEl.querySelector('.mk-stat') || {}).textContent || '';
check('状态栏说明已换成网易云', /网易云/.test(statText), statText);

// 设置里填 Cookie：保存后解析会带上 qqCookie
rootEl.querySelector('[data-act=settings]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick(60);
const input = rootEl.querySelector('[data-el=qq-cookie]');
check('设置里有 Cookie 输入框', Boolean(input));
if (input) {
  input.value = 'uin=3819559168; qm_keyst=abc123';
  rootEl.querySelector('[data-act=qq-save]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(60);
  const saved = JSON.parse(window.localStorage.getItem('mk_panel_settings') || '{}');
  check('Cookie 存进本机设置', /qm_keyst=abc123/.test(String(saved.qqCookie || '')), String(saved.qqCookie || '').slice(0, 40));

  rootEl.querySelector('[data-act=settings-done]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(40);
  rootEl.querySelector('[data-act=search]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(80);
  qqWorks = true;
  rootEl.querySelector('[data-play]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(120);
  const lastQq = calls.filter((c) => c.kind === 'playurl' && c.platform === 'qq').pop();
  check('解析请求带上了面板里的 Cookie', Boolean(lastQq) && /qm_keyst=abc123/.test(String(lastQq.qqCookie || '')), JSON.stringify(lastQq || {}).slice(0, 120));
  check('Cookie 有效时不再换源', !calls.filter((c) => c.kind === 'playurl').slice(-1).some((c) => c.platform === 'netease'));
}

// ---------- 网易云 Cookie：存 / 检查 / 红点 ----------
rootEl.querySelector('[data-act=settings]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick(60);
const netInput = rootEl.querySelector('[data-el=netease-cookie]');
check('设置里有网易云 Cookie 输入框', Boolean(netInput));
if (netInput) {
  netInput.value = 'MUSIC_U=00B5F1; __csrf=9ff2';
  rootEl.querySelector('[data-act=netease-save]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(60);
  const saved = JSON.parse(window.localStorage.getItem('mk_panel_settings') || '{}');
  check('网易云 Cookie 存进本机设置', /MUSIC_U=00B5F1/.test(String(saved.neteaseCookie || '')), String(saved.neteaseCookie || '').slice(0, 30));
  check(
    '网易云徽章显示已设置',
    /已设置/.test(String((rootEl.querySelector('[data-el=netease-state]') || {}).textContent || '')),
    String((rootEl.querySelector('[data-el=netease-state]') || {}).textContent || ''),
  );

  neteaseWorks = false;
  rootEl.querySelector('[data-act=netease-check]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(150);
  const warnTabs = Array.from(rootEl.querySelectorAll('.mk-tab.mk-warn')).map((b) => b.textContent);
  check('网易云检查失败后 tab 亮红点', warnTabs.some((t) => /网易云/.test(t)), JSON.stringify(warnTabs));
  check(
    '检查请求带上了面板里的网易云 Cookie',
    calls.filter((c) => c.kind === 'playurl' && c.platform === 'netease').some((c) => /MUSIC_U=00B5F1/.test(String(c.neteaseCookie || ''))),
  );

  neteaseWorks = true;
  rootEl.querySelector('[data-act=netease-check]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(150);
  const warnAfter = Array.from(rootEl.querySelectorAll('.mk-tab.mk-warn')).map((b) => b.textContent);
  check('网易云检查通过后红点消失', !warnAfter.some((t) => /网易云/.test(t)), JSON.stringify(warnAfter));

  rootEl.querySelector('[data-act=netease-clear]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(60);
  const cleared = JSON.parse(window.localStorage.getItem('mk_panel_settings') || '{}');
  check('网易云 Cookie 能清空', !cleared.neteaseCookie, String(cleared.neteaseCookie || ''));
}

if (panel && panel.dispose) panel.dispose();
console.log(process.exitCode ? '结果：有失败' : 'QQ 兜底测试通过');
