/**
 * 点歌台 host 半侧：注册 /music/api/* 路由。
 *
 * 为什么必须有 host 半侧：浏览器直接 fetch 网易云 / QQ 音乐 / 酷狗 / B 站会被 CORS 挡住，
 * 而这些接口在服务端出站是通的。所以搜索由这里代理，前端只跟同源路由说话。
 *
 * 凭据策略（唯一写盘的东西）：
 *   · 只接受用户自己粘贴的 Cookie，存 DSH_HOME/music-plugin/credentials.json（0600）
 *   · 完整 Cookie 永不回传前端，只回 { loggedIn, nickname }
 *   · 不写进任何日志
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { PLATFORMS, PLATFORM_LIST } from './adapters.mjs';
import { envelope, fetchJson } from './http.mjs';
import { isAllowedAudioHost, resolvePlayUrl, upstreamHeaders } from './playurl.mjs';
import { proxyAudio } from './proxy.mjs';

export const name = 'dsh-music-request';
export const inject = ['webServer'];

const BASE = '/music/api';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

function readBody(req, limitBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function apply(ctx) {
  if (apply.__installed) {
    // 同一进程内重复 apply（例如 profile 被重载）时不要重复注册路由。
    return;
  }
  apply.__installed = true;

  const webServer = ctx.webServer;
  if (!webServer || typeof webServer.register !== 'function') {
    throw new Error('music-request: 缺少 webServer 服务，无法注册路由');
  }

  const log = (...args) => {
    try {
      if (typeof ctx.logger === 'function') ctx.logger(name)(...args);
      else if (ctx.logger && typeof ctx.logger.info === 'function') ctx.logger.info(...args);
    } catch {
      /* 日志失败不影响功能 */
    }
  };

  // ---------- 凭据 ----------
  const home = process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh');
  const credDir = join(home, 'music-plugin');
  const credFile = join(credDir, 'credentials.json');

  let creds = null; // { netease: { cookie, nickname, verifiedAt } }

  async function loadCreds() {
    if (creds) return creds;
    try {
      creds = JSON.parse(await readFile(credFile, 'utf8'));
    } catch {
      creds = {};
    }
    return creds;
  }

  async function saveCreds(next) {
    creds = next;
    await mkdir(dirname(credFile), { recursive: true });
    await writeFile(credFile, JSON.stringify(next, null, 2), { mode: 0o600 });
  }

  const mask = (cookie) => {
    const m = /MUSIC_U=([^;]+)/.exec(cookie || '');
    return m ? 'MUSIC_U=' + m[1].slice(0, 4) + '…' : '(no MUSIC_U)';
  };

  /** 用 163 的 account 接口确认这串 Cookie 是否有效，顺便取昵称。 */
  async function verifyNetease(cookie) {
    const json = await fetchJson(
      'https://music.163.com/api/nuser/account/get?csrf_token=' +
        (/(?:^|;\s*)__csrf=([^;]+)/.exec(cookie || '')?.[1] ?? ''),
      { headers: { 'User-Agent': UA, Cookie: cookie, Referer: 'https://music.163.com/' } },
    );
    const profile = json?.profile ?? json?.account ?? null;
    if (!profile || !profile.userId) return { loggedIn: false, nickname: null };
    return { loggedIn: true, nickname: profile.nickname ?? null, userId: String(profile.userId) };
  }

  // ---------- 路由 ----------
  const disposers = [];

  disposers.push(
    webServer.register({
      kind: 'exact',
      path: BASE + '/platforms',
      handler: (req, res) => {
        if ((req.method || 'GET').toUpperCase() !== 'GET') {
          res.statusCode = 405;
          res.end();
          return;
        }
        sendJson(res, 200, { ok: true, data: PLATFORM_LIST });
      },
    }),
  );

  disposers.push(
    webServer.register({
      kind: 'exact',
      path: BASE + '/search',
      handler: async (req, res) => {
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        const platform = url.searchParams.get('platform') || 'netease';
        const keyword = (url.searchParams.get('kw') || '').trim();
        const limit = Math.min(30, Math.max(1, Number(url.searchParams.get('limit') || 20)));
        const adapter = PLATFORMS[platform];
        if (!adapter) {
          sendJson(res, 400, { ok: false, error: '不认识的平台：' + platform });
          return;
        }
        if (!keyword) {
          sendJson(res, 200, { ok: true, data: [] });
          return;
        }
        const out = await envelope(() => adapter.search({ keyword, limit, offset: 0 }));
        if (!out.ok) log('搜索失败', platform, keyword, out.error);
        sendJson(res, 200, out);
      },
    }),
  );

  disposers.push(
    webServer.register({
      kind: 'exact',
      path: BASE + '/playurl',
      handler: async (req, res) => {
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        const platform = url.searchParams.get('platform') || '';
        const id = url.searchParams.get('id') || '';
        if (!platform || !id) {
          sendJson(res, 400, { ok: false, error: '需要 platform 与 id' });
          return;
        }
        const info = await resolvePlayUrl(platform, id);
        if (!info.playable) {
          sendJson(res, 200, { ok: true, data: info });
          return;
        }
        // 只把「同源代理地址」交给前端，不暴露上游 CDN 地址：
        // 这样前端不用管 referer/CORS，也不会被混合内容拦。
        sendJson(res, 200, {
          ok: true,
          data: {
            playable: true,
            streamUrl:
              BASE +
              '/stream?platform=' +
              encodeURIComponent(platform) +
              '&url=' +
              encodeURIComponent(info.url),
            ext: info.ext,
            bitrate: info.bitrate,
            size: info.size,
            expiresInSec: info.expiresInSec,
          },
        });
      },
    }),
  );

  disposers.push(
    webServer.register({
      kind: 'exact',
      path: BASE + '/stream',
      handler: async (req, res) => {
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        const platform = url.searchParams.get('platform') || '';
        const target = url.searchParams.get('url') || '';
        if (!target) {
          res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('缺少 url');
          return;
        }
        // 白名单是硬边界：这个路由绝不能变成任意 URL 中转。
        if (!isAllowedAudioHost(target)) {
          res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('拒绝：不在允许的音频域名白名单内');
          return;
        }
        try {
          await proxyAudio(req, res, { url: target, headers: upstreamHeaders(platform) });
        } catch (err) {
          log('代理音频失败', target, String((err && err.message) || err));
          if (!res.headersSent) {
            res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
            res.end('代理失败：' + String((err && err.message) || err));
          } else {
            res.destroy?.();
          }
        }
      },
    }),
  );

  disposers.push(
    webServer.register({
      kind: 'exact',
      path: BASE + '/session',
      handler: async (req, res) => {
        const c = await loadCreds();
        const entry = c.netease;
        sendJson(res, 200, {
          ok: true,
          data: {
            platform: 'netease',
            loggedIn: Boolean(entry && entry.verifiedAt),
            nickname: entry?.nickname ?? null,
            hasCookie: Boolean(entry?.cookie),
          },
        });
      },
    }),
  );

  disposers.push(
    webServer.register({
      kind: 'exact',
      path: BASE + '/login',
      handler: async (req, res) => {
        if ((req.method || 'GET').toUpperCase() !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        const out = await envelope(async () => {
          const raw = await readBody(req);
          let body;
          try {
            body = JSON.parse(raw || '{}');
          } catch {
            throw new Error('请求体不是 JSON');
          }
          const cookie = String(body.cookie || '').trim();
          if (!cookie) throw new Error('Cookie 为空');
          if (cookie.length > 8000) throw new Error('Cookie 太长，确认只粘贴了请求头那一行');
          const info = await verifyNetease(cookie);
          const c = await loadCreds();
          c.netease = {
            cookie,
            nickname: info.nickname,
            verifiedAt: info.loggedIn ? Date.now() : null,
            userId: info.userId ?? null,
          };
          await saveCreds(c);
          // 只回身份信息，绝不回 cookie
          return { platform: 'netease', loggedIn: info.loggedIn, nickname: info.nickname };
        });
        if (out.ok && out.data && out.data.loggedIn) log('网易云登录成功');
        sendJson(res, 200, out);
      },
    }),
  );

  disposers.push(
    webServer.register({
      kind: 'exact',
      path: BASE + '/logout',
      handler: async (req, res) => {
        const out = await envelope(async () => {
          const c = await loadCreds();
          delete c.netease;
          await saveCreds(c);
          return { loggedIn: false };
        });
        sendJson(res, 200, out);
      },
    }),
  );

  ctx.effect?.(() => () => {
    for (const dispose of disposers) {
      try {
        dispose();
      } catch {
        /* 卸载期的清理失败不值得抛 */
      }
    }
    apply.__installed = false;
  }, 'dsh-music-request: routes');

  log('已注册路由：' + BASE + '/{platforms,search,session,login,logout}');
}
