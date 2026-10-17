/** 直接跑四个平台适配器，确认能拿到真实结果（不经过 UI）。 */
import { PLATFORMS } from '../lib/adapters.mjs';
import { envelope } from '../lib/http.mjs';

const keyword = process.argv[2] || '周杰伦';

for (const [id, adapter] of Object.entries(PLATFORMS)) {
  const t0 = Date.now();
  const out = await envelope(() => adapter.search({ keyword, limit: 3, offset: 0 }));
  const dt = Date.now() - t0;
  if (!out.ok) {
    console.log(`- ${id.padEnd(9)} FAIL(${dt}ms) ${out.error}`);
    continue;
  }
  console.log(`- ${id.padEnd(9)} ok(${dt}ms) ${out.data.length} 条`);
  for (const s of out.data.slice(0, 3)) {
    console.log(`    ${s.title} | ${s.artists.join('/')} | ${s.album} | vip=${s.vip} | ${s.url}`);
  }
}
