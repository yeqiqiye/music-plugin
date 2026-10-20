/**
 * 构建 iirose/music-iirose.js（标准版）和 iirose/music-iirose-hd.js（1080P 版）。
 *
 * 和 scripts/build.mjs 是同一套手法：面板源码以 JSON 字符串塞进占位符，
 * 产物是**一个**普通 <script>（不是 ESM、不依赖任何模块加载器），
 * 因为 IIROSE 的「引用 JS 脚本文件链接」就是直接 <script src> 一把梭。
 *
 * 两个版本唯一的差别：
 *   · 标准版 EDITION=std —— 设置里没有「B 站画质」，强制 720P
 *   · HD 版   EDITION=hd  —— 多出 720P/1080P 选项（1080P 由中转 FFmpeg 合流）
 *
 * 产物要提交进仓库：jsDelivr 只从仓库里取文件，CI 会用 git diff 校验它是否最新。
 * 因此这里**不能**写构建时间之类每次都会变的东西，否则每次构建都产生假 diff。
 *
 * 运行：node scripts/build-iirose.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

// 有人的编辑器给 package.json 加 BOM（PowerShell 的 Set-Content 就会），这里兜一下
const pkg = JSON.parse((await readFile(join(root, 'package.json'), 'utf8')).replace(/^\uFEFF/, ''));
// 换行统一成 LF：Windows 的 CRLF 会让产物随机器变化，CI 重建成 LF 就假红
const panelSource = (await readFile(join(root, 'client', 'panel-ui.js'), 'utf8')).replace(/\r\n?/g, '\n');
const mainSource = (await readFile(join(root, 'iirose', 'main.js'), 'utf8')).replace(/\r\n?/g, '\n');

function build(edition) {
  const banner =
    `/*! music-iirose v${pkg.version}${edition === 'hd' ? ' (HD)' : ''} —— IIROSE 点歌台` +
    '（构建产物，别直接改；源码 iirose/main.js + client/panel-ui.js） */';
  // 面板源码直接拼在前面，而不是运行时内联 <script> 注入：
  //   · 站点 CSP 经常拦 inline script，但拦不住已经加载成功的 <script src>
  //   · 少一层动态注入，出错时堆栈也更好看
  return [banner, panelSource, mainSource]
    .join('\n;')
    .split('__VERSION__')
    .join(pkg.version)
    .split('__EDITION__')
    .join(edition);
}

const std = build('std');
const hd = build('hd');

await writeFile(join(root, 'iirose', 'music-iirose.js'), std, 'utf8');
await writeFile(join(root, 'iirose', 'music-iirose-hd.js'), hd, 'utf8');
console.log('built iirose/music-iirose.js     (' + std.length + ' bytes)');
console.log('built iirose/music-iirose-hd.js  (' + hd.length + ' bytes)');
