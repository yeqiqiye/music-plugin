/**
 * 探测 QQ `search_for_qq_cp` 的字段形状，以及 B 站带 Cookie 后的字段形状。
 * 结论会直接改进 lib/adapters.mjs。
 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const qqUrl =
  'https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp?format=json&p=1&n=2&w=' + encodeURIComponent('周杰伦');
const qqRes = await fetch(qqUrl, {
  headers: { 'User-Agent': UA, Referer: 'https://y.qq.com/portal/search.html' },
  signal: AbortSignal.timeout(12000),
});
const qq = await qqRes.json();
console.log('=== QQ search_for_qq_cp ===');
console.log('data keys:', Object.keys(qq.data ?? {}));
const song = qq.data?.song;
console.log('song keys:', song ? Object.keys(song) : null);
console.log('first song item:\n' + JSON.stringify(song?.list?.[0], null, 1).slice(0, 1400));

const biliRes = await fetch(
  'https://api.bilibili.com/x/web-interface/search/type?search_type=video&page=1&page_size=2&keyword=' +
    encodeURIComponent('周杰伦'),
  {
    headers: {
      'User-Agent': UA,
      Referer: 'https://search.bilibili.com/',
      Origin: 'https://search.bilibili.com',
      Accept: 'application/json, text/plain, */*',
      Cookie: 'buvid3=0',
    },
    signal: AbortSignal.timeout(12000),
  },
);
const bili = await biliRes.json();
console.log('\n=== B 站 search/type（带 buvid3=0）===');
console.log('code:', bili.code, 'result len:', bili.data?.result?.length);
console.log('first item keys:', bili.data?.result?.[0] ? Object.keys(bili.data.result[0]).slice(0, 40) : null);
console.log('first item:\n' + JSON.stringify(bili.data?.result?.[0], null, 1).slice(0, 1200));
