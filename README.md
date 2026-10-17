# dsh-music-request · 点歌台

DSH（DeepSeek Harness）的 Web 插件：按 **Alt+T** 打开面板，跨平台搜歌并**直接在面板里播放**。

## 能力

| 平台 | 搜索 | 直接播放 | 说明 |
|---|---|---|---|
| 网易云音乐 | ✅ | ✅ mp3 128k/320k | `fee=1`（版权锁/VIP）拿不到音频，会明确提示并给「打开」跳转 |
| 酷狗音乐 | ✅ | ✅ mp3 128k | 用 FileHash 换播放地址 |
| QQ 音乐 | ✅ | ❌ 只能跳转 | 公开入口拿不到可直接播放的音频线路 |
| B 站 | ✅ | ✅ m4a（最高码率音频轨） | 适合 Live / MV / 翻唱 |

播放器：播/暂停、上一首/下一首、进度条拖动、音量、队列（点「+ 队列」入列，一首播完自动下一首）。

## 安装（DSH web profile）

```powershell
# 1. 构建客户端产物（只有改了 client/panel-ui.js 才需要）
node scripts/build.mjs

# 2. 挂进 profile
#    profile 目录：%USERPROFILE%\.dsh\profiles\web
#    ① package.json 的 dependencies 加 "dsh-music-request": "file:<本目录绝对路径>"
#    ② package.json 的 dsh.profile.bundles 加 "dsh-music-request"
#    ③ 把本包复制/软链到 <profile>/node_modules/dsh-music-request

# 3. 重启该 profile
dsh --profile web
```

重启后页面里：按 **Alt+T** 开关面板（Esc 关闭）。

## 架构

```
host（Node 侧，lib/）                       client（浏览器侧，client/ + lib/client.js）
  index.mjs    注册 /music/api/* 路由          panel-ui.js  面板 UI（纯 DOM，无框架依赖）
  adapters.mjs 四个平台的搜索 + 归一化          client.js    构建产物：Alt+T、挂面板、同源 fetch
  playurl.mjs  「能不能播/播哪个地址」唯一判断
  proxy.mjs    音频代理（Range 透传 + 域名白名单）
  http.mjs     出站 fetch 的唯一实现
```

为什么必须有 host 半侧：浏览器直接请求这些平台会被 CORS 拦，音频 CDN 还会校验 Referer；
163 返回的播放地址是 `http://`，页面在 localhost/https 下会被混合内容拦。所以搜索与播放都走
同源路由，前端只跟 `/music/api/*` 说话。

## 安全边界

- `/music/api/stream` 是**域名白名单**代理（`.music.126.net` / `.kugou.com` / `.bilivideo.com` 等），
  不在白名单一律 403 —— 否则这个路由会变成任意外网中转。
- 登录只接受用户自己粘贴的 Cookie，存 `%DSH_HOME%/music-plugin/credentials.json`（0600）；
  完整 Cookie 永不回传前端、不写日志。
- 路由只监听本机 loopback（`dsh web` 默认 `127.0.0.1`）。**如果把 host 改成 `0.0.0.0`，
  这些路由没有额外鉴权，请自行加门禁。**

## 开发与自测

```powershell
node scripts/build.mjs            # 构建 lib/client.js
node dev/try-adapters.mjs 周杰伦   # 四个平台搜索是否还通（上游随时可能变）
node dev/probe-playurl.mjs        # 播放地址是否还能拿到（容器/码率/Range）
node dev/smoke-client.mjs         # 假 DOM 跑真实 client.js：Alt+T、面板挂载、播放链路
node dev/server.mjs               # 本地起 3098，浏览器开 /selftest 看逐项自检
```

## 已知问题

- 网易云 `fee=1` 的歌**无法**直接播放（返回 `code=-110`），这是上游版权锁，不是 bug。
- QQ 音乐只能搜索 + 跳转。
- 播放地址有时效签名：`playurl.mjs` 内存缓存 5 分钟，过期会自动重新解析。
- 面板与 `shell.overlay` 插槽的耦合很弱（面板是 `document.body` 直属节点），
  插槽注册失败也不会影响 Alt+T。

## 许可证

[MIT](LICENSE) © 2026 yeqiqiye
