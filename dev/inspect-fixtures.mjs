/**
 * 探测：读取 dev/fixtures 下的三平台搜索结果，打印各平台真实字段结构。
 * 用途：写归一化器（normalize）之前先看清原始形状，避免凭空猜字段。
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, 'fixtures');

function load(name) {
  const p = join(dir, name);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch (e) { return { __parseError: String(e) }; }
}

const j = (v, n = 700) => {
  const s = JSON.stringify(v, null, 1);
  return s.length > n ? s.slice(0, n) + '\n  …' : s;
};
const line = (t) => console.log('\n================ ' + t + ' ================');

const netease = load('163.json');
line('网易云 163.json');
if (netease) {
  console.log('top keys:', Object.keys(netease));
  console.log('result keys:', netease.result ? Object.keys(netease.result) : null);
  const songs = netease.result?.songs ?? [];
  console.log('songs count:', songs.length);
  console.log('first song:\n', j(songs[0], 900));
}

const kugou = load('kugou.json');
line('酷狗 kugou.json');
if (kugou) {
  console.log('top keys:', Object.keys(kugou));
  console.log('data keys:', kugou.data ? Object.keys(kugou.data) : null);
  const lists = kugou.data?.lists ?? [];
  console.log('lists count:', lists.length);
  console.log('first item:\n', j(lists[0], 900));
}

const qq = load('qq.json');
line('QQ qq.json');
if (qq) {
  console.log('top keys:', Object.keys(qq));
  const body = qq.req_1?.data?.body;
  console.log('req_1.data.body keys:', body ? Object.keys(body) : null);
  console.log('body:\n', j(body, 1200));
}
