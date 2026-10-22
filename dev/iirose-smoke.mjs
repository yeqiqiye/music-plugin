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

// 中转（QQ 音乐）的夹具
const QQ_SONG = {
  platform: 'qq',
  id: '0039MnYb0qxYhV',
  title: '晴天',
  artists: ['周杰伦'],
  album: '叶惠美',
  durationMs: 269000,
  cover: '',
  vip: false,
  playable: true,
  url: 'https://y.qq.com/n/ryqq/songDetail/0039MnYb0qxYhV',
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
    if (q.get('platform') === 'bilibili') {
      return {
        ok: true,
        data: [
          {
            platform: 'bilibili',
            id: 'BV1xx411c7mD',
            title: '【MV】测试视频',
            artists: ['UP主'],
            album: '',
            durationMs: 240000,
            cover: 'https://i0.hdslb.com/bfs/archive/cover.jpg',
            vip: false,
            playable: true,
            url: 'https://www.bilibili.com/video/BV1xx411c7mD',
          },
        ],
      };
    }
    return { ok: true, data: [QQ_SONG] };
  }
  if (u.includes('relay.example.com/lyric')) {
    return {
      ok: true,
      data: { lrc: '[00:00.50]晴天 歌词\n[00:03.00]第二句', tlrc: '[00:00.50]sunny line\n[00:03.00]second line' },
    };
  }
  if (u.includes('relay.example.com/playurl')) {
    const q = new URL(u).searchParams;
    if (q.get('platform') === 'netease') {
      return {
        ok: true,
        data: { playable: true, mode: 'audio', streamUrl: 'https://m702.music.126.net/x/y/track.mp3', ext: 'mp3', bitrate: 128012 },
      };
    }
    if (q.get('platform') === 'bilibili') {
      if (q.get('mode') === 'video') {
        return {
          ok: true,
          data: {
            playable: true,
            mode: 'video',
            streamUrl: 'https://upos-sz-mirrorcos.bilivideo.com/x/video.mp4',
            ext: 'mp4',
            qn: 64,
            durationSec: 240,
          },
        };
      }
      return {
        ok: true,
        data: {
          playable: true,
          mode: 'audio',
          streamUrl: 'https://upos-sz-mirrorcos.bilivideo.com/x/audio.m4a',
          ext: 'm4a',
          bitrate: 132000,
        },
      };
    }
    return {
      ok: true,
      data: { playable: true, mode: 'audio', streamUrl: 'https://ws.stream.qqmusic.qq.com/x/track.m4a', ext: 'm4a', bitrate: 128000 },
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

// 先配好中转，面板才会列出 QQ / B 站
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
check('重复注入后仍只有一个悬浮球', window.document.querySelectorAll('.mk-iirose-ball').length === 1);
check('诊断能看出被注入过 2 次', window.__MUSIC_IIROSE__.instances === 2, String(window.__MUSIC_IIROSE__.instances));

const panelEl = window.document.querySelector('.mk-root');
check('悬浮球已注入', Boolean(window.document.querySelector('.mk-iirose-ball')));
check('悬浮球上没有 ×（关闭入口统一到设置页）', !window.document.querySelector('.mk-iirose-ball .mk-ball-x'));

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
  check(
    '卡片字段顺序：标题>歌手>封面>颜色>码率',
    card.m === 'm__4@0>晴天>周杰伦>https://p3.music.126.net/cover-abc.jpg>ff9800>128',
    card.m,
  );
  check('封面不做实体转义（转了 / 客户端就加载不出图）', !card.m.includes('&#x2F;'), card.m.slice(30, 80));
  check('mc 是 6 位十六进制颜色（不带 #）', card.mc === 'ff9800', card.mc);
  check('i 是消息 id', /^\d{12}$/.test(String(card.i)), String(card.i));
  check('公屏卡片不带 g（带 g 会变成私聊，只有自己看得到）', !('g' in card), JSON.stringify(card).slice(0, 60));
}
check('帧计数被记录', diag && diag.framesSent === 2, String(diag && diag.framesSent));
await tick(600);
const lyrEl = window.document.querySelector('.mk-lyric-float');
check('歌词面板显示原文', Boolean(lyrEl) && lyrEl.textContent.includes('晴天 歌词'), lyrEl ? lyrEl.textContent.slice(0, 40) : 'no el');
check('外语歌词双行（译文）', Boolean(lyrEl) && lyrEl.textContent.includes('sunny line'));

// ---------------- 5. 房间播放事件回填 ----------------
window.socket.onmessage({ data: '&1{"s":"s://m1.mp3","d":30,"c":"","n":"晴天","r":"@0周杰伦","b":"@0","o":"","l":null}' });
await tick();
const nowText = panelEl.querySelector('[data-el=now]').textContent;
check('&1 事件把「房间正在播放」写回面板', nowText.includes('房间：晴天'), nowText);
check('诊断里记下了当前曲', String(diag.roomNow || '').includes('晴天'), String(diag.roomNow));
let nowRaw = null;
try {
  nowRaw = JSON.parse(window.localStorage.getItem('mk_room_now') || 'null');
} catch (e) {
  nowRaw = null;
}
check(
  '房间播放状态落进 localStorage（刷新页面能接回来）',
  Boolean(nowRaw) && nowRaw.title === '晴天' && nowRaw.durationMs === 30000 && Number(nowRaw.startedAt) > 0,
  JSON.stringify(nowRaw).slice(0, 90),
);
check(
  '真实开播帧到了就不再是「预判」（时间轴对齐）',
  Boolean(nowRaw) && nowRaw.predicted === false,
  String(nowRaw && nowRaw.predicted),
);

// 点歌历史：刚点过一首，历史页应该能看到，并且落在 localStorage
const histRaw = window.localStorage.getItem('mk_history');
let histArr = [];
try {
  histArr = JSON.parse(histRaw || '[]');
} catch (e) {
  histArr = [];
}
check('点歌后写入了本机历史', histArr.length >= 1 && String(histArr[0].title || '').length > 0, String(histRaw).slice(0, 60));
panelEl.querySelector('[data-act=history]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick();
const hText = panelEl.querySelector('[data-el=body]').textContent;
check('历史页渲染出条目', /点歌历史/.test(hText) && hText.includes(histArr[0].title), hText.slice(0, 60));
// 回到搜索结果，后面的用例还要点结果里的 ▶
panelEl.querySelector('[data-act=back]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick();

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

// ---------------- 9. 配了中转之后：QQ 音乐 ----------------
check('中转地址进了诊断', String(diag.relay || '').includes('relay.example.com'), String(diag.relay));
const tabCount = panelEl.querySelectorAll('.mk-tab').length;
check('平台 tab 变成 3 个（网易云 + QQ + B 站，酷狗已下线）', tabCount === 3, String(tabCount));

// 切回「点播到房间」再试
panelEl.querySelector('[data-act=mode]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick();
panelEl.querySelectorAll('.mk-tab')[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick(80);
check(
  'QQ 搜索打到了中转',
  requested.some((u) => u.includes('relay.example.com/search') && u.includes('platform=qq')),
  requested.filter((u) => u.includes('relay')).slice(-1)[0] || '',
);

const framesBefore = sent.length;
panelEl.querySelector('[data-play]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick(80);
check('QQ 点播也发 2 帧', sent.length === framesBefore + 2, String(sent.length - framesBefore));

let kgMedia = null;
try {
  kgMedia = JSON.parse(String(sent[framesBefore]).slice(2));
} catch {
  kgMedia = null;
}
check('QQ 媒体帧 b=@2', kgMedia && kgMedia.b === '@2', kgMedia && String(kgMedia.b));
check('QQ 音频来自中转给的地址', kgMedia && String(kgMedia.s).includes('qqmusic.qq.com'), kgMedia && String(kgMedia.s));

let kgCard = null;
try {
  kgCard = JSON.parse(String(sent[framesBefore + 1]));
} catch {
  kgCard = null;
}
check('QQ 卡片以 m__4@2> 开头', kgCard && String(kgCard.m).startsWith('m__4@2>'), kgCard && String(kgCard.m).slice(0, 22));

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
  check('没配中转时只剩一个 tab', w2.document.querySelectorAll('.mk-tab').length === 1);
}

// ---------------- 9.2 B 站：视频 / 音频轨 切换 ----------------
{
  // 面板内存里的设置跟着 localStorage 走：先写 storage，再发 mk-settings 让它重读
  const applySettings = (patch) => {
    window.localStorage.setItem('mk_panel_settings', JSON.stringify(Object.assign({ card: true }, patch)));
    window.dispatchEvent(new window.CustomEvent('mk-settings', { detail: { settings: null, source: 'test' } }));
  };
  applySettings({ bili: 'video' });
  await tick(20);
  // 平台顺序按 PLATFORM_FALLBACK：netease / kugou / qq / bilibili
  const tabIds = Array.from(panelEl.querySelectorAll('.mk-tab')).map((b) => b.dataset.tab);
  check('有 B 站 tab', tabIds.includes('bilibili'), tabIds.join(','));
  const biliTab = panelEl.querySelectorAll('.mk-tab')[tabIds.indexOf('bilibili')];
  biliTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(90);
  check('B 站搜索打到了中转', requested.some((u) => u.includes('platform=bilibili')));
  check('B 站行多一个「换音频轨」按钮', Boolean(panelEl.querySelector('[data-pm][data-mode="audio"]')));

  const beforeVideo = sent.length;
  panelEl.querySelector('[data-play]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(90);
  check('视频点播也发 2 帧', sent.length === beforeVideo + 2, String(sent.length - beforeVideo));
  let vMedia = null;
  let vCard = null;
  try {
    vMedia = JSON.parse(String(sent[beforeVideo]).slice(2));
  } catch {
    vMedia = null;
  }
  try {
    vCard = JSON.parse(String(sent[beforeVideo + 1]));
  } catch {
    vCard = null;
  }
  check('视频媒体帧 b==1（通用视频，不是 B 站专用 !3）', vMedia && vMedia.b === '=1', vMedia && String(vMedia.b));
  check('视频卡片以 m__4=1> 开头', vCard && String(vCard.m).startsWith('m__4=1>'), vCard && String(vCard.m).slice(0, 18));
  check('视频卡片带时长文本', vCard && /4分/.test(String(vCard.m)), vCard && String(vCard.m).slice(-10));

  // 行内按钮：这一条换回音频轨
  const beforeAudio = sent.length;
  panelEl.querySelector('[data-pm][data-mode="audio"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(90);
  check('换回音频轨发 2 帧', sent.length === beforeAudio + 2, String(sent.length - beforeAudio));
  let aMedia = null;
  try {
    aMedia = JSON.parse(String(sent[beforeAudio]).slice(2));
  } catch {
    aMedia = null;
  }
  check('音频轨媒体帧 b==0（B 站音频标记）', aMedia && aMedia.b === '=0', aMedia && String(aMedia.b));

  // 外链点播：<标题 - 作者 - 封面#color=xx> [视频直链]
  applySettings({ bili: 'link' });
  await tick(30);
  const beforeLink = sent.length;
  panelEl.querySelector('[data-play]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(120);
  check('外链模式只发 1 条消息', sent.length === beforeLink + 1, String(sent.length - beforeLink));
  let linkMsg = null;
  try {
    linkMsg = JSON.parse(String(sent[beforeLink]));
  } catch {
    linkMsg = null;
  }
  check(
    '外链消息含 [视频直链]',
    linkMsg && /#color=[0-9a-fA-F]{6}> \[https?:\/\//.test(String(linkMsg.m)),
    linkMsg && String(linkMsg.m).slice(0, 90),
  );
  applySettings({});

  // 原生模式：把链接当普通公屏消息发出去，让 IIROSE 自己解析
  applySettings({ bili: 'native' });
  await tick(30);
  const beforeNative = sent.length;
  panelEl.querySelector('[data-play]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(90);
  check('原生模式只发 1 条消息', sent.length === beforeNative + 1, String(sent.length - beforeNative));
  let nativeMsg = null;
  try {
    nativeMsg = JSON.parse(String(sent[beforeNative]));
  } catch {
    nativeMsg = null;
  }
  check(
    '原生消息是「@ bilibilix 转链」',
    nativeMsg && /^@ https:\/\/www\.bilibilix\.com\/video\//.test(String(nativeMsg.m)),
    nativeMsg && String(nativeMsg.m).slice(0, 60),
  );
  applySettings({});
}

// ---------------- 9.5 设置里关掉「发送点播卡片」：只发媒体帧 ----------------
{
  window.localStorage.setItem('mk_panel_settings', JSON.stringify({ ball: true, gesture: true, card: false }));
  // 只数「媒体帧 / 卡片」；%a（查询房间歌单）不算
  const countFrames = () =>
    sent.filter((x) => {
      const s = String(x).trim();
      return s.startsWith('&1') || s.startsWith('{');
    }).length;
  const framesBeforeOff = countFrames();
  panelEl.querySelector('[data-play]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(80);
  check('关掉卡片后只发 1 帧', countFrames() === framesBeforeOff + 1, String(countFrames() - framesBeforeOff));
  const lastFrame = sent
    .filter((x) => {
      const s = String(x).trim();
      return s.startsWith('&1') || s.startsWith('{');
    })
    .slice(-1)[0];
  check('关掉卡片时这一帧仍是媒体数据', String(lastFrame || '').startsWith('&1{'), String(lastFrame || '').slice(0, 12));
  window.localStorage.setItem('mk_panel_settings', JSON.stringify({ ball: true, gesture: true, card: true }));
}

// ---------------- 10. 换版：旧版本还挂在页面里时，新的要把旧的拆掉 ----------------
// 真实场景：extJs 里同时留着旧链接和新链接，旧版的监听还会响应双指上滑 / Alt+T。
{
  const dom3 = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://iirose.com/',
  });
  const w3 = dom3.window;
  w3.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, data: [] }) });
  w3.socket = { send() {}, onmessage: null };
  w3.uid = '1';
  vm.runInContext(code, dom3.getInternalVMContext(), { filename: 'music-iirose.js' });
  await tick(20);

  const oldPanel = w3.__MUSIC_IIROSE__;
  check('旧版本先装了一份', Boolean(oldPanel && oldPanel.mounted));
  // 伪造成「旧版本」：版本号不同 → 再注入一次应当接管
  oldPanel.version = '0.0.1';
  let destroyed = 0;
  const realDestroy = oldPanel.destroy;
  oldPanel.destroy = function () {
    destroyed++;
    realDestroy.call(oldPanel);
  };

  vm.runInContext(code, dom3.getInternalVMContext(), { filename: 'music-iirose.js' });
  await tick(30);
  check('旧版本被拆掉（调了 destroy）', destroyed === 1, String(destroyed));
  check('换版后只有一套面板', w3.document.querySelectorAll('.mk-root').length === 1, String(w3.document.querySelectorAll('.mk-root').length));
  check('换版后只有一个悬浮球', w3.document.querySelectorAll('.mk-iirose-ball').length === 1);
  check('新版本已接管', w3.__MUSIC_IIROSE__ !== oldPanel && w3.__MUSIC_IIROSE__.mounted === true);
  check('诊断里能看到注入次数 2', w3.__MUSIC_IIROSE__.instances === 2, String(w3.__MUSIC_IIROSE__.instances));
}

// ---------------- 11. 刷新接回房间播放 / 帧内 LRC / 放完自动收 ----------------
{
  const mkDom = () => {
    const d = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      url: 'https://iirose.com/',
    });
    d.window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, data: [] }) });
    d.window.socket = { send() {}, onmessage: null };
    d.window.uid = '1';
    return d;
  };

  // A. 刷新时这首还在放：接回来 + 续上歌词（歌词直接用记录里的 LRC，不依赖中转）
  const dA = mkDom();
  dA.window.localStorage.setItem(
    'mk_room_now',
    JSON.stringify({
      title: '夜曲',
      sub: '周杰伦',
      artists: ['周杰伦'],
      startedAt: Date.now() - 30000,
      durationMs: 250000,
      platform: 'netease',
      id: '2000000002',
      lrc: '[00:00.00]夜曲 歌词\n[00:05.00]第二句\n[00:10.00]第三句\n[00:15.00]第四句\n[00:20.00]第五句\n[00:25.00]第六句\n[00:28.00]第七句\n[00:29.00]第八句',
    }),
  );
  vm.runInContext(code, dA.getInternalVMContext(), { filename: 'music-iirose.js' });
  await tick(50);
  const nowA = dA.window.document.querySelector('[data-el=now]').textContent;
  check('刷新后把「房间正在播放」接回来了', nowA.includes('房间：夜曲'), nowA);
  check('接回来时带着剩余时间', /剩 \d+:\d{2}/.test(nowA), nowA);
  const lyA = dA.window.document.querySelector('.mk-lyric-float');
  check(
    '记录里的 LRC 直接显示（不靠中转）',
    Boolean(lyA) && lyA.classList.contains('mk-on') && lyA.querySelectorAll('.lf-line').length === 3,
    lyA ? lyA.textContent.slice(0, 40) : 'no el',
  );

  // B. 早该放完了：进页面就丢掉，不留「幽灵正在播放」
  const dB = mkDom();
  dB.window.localStorage.setItem(
    'mk_room_now',
    JSON.stringify({ title: '过期歌', artists: [], startedAt: Date.now() - 300000, durationMs: 60000, platform: '', id: '', lrc: '' }),
  );
  vm.runInContext(code, dB.getInternalVMContext(), { filename: 'music-iirose.js' });
  await tick(50);
  check('过期记录不会显示成正在播放', !dB.window.document.querySelector('[data-el=now]').textContent.includes('过期歌'));
  check('过期记录被清出 localStorage', dB.window.localStorage.getItem('mk_room_now') === null);

  // C. 服务器广播的 `>` 分隔帧：带真实时长 + 整段 LRC
  dA.window.socket.onmessage({
    data:
      '&1://m10.music.126.net/x.mp3#163=1439814454>s://music.163.com/#/song?id=1439814454>225.817333>我的悲伤是水做的>@0ChiliChill  &  洛天依Official>上学>2>://p2.music.126.net/c.jpg>http://r.iirose.com/a.jpg>>[00:00.000] 作词 : ChiliChill\n[00:05.000]晒干这一片蓝色',
  });
  await tick(60);
  const nowC = dA.window.document.querySelector('[data-el=now]').textContent;
  check('分隔符帧也认得出歌名', nowC.includes('房间：我的悲伤是水做的'), nowC);
  check('分隔符帧带出剩余时间', /剩 \d+:\d{2}/.test(nowC), nowC);
  let recC = null;
  try {
    recC = JSON.parse(dA.window.localStorage.getItem('mk_room_now') || 'null');
  } catch (e) {
    recC = null;
  }
  check('时长按秒存成毫秒（225.817333s）', Boolean(recC) && recC.durationMs === 225817, recC && String(recC.durationMs));
  check(
    '帧里的 LRC 直接拿去上屏',
    Boolean(lyA) && lyA.textContent.includes('晒干这一片蓝色'),
    lyA ? lyA.textContent.replace(/\s+/g, ' ').slice(0, 60) : 'no el',
  );
  check('顺带认出网易云 id', Boolean(recC) && recC.platform === 'netease' && recC.id === '1439814454', recC ? recC.platform + '/' + recC.id : '');

  // D. 放完自动收：给一帧只有 1 秒的歌，等它自己收干净（1s 轮询 + 1.5s 余量）
  dA.window.socket.onmessage({
    data: '&1://m1.mp3>s://music.163.com/#/song?id=1>1>一秒就完>@0测试>上学>2>://c.jpg>http://a.jpg',
  });
  await tick(120);
  check('短歌先正常显示', dA.window.document.querySelector('[data-el=now]').textContent.includes('一秒就完'));
  await tick(3000);
  const nowD = dA.window.document.querySelector('[data-el=now]').textContent;
  check('放完自动收回「未在播放」', nowD.includes('未在播放'), nowD);
  check('放完把歌词窗一起收掉', !lyA.classList.contains('mk-on'), lyA.className);
  check('放完清掉 localStorage 里的记录', dA.window.localStorage.getItem('mk_room_now') === null);
  // A2. 歌词窗自己的操作：A−/A+ 字号、上下拉改行数、锁定、关掉（设置里只有一个开关）
  // 先给一首 5 分钟、8 行歌词的歌，让歌词窗处于显示状态
  dA.window.socket.onmessage({
    data:
      '&1://m2.mp3>s://music.163.com/#/song?id=2>300>测试长歌>@0测试>上学>2>://c.jpg>http://a.jpg>>' +
      '[00:00.00]第一句\n[00:20.00]第二句\n[00:40.00]第三句\n[00:60.00]第四句\n[00:80.00]第五句\n[00:100.00]第六句\n[00:120.00]第七句\n[00:140.00]第八句',
  });
  await tick(80);
  check('新歌的歌词又亮起来', lyA.classList.contains('mk-on'));
  const barA = lyA.querySelector('.lf-bar');
  check('歌词窗上有 A−/A+/🔒/✕ 四个按钮', Boolean(barA) && barA.querySelectorAll('.lf-btn').length === 4);
  const fsBefore = parseFloat(lyA.style.getPropertyValue('--lf-fs'));
  barA.querySelector('[data-lf=plus]').dispatchEvent(new dA.window.MouseEvent('click', { bubbles: true }));
  await tick(30);
  check(
    '点 A+ 字号真的变大（5 档）',
    parseFloat(lyA.style.getPropertyValue('--lf-fs')) > fsBefore,
    fsBefore + ' → ' + lyA.style.getPropertyValue('--lf-fs'),
  );

  const linesBefore = lyA.querySelectorAll('.lf-line').length;
  const gripA = lyA.querySelector('.lf-grip');
  gripA.dispatchEvent(new dA.window.MouseEvent('pointerdown', { bubbles: true, clientX: 200, clientY: 200 }));
  gripA.dispatchEvent(new dA.window.MouseEvent('pointermove', { bubbles: true, clientX: 200, clientY: 280 }));
  await tick(30);
  check(
    '右下角往下拉 = 多看几行（不只是平着拉）',
    lyA.querySelectorAll('.lf-line').length > linesBefore,
    linesBefore + ' → ' + lyA.querySelectorAll('.lf-line').length,
  );
  gripA.dispatchEvent(new dA.window.MouseEvent('pointerup', { bubbles: true }));
  await tick(20);

  barA.querySelector('[data-lf=lock]').dispatchEvent(new dA.window.MouseEvent('click', { bubbles: true }));
  await tick(30);
  check('点 🔒 锁定后带 data-lock=1', lyA.getAttribute('data-lock') === '1', String(lyA.getAttribute('data-lock')));
  check(
    '锁定时只剩解锁按钮可点（不挡房间）',
    lyA.getAttribute('data-lock') === '1' && /data-lock="1"/.test(lyA.outerHTML),
  );
  const savedA = JSON.parse(dA.window.localStorage.getItem('mk_panel_settings') || '{}');
  check('锁定状态落盘', savedA.lyricLock === true, String(savedA.lyricLock));

  barA.querySelector('[data-lf=close]').dispatchEvent(new dA.window.MouseEvent('click', { bubbles: true }));
  await tick(30);
  check('点 ✕ 关掉歌词', !lyA.classList.contains('mk-on'), lyA.className);
  check('关掉歌词写进设置', JSON.parse(dA.window.localStorage.getItem('mk_panel_settings')).lyric === false);

}

// ---------------- 12. 一次性点多首：真的每首都发（不再只发第一首） ----------------
{
  const panel12 = window.__MUSIC_IIROSE__.panel;
  const mediaCount = () => sent.filter((f) => String(f).startsWith('&1')).length;
  const mk = (id, title, dur) => ({ platform: 'netease', id, title, artists: ['周杰伦'], durationMs: dur });

  const before12 = mediaCount();
  const p12 = panel12.playAll([mk('1901371647', '晴天', 278961), mk('1901371648', '七里香', 299000), mk('1901371649', '夜曲', 250000)]);
  await tick(150);
  check('批量点歌立刻开始发第一首', mediaCount() > before12, 'sent ' + (mediaCount() - before12));
  const bar12 = panelEl.querySelector('[data-el=batch]');
  check('面板顶部出现批量进度（不在房间里刷）', Boolean(bar12) && bar12.classList.contains('mk-on'), bar12 && bar12.className);
  check('进度里带 x/y', /1\/3/.test(panelEl.querySelector('[data-el=batch-txt]').textContent), panelEl.querySelector('[data-el=batch-txt]').textContent);

  await tick(1800);
  const res12 = await p12;
  check('3 首都发进房间（不是只发第一首）', res12.ok === 3 && mediaCount() - before12 >= 3, JSON.stringify(res12).slice(0, 70));
  check('批量进度条收起', !panelEl.querySelector('[data-el=batch]').classList.contains('mk-on'));
  check(
    '点完在房间里留一条汇总（首数 / 时长，不带进度刷屏）',
    Boolean(diag.lastNotice) && /3 \/ 3 首/.test(String(diag.lastNotice)) && /分钟/.test(String(diag.lastNotice)),
    String(diag.lastNotice),
  );

  // 取消：8 首点到一半停下
  const before13 = mediaCount();
  const many = Array.from({ length: 8 }, (_, i) => mk(String(1901373000 + i), '批量' + i, 200000));
  const p13 = panel12.playAll(many);
  await tick(700);
  panelEl.querySelector('[data-act=batch-cancel]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const res13 = await p13;
  check('取消后不再继续点', res13.cancelled === true, JSON.stringify(res13).slice(0, 60));
  check('取消时确实只发了几首', mediaCount() - before13 < 8, 'sent ' + (mediaCount() - before13));
}

// ---------------- 13. 我的歌单：从历史建、打开、整批点、删除 ----------------
{
  const media = () => sent.filter((f) => String(f).startsWith('&1')).length;
  // 从历史建一个歌单
  panelEl.querySelector('[data-act=history]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(60);
  const toPl = panelEl.querySelector('[data-act=hist-to-pl]');
  check('历史页有「存成歌单」按钮', Boolean(toPl));
  toPl.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(90);
  let saved = [];
  try {
    saved = JSON.parse(window.localStorage.getItem('mk_playlists') || '[]');
  } catch (e) {
    saved = [];
  }
  check(
    '生成了一个本机歌单（带歌）',
    Array.isArray(saved) && saved.length === 1 && saved[0].songs.length > 0 && /历史/.test(saved[0].name),
    JSON.stringify(saved).slice(0, 80),
  );

  // 歌单页
  panelEl.querySelector('[data-act=playlists]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(60);
  const plBody = panelEl.querySelector('[data-el=body]').textContent;
  check('歌单页列出这个歌单', /我的歌单/.test(plBody) && plBody.includes(saved[0].name), plBody.slice(0, 60));

  // 打开 → 全部点歌（房间模式应当真的发帧）
  panelEl.querySelector('[data-act=pl-open]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(70);
  check('打开本机歌单能看到歌', panelEl.querySelectorAll('.mk-song').length > 0, String(panelEl.querySelectorAll('.mk-song').length));
  const beforePl = media();
  panelEl.querySelector('[data-act=batch-play]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(200);
  check('本机歌单也能整批点（真的往房间发）', media() > beforePl, 'sent ' + (media() - beforePl));
  panelEl.querySelector('[data-act=batch-cancel]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(60);

  // 返回 → 删除
  panelEl.querySelector('[data-act=back]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(60);
  check('从本机歌单返回落在歌单列表（不是搜索结果）', /我的歌单/.test(panelEl.querySelector('[data-el=body]').textContent));
  panelEl.querySelector('[data-act=pl-del]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(60);
  check('删除后本机没有歌单了', JSON.parse(window.localStorage.getItem('mk_playlists') || '[]').length === 0);
  check('顶栏歌单按钮上的计数跟着清空', (panelEl.querySelector('[data-el=pl-count]').textContent || '') === '');
}

// ---------------- 14. 切歌 / 暂停后歌词要收：盯房间那个 <audio> ----------------
{
  const dM = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://iirose.com/',
  });
  const wM = dM.window;
  wM.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, data: [] }) });
  wM.socket = { send() {}, onmessage: null };
  wM.uid = '1';
  // 假装房间里已经有一个在响的 <audio>（IIROSE 播放器就是这么干的）
  const roomAudio = wM.document.createElement('audio');
  roomAudio.src = 'https://m1.music.126.net/x/abc123.mp3';
  Object.defineProperty(roomAudio, 'paused', { value: false, configurable: true });
  Object.defineProperty(roomAudio, 'readyState', { value: 4, configurable: true });
  wM.document.body.appendChild(roomAudio);
  wM.localStorage.setItem(
    'mk_room_now',
    JSON.stringify({
      title: '要切掉的歌',
      artists: ['某人'],
      startedAt: Date.now() - 5000,
      durationMs: 250000,
      platform: '',
      id: '',
      src: '//m1.music.126.net/x/abc123.mp3',
      lrc: '[00:00.00]第一句\n[00:05.00]第二句',
    }),
  );
  vm.runInContext(code, dM.getInternalVMContext(), { filename: 'music-iirose.js' });
  await tick(120);
  const panelM = wM.__MUSIC_IIROSE__.panel;
  check('认出了房间里那个 <audio>', panelM.roomMedia().hooked === true, JSON.stringify(panelM.roomMedia()).slice(0, 90));
  const nowM = () => wM.document.querySelector('[data-el=now]').textContent;
  const lyM = wM.document.querySelector('.mk-lyric-float');
  check('一开始在显示歌词', Boolean(lyM) && lyM.classList.contains('mk-on'), lyM && lyM.className);

  // 用户点了切歌 / 暂停：元素被 pause，且没有新帧
  Object.defineProperty(roomAudio, 'paused', { value: true, configurable: true });
  roomAudio.dispatchEvent(new wM.Event('pause'));
  await tick(400);
  check('刚暂停时不立刻收（给切歌留宽限）', nowM().includes('要切掉的歌'), nowM());
  await tick(2600);
  check('2.5 秒后没收到的确停了：播放信息收回', nowM().includes('未在播放'), nowM());
  check('歌词窗一起收掉（不再挂着）', !lyM.classList.contains('mk-on'), lyM.className);
  check('localStorage 里的记录也清了', wM.localStorage.getItem('mk_room_now') === null);

  // 正常切歌不该被误杀：帧来了就取消宽限
  wM.localStorage.setItem(
    'mk_room_now',
    JSON.stringify({
      title: '下一首', artists: [], startedAt: Date.now(), durationMs: 250000,
      platform: '', id: '', src: '//m1.music.126.net/x/def456.mp3', lrc: '[00:00.00]新的一句',
    }),
  );
  wM.socket.onmessage({ data: '&1://m1.music.126.net/x/def456.mp3>s://music.163.com/song?id=9>250>下一首>@0某人>上学>2>://c.jpg>http://a.jpg>>[00:00.00]新的一句' });
  await tick(300);
  check('新帧来了照常显示下一首', nowM().includes('下一首'), nowM());
}

console.log('');
if (failures.length) {
  console.log('结果：' + failures.length + ' 项失败 -> ' + failures.join(' / '));
  process.exit(1);
}
console.log('结果：全部通过');
// 面板里有顶栏时钟的 setInterval，jsdom 下会吊住事件循环；跑完直接退出
process.exit(0);
