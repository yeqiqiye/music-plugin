/**
 * 云函数产物（relay/serverless.js）的离线自检：不联网，只验证「event → 响应」这一层对不对。
 *
 *   node dev/serverless-smoke.mjs
 *   RELAY_NET=1 node dev/serverless-smoke.mjs    # 额外跑一次真实酷狗搜索
 *
 * 覆盖：阿里云 FC 与腾讯云 SCF 两种 event 形状、根路径说明书、404、CORS 头、base64 响应体。
 */
import { handler } from '../relay/serverless.js';

const failures = [];
const check = (label, cond, extra = '') => {
  console.log((cond ? '  ok   ' : '  FAIL ') + label + (extra ? '  ' + extra : ''));
  if (!cond) failures.push(label);
};

const decode = (res) => {
  const text = res.isBase64Encoded ? Buffer.from(res.body, 'base64').toString('utf8') : String(res.body);
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { text, json };
};

// ---------------- 阿里云 FC 3.0 HTTP 触发器 ----------------
const fcEvent = (path, queryParameters = {}) => ({
  version: 'v1',
  rawPath: path,
  body: '',
  isBase64Encoded: false,
  headers: { Host: 'example.cn-hangzhou.fcapp.run', 'User-Agent': 'fc-test' },
  queryParameters,
  requestContext: {
    domainName: 'example.cn-hangzhou.fcapp.run',
    http: { method: 'GET', path, protocol: 'HTTP/1.1' },
  },
});

const health = await handler(fcEvent('/health'));
const healthBody = decode(health);
check('阿里云：/health 返回 200', health.statusCode === 200, String(health.statusCode));
check('阿里云：响应走 base64', health.isBase64Encoded === true);
check('阿里云：/health 内容正确', healthBody.json?.ok === true && Array.isArray(healthBody.json?.platforms), healthBody.text);
check(
  '阿里云：带 CORS 头',
  String(health.headers['access-control-allow-origin'] || health.headers['Access-Control-Allow-Origin'] || '') === '*',
  JSON.stringify(health.headers).slice(0, 120),
);
check('阿里云：不返回被平台保留的 content-length', !Object.keys(health.headers).some((k) => k.toLowerCase() === 'content-length'));

const root = await handler(fcEvent('/'));
const rootBody = decode(root);
check('阿里云：根路径给说明书', root.statusCode === 200 && Array.isArray(rootBody.json?.endpoints), rootBody.text.slice(0, 60));

const missing = await handler(fcEvent('/nope'));
check('阿里云：未知路径 404', missing.statusCode === 404, String(missing.statusCode));

// ---------------- 腾讯云 SCF + API 网关 ----------------
const scfEvent = (path, queryString = '{}') => ({
  path,
  httpMethod: 'GET',
  headers: { host: 'service-abc.gz.apigw.tencentcs.com', 'user-agent': 'scf-test' },
  queryString,
  requestContext: { httpMethod: 'GET', path },
});

const scfHealth = await handler(scfEvent('/health'));
const scfBody = decode(scfHealth);
check('腾讯云：/health 返回 200', scfHealth.statusCode === 200, String(scfHealth.statusCode));
check('腾讯云：/health 内容正确', scfBody.json?.ok === true, scfBody.text);

const scfSearchShape = await handler(scfEvent('/nope', '{}'));
check('腾讯云：未知路径 404', scfSearchShape.statusCode === 404, String(scfSearchShape.statusCode));

// ---------------- 腾讯云「函数 URL」形状（httpMethod/path/queryString 对象）----------------
const scfUrl = (path, queryString = {}) => ({ body: '', headers: { host: 'x.ap-guangzhou.tencentscf.com' }, httpMethod: 'GET', path, queryString });

const suHealth = await handler(scfUrl('/health'));
check('腾讯云函数URL：/health 200', suHealth.statusCode === 200, String(suHealth.statusCode));
check('腾讯云函数URL：响应是文本（不是 base64）', suHealth.isBase64Encoded === false && suHealth.body.startsWith('{'), String(suHealth.body).slice(0, 40));

const suQuery = await handler(scfUrl('/playurl', { platform: 'nope', id: '1' }));
const suBody = JSON.parse(suQuery.body);
check('腾讯云函数URL：queryString 对象被解析', /不支持的平台/.test(String(suBody.error)), String(suBody.error));
// ---------------- 可选：真实上游 ----------------
if (process.env.RELAY_NET === '1') {
  try {
    const searched = await handler(
      fcEvent('/search', { platform: 'kugou', kw: '晴天', limit: '2', page: '1' }),
    );
    const body = decode(searched);
    check('联网：酷狗搜索经适配层可用', searched.statusCode === 200 && body.json?.data?.length > 0, body.text.slice(0, 80));
  } catch (err) {
    console.log('跳过联网用例：' + String((err && err.message) || err));
  }
}

console.log('');
if (failures.length) {
  console.log('结果：' + failures.length + ' 项失败 -> ' + failures.join(' / '));
  process.exit(1);
}
console.log('结果：全部通过');
