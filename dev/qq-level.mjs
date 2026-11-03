// QQ 音质降级链的离线单测：把全局 fetch 换成假上游，看它按什么顺序要什么 quality
import { worker } from '../relay/worker.js';

let calls = [];
let mode = 'all-ok'; // all-ok | flac-404 | no-cookie | vip-blocked

const realFetch = globalThis.fetch;

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes('musicu.fcg')) {
    const data = JSON.parse(decodeURIComponent(u.split('data=')[1]));
    const param = data.req_0.param;
    const filename = param.filename && param.filename[0] ? param.filename[0] : '';
    const prefix = filename.slice(0, 4);
    calls.push({ kind: 'vkey', prefix, filename });
    // 没 cookie 的场景：一律不给地址
    if (mode === 'no-cookie') {
      return jsonRes({ req_0: { code: 0, data: { sip: ['http://aqqmusic.tc.qq.com/'], midurlinfo: [{ result: 104003, purl: '' }] } } });
    }
    if (mode === 'vip-blocked') {
      return jsonRes({ req_0: { code: 0, data: { sip: ['http://aqqmusic.tc.qq.com/'], midurlinfo: [{ result: 104003, purl: '' }] } } });
    }
    return jsonRes({
      req_0: { code: 0, data: { sip: ['http://aqqmusic.tc.qq.com/'], midurlinfo: [{ result: 0, purl: prefix + 'song.m4a?vkey=abc', filename }] } },
    });
  }
  // HEAD 探活
  calls.push({ kind: 'head', url: u.slice(0, 40) });
  if (mode === 'flac-404' && u.includes('F000')) return new Response(null, { status: 404 });
  return new Response(null, { status: 206, headers: { 'content-length': '100' } });
};

function jsonRes(obj) {
  return new Response(JSON.stringify(obj), { status: 200, headers: { 'content-type': 'application/json' } });
}

async function playurl(level, id) {
  // 每个用例换一个 songmid：中转有 5 分钟 playCache，同 id 同 level 会直接命中缓存
  const url = 'https://relay.test/playurl?platform=qq&id=' + (id || '0039MnYb0qxYhV') + (level ? '&level=' + level : '');
  const res = await worker.fetch(new Request(url), { QQ_COOKIE: mode === 'no-cookie' ? '' : 'uin=1; qm_keyst=x', QQ_UIN: '1' });
  return { status: res.status, body: await res.json() };
}

function check(name, cond, extra = '') {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (cond ? '' : '   ← ' + extra));
  if (!cond) process.exitCode = 1;
}

// 1) level=lossless → F000 flac，HEAD 206 → 采用
calls = [];
mode = 'all-ok';
let r = await playurl('lossless', 'id0001');
check('无损：请求 F000 前缀', calls.some((c) => c.kind === 'vkey' && c.prefix === 'F000'), JSON.stringify(calls));
check('无损：返回 ext=flac + 1411200bps', r.body.data?.ext === 'flac' && r.body.data?.bitrate === 1411200, JSON.stringify(r.body));

// 2) F000 文件 404 → 退到 M800
calls = [];
mode = 'flac-404';
r = await playurl('lossless', 'id0002');
check('无损 404：先试 F000 再退 M800', calls.filter((c) => c.kind === 'vkey').map((c) => c.prefix).join('>') === 'F000>M800', JSON.stringify(calls.filter((c) => c.kind === 'vkey')));
check('无损 404：最终返回 ext=mp3 + 320000bps', r.body.data?.ext === 'mp3' && r.body.data?.bitrate === 320000, JSON.stringify(r.body.body || r.body));

// 3) level 缺省 → 320k 起（不打无损）
calls = [];
mode = 'all-ok';
r = await playurl('', 'id0003');
check('缺省音质：直接从 M800 起，不试 F000', calls.filter((c) => c.kind === 'vkey')[0]?.prefix === 'M800', JSON.stringify(calls.filter((c) => c.kind === 'vkey')));

// 4) level=standard → 只要 C400，不 HEAD 探活
calls = [];
mode = 'all-ok';
r = await playurl('standard', 'id0004');
check('标准音质：只要 C400', calls.filter((c) => c.kind === 'vkey').map((c) => c.prefix).join('>') === 'C400', JSON.stringify(calls.filter((c) => c.kind === 'vkey')));
check('标准音质：跳过 HEAD 探活', calls.filter((c) => c.kind === 'head').length === 0, JSON.stringify(calls));

// 5) 绿钻被拒（104003）→ playable:false + 提示 cookie
calls = [];
mode = 'vip-blocked';
r = await playurl('lossless', 'id0005');
check('被拒：三个档都试过', calls.filter((c) => c.kind === 'vkey').length === 3, JSON.stringify(calls.filter((c) => c.kind === 'vkey')));
check('被拒：playable=false 且提示 Cookie', r.body.data?.playable === false && /Cookie/.test(String(r.body.data?.note)), JSON.stringify(r.body));

// 6) 没配 cookie → note 指向配置
calls = [];
mode = 'no-cookie';
r = await playurl('lossless', 'id0006');
check('无 cookie：提示配 QQ_COOKIE', /QQ_COOKIE/.test(String(r.body.data?.note)), JSON.stringify(r.body));

globalThis.fetch = realFetch;
console.log(process.exitCode ? '\nQQ 音质测试失败' : '\nQQ 音质测试通过');
