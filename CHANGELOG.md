# 更新日志

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.8.0] - 2026-11-24

### 新增
- 设置页加「装完去哪设置」引导（README 同步）
- 敏感参数全部改为留空默认：`portraitOwner` / `ownerUids` / `liveNoticeTarget` / `qqForwardTargets` / `danmakuRoomId` 兜底值清空，避免把作者/使用者的个人标识带进发布包
- 代码与提示词里的示例群号、QQ 号、房间号统一换成通用占位（`123456789` / `10001`）

### 变更
- `author` 字段补为 `然哥`（市场详情页不再显示「未提供」）
- README 的补丁段落改为「可选依赖」，并补一段面向市场审核的说明（本插件不修改任何官方代码）

### 修复
- `danmakuRoomId` 为空时不再回落到硬编码房间号，改为 0 并在需要时给出提示

## [0.7.0] - 2026-11（内部版本，未单独发版）
- 榜单口径改为「只按本场礼物金额」，剔除自己；日/周/月榜接口下播即空，仅作校准源
- 速报 20 分钟 ≥2 条（📡现场 / 🐳 / 👉链接 三段式）
- 弹幕长度上限按 40 汉字 / 80 位计算，超长去颜文字重试；风控冷却 120s

## [0.6.5] - 2026-11-06

### 新增
- **数据源自检**：每 60 秒检查 SSE 是否连着、多久没收到数据；开播中「断流 2 分钟」或「SSE 连着但 5 分钟没数据」→ 桌宠气泡报警（0 token，10 分钟最多一次）。「现场实况」面板新增 `source` 块（`sse` / `silentMin` / `live` / `storeCursor`），先分清是数据没进来，还是她自己不回。
- **直播画面（Overlay）面板**：把 B站插件的 `/overlay` 直接嵌进设置窗口预览，带「刷新预览 / 打开编辑器 / 复制 OBS 地址」三个按钮；地址由 `streamUrl` 推导，7795 被占用顺延时也能跟对。

### 变更
- `fromStoreEvent` 接受 `archive-only` 的 **礼物 / SC / 上舰 / 进场 / 开播** 存档（B站插件 `modelFeed=false` 时只写存档，契约变了）；弹幕与人气仍只认 `deliver`，不会双回。

## [0.6.4] - 2026-11-06

### 新增
- **礼物合并窗口 `giftMergeSec`（默认 6 秒）**：窗口内收到的多个礼物合并成「一条」事件（如 `人气票×3、鼓掌声`）只唤醒模型一次，窗口安静后结算。省 token 也避免连珠炮刷屏；0 = 关闭。
- **桌宠表情动作 `petActionRate`（默认 2）**：每条提示词末尾追加一行「直播画面会拍到你」的提醒，让她在 `pet_say` 脚本开头带 `【表情, 动作】`（词表来自 `{{pet.vocab}}`，不重复占 token）。OBS 抓桌宠画面时观众能看到。0 = 不带。
- 设置面板左列「游戏道具礼物必回」「礼物合并窗口」，右列「弹幕带颜文字」「桌宠表情动作频率」。

### 变更
- `sameUserGapSec` 默认 15 → **10 秒**；`guardBurstSec` 默认 20 → **15 秒**（依据 11-05 直播日志：被挡的 31 条间隔中位数 12 秒）。
- 默认值与运行时对齐：`minGiftYuan=1`、`replyEmoteOnly=false`。

### 修复
- 礼物合并后数量重复显示（`body` 已含 ×N 时不再叠加 `count`）。

## [0.4.0] - 2026-10-25

### 新增
- **弹幕回应转发到 QQ**：`forwardToQq` / `qqForwardTargets` / `qqForwardFormat` / `qqForwardGapSec` 四个配置，支持群与私聊（`u:` 前缀），三种格式（`reply` / `full` / `important`）。走 NapCat HTTP，**0 token**。
- **弹幕过滤**：`blockNoise`（刷屏 / 纯数字 / 纯表情三合一）、`minUserLevel`（荣耀等级门槛）。
- **自定义面板「QQ 消息记录」**：记录她发往 QQ 的每条消息（去重，最多 100 条），带开关、刷新、清空。
- **0 token 气泡直推**：`recordQq()` 后 POST `http://127.0.0.1:7797/api/say`，不经过模型。

### 变更
- **身份优先逻辑修正**：舰长/管理员不再豁免过滤，只享有「排队优先」（跳过节流间隔），照样过 `blockNoise` 和 `minUserLevel`。
- **三个独立屏蔽开关合并为 `blockNoise`**（原 `blockSpam` / `blockPureNumber` / `blockPureEmoji` 已删除）。
- **`syncQqToBubble` 从配置页移除**，只在「QQ 消息记录」面板里控制（避免双开关混淆）。

### 修复
- 同一轮内重复调用 `pet_say` 导致两条近似气泡：新增 `petSayCount` 计数，第二轮直接跳过。
- 面板 `setEnabled` 不持久化：改走 `ctx.persist()`。
- `ctx.invoke` 参数数量错误（签名只有 `method, args?`）。
- `ui.h` 第二参数误用 style 对象（实际是 className），改用 `ui` 原语。

## [0.3.0] - 2026-10-25

### 新增
- WebUI 配置面板：`config.ts` 声明 `ConfigGroup`，WebUI 自动渲染表单。
- 「QQ 同步气泡」独立面板（`panels` + `invoke`）。
- 统一噪声过滤三个开关（后合并）、身份优先、等级门槛。

## [0.2.0] - 2026-10-25

### 新增
- `outputTap` 旁听 `qq_send`，记录到面板。
- `/api/say` 补丁支持（改内置 desktop-pet）。

## [0.1.0] - 2026-10-25

### 新增
- 首个可用版本：订阅 B站 SSE（7795）→ 过滤 → `pushEvent` 唤醒她 → 桌宠气泡回应。
- 支持弹幕 / 礼物 / SC / 上舰四类事件。
- 26 个单元测试。

## 0.6.2 — 2026-11-05 · 面板白屏彻底修复（换文件名）

- **TDZ 根治**：`numField/textField/areaField/boolField` 从 const 箭头改为 function 声明（整体提升），任何调用顺序都不会再抛 `Cannot access 'xxx' before initialization`。
- **换文件名绕缓存**：产物改为 `dist/webui-0.6.2.js`，`cortico.webUiClient` 同步指向它——旧 URL 在任何一层（内存模块表 / HTTP 缓存）的缓存全部失效，必然加载新包。
- **教训**：① pnpm 对 `file:` 依赖按**文件**硬链接，新建文件不会自动出现在安装目录，必须手动 cp；② 改 `dist/webui.js` 必须同时升 version；③ 应用窗口只在整包重启（Coopanion.exe 重启）时才重载面板脚本，`/api/run/shutdown` 只重启内核、不动窗口。

## 0.6.1 — 2026-11-05 · 修复设置面板白屏（TDZ）

- 设置面板把「本局游戏」整块挪到控件工厂之后，修 `Cannot access 'textField' before initialization`。
- **升版本号才能让浏览器换新包**：前端资源 URL 是 `/assets/extensions/<包>/<版本>/webui.js`，版本不变就命中旧缓存。以后改 `dist/webui.js` 必须同时升 version。

## 0.6.0 — 2026-11-05 · 现场感重做 + 设置页三列化

### 新增
- **现场上下文（scene）**：每轮提示词带上「【现场】现在几点 + 刚才这一幕」（最近 6 条弹幕/礼物/SC/进场 + 高能榜人数），她终于知道直播间此刻在发生什么。
- **自绘「设置」面板**：三列布局（必回与打赏 / 什么时候开口 / 话怎么送出去）+ 底部「高级」折叠区，覆盖全部 41 项；改完 450ms 自动保存、立即生效，不再挂 41 项一字排开的 schema 表单。
- **现场实况面板**自绘：计数卡 + 跳过原因 + 最近判定表。
- `blockWords`（屏蔽词）：照抄咩播「屏蔽敏感词汇」，命中只压机会型，点名/礼物/SC/上舰照回。

### 变更
- **弹幕字数上限 20 → 80**（实测 B 站直播间上限 80），`replyMaxChars` 默认 40。
- **舰长欢迎不再用固定话术**：删掉「上座/唱名/点灯/报数/锣响」轮换，改成「拿此刻直播间正在发生的事接他」；`guardWelcomeStyles` 默认留空 = 完全自由发挥。
- **礼物回应改成「游戏内效果」叙事**：不报价、不谢老板，先说游戏里发生了什么，再给一句短反应；对照表放环境提示词里，表里没有就按礼物名猜。
- **SC 不再一律甩给房主**：提示词分成「自己能答」和「必须房主拍板」两路，后者也要求换说法。

### 修复
- 礼物提示词把「礼物名 ×N」重复拼了两次。

## 0.5.1 — 2026-11-05 · 礼物/SC/上舰接上官方事件库 + 舰长仪式感

### 新增
- **事件库补全（useStoreEvents）**：礼物 / SC / 上舰 改从宿主 `host.store` 读 `bilibili.gift` / `bilibili.superchat` / `bilibili.guard` / `bilibili.enter-guard`，带真实 `meta.yuan` 与 `guardLevel`。根因：overlay 投影（`bilibili/src/overlay/project.ts`）只给「礼物名×数量」，金额被丢掉，旧版按 `minGiftYuan` 判断会把所有礼物当 0 元丢弃——这就是「礼物全无回应」的原因。
- **舰长 / 提督 / 总督 进场欢迎**：`guardWelcome` / `guardWelcomePerDay` / `guardWelcomeStyles`。按「人 + 自然日」计数并写盘（`worlds/live-cue/guard-welcome.json`），每人每天默认 1 次；风格轮换 + 名次 + 「刚才说过的话」三重去重，保证每次不一样。
- **SC 读完再回（scDelaySec）**：默认 8 秒后才让模型开口，提示词要求先用半句复述对方诉求再回答。
- **小额礼物不静默丢弃（cheapGiftAsChance）**：低于门槛降级为机会型，有空就谢一句。
- **屏蔽名单（blockUsers）**：照抄咩播的「屏蔽用户名」，模糊包含即命中。
- **现场实况面板**：必回/机会/过滤计数、跳过原因排行、最近 60 条判定、最近说过的 4 句。
- **发弹幕风控自动退避**：命中频率类返回码时冷却 120 秒，不用手调间隔。

### 变更
- **`minUserLevel` 默认改 0**：绝大多数观众荣耀等级是 0，填 1 会把普通观众全屏蔽（线上实测过）。
- **`maxPerHour` 只统计机会型**：必回项不再被小时上限吃掉。
- **`qqForwardFormat` 默认改 `important`**：直播时群里只收 @她 / 礼物 / SC，不刷屏。
- **发弹幕按标点断句**：`clipDanmaku()` 在 20 字内优先断在句读，不带省略号、不带 emoji，避免半句话被截断。

### 修复
- `pickAmount()` 认不出 `¥30` 这种写法（SC 正文只写 ¥，不写「元」）。
- 舰长进场被当成普通进场（`guardLevel>0` 未走必回通道）。

## 0.5.0 — 2026-11-05 · 有活人感的三层直播助理

- 新增 **意图与优先级判定层**：`classifyIntent()` 把事件分成 P0 必回 / P1 机会 / P2 不回，并给出 reason（at-or-keyword / gift / superchat / guard / guard-admin / question / chatty / hostile / peer-chat / noise …）。
- **必回 100% 不受限频**：礼物达门槛、SC、上舰、@或关键词、舰长/房管弹幕。
- **机会型回应**：没点名她的问句 / 有内容的闲聊，受 `chanceGapSec`（默认 90 秒）约束；`0` = 关闭机会回应。
- **限频改为可选**：`gapSec` 支持 `0` = 完全关闭（只约束机会型，必回从不受限）。
- 新增 **过滤层**：不友善弹幕（内置词表 + `hostileWords`）、说给房主/别人的对话（`blockPeerChat`，@别人 / 「某某你…」）。
- 去重：同人同内容 90 秒；同人 20 秒内只回一条（防连珠炮）。
- 提示词层：`buildPrompt()` 按事件类型给人设化指令（15~30 字、口语、别客服腔、别复读）；礼物/SC/上舰/进场各有专属口气。
- **修复**：`promptDocs` 未注册 → ENV_PROMPT.md 从未注入；现已在 `webUi()` 注册，变量改为无连字符（`livecue.*`）以确保渲染。
- 面板徽章新增：限频状态、机会回应间隔、必回/机会计数、过滤计数。
- 测试：105 项通过（新增 intent 13 项 + routing 8 项）。
