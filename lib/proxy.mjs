/**
 * 音频流代理：把上游 CDN 的字节原样转给浏览器，并把 Range 语义透传下去。
 *
 * 为什么要代理而不是让 <audio> 直接指上游：
 *   1. 这些 CDN 校验 Referer，浏览器直接放会 403；
 *   2. CORS 不让跨域；
 *   3. 163 返回的是 http:// 地址，页面在 localhost/https 下会被混合内容拦。
 *
 * 安全边界：只有白名单域名能过（见 playurl.mjs 的 isAllowedAudioHost）——
 * 否则这个路由就成了任意外网中转，不能留。
 */

export async function proxyAudio(req, res, { url, headers = {}, fallbackContentType = 'audio/mpeg' }) {
  const range = req.headers.range;
  const upstream = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    headers: { ...headers, ...(range ? { Range: range } : {}) },
    signal: AbortSignal.timeout(30000),
  });

  if (!upstream.ok && upstream.status !== 206) {
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('上游返回 HTTP ' + upstream.status);
    return upstream.status;
  }

  const out = {
    'content-type': upstream.headers.get('content-type') || fallbackContentType,
    'accept-ranges': upstream.headers.get('accept-ranges') || 'bytes',
    'cache-control': 'no-store',
  };
  const len = upstream.headers.get('content-length');
  if (len) out['content-length'] = len;
  const cr = upstream.headers.get('content-range');
  if (cr) out['content-range'] = cr;

  res.writeHead(upstream.status, out);

  if (!upstream.body) {
    res.end();
    return upstream.status;
  }
  try {
    for await (const chunk of upstream.body) {
      if (!res.write(chunk)) {
        // 下游背压：等 drain 再继续，避免把整个音频读进内存
        await new Promise((resolve) => res.once('drain', resolve));
      }
    }
    res.end();
  } catch (err) {
    // 客户端中途断开（拖动进度条）是常态，不当错误处理
    res.destroy?.();
  }
  return upstream.status;
}
