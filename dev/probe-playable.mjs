/**
 * 第二个探测：确认「哪些歌真的能直接播」。
 *   node dev/probe-playable.mjs
 *
 * 关键问题：
 *   1. 163 VIP 歌（fee=1）在外面拿 url 会不会被拦？
 *   2. 酷狗返回的是不是真 mp3？
 *   3. B 站 dash 音频是 m4a（mp4 容器）—— 浏览器 <audio> 能不能直接吃？
 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const show = (l, v) => console.log('  ' + String(l).padEnd(30) + v);

async function probe(label, url, headers = {}) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Range: 'bytes=0-4095', ...headers },
      signal: AbortSignal.timeout(15000),
    });
    const buf = Buffer.from(await res.arrayBuffer());
    // 容器识别：mp3 = ID3 或 0xFFFB/0xFFF3；mp4/m4a = 'ftyp'；flac = 'fLaC'
    const hex = buf.subarray(0, 12).toString('hex');
    const ascii = buf.subarray(0, 12).toString('latin1').replace(/[^\x20-\x7e]/g, '.');
    let kind = 'unknown';
    if (ascii.startsWith('ID3') || hex.startsWith('fffb') || hex.startsWith('fff3') || hex.startsWith('fff2')) kind = 'mp3';
    else if (ascii.includes('ftyp')) kind = 'mp4/m4a(' + ascii.slice(4, 8) + ')';
    else if (ascii.startsWith('fLaC')) kind = 'flac';
    else if (ascii.startsWith('OggS')) kind = 'ogg';
    show(label, `HTTP ${res.status} ${res.headers.get('content-type')} ${kind} size=${res.headers.get('content-range') || res.headers.get('content-length')}`);
    return { kind, status: res.status };
  } catch (err) {
    show(label, 'ERR ' + String(err.message || err));
    return { kind: 'error', status: 0 };
  }
}

console.log('== 1. 网易云热门 VIP 歌（fee=1）能不能拿到 url ==');
for (const [kw, why] of [['周杰伦 晴天', 'fee=1 大概率'], ['告白气球', 'fee=1']]) {
  const s = await (
    await fetch('https://music.163.com/api/search/get/web?csrf_token=&type=1&offset=0&limit=5&s=' + encodeURIComponent(kw), {
      headers: { 'User-Agent': UA, Referer: 'https://music.163.com/' },
      signal: AbortSignal.timeout(15000),
    })
  ).json();
  for (const song of (s?.result?.songs ?? []).slice(0, 3)) {
    const fee = song.fee;
    const j = await (
      await fetch(`https://music.163.com/api/song/enhance/player/url?ids=[${song.id}]&br=128000`, {
        headers: { 'User-Agent': UA, Referer: 'https://music.163.com/' },
        signal: AbortSignal.timeout(15000),
      })
    ).json();
    const d = j?.data?.[0];
    show(`  [${kw}] fee=${fee}`, `「${String(song.name).slice(0, 16)}」 code=${d?.code} fee=${d?.fee} url=${d?.url ? '有' : 'null'} size=${d?.size}`);
    if (d?.url) await probe('    试播', d.url, { Referer: 'https://music.163.com/' });
  }
}

console.log('\n== 2. 酷狗 getSongInfo 的返回（含 privilege / 是否为真 mp3）==');
{
  const s = await (
    await fetch('https://songsearch.kugou.com/song_search_v2?keyword=' + encodeURIComponent('周杰伦 晴天') + '&page=1&pagesize=3', {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(15000),
    })
  ).json();
  for (const item of (s?.data?.lists ?? []).slice(0, 2)) {
    const hash = item.FileHash;
    const j = await (
      await fetch(`https://m.kugou.com/app/i/getSongInfo.php?cmd=playInfo&hash=${hash}`, {
        headers: { 'User-Agent': UA, Referer: 'https://www.kugou.com/', Cookie: 'kg_mid=1' },
        signal: AbortSignal.timeout(15000),
      })
    ).json();
    show(`  「${String(item.SongName).slice(0, 14)}」`, `status=${j?.status} err=${j?.error || '-'} privilege=${j?.privilege} extName=${j?.extName} bitRate=${j?.bitRate} timeLength=${j?.timeLength}`);
    if (j?.url) await probe('    试播', j.url, { Referer: 'https://www.kugou.com/' });
  }
}

console.log('\n== 3. B 站 dash 音频流是 m4a：<audio> 能否直接播（看容器与 codec）==');
{
  const s = await (
    await fetch('https://api.bilibili.com/x/web-interface/search/type?search_type=video&page=1&page_size=2&keyword=' + encodeURIComponent('晴天 周杰伦 音频'), {
      headers: { 'User-Agent': UA, Referer: 'https://search.bilibili.com/', Cookie: 'buvid3=0' },
      signal: AbortSignal.timeout(15000),
    })
  ).json();
  for (const v of (s?.data?.result ?? []).slice(0, 2)) {
    const view = await (
      await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${v.bvid}`, {
        headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/', Cookie: 'buvid3=0' },
        signal: AbortSignal.timeout(15000),
      })
    ).json();
    const cid = view?.data?.cid;
    const pj = await (
      await fetch(`https://api.bilibili.com/x/player/playurl?bvid=${v.bvid}&cid=${cid}&fnval=16&fourk=1`, {
        headers: { 'User-Agent': UA, Referer: `https://www.bilibili.com/video/${v.bvid}`, Cookie: 'buvid3=0' },
        signal: AbortSignal.timeout(15000),
      })
    ).json();
    const audios = pj?.data?.dash?.audio ?? [];
    show(`  ${v.bvid}`, `音频轨 ${audios.length} 条：` + audios.slice(0, 3).map((a) => `${a.id}/${a.codecs}/${Math.round(a.bandwidth / 1000)}k`).join(' '));
    if (audios[0]) await probe('    试播', audios[0].baseUrl, { Referer: `https://www.bilibili.com/video/${v.bvid}` });
  }
}
