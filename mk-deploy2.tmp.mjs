import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const src = readFileSync(process.env.TEMP + '\\fc-deploy-relay.mjs', 'utf8');
// 这次部署顺便把 STICKER_SECRET 写进环境变量（没有就生成一个）
let s = src;
if (!s.includes('STICKER_SECRET')) {
  s = s.replace(
    'const body = JSON.stringify({\n  handler: fn.handler || \'index.handler\',',
    `const envVars = Object.assign({}, fn.environmentVariables || {});
if (!envVars.STICKER_SECRET) envVars.STICKER_SECRET = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
console.log('STICKER_SECRET set:', Boolean(envVars.STICKER_SECRET));
const body = JSON.stringify({
  handler: fn.handler || 'index.handler',`,
  );
  s = s.replace('  environmentVariables: fn.environmentVariables || {},', '  environmentVariables: envVars,');
  s = s.replace("import { execFileSync } from 'node:child_process';", "import { execFileSync } from 'node:child_process';\nimport crypto from 'node:crypto';");
}
writeFileSync(process.env.TEMP + '\\fc-deploy-relay2.mjs', s);
console.log('deploy script ready');
