/**
 * 探测：各平台能不能拿到「可直接播放的音频地址」，以及是否支持 Range（拖动进度条）。
 *   node dev/probe-playurl.mjs
 *
 * 这个脚本的结论直接决定 lib/playurl.mjs 里哪些平台可以"直接播"、哪些只能"跳转"。
 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const show = (label, value) => console.log('  ' + label.padEnd(28) + value);

async function head(label, url, headers = {}) {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': UA, Range: 'bytes=0-2047', ...headers },
      signal: AbortSignal.timeout(15000),
    });
    const ct = res.headers.get('content-type');
    const cr = res.headers.get('content-range');
    const cl = res.headers.get('content-length');
    const buf = Buffer.from(await res.arrayBuffer());
    const magic = buf.subarray(0, 4).toString('hex');
    show(label, `HTTP ${res.status} ct=${ct} len=${cl} range=${cr || '-'} magic=${magic} first=${buf.subarray(0, 12).toString('latin1').replace(/[^\x20-\x7e]/g, '.')}`);
    return res.status === 200 || res.status === 206;
  } catch (err) {
    show(label, 'ERR ' + String(err.message || err));
    return false;
  }
}

console.log('== 1. 网易云：拿 free 歌曲的播放地址 ==');
try {
  const search = await (
    await fetch('https://music.163.com/api/search/get/web?csrf_token=&type=1&offset=0&limit=8&s=' + encodeURIComponent('晴天'), {
      headers: { 'User-Agent': UA, Referer: 'https://music.163.com/' },
      signal: AbortSignal.timeout(15000),
    })
  ).json();
  const songs = search?.result?.songs ?? [];
  show('搜索结果数', songs.length);
  for (const s of songs.slice(0, 6)) {
    show(`  id=${s.id} fee=${s.fee}`, String(s.name).slice(0, 30) + ' / ' + (s.artists ?? []).map((a) => a.name).join(','));
  }
  for (const s of songs.slice(0, 4)) {
    const url = `https://music.163.com/api/song/enhance/player/url?ids=[${s.id}]&br=128000`;
    try {
      const j = await (
        await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://music.163.com/' }, signal: AbortSignal.timeout(15000) })
      ).json();
      const d = j?.data?.[0];
      const okUrl = d?.url || null;
      show(`  163 id=${s.id} fee=${s.fee}`, `code=${d?.code} br=${d?.br} size=${d?.size} url=${okUrl ? okUrl.slice(0, 60) + '…' : 'null'}`);
      if (okUrl) await head(`    试听 id=${s.id}`, okUrl, { Referer: 'https://music.163.com/' });
    } catch (err) {
      show(`  163 id=${s.id}`, 'ERR ' + String(err.message || err));
    }
  }
} catch (err) {
  show('网易云搜索', 'ERR ' + String(err.message || err));
}

console.log('\n== 2. 酷狗：search → get_res + playurl ==');
try {
  const s = await (
    await fetch('https://songsearch.kugou.com/song_search_v2?keyword=' + encodeURIComponent('晴天') + '&page=1&pagesize=5', {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(15000),
    })
  ).json();
  const list = s?.data?.lists ?? [];
  show('搜索结果数', list.length);
  for (const item of list.slice(0, 3)) {
    const hash = item.FileHash || item.HQFileHash || item.SQFileHash;
    const albumId = item.AlbumID ?? item.AlbumId;
    show(`  ${String(item.SongName).slice(0, 18)} hash=${String(hash).slice(0, 12)}… album=${albumId} dur=${item.Duration}`);
    // 新版 get_res 需要 mid（从 item.EMixSongID / Audioid 里取）与 album_audio_id
    const mid = item.EMixSongID || item.Audioid || item.MixSongID;
    const cands = [
      `https://wwwapi.kugou.com/yy/index.php?r=play/getdata&hash=${hash}&album_id=${albumId}&mid=${mid}&platid=4&_=${Date.now()}`,
      `https://m.kugou.com/app/i/getSongInfo.php?cmd=playInfo&hash=${hash}`,
      `https://trackercdn.kugou.com/i/v2/?key=${hash}&hash=${hash}&br=hq&appid=1005&pid=2&cmd=25&behavior=play`,
    ];
    for (const u of cands) {
      try {
        const res = await fetch(u, {
          headers: { 'User-Agent': UA, Referer: 'https://www.kugou.com/', Cookie: 'kg_mid=1' },
          signal: AbortSignal.timeout(15000),
        });
        const text = await res.text();
        let info = text.slice(0, 100).replace(/\s+/g, ' ');
        let playUrl = null;
        try {
          const j = JSON.parse(text);
          playUrl = j?.data?.play_url || j?.url || (Array.isArray(j?.url) ? j.url[0] : null) || j?.data?.play_backup_url;
          info = `keys=${Object.keys(j?.data ?? j ?? {}).slice(0, 8).join(',')} play_url=${playUrl ? 'YES' : 'null'}`;
        } catch {
          /* 非 JSON */
        }
        show(`    [${u.split('/')[2]}] ${res.status}`, info);
        if (playUrl) {
          await head('      试听', playUrl, { Referer: 'https://www.kugou.com/' });
          break;
        }
      } catch (err) {
        show(`    [${u.split('/')[2]}]`, 'ERR ' + String(err.message || err));
      }
    }
  }
} catch (err) {
  show('酷狗搜索', 'ERR ' + String(err.message || err));
}

console.log('\n== 3. B 站：search → view → playurl（取音频流）==');
try {
  const s = await (
    await fetch('https://api.bilibili.com/x/web-interface/search/type?search_type=video&page=1&page_size=3&keyword=' + encodeURIComponent('晴天 周杰伦'), {
      headers: { 'User-Agent': UA, Referer: 'https://search.bilibili.com/', Cookie: 'buvid3=0' },
      signal: AbortSignal.timeout(15000),
    })
  ).json();
  for (const v of (s?.data?.result ?? []).slice(0, 2)) {
    const bvid = v.bvid;
    show('  视频', `${bvid} ${String(v.title).replace(/<[^>]*>/g, '').slice(0, 26)}`);
    const view = await (
      await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, {
        headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/', Cookie: 'buvid3=0' },
        signal: AbortSignal.timeout(15000),
      })
    ).json();
    const cid = view?.data?.cid;
    const aid = view?.data?.aid;
    show('    cid/aid', `${cid} / ${aid}`);
    if (!cid) continue;
    const pu = `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&fnval=16&fourk=1`;
    const pj = await (
      await fetch(pu, {
        headers: { 'User-Agent': UA, Referer: `https://www.bilibili.com/video/${bvid}`, Cookie: 'buvid3=0' },
        signal: AbortSignal.timeout(15000),
      })
    ).json();
    const dash = pj?.data?.dash;
    const audio = dash?.audio?.[0]?.baseUrl || dash?.audio?.[0]?.base_url;
    const durl = pj?.data?.durl?.[0]?.url;
    show('    playurl', `code=${pj?.code} dash_audio=${audio ? 'YES' : 'null'} durl=${durl ? 'YES' : 'null'}`);
    if (audio) await head('      音频流', audio, { Referer: `https://www.bilibili.com/video/${bvid}` });
    if (durl) await head('      durl', durl, { Referer: `https://www.bilibili.com/video/${bvid}` });
  }
} catch (err) {
  show('B 站', 'ERR ' + String(err.message || err));
}
