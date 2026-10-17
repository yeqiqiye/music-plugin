/**
 * 出站 HTTP 的唯一实现：超时、UA、失败即抛。
 * 所有平台适配器都从这里走，不在各处各写一份 fetch。
 */
const DEFAULT_TIMEOUT_MS = 8000;

export async function fetchText(url, { headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
    headers,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}${text ? ' - ' + text.slice(0, 120) : ''}`);
  }
  return text;
}

export async function fetchJson(url, options) {
  const text = await fetchText(url, options);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('响应不是合法 JSON（前缀：' + text.slice(0, 80) + '）');
  }
}

/** 给路由用：统一成功/失败信封，绝不把异常甩成 500 让前端没法显示原因。 */
export async function envelope(fn) {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}
