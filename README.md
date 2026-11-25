# cortico-world-live-cue（直播弹幕桥）

把 B 站直播间弹幕桥接成一次「常规唤醒」，让桌宠用**对话气泡**回应观众。
同时把她的回应**零 token** 转发到 QQ 群。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## 它解决什么问题

默认的 `cortico-world-bilibili` 只能把她的回复写到 Overlay 公告板
（`bilibili_set_announcement`），观众看不到「她开口说话」。

本扩展改走 `host.pushEvent` 的**常规唤醒**通道，她的输出就走和 QQ 群一样的路径 → **桌宠气泡出现**。

## 核心特性

| 特性 | 说明 | token 消耗 |
| :-- | :-- | :-- |
| **弹幕 → 气泡** | 观众发弹幕，她以桌宠气泡回应 | 1 次（原本就要花） |
| **礼物 / SC / 上舰** | 三类事件都能触发回应 | 同上 |
| **QQ 消息 → 气泡** | 她发往 QQ 的消息自动推成气泡 | **0** |
| **弹幕回应 → QQ** | 她的弹幕回应转发到群/私聊 | **0** |
| **过滤** | 刷屏 / 纯数字 / 纯表情 / 等级门槛 | 0 |
| **身份优先** | 舰长/管理员跳过节流间隔（不过滤） | 0 |

## 数据流

```
B站直播间 ──SSE(7795)──▶ live-cue ──过滤/节流──▶ pushEvent ──▶ 她回应
                                                              │
                                    ┌─────────────────────────┤
                                    ▼                         ▼
                              桌宠气泡(观众看见)        转发到 QQ 群
                              POST 7797 /api/say       POST NapCat 3000
                                    │                         │
                                    └──── 两条都是 0 token ───┘

QQ 群消息 ──▶ 她回应 ──▶ qq_send ──▶ 群
                              │
                              └─▶ outputTap 旁听 ──▶ POST 7797 /api/say ──▶ 气泡（0 token）
```

## 装完去哪设置

装好、启用之后：

1. 打开 Coo 面板 → 左侧「World 扩展」
2. 找到「**直播弹幕桥**」（图标是弹幕气泡）
3. **点插件名**，进入详情页 → 顶部有「设置」页签

> 设置页分三列：左边「谁给钱、怎么回」，中间「什么时候开口」，右边「话怎么送出去」；最下面是连接参数。改完自动保存。

如果找不到入口：Coo 面板左上角有搜索框，输入「弹幕」也能定位。

---

## 安装

### 依赖（可选）：给 desktop-pet 打 `/api/say` 补丁

**这一步是可选的。不装也能正常用** —— 弹幕、礼物、SC、上舰的回应都正常，只是「她的话不弹桌宠气泡」。

> **给市场审核的说明**：本插件本身不修改任何官方代码。补丁脚本 `scripts/patch_desktop_pet.py` 只用于给桌宠加上一个 HTTP 接口（`/api/say`），属于用户本地的可选增强，**装不装都不影响插件主功能**。

```bash
python scripts/patch_desktop_pet.py           # 检测 + 按需打补丁（幂等）
python scripts/patch_desktop_pet.py --check   # 只检测
python scripts/patch_desktop_pet.py --revert  # 还原
```

> 补丁改的是 Coopanion 内置 `desktop-pet`，**升级会被覆盖**，重跑一次脚本即可补回。

### 安装扩展

**方式 A：Coopanion 扩展页（推荐）**

```
Coopanion → 扩展 → 从本机目录安装 → 选本目录
→ 重启 Coopanion → World 总览 → 启用「直播弹幕桥」
```

**方式 B：命令行**

```bash
cd C:/Users/Administrator/Coopanion/data/extensions
pnpm add file:C:/Users/Administrator/Projects/cortico-world-live-cue
```

## 首次配置清单（必做）

> **装完不配，它什么都不做。** 下面 7 项是必须填的（第 7 项可选），其余都有合理默认值。

### 1. 弹幕从哪来

| 配置 | 填什么 | 不填会怎样 |
| :-- | :-- | :-- |
| `danmakuRoomId` | **你的 B 站直播间号**（纯数字） | 拿不到弹幕、榜单、礼物，整个插件空转 |

> 默认留空。以前的版本写死过一个房间号，正式版已清掉，**必须自己填**。

### 2. 弹幕源地址

| 配置 | 填什么 | 说明 |
| :-- | :-- | :-- |
| `streamUrl` | `http://127.0.0.1:7795/stream` | 一般不用改，前提是 `cortico-world-bilibili` 开着 |

### 3. 回应往哪个 QQ 发

| 配置 | 填什么 | 不填会怎样 |
| :-- | :-- | :-- |
| `qqForwardTargets` | 群号（如 `123456789`）或 `u:QQ号`（私聊给某人）；多个用逗号分隔 | **回应只在本地念，不进 QQ** |

> 想先自己看效果，填 `u:你的QQ号` 只发私聊，确认没问题再改回群。

### 4. 开播播报发给谁

| 配置 | 填什么 | 不填会怎样 |
| :-- | :-- | :-- |
| `liveNoticeTarget` | 群号 | 开播时不 @ 全体、不发通知 |

### 5. 怎么认出「主播自己」

| 配置 | 填什么 | 不填会怎样 |
| :-- | :-- | :-- |
| `ownerUids` | 你的 B 站 UID（多个用逗号） | 识别不出你，**你自己的弹幕会被当成观众**，她可能会回你 |
| `ownerNames` | 你的 B 站昵称 | 同上，作为兜底 |

### 6. 舰长画图找谁确认

| 配置 | 填什么 | 不填会怎样 |
| :-- | :-- | :-- |
| `portraitOwner` | 你的 QQ 号 | 舰长上舰的祝贺画**不会发出去**（没人确认） |

> 这一项是可选的：不填只是「舰长画图」这个功能不工作，其他照常。

### 7. 让她能发弹幕（可选）

| 配置 | 填什么 | 不填会怎样 |
| :-- | :-- | :-- |
| `danmakuCookie` | 浏览器登录 B 站后复制的整条 Cookie（要同时含 `SESSDATA` 和 `bili_jct`） | **她不能发弹幕**；但弹幕接收、QQ 转发、礼物回应都照常 |
| `bili_jct` | 单独填 bili_jct（若上面没填整条 Cookie） | 同上 |

> `SESSDATA` 留空时会自动复用 `cortico-world-bilibili` 插件里那份。**Cookie 只存本地，不会上传**。

---

### 配完之后自检

1. 看控制台 [2] 体检 → 「直播弹幕桥」那几行是不是都 OK
2. 开一次播 → 发一条弹幕「@她 在吗」→ 看是否在 QQ 里收到回应
3. 如果没反应：看 [1] 启动 / [3] 直播设置里的「转发目标」是否为空

## 配置（14 项）

**推荐用 WebUI 面板改**：World 总览 → 直播弹幕桥 → 配置。

### 数据源与频率

| 配置 | 默认 | 范围 | 说明 |
| :-- | :-- | :-- | :-- |
| `streamUrl` | `http://127.0.0.1:7795/stream` | — | B站弹幕 SSE 地址 |
| `gapSec` | 30 | 5–600 | 两条回应最短间隔（秒） |

### 礼物与回应开关

| 配置 | 默认 | 说明 |
| :-- | :-- | :-- |
| `minGiftYuan` | 5 | 礼物金额门槛（元） |
| `replyOnAt` | true | 有人 @ 她时回应 |
| `replyOnQuestion` | true | 含问句时回应 |
| `replyOnSuperChat` | true | SC 必回 |
| `replyOnGuard` | true | 上舰必回 |

### 过滤

| 配置 | 默认 | 说明 |
| :-- | :-- | :-- |
| `blockNoise` | true | 同时过滤刷屏 / 纯数字 / 纯表情 |
| `prioritizeGuard` | true | 舰长/管理员**排队优先**（不跳过滤，只跳节流） |
| `minUserLevel` | 0 | 荣耀等级门槛，0 = 不限 |

### QQ 同步与转发

| 配置 | 默认 | 说明 |
| :-- | :-- | :-- |
| `syncQqToBubble` | true | 把她发往 QQ 的消息记录到面板 + 推成气泡 |
| `forwardToQq` | **false** | 把弹幕回应转发到 QQ |
| `qqForwardTargets` | `（空）` | 群号 / `u:QQ号`（私聊）/ 多个用逗号分隔 |
| `qqForwardFormat` | `full` | `reply` 只发她的话 / `full` 带观众原话 / `important` 只转重要的 |
| `qqForwardGapSec` | 60 | 转发节流（秒） |

### 手动改 JSON

配置段 `worlds.live-cue`：

```json
{
  "worlds": {
    "live-cue": {
      "enabled": true,
      "gapSec": 30,
      "minGiftYuan": 5,
      "blockNoise": true,
      "minUserLevel": 0,
      "forwardToQq": false,
      "qqForwardTargets": "",
      "qqForwardFormat": "full"
    }
  }
}
```

## 面板

| 页签 | 作用 |
| :-- | :-- |
| **配置** | 14 个配置项（框架自动渲染） |
| **QQ 消息记录** | 她发往 QQ 的每条消息（群聊+私聊），带开关/刷新/清空 |

## 开发

### 发版前自检

```bash
npm run prepublish-check
```

会扫四件事：个人标识有没有漏、包信息是否齐（author/license/files）、README 有没有「首次配置」、`src/` 里有没有混进 `.bak`。全过才建议发。



```bash
corepack pnpm install
TMP="$PWD/.tmp" TEMP="$PWD/.tmp" pnpm test    # 单元测试（沙箱必须设 TMP）
ESB="node_modules/.pnpm/esbuild@0.21.5/node_modules/esbuild/bin/esbuild"
"$ESB" src/webui/client.ts --bundle --format=esm --outfile=dist/webui.js
```

同步到 Coopanion（Coopanion 运行时 `pnpm add` 会失败，直接复制）：

```bash
cp src/index.ts src/config.ts src/ENV_PROMPT.md dist/webui.js \
   "C:/Users/Administrator/Coopanion/data/extensions/node_modules/cortico-world-live-cue/"
```

## 文件结构

```
├── src/index.ts          # 入口 + World 实现（SSE/过滤/转发/气泡）
├── src/config.ts         # LIVE_CUE_DEFAULTS + liveCueConfigGroup
├── src/ENV_PROMPT.md     # 给 agent 的环境提示词
├── src/webui/client.ts   # QQ 消息记录面板
├── dist/webui.js         # esbuild 产物
├── scripts/patch_desktop_pet.py   # /api/say 补丁工具
└── test/                 # vitest（world / config / filter / forward）
```

## 安全与隐私

- **只连本地地址**：`127.0.0.1:7795`（SSE）、`127.0.0.1:7797`（气泡）、`127.0.0.1:3000`（NapCat）
- **不读任何用户文件、不读 API Key、不上传任何数据**
- 弹幕文本只在内存里过一遍，不落盘（记录列表也在内存，重启清空）

## 代码来源与许可

**MIT License**（见 [LICENSE](LICENSE)）

| 参考/复用 | 来源 | License |
| :-- | :-- | :-- |
| World 结构 / `pushEvent` / `ui` 原语 / `panels` | [`cortico-world-agenda`](https://github.com/Pal-AI-Lab/Cortico) | MIT |
| `ConfigGroup` 写法 / SSE 协议 / `facts` 字段 | [`cortico-world-bilibili`](https://github.com/Pal-AI-Lab/Cortico) | MIT |
| `outputTap` 旁听 / `callApi` 格式 | [`cortico-world-qq-final`](https://github.com/Pal-AI-Lab/Cortico) | MIT |
| 官方模板 | [`Cortico/templates/extension`](https://github.com/Pal-AI-Lab/Cortico) | MIT |

## 已知限制

| 限制 | 说明 |
| :-- | :-- |
| **`/api/say` 补丁会被升级覆盖** | 跑 `scripts/patch_desktop_pet.py` 补回 |
| **记录在内存** | 重启后「QQ 消息记录」清空 |
| **最多 100 条记录** | 超出丢最旧 |
| **SC/上舰识别靠关键词** | 官方 SSE 只给 `eventKind: danmaku|gift`，需实测校准 |
| **只监听主 session** | 子 session 的输出旁听不到 |
