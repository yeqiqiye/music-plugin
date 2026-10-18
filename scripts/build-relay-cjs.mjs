/**
 * 构建 relay/serverless.cjs —— 给「只吃 CommonJS」的云函数平台用（比如腾讯云 SCF）。
 *
 *   node scripts/build-relay-cjs.mjs
 *
 * 背景：腾讯云 SCF 的 Node.js 运行时对 .mjs（ES Module）支持不稳，实测 `.mjs` 入口会
 * CreateFailed（codeSize=0），而同样内容的 `.js`（CommonJS）正常。所以这里把
 * relay/worker.js + relay/serverless-adapter.js 里的 `export` 改写成 `module.exports`。
 *
 * 阿里云 FC 用 ESM 没问题（relay/serverless.js），腾讯云用本文件的产物（改名 index.js）。
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const worker = await readFile(join(root, 'relay', 'worker.js'), 'utf8');
const adapter = await readFile(join(root, 'relay', 'serverless-adapter.js'), 'utf8');

let code = [worker, adapter].join('\n\n');

// 去掉 ESM 的 export，改由末尾统一 module.exports 暴露
code = code.replace(/^export default worker;\s*$/m, '');
code = code.replace(/^export const worker = \{/m, 'const worker = {');
code = code.replace(/^export async function handler\(/m, 'async function handler(');
code = code.replace(/^export const main_handler = handler;.*$/m, '');
code = code.replace(/^export const main = handler;.*$/m, '');
code = code.replace(/^export /gm, '');

if (/\bexport\b/.test(code.split('\n').filter((l) => l.trim().startsWith('export')).join('\n'))) {
  throw new Error('还有没清掉的 export，检查一下构建脚本');
}

const banner = '/*! music-relay for 腾讯云 SCF（CommonJS 构建产物，别直接改；源码 relay/worker.js + relay/serverless-adapter.js） */';
const out = `${banner}\n"use strict";\n\n${code}\nmodule.exports = { handler, main_handler: handler, main: handler, worker };\n`;

await writeFile(join(root, 'relay', 'serverless.cjs'), out, 'utf8');
console.log('built relay/serverless.cjs  (' + out.length + ' bytes)');
