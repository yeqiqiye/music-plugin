# IIROSE 版：一个链接，在房间里点歌

把点歌台做成 IIROSE 的**用户脚本**：粘一个 https 链接进「引用 JS 脚本文件链接」，刷新后
面板就长在页面上，点好的歌**进房间歌单**，不是只给自己听。

- 不需要装 Node、不需要服务器、不需要账号
- 只有一个 JS 文件，走 CDN（jsDelivr 从本仓库的 tag 取文件）

## 能做什么

| 能力 | 说明 |
|---|---|
| 搜索 | 网易云（经 `api.shadowsee.icu` 的 `/cloudsearch`），带封面、时长、VIP 标记 |
| 翻页 | 结果底部「‹ 上一页 / 第 N 页 / 下一页 ›」，每页 10/20/30 条可选 |
| 点播到房间 | 点 ▶ → 服务器收到两帧，歌进房间歌单，公屏出现点播卡片 |
| 只在本机听 | 面板顶栏切成「仅本机试听」，用 163 的 https 直链本地播，不进房间 |
| 队列 | 「+ 队列」入列，上一首/下一首按队列走 |
| 房间状态 | 面板显示「房间正在播放：歌名 - 歌手」（监听 `&1` 媒体帧） |
| 兜底 | 每行的「指令」按钮复制 `@@歌名 歌手`，房间不让点播时自己粘聊天框 |
| 酷狗 / B 站 | **需要配一个中转**（见下文），配好后自动多两个 tab |

## 安装（三步）

1. 打开 IIROSE → 设置里找到「引用 JS 脚本文件链接」那个对话框；
2. 粘下面任意一行（有多个脚本就一行一个）：
   ```
   https://cdn.jsdelivr.net.cn/gh/yeqiqiye/music-plugin@v0.2.0/iirose/music-iirose.js
   ```
3. 刷新页面（F5），进一个 **音乐分享 / 视频分享** 属性的房间。

然后：按 **Alt+T**，或者点右下角的 **♪** 悬浮球。

> 三种 CDN 地址，哪个快用哪个（内容完全一样）：
>
> - `https://cdn.jsdelivr.net.cn/gh/yeqiqiye/music-plugin@v0.2.0/iirose/music-iirose.js`
> - `https://fastly.jsdelivr.net/gh/yeqiqiye/music-plugin@v0.2.0/iirose/music-iirose.js`
> - `https://gcore.jsdelivr.net/gh/yeqiqiye/music-plugin@v0.2.0/iirose/music-iirose.js`

## 房间要求（这条最容易卡住）

只有属性是 **音乐分享** 或 **视频分享** 的房间才能点播。普通/音乐/视频属性的房间
（比如「花园之门」「桥洞」）即使帧发出去了也不会有人播。

进错房间的表现：面板显示「已点播」，但房间里没动静。这时换房间，或点「指令」把
`@@歌名 歌手` 粘到聊天框试试。

## 翻页

结果列表底部有一条：

```
‹ 上一页    第 2 页    下一页 ›
```

- 「每页条数」在搜索框右边的下拉里（10 / 20 / 30），改了之后从第 1 页重新搜；
- 本页拿满（比如 20 条）才允许「下一页」，拿不满就是到最后一页了；
- 翻过头会提示「没有更多了」，已经看到的结果不会被清掉。

## 酷狗 / B 站：为什么需要一个中转

直连搜不到，不是漏了，是上游真卡着：

| 平台 | 卡在哪 |
|---|---|
| 酷狗 | 搜索接口能 JSONP，但「hash → 播放地址」那个接口**不返回 CORS 头**，浏览器读不到 |
| B 站 | 搜索/播放地址接口有反爬，裸请求直接 **412 / 403**，必须服务端带 UA + Referer + Cookie |
| 公共 CORS 代理 | 试过 codetabs / allorigins / corsproxy：前两个 522，最后一个现在要 API key —— 不能当正式方案 |

所以酷狗和 B 站走一个**只中转元数据**的小服务（搜索 + 播放地址，都是几 KB 的 JSON）。
音频本身：酷狗是 CDN 直链（匿名可取），B 站走中转的 `/stream` 补上 Referer 再吐给播放器。

### 部署（Cloudflare Workers，免费额度足够）

> **先看清楚三件事，能避开 90% 的坑：**
> 1. 要建的是 **Worker**，不是 **Pages**。Pages 是托管静态站点的，会把你的仓库当站点去 build。
> 2. **不要填 Git 仓库地址**。中转是一个单文件 Worker，用控制台的在线编辑器粘贴就行；
>    连 GitHub 的那套（Continue with GitHub → 构建命令 → `wrangler deploy`）是给完整项目用的，
>    本仓库没有 `wrangler.json`，套上去只会失败。
> 3. 别把**文章链接**当仓库地址粘进去。日志里出现
>    `Cloning repository... Failed: error occurred while fetching https://.../posts/...`
>    就是这一步错了 —— Cloudflare 去 clone 一个 HTML 页面，当然失败。

1. Cloudflare 控制台 → **Workers & Pages** → **Create application** → **Workers** → **Create Worker**
   （选 "Start with Hello World"，不要选 Pages，也不要选 Continue with GitHub）；
2. 给个名字（例如 `music-relay`），点 **Deploy**；
3. 点 **Edit code**（在线编辑器），把仓库里的 [`relay/worker.js`](../relay/worker.js) 整份内容
   覆盖进去 —— 保留它开头的 `export default { async fetch(request) { ... } }`，再 **Deploy**；
4. 记下地址，例如 `https://music-relay.你的子域.workers.dev`，浏览器直接打开
   `https://music-relay.你的子域.workers.dev/health` 应该看到 `{"ok":true,...}`；
5. 在 IIROSE 页面按 F12，控制台执行：

```js
localStorage.setItem('mk_iirose_relay', 'https://music-relay.你的子域.workers.dev');
location.reload();
```

刷新后点歌台会多出 **酷狗音乐** 和 **B 站（音频轨）** 两个 tab。没配中转时这两个 tab 不显示。

### 不用 Cloudflare 也行

同一份逻辑能直接跑在 Node 上（`relay/dev-server.mjs`）：

```powershell
npm run relay                 # 默认 127.0.0.1:8799
curl "http://127.0.0.1:8799/health"
```

但页面是 https，直连 `http://127.0.0.1` 会被混合内容拦 —— 要么在外面套一层 https 反代
（nginx / frp / cloudflared tunnel），要么就用 Workers。**别把没有任何鉴权的它直接开到公网。**

### 接口（想自己实现也行）

```
GET /search?platform=kugou|bilibili&kw=..&limit=..&page=..   → { ok, data: Song[] }
GET /playurl?platform=kugou|bilibili&id=..                   → { ok, data: { playable, streamUrl, ext, bitrate } }
GET /stream?platform=bilibili&url=..                         → 音频字节（Range 透传，补 Referer）
GET /health                                                  → { ok, platforms }
```

所有响应都带 `Access-Control-Allow-Origin: *`，不读 cookie，不存任何东西。

## 热键与模式

| 操作 | 说明 |
|---|---|
| `Alt+T` | 开关面板（也可以在 DevTools 里 `__MUSIC_IIROSE__.panel.open()`） |
| 右下角 ♪ | 悬浮球。浏览器抢走 Alt+T（Firefox 的工具栏）时用它 |
| 顶栏「点播到房间 / 仅本机试听」 | 切模式，选择会被记住（`localStorage.mk_iirose_mode`） |
| `Esc` | 关闭面板 |

改热键（默认 `Alt+T`，支持 `Ctrl+Shift+M` 这种写法）：

```js
localStorage.setItem('mk_iirose_hotkey', 'Alt+M'); // 刷新后生效
```

## 它是怎么"发到房间"的

IIROSE 的房间播放器由页面自己的 WebSocket 驱动，协议是社区逆向出来的，正好有现成的
参考实现（koishi 的 IIROSE 适配器）。点一次 ▶ 我们发两帧：

```js
// 1) 媒体数据帧：服务器据此入队
socket.send('&1' + JSON.stringify({
  s: 's://m702.music.126.net/.../track.mp3',  // 音频直链，去掉 "http" 前缀
  d: 279,                                      // 时长（秒）
  c: 's://p3.music.126.net/.../cover.jpg',     // 封面
  n: '晴天', r: '周杰伦',
  b: '@0',                                     // @0 = 网易云
  o: 's://music.163.com/song?id=1901371647',
  l: null,                                     // 歌词（不传）
}));

// 2) 点播卡片：公屏上那张卡
socket.send(JSON.stringify({
  g: uid,                                      // 自己的 uid
  m: 'm__4@0>晴天>周杰伦>https://...jpg>#ff9800>128',
  mc: '#ff9800',
  i: '645111455863',                           // 消息 id
}));
```

几个关键点：

- **socket 在哪**：`window.socket`，或者 `#mainFrame.contentWindow.socket`（IIROSE 的应用可能跑在
  iframe 里）。脚本两层都找了，找不到就提示「请先进房间」。
- **为什么要自己解析音频**：`&1` 帧里必须带**能直接播的音频地址**，所以搜索之后还要问一次
  `/song/url/v1` 拿 163 的 https 直链（这个 CDN 支持 Range、`ACAO: *`、不校验 Referer）。
- **为什么不本地播**：房间播放器已经会播了，面板再放一遍就是双声。所以「点播到房间」模式下
  `<audio>` 完全不参与。
- **为什么不自己搭后端**：`api.shadowsee.icu` 对 `https://iirose.com` 回了 CORS 白名单
  （IIROSE 自己的客户端很可能也在用它），所以浏览器能直连，省掉一整个服务端。

## 常见问题

**点了 ▶ 房间没反应？**
先确认房间属性（见上）。再看 `__MUSIC_IIROSE__.framesSent` 有没有涨；没涨说明没找到 socket，
进房间后按 F5 重来。

**提示「这首拿不到音频」？**
该曲在网易云是版权锁/会员专享，接口返回 `url: null`。换一首，或点「指令」让 IIROSE 自己解析
（它可能有自己的会员通道，成不成看平台）。

**面板打不开？**
`Alt+T` 可能被浏览器占用 → 点右下角 ♪。仍然没有的话，按 F12 看 `__MUSIC_IIROSE__`：
`state: 'error'` 后面就是原因。

**搜索报错 / 一直转？**
`api.shadowsee.icu` 挂了或你网络到不了。换一个同类接口（任何兼容网易云 API 的服务）：

```js
localStorage.setItem('mk_iirose_api', 'https://你的接口域名');
```

`localStorage.removeItem('mk_iirose_api')` 恢复默认。

**队列排了十几首，后面的歌放到一半断了？**
播放地址带 20 分钟签名（`expi=1200`），排太久后段会过期 —— 官方点播也是同样的行为。
长歌单建议分批点。

**会不会只支持网易云？**
这个版本是。QQ/酷狗/B 站的解析需要另外的接口，暂不做；想要的话用「指令」兜底，IIROSE
自己的客户端支持这几个平台。

## 自检

DevTools 控制台：

```js
__MUSIC_IIROSE__            // { version, mounted, state, socketOk, framesSent, roomNow, api }
__MUSIC_IIROSE__.panel.open()
```

`state: 'ready'` + `socketOk: true` 就说明能用了。

## 版本与更新

脚本地址里带 tag（`@v0.2.0`）。升级时把地址里的版本号改掉再刷新即可，
jsDelivr 会按 tag 取新文件；改完记得刷新一次页面（CDN 有缓存）。

| 版本 | 内容 |
|---|---|
| v0.3.0 | 翻页；酷狗 / B 站（需配中转 `relay/worker.js`）；B 站音频走中转补 Referer |
| v0.2.0 | 首个 IIROSE 版：搜索、点播两帧、房间播放回显、试听模式、兜底指令 |

## 已知限制

- 网易云直连可用；**酷狗 / B 站必须配中转**（原因见上）。
- 房间必须允许点播；播放地址约 20 分钟过期（B 站 `m4s` 也是带签名的）。
- 依赖第三方接口 `api.shadowsee.icu`（可用 `mk_iirose_api` 换基址）。
- 房间的「媒体白名单」如果只放行官方平台，外链可能被拒——这时用「指令」兜底。
- B 站的音频轨是 `m4s`（`application/octet-stream`），个别播放器可能按后缀猜格式；已经能播，
  但如果遇到某台设备不响，优先换一首或换酷狗源。
