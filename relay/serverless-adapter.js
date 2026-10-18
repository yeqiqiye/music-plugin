/**
 * 服务器函数适配层（这个文件本身不单独部署，构建时拼在 worker.js 后面生成 relay/serverless.js）。
 *
 * 目标：同一份中转逻辑，既能跑在 Cloudflare Workers（Web Request/Response），
 * 也能跑在阿里云函数计算 FC / 腾讯云 SCF 的 HTTP 触发器上（event/response 那一套）。
 *
 * 两家的入参形状：
 *   阿里云 FC 3.0（内置运行时 + HTTP 触发器）
 *     { version:'v1', rawPath, headers, queryParameters, body, isBase64Encoded,
 *       requestContext: { domainName, http: { method, path } } }
 *     返回 { statusCode, headers, body, isBase64Encoded }
 *   腾讯云 SCF（API 网关触发器，需开启「集成响应」）
 *     { path, httpMethod, headers, queryString（JSON 字符串）, queryStringParameters, requestContext }
 *     返回 { statusCode, headers, body, isBase64Encoded }
 *
 * 注意：两家对「响应体」都是先整块拿到再返回，所以 B 站那种几 MB 的音频要靠 Range 分段；
 * 单次响应过大（SCF 约 6MB / FC 16MB）会失败——这是平台限制，不是代码问题。
 */

/** FC/SCF 不允许自己设的响应头，设了会被丢掉甚至报错，这里主动过滤 */
const RESERVED_HEADERS = new Set([
  'connection',
  'content-length',
  'date',
  'keep-alive',
  'server',
  'content-disposition',
  'transfer-encoding',
]);

function pickMethod(event) {
  return (
    event?.requestContext?.http?.method ||
    event?.httpMethod ||
    event?.requestContext?.httpMethod ||
    event?.requestContext?.http?.method ||
    'GET'
  ).toUpperCase();
}

function pickPath(event) {
  // requestContext.http.path 是 URL 解码后的；rawPath 是编码过的
  return event?.requestContext?.http?.path || event?.path || event?.rawPath || '/';
}

function pickHost(event) {
  const host =
    event?.headers?.host ||
    event?.headers?.Host ||
    event?.requestContext?.domainName ||
    '';
  return String(host).split(',')[0].trim() || 'relay.local';
}

function pickQuery(event) {
  const out = new URLSearchParams();
  const add = (k, v) => {
    if (v == null) return;
    // 两家都会把同名参数用逗号拼起来，这里原样拆回多个值
    for (const part of String(v).split(',')) out.append(k, part);
  };

  if (event?.queryParameters && typeof event.queryParameters === 'object') {
    for (const [k, v] of Object.entries(event.queryParameters)) add(k, v);
  } else if (event?.queryStringParameters && typeof event.queryStringParameters === 'object') {
    for (const [k, v] of Object.entries(event.queryStringParameters)) add(k, v);
  } else if (typeof event?.queryString === 'string' && event.queryString.trim().startsWith('{')) {
    try {
      for (const [k, v] of Object.entries(JSON.parse(event.queryString))) add(k, v);
    } catch {
      /* 解析失败就当没参数 */
    }
  } else if (typeof event?.queryString === 'string' && event.queryString) {
    for (const [k, v] of new URLSearchParams(event.queryString)) add(k, v);
  }
  return out;
}

/** event → Web Request */
function toRequest(event) {
  const qs = pickQuery(event).toString();
  const url = `https://${pickHost(event)}${pickPath(event)}${qs ? '?' + qs : ''}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(event?.headers || {})) {
    if (v == null) continue;
    try {
      headers.set(k, String(v));
    } catch {
      /* 非法头名忽略 */
    }
  }
  return new Request(url, { method: pickMethod(event), headers });
}

/** Web Response → event 响应（统一 base64，音频也不怕） */
async function toResult(response) {
  const headers = {};
  response.headers.forEach((v, k) => {
    const lower = k.toLowerCase();
    if (RESERVED_HEADERS.has(lower) || lower.startsWith('x-fc-')) return;
    headers[k] = v;
  });
  const buf = Buffer.from(await response.arrayBuffer());
  return {
    statusCode: response.status,
    headers,
    isBase64Encoded: true,
    body: buf.toString('base64'),
  };
}

/**
 * 阿里云 FC 的入口（请求处理程序填 index.handler）
 * 腾讯云 SCF 的入口（请求处理程序填 index.main_handler）
 */
export async function handler(event) {
  try {
    const response = await worker.fetch(toRequest(event));
    return await toResult(response);
  } catch (err) {
    return {
      statusCode: 502,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      isBase64Encoded: false,
      body: JSON.stringify({ ok: false, error: String((err && err.message) || err) }),
    };
  }
}

export const main_handler = handler;
export const main = handler;
