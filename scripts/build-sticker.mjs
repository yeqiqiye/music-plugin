/**
 * 构建 iirose/sticker.js —— 独立的「表情包」脚本（不依赖点歌台）。
 *
 * 和 scripts/build-iirose.mjs 一样的手法：产物是**一个**普通 <script>，
 * 只把 __VERSION__ 换成 package.json 里的版本号；不写构建时间（否则每次构建都产生假 diff）。
 *
 * 运行：node scripts/build-sticker.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const pkg = JSON.parse((await readFile(join(root, 'package.json'), 'utf8')).replace(/^\uFEFF/, ''));
const src = (await readFile(join(root, 'iirose', 'sticker-main.js'), 'utf8')).replace(/\r\n?/g, '\n');

const out = src.split('__VERSION__').join(pkg.version);
await writeFile(join(root, 'iirose', 'sticker.js'), out, 'utf8');
console.log('built iirose/sticker.js (' + out.length + ' bytes)');
