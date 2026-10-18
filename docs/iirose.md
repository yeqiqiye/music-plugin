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
| 会员曲（网易云） | 中转里配 `NETEASE_COOKIE` 即可；没配也能放免费曲 |

> 配中转**不用开 F12**：没配过的时候右下角会多一个 **⚙**，点开填地址就行（见下文）。

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

> ⚠️ `*.workers.dev` 在部分网络（尤其国内）会被 DNS 污染，解析到一个不相干的 IP、连接超时。
> 表现是：Cloudflare 控制台里预览正常，但你自己浏览器打不开 `/health`。这时候别怀疑代码，
> 走下面「国内云函数」或者给 Worker 绑一个自己的域名。

### 国内云函数（不绑域名也能用）

Cloudflare 的 `workers.dev` 打不开时，同一份逻辑可以直接跑在阿里云函数计算 FC 或腾讯云 SCF 上，
默认域名国内可达、不用备案。用构建好的单文件产物：[`relay/serverless.js`](../relay/serverless.js)
（= `relay/worker.js` + `relay/serverless-adapter.js`，`npm run build:relay` 生成）。

#### 阿里云函数计算 FC（推荐，步骤最少）

1. 函数计算控制台 → **函数** → **创建函数** → **事件函数**；
2. 运行环境选 **Node.js 20**，请求处理程序填 `index.handler`；
3. 代码编辑器里新建 / 覆盖 `index.mjs`，把 [`relay/serverless.js`](../relay/serverless.js) 全部粘进去
   （**文件名必须是 `.mjs`**，因为它是 ES Module）；
4. 部署代码 → 函数详情 → **配置 → 触发器** → 创建 **HTTP 触发器**（认证方式：**无需认证**）；
5. 拿到形如 `https://xxxx.cn-hangzhou.fcapp.run` 的地址，浏览器打开
   `https://xxxx.cn-hangzhou.fcapp.run/health`，看到 `{"ok":true,...}` 就成了；
6. IIROSE 里 `localStorage.setItem('mk_iirose_relay', 'https://xxxx.cn-hangzhou.fcapp.run')` + 刷新。

#### 腾讯云 SCF（函数 URL）

> 注意：腾讯云 **API 网关已停售**，新建触发请用「函数 URL」，不要选 API 网关。
> 另外 SCF 的 Node 运行时对 `.mjs` 支持不稳（新建会 CreateFailed），**必须用 CommonJS**：
> 入口文件是 [`relay/serverless.cjs`](../relay/serverless.cjs)，存成 `index.js`。

1. 云函数 → 新建 → **Node.js 18** → 运行角色默认即可；
2. 函数代码里新建 `index.js`，粘贴 [`relay/serverless.cjs`](../relay/serverless.cjs)；
   请求处理程序填 `index.main_handler`；
3. 函数详情 → 左侧 **函数 URL** → **新建** → 勾选 **公网访问**、授权类型选 **开放（NONE）**；
4. 拿到形如 `https://xxxx.ap-guangzhou.tencentscf.com` 的地址，访问 `/health`；
5. 把它写进 `mk_iirose_relay`。

> SCF 的函数 URL **不支持二进制响应**，所以 B 站的 `/stream` 代理用不了（会直接给 CDN 地址）。
> 酷狗、网易云的音频都是 CDN 直链，不受影响。

> 云函数的响应是「先收全再返回」，所以 B 站音频要靠 Range 分段，单个响应太大会被平台掐断
> （SCF 约 6MB、FC 16MB）。正常播放器都是分段请求，一般没事；真遇到大文件失败，换酷狗源。

### 不用 Cloudflare 也行

同一份逻辑能直接跑在 Node 上（`relay/dev-server.mjs`）：

```powershell
npm run relay                 # 默认 127.0.0.1:8799
curl "http://127.0.0.1:8799/health"
```

但页面是 https，直连 `http://127.0.0.1` 会被混合内容拦 —— 要么在外面套一层 https 反代
（nginx / frp / cloudflared tunnel），要么就用云函数。**别把没有任何鉴权的它直接开到公网。**

### 接口（想自己实现也行）

```
GET /search?platform=netease|kugou|bilibili&kw=..&limit=..&page=..  → { ok, data: Song[] }
GET /playurl?platform=netease|kugou|bilibili&id=..                  → { ok, data: { playable, streamUrl, ext, bitrate } }
GET /stream?platform=bilibili&url=..                                → 音频字节（Range 透传，补 Referer）
GET /health                                                         → { ok, platforms }
```

所有响应都带 `Access-Control-Allow-Origin: *`；中转本身不存任何东西（Cookie 只以环境变量形式存在）。

## 用你自己的会员（Cookie）

中转支持两个环境变量（Cloudflare Worker：**Settings → Variables and Secrets → Add → Secret**）：

| 变量 | 作用 |
|---|---|
| `NETEASE_COOKIE` | 网易云搜索/取地址都带上它。**有会员时，VIP 曲能拿到真实音频** |
| `KUGOU_COOKIE` | 可选；酷狗的接口会带上，对部分付费曲有用（未逐一验证） |

### 怎么拿到网易云 Cookie

1. 浏览器打开 `https://music.163.com` 并登录；
2. F12 → **Network**（网络）→ 刷新页面；
3. 随便点一条 `music.163.com` 的请求 → **Request Headers** → `Cookie`；
4. 右键 → **Copy value**，形如 `MUSIC_U=xxxx; __csrf=yyyy; NMTID=zzz;`；
5. 粘到 Worker 的 `NETEASE_COOKIE` secret 里，Deploy/保存后立即生效，不需要改代码。

> ⚠️ Cookie 等于账号登录态：只放在**你自己的** Worker 里，别贴给第三方接口、别进 Git。
> 换设备/改密码会失效，失效后重新复制一次即可。
> 另外：数字专辑（需单独购买）即使有会员也拿不到，接口会返回「可能受限制」。

> 在 IIROSE 里按 F12 有时会被站点的反调试搞到页面反复刷新 —— 那和本项目无关。
> 配中转不需要 F12（用右下角 ⚙），只有复制网易云 Cookie 才需要用一次 DevTools（在 music.163.com 上用）。

## 热键与模式

| 操作 | 说明 |
|---|---|
| `Alt+T` | 开关面板（也可以在 DevTools 里 `__MUSIC_IIROSE__.panel.open()`） |
| 右下角 ♪ | 悬浮球。浏览器抢走 Alt+T（Firefox 的工具栏）时用它；**按住可以拖动** |
| 悬浮球右上角 × | **隐藏悬浮球**（位置和隐藏状态都会记住） |
| **双指上滑** | 手机上打开点歌台；悬浮球被隐藏后也靠它叫回来 |
| 顶栏「点播到房间 / 仅本机试听」 | 切模式，选择会被记住（`localStorage.mk_iirose_mode`） |
| `Esc` | 关闭面板 |

改热键（默认 `Alt+T`，支持 `Ctrl+Shift+M` 这种写法）：

```js
localStorage.setItem('mk_iirose_hotkey', 'Alt+M'); // 刷新后生效
```

## 手机上怎么用

手机上没有 `Alt+T`，所以做了两条入口：

| 手势 / 操作 | 效果 |
|---|---|
| **双指在页面上向上滑**（约 90px） | 打开点歌台，同时把隐藏的悬浮球叫回来 |
| 点悬浮球 | 开 / 关面板 |
| **按住悬浮球拖动** | 挪到不挡视野的位置，松手就记住（下次打开还在原处） |
| 点悬浮球右上角 **×** | 隐藏悬浮球；之后用双指上滑再叫出来 |

面板在小屏上会自动变成整屏，隐藏「打开 / 搜」这类次要链接，播放按钮和翻页键都加大了。

### 搜用户 / 搜歌单（批量点歌）

搜索框下面有 **歌曲 / 用户 / 歌单** 三个范围（配了中转才有）：

1. 选「歌单」→ 输入关键词（例如 `周杰伦 精选`）→ 点歌单直接进去；
2. 歌单详情页顶部有 **「全部入队（N）」**，一次把整个歌单塞进队列；
3. 选「用户」→ 点某个人 → 看 TA 公开的歌单 → 再点进去同样可以全部入队。

> 搜用户 / 歌单目前只有**网易云**支持；切到酷狗 / B 站 / QQ 会提示「该平台不支持」。
> 「全部入队」只进本机队列（最多一次 100 首），不会一口气往房间里发 100 条点播。

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
| v0.3.4 | 移动端：双指上滑开面板、悬浮球可拖动/隐藏；新增搜用户 / 搜歌单 + 歌单「全部入队」 |
| v0.3.1 | 网易云也走中转（可配 NETEASE_COOKIE 解锁会员曲）；面板右下角 ⚙ 直接配中转，不用 F12 |
| v0.3.0 | 翻页；酷狗 / B 站（需配中转 elay/worker.js）；B 站音频走中转补 Referer |
| v0.2.0 | 首个 IIROSE 版：搜索、点播两帧、房间播放回显、试听模式、兜底指令 |

## 已知限制

- 网易云直连可用；**酷狗 / B 站必须配中转**（原因见上）。
- 房间必须允许点播；播放地址约 20 分钟过期（B 站 `m4s` 也是带签名的）。
- 依赖第三方接口 `api.shadowsee.icu`（可用 `mk_iirose_api` 换基址）。
- 房间的「媒体白名单」如果只放行官方平台，外链可能被拒——这时用「指令」兜底。
- B 站的音频轨是 `m4s`（`application/octet-stream`），个别播放器可能按后缀猜格式；已经能播，
  但如果遇到某台设备不响，优先换一首或换酷狗源。
