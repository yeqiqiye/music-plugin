/**
 * 构建 relay/serverless.js —— 给国内云函数（阿里云 FC / 腾讯云 SCF）用的单文件。
 *
 *   node scripts/build-relay.mjs
 *
 * 做的事只有一件：把 relay/worker.js（真正的逻辑）和 relay/serverless-adapter.js（event 适配）
 * 拼成一个文件，并导出 handler / main_handler。云函数平台只能上传「一个入口文件」时用它。
 *
 * Cloudflare Workers 不需要这个产物，直接用 relay/worker.js。
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const worker = await readFile(join(root, 'relay', 'worker.js'), 'utf8');
const adapter = await readFile(join(root, 'relay', 'serverless-adapter.js'), 'utf8');

if (!worker.includes('export const worker')) {
  throw new Error('relay/worker.js 里找不到 `export const worker`，适配层没法引用');
}

const banner = `/*! music-relay serverless (阿里云 FC / 腾讯云 SCF) —— 构建产物，别直接改；源码 relay/worker.js + relay/serverless-adapter.js */`;

const bundle = [banner, worker, adapter].join('\n\n');

await writeFile(join(root, 'relay', 'serverless.js'), bundle + '\n', 'utf8');
console.log('built relay/serverless.js  (' + bundle.length + ' bytes)');
