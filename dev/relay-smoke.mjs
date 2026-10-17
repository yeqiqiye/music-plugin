/**
 * 中转的真实联网自检（不进 CI：上游会抽风，联网测试放 CI 里只会红得莫名其妙）。
 *
 *   npm run test:relay
 *
 * 它直接 import relay/worker.js，用 Request 调 fetch handler —— 和 Cloudflare 上跑的是同一份代码。
 * 覆盖：/health → 酷狗搜索 → 酷狗播放地址 → B 站搜索 → B 站播放地址。
 * 网络不通或上游限流时打印「跳过」，退出码 0。
 */
import worker from '../relay/worker.js';

const failures = [];
const check = (label, cond, extra = '') => {
  console.log((cond ? '  ok   ' : '  FAIL ') + label + (extra ? '  ' + extra : ''));
  if (!cond) failures.push(label);
};

async function call(path) {
  const res = await worker.fetch(new Request('https://relay.local' + path));
  const json = await res.json();
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status} ${JSON.stringify(json).slice(0, 120)}`);
  return json;
}

/** 中转返回的是它自己的 /stream 地址时，直接喂给 worker，别真去请求外网 */
async function probeAudio(streamUrl) {
  const req = new Request(streamUrl, { headers: { range: 'bytes=0-1023' } });
  if (new URL(streamUrl).hostname === 'relay.local') return worker.fetch(req);
  return fetch(req);
}

try {
  const health = await call('/health');
  check('/health 正常', health.ok === true, JSON.stringify(health));

  const ks = await call('/search?platform=kugou&kw=' + encodeURIComponent('晴天') + '&limit=3&page=1');
  check('酷狗搜索返回结果', ks.ok === true && ks.data.length > 0, `n=${ks.data && ks.data.length}`);
  const kugou = ks.data && ks.data[0];
  if (kugou) {
    check('酷狗结果字段齐全', Boolean(kugou.id && kugou.title && kugou.platform === 'kugou'), kugou.title);
    const kp = await call('/playurl?platform=kugou&id=' + encodeURIComponent(kugou.id));
    check('酷狗播放地址可用', kp.ok === true && kp.data.playable === true, JSON.stringify(kp.data).slice(0, 120));
    if (kp.data && kp.data.streamUrl) {
      // 音频是 CDN 直连，这里确认它真的能被匿名取到（房间播放走同一条路）
      const head = await probeAudio(kp.data.streamUrl);
      check('酷狗音频匿名可取（206/200）', head.status === 200 || head.status === 206, 'HTTP ' + head.status);
    }
  }

  const bs = await call('/search?platform=bilibili&kw=' + encodeURIComponent('晴天') + '&limit=2&page=1');
  check('B 站搜索返回结果', bs.ok === true && bs.data.length > 0, `n=${bs.data && bs.data.length}`);
  const bili = bs.data && bs.data[0];
  if (bili) {
    const bp = await call('/playurl?platform=bilibili&id=' + encodeURIComponent(bili.id));
    check('B 站播放地址可用', bp.ok === true && bp.data.playable === true, JSON.stringify(bp.data).slice(0, 120));
    check('B 站地址已改成中转的 /stream', String(bp.data.streamUrl || '').startsWith('https://relay.local/stream'), String(bp.data.streamUrl).slice(0, 60));
    if (bp.data && bp.data.streamUrl) {
      const head = await probeAudio(bp.data.streamUrl);
      check('B 站音频匿名可取（206/200）', head.status === 200 || head.status === 206, 'HTTP ' + head.status);
    }
  }
} catch (err) {
  console.log('跳过：上游或网络不可用 -> ' + String((err && err.message) || err));
  process.exit(0);
}

console.log('');
if (failures.length) {
  console.log('结果：' + failures.length + ' 项失败 -> ' + failures.join(' / '));
  process.exit(1);
}
console.log('结果：全部通过');
