# 发布流程（照着做，一步不用想）

> 给不熟开发流程的人看的。每一步都写了「做什么」和「怎么确认成功」。

---

## 0. 准备：确认三件事齐了

| 检查 | 怎么确认 |
| :-- | :-- |
| 自检通过 | `npm run prepublish-check` → 最后一行显示「结论：可以发」 |
| 测试通过 | `npm test` → 显示所有测试 passed |
| 版本号对 | `package.json` 的 `version` 和 `CHANGELOG.md` 最新一条一致 |

**三件缺一件都别往下走。**

---

## 1. 改版本号（如果这次有改动）

**规则**（语义化版本）：

| 改了什么 | 版本怎么变 | 例子 |
| :-- | :-- | :-- |
| 只修 bug | 最后一位 +1 | 0.8.0 → 0.8.1 |
| 加了功能 | 中间一位 +1，最后归零 | 0.8.0 → 0.9.0 |
| 大改/不兼容 | 第一位 +1 | 0.8.0 → 1.0.0 |

改两个地方，**必须一致**：

1. `package.json` 的 `version`
2. `CHANGELOG.md` 里加一节 `## [x.y.z] - 日期`

---

## 2. 本地打包试一下（不发布，只看内容对不对）

```bash
npm pack --dry-run
```

**看三样**：

| 看什么 | 正常值 | 不正常怎么办 |
| :-- | :-- | :-- |
| total files | 20 左右 | 超过 50 说明把测试/文档打进去了，检查 `files` 白名单 |
| package size | 170 kB 左右 | 超过 1 MB 说明把旧版构建产物打进去了 |
| 有没有 `docs/`、`test/`、`.bak` | **不应该有** | 有就移走 |

---

## 3. 建 GitHub 仓库（只做一次）

> **这一步需要你的 GitHub 账号，我没法替你做。**

```bash
# 在项目目录下
git init
git add .
git commit -m "feat: 首次发布 0.8.0"
gh repo create <你的用户名>/cortico-world-live-cue --public --source=. --push
```

**如果没装 `gh`**：去 github.com 手动建一个空仓库，然后按它给的提示 push。

**建完之后**，回来改 `package.json`，把这三项填上（npm 页面会显示）：

```json
"repository": { "type": "git", "url": "git+https://github.com/<你>/cortico-world-live-cue.git" },
"homepage": "https://github.com/<你>/cortico-world-live-cue#readme",
"bugs": { "url": "https://github.com/<你>/cortico-world-live-cue/issues" }
```

---

## 4. 发布到插件市场

按 Coo 的插件市场流程走（上传 tarball 或填仓库地址，看你那边的要求）。

**发之前最后确认一次**：

- [ ] `npm run prepublish-check` 通过
- [ ] `npm test` 通过
- [ ] `npm pack --dry-run` 里没有 docs/test/.bak
- [ ] README 的「首次配置清单」是最新的
- [ ] 版本号和 CHANGELOG 一致

---

## 5. 发完之后（重要，别省）

### 5.1 自己装一遍

**这是最容易被跳过、也最容易发现问题的一步。**

1. 把 `config.json` 里的 `worlds.live-cue` 整段删掉（先备份）
2. 重新装载插件
3. 按 README 的「首次配置清单」从零填一遍
4. 看能不能跑起来

**能跑通 = 用户也能。跑不通 = 用户会来骂。**

### 5.2 盯前三条 issue

发出去第一周，问题会集中在这三类：

| 类型 | 典型问法 | 处理 |
| :-- | :-- | :-- |
| 装了不工作 | 「为什么她不理弹幕」 | 八成是没填房间号/转发目标 → 让他跑 `prepublish-check` 看配置 |
| 连不上 | 「弹幕不进来」 | 检查 `cortico-world-bilibili` 有没有开 |
| 发不出声 | 「语音是文字」 | 看日志是 `action=tts` 还是 `未能合成` |

**把这三类问题写进 README 的「常见问题」**，能省掉后面 80% 的重复回答。

---

## 6. 以后每次改完（固定动作）

```bash
npm run prepublish-check   # 1. 自检
npm test                   # 2. 测试
npm pack --dry-run         # 3. 看包里有没有多余文件
```

三步都过再改版本号发布。

**这三步加起来不到一分钟，能挡住 90% 的低级错误。**

---

## 附：这次发布做了什么（留个记录）

| 项 | 结果 |
| :-- | :-- |
| 源码脱敏 | 10 处个人标识清空（QQ / 群号 / 房间号 / UID） |
| README | 加「首次配置清单」7 项 + 「发版前自检」说明 |
| 自检脚本 | `scripts/prepublish_check.py`（查四项） |
| 包体积 | 205.5 kB → **166.6 kB**（清掉 12 个旧版 webui） |
| 文件数 | 32 → **20** |
| CHANGELOG | 补到 0.8.0 |
