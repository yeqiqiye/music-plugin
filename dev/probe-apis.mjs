/** 探测替代方案：QQ 音乐搜索的其他入口、B 站搜索的风控（412）绕法。 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function probe(name, url, headers = {}) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(12000) });
    const text = await res.text();
    let shape = text.slice(0, 200).replace(/\s+/g, ' ');
    try {
      const j = JSON.parse(text);
      const body = j?.req_1?.data?.body;
      if (body?.song) shape = 'song.list=' + (body.song.list?.length ?? 'n/a') + ' total=' + (body.song.total ?? body.song.totalnum ?? '?');
      else if (j?.data?.result) shape = 'bili result=' + (Array.isArray(j.data.result) ? j.data.result.length : 'not-array');
      else shape = JSON.stringify(j).slice(0, 180);
    } catch { /* 非 JSON，保留原文前缀 */ }
    console.log(`[${res.status}] ${name} (${Date.now() - t0}ms) ${shape}`);
  } catch (err) {
    console.log(`[ERR] ${name} (${Date.now() - t0}ms) ${String(err.message || err)}`);
  }
}

const qqPayload = (method, module, param) =>
  'https://u.y.qq.com/cgi-bin/musicu.fcg?format=json&data=' +
  encodeURIComponent(JSON.stringify({ comm: { ct: 24, cv: 0 }, req_1: { method, module, param } }));

console.log('--- QQ 音乐候选入口 ---');
await probe('QQ desktop GET', qqPayload('DoSearchForQQMusicDesktop', 'music.search.SearchCgiService', { num_per_page: 3, page_num: 1, query: '周杰伦', search_type: 0 }), { Referer: 'https://y.qq.com/' });
await probe('QQ desktop POST', 'https://u.y.qq.com/cgi-bin/musicu.fcg', { Referer: 'https://y.qq.com/' });
await probe('QQ mobile', qqPayload('DoSearchForQQMusicMobile', 'music.search.SearchCgiService', { num_per_page: 3, page_num: 1, query: '周杰伦', search_type: 0 }), { Referer: 'https://y.qq.com/' });
await probe('QQ search_for_qq_cp', 'https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp?format=json&p=1&n=3&w=' + encodeURIComponent('周杰伦'), { Referer: 'https://y.qq.com/portal/search.html' });
await probe('QQ old client_search_cp', 'https://c.y.qq.com/soso/fcgi-bin/client_search_cp?format=json&p=1&n=3&w=' + encodeURIComponent('周杰伦') + '&new_json=1', { Referer: 'https://y.qq.com/portal/search.html' });

console.log('--- B 站候选入口 ---');
const biliHeaders = { Referer: 'https://search.bilibili.com/', Origin: 'https://search.bilibili.com', Accept: 'application/json, text/plain, */*' };
await probe('bili search/type', 'https://api.bilibili.com/x/web-interface/search/type?search_type=video&page=1&page_size=3&keyword=' + encodeURIComponent('周杰伦'), biliHeaders);
await probe('bili search/all/v2', 'https://api.bilibili.com/x/web-interface/wbi/search/all/v2?keyword=' + encodeURIComponent('周杰伦'), biliHeaders);
await probe('bili search/type + buvid', 'https://api.bilibili.com/x/web-interface/search/type?search_type=video&page=1&page_size=3&keyword=' + encodeURIComponent('周杰伦'), { ...biliHeaders, Cookie: 'buvid3=0' });
await probe('bili suggest', 'https://s.search.bilibili.com/main/suggest?term=' + encodeURIComponent('周杰伦'), biliHeaders);
