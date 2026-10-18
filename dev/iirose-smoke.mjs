/**
 * IIROSE 版点歌台的离线冒烟：在 jsdom 里跑真正的 iirose/music-iirose.js。
 *
 * 覆盖：载入幂等 → 挂载 → Alt+T 开关 → 搜索归一化 → 点 ▶ 发出的两帧（逐字段断言）
 *      → &1 事件回填「房间正在播放」→ 切到本机试听不再发帧 → 复制兜底指令。
 *
 * 用法：node dev/iirose-smoke.mjs（没装 jsdom 会自跳过，CI 里会临时装一份真跑）
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
  console.log('跳过：没装 jsdom（可选依赖）。CI 里会装上跑，本地想跑就 npm i -D jsdom。');
  process.exit(0);
}

const failures = [];
const check = (label, cond, extra = '') => {
  console.log((cond ? '  ok   ' : '  FAIL ') + label + (extra ? '  ' + extra : ''));
  if (!cond) failures.push(label);
};
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));

// ---------------- 假房间：socket 收帧，fetch 回夹具 ----------------
const sent = [];
const requested = [];

const song = (id, name, album, dt, fee, cover) => ({
  id,
  name,
  ar: [{ name: '周杰伦' }],
  al: { name: album, picUrl: cover },
  dt,
  fee,
});
const SEARCH_FIXTURE = {
  result: {
    songs: [song(1901371647, '晴天', '叶惠美', 278961, 8, 'http://p3.music.126.net/cover-abc.jpg')].concat(
      // 凑满 20 条：翻页按钮的「下一页」是按「本页条数 >= limit」判活的
      Array.from({ length: 19 }, (_, i) => song(3000000000 + i, '歌' + (i + 1), '专辑', 200000, 0, '')),
    ),
  },
};
// 第 2 页给一批完全不同的歌，用来证明 offset 真的生效了
const SEARCH_PAGE2 = {
  result: {
    songs: [
      song(2000000001, '七里香', '七里香', 299000, 1, ''),
      song(2000000002, '夜曲', '十一月的萧邦', 250000, 1, ''),
      song(2000000003, '龙卷风', 'Jay', 240000, 0, ''),
    ],
  },
};
const URL_FIXTURE = {
  data: [{ id: 1901371647, url: 'http://m702.music.126.net/x/y/track.mp3', br: 128012, size: 481115, type: 'mp3', expi: 1200 }],
};

// 中转（酷狗）的夹具
const KUGOU_SONG = {
  platform: 'kugou',
  id: '48C685F679FFC7CF08B8A8341CA9DB44',
  title: '晴天',
  artists: ['蓝心羽'],
  album: '网瘾少女叽',
  durationMs: 176000,
  cover: '',
  vip: false,
  playable: true,
  url: 'https://www.kugou.com/mixsong/abc.html',
};

/** 163 原始形状 → 中转返回的 Song 形状（两份 fixture 共用一套数据） */
function toSongs(fixture) {
  return (fixture.result.songs || []).map((s) => ({
    platform: 'netease',
    id: String(s.id),
    title: s.name,
    artists: (s.ar || []).map((a) => a.name),
    album: s.al?.name || '',
    durationMs: s.dt || null,
    cover: s.al?.picUrl || '',
    vip: s.fee === 1 || s.fee === 4,
    playable: true,
    url: 'https://music.163.com/song?id=' + s.id,
  }));
}

function route(url) {
  requested.push(String(url));
  const u = String(url);
  if (u.includes('relay.example.com/search')) {
    const q = new URL(u).searchParams;
    if (q.get('platform') === 'netease') {
      return { ok: true, data: toSongs(q.get('page') === '2' ? SEARCH_PAGE2 : SEARCH_FIXTURE) };
    }
    return { ok: true, data: [KUGOU_SONG] };
  }
  if (u.includes('relay.example.com/playurl')) {
    const q = new URL(u).searchParams;
    if (q.get('platform') === 'netease') {
      return {
        ok: true,
        data: { playable: true, streamUrl: 'https://m702.music.126.net/x/y/track.mp3', ext: 'mp3', bitrate: 128012 },
      };
    }
    return {
      ok: true,
      data: { playable: true, streamUrl: 'https://sharefs.kugou.com/x/track.mp3', ext: 'mp3', bitrate: 128000 },
    };
  }
  if (u.includes('/cloudsearch')) {
    return u.includes('offset=20') ? SEARCH_PAGE2 : SEARCH_FIXTURE;
  }
  if (u.includes('/song/url')) return URL_FIXTURE;
  throw new Error('测试里没预料到的请求：' + url);
}

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
  // 必须用 dangerously：脚本是「自己内联一个 <script> 到 head」来装面板的，
  // outside-only 模式下 jsdom 不会执行它（真实浏览器会）。测试页面本身没有任何外部脚本。
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'https://iirose.com/',
});
const { window } = dom;

window.fetch = async (url) => ({
  ok: true,
  status: 200,
  json: async () => route(url),
});

// 假房间连接：IIROSE 里就是 window.socket / window.uid
window.socket = {
  send(frame) {
    sent.push(frame);
  },
  onmessage: null,
};
window.uid = '688829143194';
window.inputcolorhex = '#ff9800';

let clipboardText = null;
Object.defineProperty(window.navigator, 'clipboard', {
  value: {
    writeText: async (t) => {
      clipboardText = t;
    },
  },
  configurable: true,
});

// 先配好中转，面板才会列出酷狗 / B 站
window.localStorage.setItem('mk_iirose_relay', 'https://relay.example.com');

const code = readFileSync(join(root, 'iirose', 'music-iirose.js'), 'utf8');
const run = () => vm.runInContext(code, dom.getInternalVMContext(), { filename: 'music-iirose.js' });

// ---------------- 1. 载入 + 幂等 ----------------
run();
await tick(20);
const diag = window.__MUSIC_IIROSE__;
check('脚本载入后暴露诊断对象', Boolean(diag));
check('挂载成功（mounted）', Boolean(diag && diag.mounted), JSON.stringify(diag && diag.state));
check('认出了房间连接', Boolean(diag && diag.socketOk));
check('面板节点只有一个', window.document.querySelectorAll('.mk-root').length === 1);

run(); // 再跑一遍：模拟「脚本列表里贴了两遍」
await tick(20);
check('重复注入不会挂第二套', window.document.querySelectorAll('.mk-root').length === 1);

const panelEl = window.document.querySelector('.mk-root');
check('悬浮球已注入', Boolean(window.document.querySelector('.mk-iirose-ball')));

// ---------------- 2. Alt+T ----------------
const keydown = (init) =>
  window.document.dispatchEvent(
    new window.KeyboardEvent('keydown', Object.assign({ bubbles: true, code: 'KeyT', key: 't' }, init)),
  );

keydown({ altKey: true });
await tick();
check('Alt+T 打开面板', panelEl.classList.contains('mk-open'));
keydown({}); // 不带 Alt：不该有反应
await tick();
check('不带 Alt 的 T 不影响面板', panelEl.classList.contains('mk-open'));
keydown({ altKey: true });
await tick();
check('Alt+T 再按一次关闭', !panelEl.classList.contains('mk-open'));
panelEl.classList.add('mk-open'); // 后续用例直接在打开状态跑

// ---------------- 3. 搜索 ----------------
panelEl.querySelector('[data-el=kw]').value = '晴天';
panelEl.querySelector('[data-act=search]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick(60);

const rows = panelEl.querySelectorAll('.mk-song');
check('搜索后渲染 20 行结果', rows.length === 20, String(rows.length));
check('网易云搜索打到了中转', requested.some((u) => u.includes('relay.example.com/search') && u.includes('platform=netease')), requested[0] || '');
check('VIP 标记（fee=8 不算 VIP）出现「可听」', panelEl.innerHTML.includes('可听'));

// ---------------- 4. 点 ▶ 发出的两帧 ----------------
panelEl.querySelector('[data-play]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick(60);

check('点 ▶ 发出 2 帧', sent.length === 2, 'got ' + sent.length);
const mediaFrame = sent[0] || '';
const cardFrame = sent[1] || '';
check('第一帧是 &1 媒体数据', mediaFrame.startsWith('&1{'));

let media = null;
try {
  media = JSON.parse(mediaFrame.slice(2));
} catch {
  media = null;
}
check('媒体帧是合法 JSON', Boolean(media), mediaFrame.slice(0, 80));
if (media) {
  check('s 去掉了 http 前缀（https → s://）', media.s === 's://m702.music.126.net/x/y/track.mp3', media.s);
  check('d 是秒（278961ms → 279）', media.d === 279, String(media.d));
  check('c 是封面且升级到 https', media.c === 's://p3.music.126.net/cover-abc.jpg', String(media.c));
  check('n 是歌名', media.n === '晴天', String(media.n));
  check('r 是歌手', media.r === '周杰伦', String(media.r));
  check('b 标成网易云（@0）', media.b === '@0', String(media.b));
  check('o 是歌曲页链接', media.o === 's://music.163.com/song?id=1901371647', String(media.o));
  check('l 是 null（不带歌词）', media.l === null, JSON.stringify(media.l));
}

let card = null;
try {
  card = JSON.parse(cardFrame);
} catch {
  card = null;
}
check('第二帧是卡片 JSON', Boolean(card), cardFrame.slice(0, 80));
if (card) {
  check('卡片以 m__4@0> 开头', String(card.m).startsWith('m__4@0>'), String(card.m).slice(0, 24));
  check('卡片字段顺序：标题>歌手>封面>颜色>码率', card.m === 'm__4@0>晴天>周杰伦>https:&#x2F;&#x2F;p3.music.126.net&#x2F;cover-abc.jpg>#ff9800>128', card.m);
  check('mc 是颜色', card.mc === '#ff9800', card.mc);
  check('i 是消息 id', /^\d{12}$/.test(String(card.i)), String(card.i));
  check('g 带上了 uid', card.g === '688829143194', String(card.g));
}
check('帧计数被记录', diag && diag.framesSent === 2, String(diag && diag.framesSent));

// ---------------- 5. 房间播放事件回填 ----------------
window.socket.onmessage({ data: '&1{"s":"s://m1.mp3","d":3,"c":"","n":"晴天","r":"@0周杰伦","b":"@0","o":"","l":null}' });
await tick();
const nowText = panelEl.querySelector('[data-el=now]').textContent;
check('&1 事件把「房间正在播放」写回面板', nowText.includes('房间：晴天'), nowText);
check('诊断里记下了当前曲', String(diag.roomNow || '').includes('晴天'), String(diag.roomNow));

// ---------------- 6. 切到「仅本机试听」 ----------------
panelEl.querySelector('[data-act=mode]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick();
const modeText = panelEl.querySelector('[data-act=mode]').textContent;
check('模式按钮切到「仅本机试听」', modeText.includes('仅本机试听'), modeText);

const before = sent.length;
panelEl.querySelector('[data-play]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick(60);
check('试听模式不再往房间发帧', sent.length === before, 'new frames: ' + (sent.length - before));
const audio = window.document.querySelector('[data-el=audio]');
check('试听模式把 https 直链给了 <audio>', String(audio.src).includes('https://m702.music.126.net'), String(audio.src));

// ---------------- 7. 复制兜底指令 ----------------
panelEl.querySelector('[data-directive]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick(20);
check('「指令」按钮复制到剪贴板', clipboardText === '@@晴天 周杰伦', String(clipboardText));

// ---------------- 8. 翻页 ----------------
panelEl.querySelector('[data-act=search]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick(60);
const pager = panelEl.querySelector('[data-el=pager]');
check('结果出来后出现翻页条', pager.classList.contains('mk-on'));
check('第 1 页的「上一页」是禁用的', pager.querySelector('[data-page="0"]').disabled === true);

pager.querySelector('[data-page="2"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick(60);
check('翻页请求带上了 page=2', requested.some((u) => u.includes('relay.example.com/search') && u.includes('page=2')));
check('第 2 页渲染了另一批歌（七里香）', panelEl.innerHTML.includes('七里香'));
const statText = panelEl.querySelector('[data-el=stat]').textContent;
check('状态栏显示「第 2 页」', /第 2 页/.test(statText), statText);
check('只剩 3 条时「下一页」禁用', panelEl.querySelector('[data-el=pager] [data-page="3"]').disabled === true);

// ---------------- 9. 配了中转之后：酷狗 ----------------
check('中转地址进了诊断', String(diag.relay || '').includes('relay.example.com'), String(diag.relay));
const tabCount = panelEl.querySelectorAll('.mk-tab').length;
check('平台 tab 变成 4 个（网易云 + 酷狗 + B 站 + QQ）', tabCount === 4, String(tabCount));

// 切回「点播到房间」再试
panelEl.querySelector('[data-act=mode]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick();
panelEl.querySelectorAll('.mk-tab')[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick(80);
check(
  '酷狗搜索打到了中转',
  requested.some((u) => u.includes('relay.example.com/search') && u.includes('platform=kugou')),
  requested.filter((u) => u.includes('relay')).slice(-1)[0] || '',
);

const framesBefore = sent.length;
panelEl.querySelector('[data-play]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick(80);
check('酷狗点播也发 2 帧', sent.length === framesBefore + 2, String(sent.length - framesBefore));

let kgMedia = null;
try {
  kgMedia = JSON.parse(String(sent[framesBefore]).slice(2));
} catch {
  kgMedia = null;
}
check('酷狗媒体帧 b=@4', kgMedia && kgMedia.b === '@4', kgMedia && String(kgMedia.b));
check('酷狗音频来自中转给的地址', kgMedia && String(kgMedia.s).includes('sharefs.kugou.com'), kgMedia && String(kgMedia.s));

let kgCard = null;
try {
  kgCard = JSON.parse(String(sent[framesBefore + 1]));
} catch {
  kgCard = null;
}
check('酷狗卡片以 m__4@4> 开头', kgCard && String(kgCard.m).startsWith('m__4@4>'), kgCard && String(kgCard.m).slice(0, 22));

// ---------------- 10. 没配中转时：右下角 ⚙ 配置入口（不用 F12） ----------------
{
  const dom2 = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://iirose.com/',
  });
  const w2 = dom2.window;
  w2.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, data: [] }) });
  w2.socket = { send() {}, onmessage: null };
  w2.uid = '1';
  vm.runInContext(code, dom2.getInternalVMContext(), { filename: 'music-iirose.js' });
  await tick(20);
  const gear = w2.document.querySelector('.mk-iirose-gear');
  check('没配中转时出现 ⚙ 配置按钮', Boolean(gear));
  if (gear) {
    gear.dispatchEvent(new w2.MouseEvent('click', { bubbles: true }));
    await tick(20);
    check('点 ⚙ 弹出配置表单', Boolean(w2.document.querySelector('[data-mk-setup] [data-mk-input]')));
  }
  check('没配中转时不会渲染酷狗 tab', w2.document.querySelectorAll('.mk-tab').length === 1);
}

console.log('');
if (failures.length) {
  console.log('结果：' + failures.length + ' 项失败 -> ' + failures.join(' / '));
  process.exit(1);
}
console.log('结果：全部通过');
