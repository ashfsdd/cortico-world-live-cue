/**
 * cortico-world-live-cue —— 直播弹幕桥
 *
 * 把 B 站直播间弹幕桥接成一次「常规唤醒」，
 * 让桌宠用对话气泡（而不是 Overlay 公告板）回应观众。
 *
 * 数据来源（两条，各管一段）：
 *   1. 弹幕 / 进场：cortico-world-bilibili 的 overlay SSE → GET http://127.0.0.1:7795/stream
 *      （实时、逐条，带 guardLevel / medalLevel / isAdmin）
 *   2. 礼物 / 醒目留言 / 上舰：宿主事件库 host.store → bilibili.gift / bilibili.superchat / bilibili.guard
 *      为什么不用 SSE：overlay 投影只给「礼物名×数量」，把金额丢了（见 bilibili/src/overlay/project.ts），
 *      照它判门槛会把所有礼物误判成 0 元。事件库那份带 meta.yuan / meta.guardLevel，与官方插件同源。
 *
 * 许可证：MIT
 * 结构参考：cortico-world-agenda（MIT, Pal AI Lab / 筆離嘢）
 * SSE 协议参考：cortico-world-bilibili（MIT, Pal AI Lab）
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { GIFT_PRICE } from './gift-price.ts';
import { loadSession, saveSession, recordGift, resumeSession, topRank, newSession, calcDeviation, matchOwner, type RankSession } from './rank-store.ts';
import {
  reportDir, saveReport, listReports, pickPendingReport, buildReportText, looksSafe, loadReport, loadNarrative, narrativePath, stripKaomoji,
  type DailyReport,
} from './report-store.ts';
import { dirname, join } from 'node:path';
import { LIVE_CUE_DEFAULTS, liveCueConfigGroup } from './config.ts';

const execFileP = promisify(execFile);
/** B站命令行（bili CLI），发动态用 */
// 2026-11-23 发布准备：不再写死个人路径；优先环境变量，其次 PATH 里的 bili
const BILLI_BIN = process.env.BILI_BIN || 'bili';
/** NapCat 的 OneBot HTTP 口 */
const NAPCAT_BASE = 'http://127.0.0.1:3000';

// ───────────────────────────────────────────────
// 配置（必须含 WorldSection 的 enabled）
// ───────────────────────────────────────────────

export interface LiveCueConfig {
  /** World 启用开关（框架要求） */
  enabled: boolean;
  /** 7795 SSE 地址 */
  streamUrl: string;
  /** 从事件库补全礼物/SC/上舰（overlay 流不带金额） */
  useStoreEvents: boolean;
  /** 两次唤醒最短间隔（秒） */
  gapSec: number;
  /** 礼物金额门槛（元） */
  minGiftYuan: number;
  /** 大额礼物门槛（元）：达到这个数单独成条，不参与合并 */
  bigGiftYuan: number;
  /** 低于门槛的礼物按机会型处理 */
  cheapGiftAsChance: boolean;
  /** 弹幕里 @ 了主播/她时是否回应 */
  replyOnAt: boolean;
  /** 弹幕里带问号时是否回应 */
  replyOnQuestion: boolean;
  /** 是否回应 SC */
  replyOnSuperChat: boolean;
  /** 是否回上舰 */
  replyOnGuard: boolean;
  /** SC 读完再回的等待秒数（0 = 立即） */
  scDelaySec: number;
  /** 统一噪声过滤：刷屏 / 纯数字 / 纯表情 */
  blockNoise: boolean;
  /** 舰长/管理员优先回复（只影响节流，不跳过过滤） */
  prioritizeGuard: boolean;
  /** 礼物必回总开关（达到金额门槛 100% 必回） */
  replyOnGift: boolean;
  /** 过滤不友善 / 辱骂 / 赶人的弹幕 */
  blockHostile: boolean;
  /** 额外的不友善词（逗号分隔） */
  hostileWords: string;
  /** 屏蔽词：命中只挡机会型插话（照抄咩播） */
  blockWords: string;
  /** 游戏插件指令正则（一行一条） */
  blockPatterns: string;
  /** 本场玩法 */
  gameBrief: string;
  /** 游戏包 id */
  gamePackId: string;
  /** 游戏名 */
  gameName: string;
  /** 道具表：阵营|礼物|效果 */
  gameItems: string;
  /** 规则与术语 */
  gameRules: string;
  /** 开播下播自动播报 */
  autoLiveNotice: boolean;
  /** 播报最短间隔（秒） */
  liveNoticeGapSec: number;
  /** 每天最多播报几条 */
  liveNoticeMaxPerDay: number;
  /** 播报正文发完多久补一条表情包（秒），0 或不填=默认 60 */
  noticeStickerDelaySec: number;
  /** 下播后是否同步发一条 B 站动态（需 biliwhale 已登录 + 自动提交；默认关） */
  livePostDynamic: boolean;
  /** 开播时把「前一天战报」发到 B站动态，只发一次（默认关） */
  reportDynamic: boolean;
  /** 主人 B站 UID（逗号分隔）：只有他说的「下播」才算准备下播信号 */
  ownerUids: string;
  /** 主人 B站昵称（逗号分隔，兜底用） */
  ownerNames: string;
  /** 官方日榜接口里的 ruid（只影响「我在榜上第几」，留 0 也能拉到榜单） */
  rankRuid: number;
  /** 播报目标 */
  liveNoticeTarget: string;
  /** 陪播引导开关 */
  promoCue: boolean;
  /** 引导最短间隔（秒） */
  promoGapSec: number;
  /** 引导话术轮换 */
  promoTopics: string;
  /** 过滤「说给主播/别人」的对话弹幕 */
  blockPeerChat: boolean;
  /** 屏蔽名单（用户名，模糊包含） */
  blockUsers: string;
  /** 机会型回应总开关 */
  chanceReply: boolean;
  /** 机会型回应最短间隔（秒），0 = 关闭 */
  chanceGapSec: number;
  /** 用户等级门槛：低于此等级不回应（0 = 不限） */
  minUserLevel: number;
  /** 把发往 QQ 群的消息同步记录到气泡面板 */
  syncQqToBubble: boolean;
  /** 把对直播弹幕的回应转发到 QQ */
  forwardToQq: boolean;
  /** 转发目标：群号 / 私聊（u: 前缀），多个逗号分隔 */
  qqForwardTargets: string;
  /** 转发格式 */
  qqForwardFormat: 'reply' | 'full' | 'important';
  /** 转发节流（秒）：同一个人两次转发之间的最短间隔 */
  qqForwardGapSec: number;
  /** 不同人是否绕过上面那道上限（true = 按人算，false = 全局算） */
  qqForwardPerUser: boolean;
  /** 任意两条转发之间的最小间隔（秒），0 = 不限制；防连发刷屏 */
  qqForwardMinGapSec: number;
  /** 每分钟最多转发几条（0 = 不限），超了这条就不发 */
  qqForwardMaxPerMin: number;
  /** 现场速报间隔（秒）：0 = 关闭；开着时每 N 秒往群里发一条「现在直播间在发生什么」 */
  qqDigestSec: number;
  /** 命中道具表的礼物无条件必回 */
  gameGiftAlwaysReply: boolean;
  /** 房管/舰长同人连发间隔（秒） */
  guardBurstSec: number;
  /** 同一人两条必回间隔（秒） */
  sameUserGapSec: number;
  /** 弹幕允许 B站表情/颜文字 */
  emojiInDanmaku: boolean;
  /** 纯 B站表情弹幕也当互动 */
  replyEmoteOnly: boolean;
  /** 礼物合并窗口（秒）：窗口内多条礼物合并成一次唤醒，0 = 不合并 */
  giftMergeSec: number;
  /** 每几条回复带一次桌宠表情/动作（0 = 不带） */
  petActionRate: number;
  /** 舰长每天可免费出图几张（0 = 不限） */
  guardDrawPerDay: number;
  atKeywords: string;
  sendDanmaku: boolean;
  danmakuCookie: string;
  danmakuRoomId: number;
  danmakuMaxLen: number;
  danmakuGapSec: number;
  /** 回应字数上限（写进提示词） */
  replyMaxChars: number;
  /** 舰长进场必欢迎 */
  guardWelcome: boolean;
  /** 每人每天最多欢迎几次（0 = 不限） */
  guardWelcomePerDay: number;
  /** 欢迎词轮换风格 */
  guardWelcomeStyles: string;
}

export const DEFAULT_CONFIG: LiveCueConfig = { ...LIVE_CUE_DEFAULTS };

// ───────────────────────────────────────────────
// 事件
// ───────────────────────────────────────────────

export type LiveEventKind = 'danmaku' | 'gift' | 'superchat' | 'guard' | 'enter' | 'audience' | 'room';

export interface LiveEvent {
  kind: LiveEventKind;
  username: string;
  body: string;
  amount?: number;
  /** 礼物数量（×N） */
  count?: number;
  guardName?: string;
  /** B站舰队等级：1=总督 2=提督 3=舰长；0/undefined = 非舰长 */
  guardLevel?: number;
  /** 直播间管理员 */
  isAdmin?: boolean;
  /** 直播间荣耀等级（user_level） */
  userLevel?: number;
  /** 粉丝牌等级 */
  medalLevel?: number;
  /** 粉丝牌名字 */
  medalName?: string;
  /** 礼物事件唯一 id（去重用；事件库那份有） */
  tid?: string;
  /** B站数字 UID（抓头像用） */
  uid?: string;
  /** 续费（guard-renew）：只延长有效期，不再画祝贺画 */
  renew?: boolean;
  /** 这条礼物合并后没到门槛：回一句就行，别往群里转（2026-11-12 加） */
  noForward?: boolean;
}

// ───────────────────────────────────────────────
// 纯函数：判断值不值得回应
// ───────────────────────────────────────────────

/** 纯数字：整条只有数字（可含空白） */

/**
 * B 站自带的“表情包”在弹幕里长这样：[大笑] [doge] [妙啊] [吃瓜]
 * 纯表情包 = 整条去掉所有 [xxx] 之后什么都不剩（可以有空格/重复）。
 * 只要还夹着别的话（比如“这个表情包怎么用”），就不算纯表情，不会被误伤。
 */
export function isBiliEmoteOnly(s: string): boolean {
  const t = (s || '').trim();
  if (!t) return false;
  const marks = t.match(/\[[^\]]{1,12}\]/g);
  if (!marks || marks.length === 0) return false;
  const rest = t.replace(/\[[^\]]{1,12}\]/g, '').replace(/[\s\u3000]/g, '');
  return rest.length === 0;
}

export function isPureNumber(s: string): boolean {
  const t = (s || '').trim();
  return t.length > 0 && /^[\d\s]+$/.test(t);
}

/** 纯表情：只含 emoji / 符号 / 标点 / 空白，没有任何文字或数字 */
export function isPureEmoji(s: string): boolean {
  const t = (s || '').trim();
  if (!t) return true;
  const stripped = t.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\p{S}\p{P}\s]/gu, '');
  return stripped.length === 0;
}

/** 刷屏：同一字符连刷 ≥6 次，或整条字符种类极少但长度很长，或超长 */
export function isSpam(s: string): boolean {
  const t = (s || '').trim();
  if (!t) return false;
  if (t.length > 120) return true;
  if (/(.)\1{5,}/u.test(t)) return true;
  const compact = t.replace(/\s/g, '');
  if (compact.length >= 6 && new Set(compact).size <= 2) return true;
  return false;
}

/**
 * 身份优先：舰长（1/2/3）与管理员。
 * 注意：优先只体现在「排队」上（跳过节流间隔），不跳过任何过滤。
 */
/** 内置不友善词表：辱骂 / 人身攻击 / 赶人。可在配置里追加自定义词。 */
const BUILTIN_HOSTILE = [
  '傻逼', '煞笔', '沙比', 'cnm', 'nmsl', '你妈', '尼玛', '脑残', '智障', '弱智',
  '废物', '去死', '滚出直播间', '狗东西', '贱人', '垃圾主播', '烂主播', '恶心主播',
];

/** 0 = 必回；1 = 机会型（受间隔与上限约束）；2 = 不回 */
export type IntentPriority = 0 | 1 | 2;

export interface LiveIntent {
  priority: IntentPriority;
  /** 判定原因，写日志与验收用 */
  reason: string;
  /** 是否在叫她（@ 或关键词） */
  addressed: boolean;
  question: boolean;
  hostile: boolean;
  peerChat: boolean;
}

export function keywordList(cfg: LiveCueConfig): string[] {
  return String(cfg.atKeywords || '')
    .split(/[,，\s]+/)
    .map((k) => k.trim())
    .filter(Boolean);
}

function splitList(s: string): string[] {
  return String(s || '')
    .split(/[,，\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** 是否在叫她：命中关键词，或 @ 后面接的是她的名字 */
export function isAddressedToHer(t: string, cfg: LiveCueConfig): boolean {
  if (!cfg.replyOnAt) return false;
  const kws = keywordList(cfg);
  if (kws.some((k) => t.includes(k))) return true;
  const ats = t.match(/@([^\s，,。！!？?]+)/g) || [];
  return ats.some((a) => kws.some((k) => a.includes(k)));
}

/** 不友善判定：内置词表 + 自定义词 */
export function isHostileText(t: string, cfg: LiveCueConfig): boolean {
  if (!cfg.blockHostile) return false;
  const extra = splitList(cfg.hostileWords).map((x) => x.toLowerCase());
  const low = t.toLowerCase();
  return [...BUILTIN_HOSTILE, ...extra].some((w) => w && low.includes(w.toLowerCase()));
}

/** 是不是她自己在说话（B站会把自己发的弹幕推回来） */
export function isSelfName(name: string, cfg: LiveCueConfig): boolean {
  const list = splitList(cfg.selfNames);
  if (!list.length) return false;
  const n = (name || '').trim();
  return list.some((x) => n === x);
}

/**
 * B站直播弹幕按「半角字符位」算长度：中文/全角标点/emoji 各占 2，英文/数字/半角标点各占 1。
 * 实测（2026-11-05）：40 汉字 = 80 位 ✅、80 汉字 = 160 位 ❌（返回 1003212 超出限制长度）、
 * 78 字母 + 1 汉字 = 80 位 ✅、79 字母 + 1 汉字 = 81 位 ❌。
 */
export function displayWidth(text: string): number {
  // B站实测（2026-11-20 05:40，直播间账号直发）：
  //   40 汉字 → code=0；41 汉字 → 1003212
  //   80 英文 → code=0；81 英文 → 1003212
  // 结论：上限是「80 个半角位」—— ASCII 可见字符算 1 位，其余（汉字/标点/颜文字/emoji）算 2 位。
  // 旧实现按 Unicode 宽表算，颜文字里的符号被当成 1 位 → 宽度被低估，超长被 B 站拒。
  let width = 0;
  for (const ch of String(text || '')) {
    const cp = ch.codePointAt(0) ?? 0;
    width += cp >= 0x20 && cp <= 0x7e ? 1 : 2;
  }
  return width;
}

/** 这条弹幕是不是游戏插件（猫猫养成等）的指令，而不是在跟她说话 */
export function isGameCommand(text: string, cfg: LiveCueConfig): boolean {
  const pats = String(cfg.blockPatterns || '')
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
  if (!pats.length) return false;
  const t = String(text || '').trim();
  for (const p of pats) {
    try {
      if (new RegExp(p, 'iu').test(t)) return true;
    } catch {
      /* 写错的正则跳过，别把整条链路带崩 */
    }
  }
  return false;
}

/** 屏蔽词：照抄咩播的「屏蔽敏感词汇」，命中只说「别主动接话」 */
export function isBlockedWord(text: string, cfg: LiveCueConfig): boolean {
  const list = splitList(cfg.blockWords);
  if (!list.length) return false;
  const t = (text || '').toLowerCase();
  return list.some((w) => w && t.includes(w.toLowerCase()));
}

/** 屏蔽名单：用户名模糊包含即命中 */
export function isBlockedUser(name: string, cfg: LiveCueConfig): boolean {
  const list = splitList(cfg.blockUsers);
  if (!list.length) return false;
  const n = (name || '').toLowerCase();
  return list.some((x) => n.includes(x.toLowerCase()));
}

/** 是不是在跟主播/别的观众说话（不是对她说的） */
export function isPeerChatText(t: string, cfg: LiveCueConfig): boolean {
  if (!cfg.blockPeerChat) return false;
  if (isAddressedToHer(t, cfg)) return false;
  // ① @ 了别人
  if (/@/.test(t)) return true;
  // ② 「某某 你…」式点名对话
  if (/^[\u4e00-\u9fa5A-Za-z0-9_\-]{1,10}[，,：:\s]+你/.test(t)) return true;
  // ③ 直接以第二人称跟某人说话
  if (/^你(在吗|吃了吗|干嘛呢|来了|好啊|好呀|别|怎么|是不是|要不要)/.test(t)) return true;
  return false;
}

const QUESTION_RE = /[?？]|吗|呢|怎么|什么|为什么|几点|多少|哪个|谁|是不是|能不能|要不要/;

/** 身份优先：舰长（1/2/3）与管理员 */
export function isPriorityUser(ev: LiveEvent, cfg: LiveCueConfig): boolean {
  return cfg.prioritizeGuard && ((ev.guardLevel ?? 0) > 0 || ev.isAdmin === true);
}

/** 舰长系的档位名 */
export function guardTitle(level: number | undefined): string {
  if (level === 1) return '总督';
  if (level === 2) return '提督';
  if (level === 3) return '舰长';
  return '';
}

/**
 * 第 2 层核心：把一条事件判成「必回 / 机会 / 不回」。
 * 必回：礼物达门槛、SC、上舰、@或关键词、舰长/房管弹幕、舰长进场 —— 不吃任何限频。
 * 机会：没点名她的问句 / 有内容的闲聊 / 小额礼物 —— 吃 gapSec、chanceGapSec、maxPerHour。
 * 不回：噪声、不友善、说给别人的、没内容的 —— 直接丢，省 token。
 */
export function classifyIntent(
  ev: LiveEvent,
  cfg: LiveCueConfig,
  knownSupporter?: (name?: string) => boolean,
): LiveIntent {
  const r = classifyCore(ev, cfg, knownSupporter);
  // 屏蔽词只压「机会型」：点名她 / 礼物 / SC / 上舰 该回还得回
  if (r.priority === 1 && ev.body && isBlockedWord(ev.body, cfg)) {
    return { ...r, priority: 2, reason: 'blocked-word' };
  }
  return r;
}

/**
 * 荣誉等级门槛（2026-11-15 抽成共用函数）
 *
 * 抽出来的原因：以前只有 classifyCore 用了 minUserLevel，noteScene 把弹幕写进「现场」时
 * 完全不看等级 —— 结果是「判定为不回」，但「现场」里还留着，她读现场照样能接话。
 * 两处必须用同一套判据，否则改了一边另一边就漏。
 *
 * 参数全部从 cfg 现读（调用方传 liveCfg()），所以面板改数值/关开关立刻生效，不写死。
 * 舰长、房管永远放行 —— 哪怕账号等级是 0，能上舰就不是路人。
 */
function isBelowLevelGate(
  ev: LiveEvent,
  cfg: LiveCueConfig,
  knownSupporter?: (name?: string) => boolean,
): boolean {
  const minLv = Number(cfg.minUserLevel ?? 0);
  if (!(minLv > 0)) return false;
  if (ev.guardLevel || ev.isAdmin) return false;
  // 戴了粉丝灯牌的人 = 这个直播间的老粉，不算路人（2026-11-17 加）
  // 依据官方字段：fans_medal_level（info[3][0]），与 info[4][0] 的直播间等级是两套数
  if ((ev.medalLevel ?? 0) > 0) return false;
  // 本场送过礼的人不算路人：哪怕 B 站给的等级是 0，他已经在花钱了（2026-11-15，主人要求）
  if (knownSupporter && knownSupporter(ev.username)) return false;
  return Number(ev.userLevel ?? 0) < minLv;
}

function classifyCore(
  ev: LiveEvent,
  cfg: LiveCueConfig,
  knownSupporter?: (name?: string) => boolean,
): LiveIntent {
  const base = { addressed: false, question: false, hostile: false, peerChat: false };

  // 自回声优先于一切：她自己发的弹幕不再回（B站会把本人的弹幕推回直播间）
  if (isSelfName(ev.username, cfg)) {
    return { ...base, priority: 2, reason: 'self-echo' };
  }
  // 屏蔽名单次之（连欢迎都不给）
  if (isBlockedUser(ev.username, cfg)) {
    return { ...base, priority: 2, reason: 'blocked-user' };
  }

  if (ev.kind === 'danmaku') {
    const t = (ev.body || '').trim();
    if (!t) return { ...base, priority: 2, reason: 'empty' };
    // 游戏插件指令（喵/左3/购买12…）：不是给她的，直接丢，连 token 都不烧
    if (isGameCommand(t, cfg)) return { ...base, priority: 2, reason: 'game-command' };
    // 纯 B站表情（[米饭][妙啊]）不是噪声：观众是在用表情互动，按机会型偶尔接一句
    if (isBiliEmoteOnly(t)) {
      return cfg.replyEmoteOnly
        ? { ...base, question: false, priority: 1, reason: 'emote' }
        : { ...base, priority: 2, reason: 'noise' };
    }
    if (cfg.blockNoise && (isPureNumber(t) || isPureEmoji(t) || isSpam(t))) {
      return { ...base, priority: 2, reason: 'noise' };
    }
    if (isBelowLevelGate(ev, cfg, knownSupporter)) {
      return { ...base, priority: 2, reason: 'low-level' };
    }
    if (!/[\u4e00-\u9fa5a-zA-Z]/.test(t)) return { ...base, priority: 2, reason: 'no-letter' };

    const hostile = isHostileText(t, cfg);
    if (hostile) return { ...base, priority: 2, reason: 'hostile', hostile: true };

    const addressed = isAddressedToHer(t, cfg);
    const question = QUESTION_RE.test(t);
    const peerChat = !addressed && isPeerChatText(t, cfg);
    if (peerChat) {
      return { ...base, addressed, question, peerChat: true, priority: 2, reason: 'peer-chat' };
    }

    if (addressed) return { ...base, addressed, question, priority: 0, reason: 'at-or-keyword' };
    if (isPriorityUser(ev, cfg)) {
      return { ...base, addressed, question, priority: 0, reason: 'guard-admin' };
    }
    if (cfg.chanceReply && cfg.chanceGapSec > 0 && cfg.replyOnQuestion && question) {
      return { ...base, addressed, question, priority: 1, reason: 'question' };
    }
    if (cfg.chanceReply && cfg.chanceGapSec > 0 && t.length >= 8) {
      return { ...base, addressed, question, priority: 1, reason: 'chatty' };
    }
    return { ...base, addressed, question, priority: 2, reason: 'not-for-her' };
  }

  if (ev.kind === 'gift') {
    if (!cfg.replyOnGift) return { ...base, priority: 2, reason: 'gift-off' };
    // 整蛊直播：命中道具表的礼物（人气票 / 鼓掌声 / 冰晶吊坠…）一律必回，不看金额
    if (cfg.gameGiftAlwaysReply && isGameItemGift(ev.body || '', cfg)) {
      return { ...base, priority: 0, reason: 'gift-game-item' };
    }
    // 加 1e-6 容差：浮点累加出来的 0.9999999 也算达标，别让用户白刷
    if ((ev.amount ?? 0) + 1e-6 >= cfg.minGiftYuan) {
      return { ...base, priority: 0, reason: 'gift' };
    }
    // 小额礼物不静默丢弃：排到机会型，有空就谢一句（整蛊直播里礼物是「道具」）
    return cfg.cheapGiftAsChance
      ? { ...base, priority: 1, reason: 'gift-cheap' }
      : { ...base, priority: 2, reason: 'gift-below-threshold' };
  }
  if (ev.kind === 'superchat') {
    return cfg.replyOnSuperChat
      ? { ...base, priority: 0, reason: 'superchat' }
      : { ...base, priority: 2, reason: 'sc-off' };
  }
  if (ev.kind === 'guard') {
    return cfg.replyOnGuard
      ? { ...base, priority: 0, reason: 'guard' }
      : { ...base, priority: 2, reason: 'guard-off' };
  }
  if (ev.kind === 'enter') {
    const isGuard = (ev.guardLevel ?? 0) > 0;
    // 舰长 / 提督 / 总督 进门 → 仪式感欢迎（配额在 onChunk 里按人按天扣）
    if (isGuard && cfg.guardWelcome) {
      return { ...base, priority: 0, reason: 'guard-enter' };
    }
    if (!cfg.sendEnter) return { ...base, priority: 2, reason: 'enter-off' };
    const need = cfg.enterMedalLevel ?? 0;
    const ok = ev.isAdmin === true
      || (need > 0 ? (ev.medalLevel ?? 0) >= need : (ev.medalLevel ?? 0) > 0);
    return ok ? { ...base, priority: 1, reason: 'enter' } : { ...base, priority: 2, reason: 'enter-filtered' };
  }
  if (ev.kind === 'audience') {
    return cfg.sendAudience
      ? { ...base, priority: 1, reason: 'audience' }
      : { ...base, priority: 2, reason: 'audience-off' };
  }
  return { ...base, priority: 2, reason: 'unknown' };
}

/** 兼容旧接口：值得回应（必回或机会型） */
export function shouldReply(ev: LiveEvent, cfg: LiveCueConfig): boolean {
  return classifyIntent(ev, cfg).priority < 2;
}

// ───────────────────────────────────────────────
// 纯函数：事件 → 提示词
// ───────────────────────────────────────────────

/** 本次回应允许的字数（发弹幕时按弹幕上限收紧，避免半句话被截断） */
export function replyLimit(cfg: LiveCueConfig): number {
  const base = Number(cfg.replyMaxChars || 40);
  if (!cfg.sendDanmaku) return base;
  return Math.min(base, Number(cfg.danmakuMaxLen || 80));
}

/** 轮换取一种欢迎风格，保证同一天不同人听到的不一样 */
export function pickStyle(cfg: LiveCueConfig, seq: number): string {
  const styles = splitList(cfg.guardWelcomeStyles);
  if (!styles.length) return ''; // 留空 = 完全按现场自由发挥
  return styles[Math.abs(seq) % styles.length];
}

export interface SceneItem {
  /** 毫秒时间戳 */
  at: number;
  /** 一行摘要，如「阿杰：这关又掉两个小孩」 */
  text: string;
}

export interface PromptContext {
  /** 最近几条已经说过的回应，防复读 */
  recent?: string[];
  /** 当前这一幕：最近几条直播间动态（不含正在回应的这条） */
  scene?: readonly SceneItem[];
  /** 高能榜/在线人数，0 = 未知 */
  viewers?: number;
  /** 今天是第几个被隆重欢迎的舰长（从 1 起） */
  guardOrdinal?: number;
  /** 这个舰长今天第几次被欢迎 */
  guardTimesToday?: number;
  /** 欢迎风格提示（配置留空时为空，表示完全自由发挥） */
  style?: string;
  /** 这一轮要不要顺带一句引导（上舰/加群/拉红粉） */
  promo?: string;
}

/** 表情包目录默认值（Coo 部署的 emoji 目录）；配置 stickerDir 可覆盖 */
// 2026-11-23 发布准备：默认留空（由 worlds.live-cue.stickerDir 配置决定）
const DEFAULT_STICKER_DIR = process.env.COOPANION_EMOJI_DIR || '';

/** 单张表情包上限：超过这个尺寸 base64 发不出去，QQ 侧也不收（2026-11-14 提取成常量） */
const MAX_STICKER_BYTES = 4 * 1024 * 1024;

/** 显示宽度：emoji 与中文算 2，ASCII 算 1。用来把榜一名字对齐到下一行「·」的列 */
function dwidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (c >= 0x1f000) w += 2;
    else if (c >= 0x1100 && (
      c <= 0x115f || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3)
      || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f)
      || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6)
    )) w += 2;
    else w += 1;
  }
  return w;
}

function hhmm(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 这一条是不是「观众 进直播间」（进/退场事件，没有对话内容） */
function isEnterLine(text: string): boolean {
  return text.endsWith('进直播间') && !text.includes('：');
}

/**
 * 「观众 进直播间」会连刷十几条，把真实弹幕挤出「刚才这一幕」——模型只看得到一排进场，
 * 就只能复读「又有人进来」。这里把进场压成一行计数，真实弹幕/礼物优先保留。
 * （2026-11-12 加：11-12 场次里 6 行现场有 5 行是进场）
 */
export function compactScene<T extends { at: number; text: string }>(items: readonly T[], max = 6): Array<{ at: number; text: string }> {
  const rest: Array<{ at: number; text: string }> = [];
  let enterN = 0;
  let enterAt = 0;
  for (const it of items) {
    if (isEnterLine(it.text)) { enterN += 1; enterAt = it.at; continue; }
    rest.push({ at: it.at, text: it.text });
  }
  if (enterN) rest.push({ at: enterAt, text: `观众进直播间 ×${enterN}` });
  return rest.slice(-max);
}

/** 把「刚才这一幕」压成几行，让模型知道直播间现在在发生什么 */
export function buildSceneBlock(ctx?: PromptContext, now = Date.now()): string {
  const items = compactScene(ctx?.scene ?? [], 6);
  const head = ctx?.viewers && ctx.viewers > 0
    ? `【现场】现在 ${hhmm(now)}，直播间在线约 ${ctx.viewers} 人。`
    : `【现场】现在 ${hhmm(now)}。`;
  if (!items.length) return `${head}\n这几分钟直播间还没什么动静。`;
  return `${head}\n刚才这一幕：\n${items.map((it) => `- ${hhmm(it.at)} ${it.text}`).join('\n')}`;
}

function recentHint(ctx?: PromptContext): string {
  const list = (ctx?.recent ?? []).filter(Boolean).slice(-4);
  if (!list.length) return '';
  return `\n你刚才已经说过这些，别换个说法再讲一遍：${list.map((t) => `「${t}」`).join('、')}`;
}

/** 礼物名是否命中本局道具表（整蛊直播的核心道具，0.1 元也要回） */
export function isGameItemGift(name: string, cfg: LiveCueConfig): boolean {
  const n = String(name || '').replace(/\s*[×xX]\s*\d+\s*$/, '').trim();
  if (!n) return false;
  return String(cfg.gameItems || '')
    .split(/\r?\n/)
    .map((l) => l.split('|').map((x) => (x || '').trim()))
    .some(([, gift]) => !!gift && gift !== '待补' && (gift === n || n.includes(gift) || gift.includes(n)));
}

/** 从道具表里查「这个礼物在游戏里干了什么」，只给一行 */
export function giftHint(ev: LiveEvent, cfg: LiveCueConfig): string {
  if (ev.kind !== 'gift') return '';
  const name = String(ev.body || '').replace(/\s*[×xX]\s*\d+\s*$/, '').trim();
  if (!name) return '';
  const hit = String(cfg.gameItems || '')
    .split(/\r?\n/)
    .map((l) => l.split('|').map((x) => (x || '').trim()))
    .find(([, gift]) => gift && gift !== '待补' && (gift === name || name.includes(gift) || gift.includes(name)));
  if (!hit) return `【本局对照】「${name}」不在表里，按名字猜它在游戏里干了什么。\n`;
  return `【本局对照】「${name}」=${hit[2]}（${hit[0]}）。\n`;
}

/** 把「本局游戏」压成一段：名称 + 玩法 + 红黑道具 + 规则术语 */
export function buildGameBlock(cfg: LiveCueConfig): string {
  const name = String(cfg.gameName || '').trim();
  const brief = String(cfg.gameBrief || '').trim();
  const items = String(cfg.gameItems || '').trim();
  const rules = String(cfg.gameRules || '').trim();
  if (!name && !brief && !items && !rules) return '';

  const fmt = (line: string): string => {
    const [side, gift, effect] = line.split('|').map((x) => (x || '').trim());
    if (!effect) return '';
    return (!gift || gift === '待补') ? `${effect}（礼物待补）` : `${gift}→${effect}`;
  };
  const pick = (side: string): string[] => items
    .split(/\r?\n/)
    .filter((l) => l.startsWith(side))
    .map(fmt)
    .filter(Boolean)
    .slice(0, 24);

  const red = pick('红粉');
  const black = pick('黑粉');
  const lines: string[] = [`【本局游戏】${name || '当前游戏'}`];
  if (brief) lines.push(`玩法：${brief}`);
  if (red.length) lines.push(`红粉（帮主播）：${red.join('；')}`);
  if (black.length) lines.push(`黑粉（整蛊）：${black.join('；')}`);
  if (rules) lines.push(`规则与术语：${rules.split(/\r?\n/).map((x) => x.trim()).filter(Boolean).join('；')}`);
  return lines.join('\n').slice(0, 2000) + '\n';
}

/** 对外入口：在核心提示词前后套上「本局游戏」和「顺带一句引导」 */
export function buildPrompt(ev: LiveEvent, intent?: LiveIntent, cfg?: LiveCueConfig, ctx?: PromptContext): string {
  const conf = cfg ?? DEFAULT_CONFIG;
  // 完整玩法块放在系统前缀（envPromptVars.gameBlock），事件里只带这一条礼物的对照，省 token
  const base = buildPromptCore(ev, intent, conf, ctx);
  const promo = ctx?.promo ? `\n【顺带】如果这句话接得上，捎一句：${ctx.promo}。接不上就别说，别硬塞。` : '';
  return giftHint(ev, conf) + base + promo + actionHint(conf);
}

/**
 * 直播画面里观众看得见她的表情和动作（OBS 抓桌宠画面）。
 * 词表本来就在她的系统提示词里（{{pet.vocab}}），这里只提醒「直播时要用」，不重复列词，省 token。
 */
function actionHint(conf: LiveCueConfig): string {
  const rate = Number(conf.petActionRate ?? 2);
  if (!rate) return '';
  const every = rate <= 1 ? '每条都要带' : `平均每 ${rate} 条至少带 1 条`;
  return `\n【动作】直播画面会拍到你，观众看得见表情和动作。pet_say 的 script 开头用【表情】或【表情, 动作】标记（词用你词表里的，例：【生气, 跳】这小孩又掉下去了！）。${every}，别连着三次用同一个。`;
}

function buildPromptCore(ev: LiveEvent, intent?: LiveIntent, cfg?: LiveCueConfig, ctx?: PromptContext): string {
  const who = ev.username || '观众';
  const conf = cfg ?? DEFAULT_CONFIG;
  const limit = replyLimit(conf);
  // 主人判定：B站昵称脱敏后形如「然***」「然酱***」，或直接叫然酱/然哥
  const isOwner = /^然/.test(who) || /然酱|然哥|面包哥/.test(who);
  const ownerHint = isOwner
    ? '\n（这个昵称像是主人自己，别当普通观众，语气可以更亲近）'
    : '';
  const mode = intent?.priority === 0 ? '【必回】' : '【可选·别抢主播的话】';
  const noRepeat = recentHint(ctx);
  const scene = buildSceneBlock(ctx);

  switch (ev.kind) {
    case 'gift': {
      const giftName = String(ev.body || '礼物').replace(/\s*[×xX]\s*\d+\s*$/, '').trim();
      const num = ev.count && ev.count > 1 ? ` ×${ev.count}` : '';
      const price = ev.amount ? `（约 ${ev.amount} 元，别念出来）` : '';
      return `【直播间礼物】${who} 送出「${giftName}」${num}${price}。${mode}\n`
        + `${scene}\n`
        + `【怎么接】这不是打赏，是他刚在游戏里按了一个按钮，画面上的变化就是他干的：\n`
        + `① 先点出「游戏里发生了什么」——对照环境提示词里的「礼物 → 效果」表；表里没有就按礼物名猜，别装作没看见。\n`
        + `② 再给一个短反应：起哄、心疼小孩、骂一句、报个战况都行。\n`
        + `不报价、不说「感谢老板」、不写小作文。不超过 ${limit} 字，一句话说完。${ownerHint}${noRepeat}`;
    }
    case 'superchat': {
      const price = ev.amount ? ` ¥${ev.amount}` : '';
      return `【醒目留言 SC${price}】${who} 说：「${ev.body || ''}」${mode}\n`
        + `${scene}\n`
        + `【怎么接】先用半句复述他最想被回答的那个点（证明你整条看完了），再判断该谁答：\n`
        + `- 游戏怎么玩、常识、闲聊、夸你损你 → 你自己答，别推给主播；\n`
        + `- 只有要他本人拍板、承诺、上手操作的，才转给他，说法要自然（「这个得然哥点头」），别每次同一个句式。\n`
        + `答完顺一句谢，不报价。不超过 ${limit} 字。${ownerHint}${noRepeat}`;
    }
    case 'guard': {
      const role = ev.guardName || guardTitle(ev.guardLevel) || '舰长';
      // 三档热度：总督最大、提督次之、舰长要热烈（2026-11-12 用户要求）
      const heat = ev.guardLevel === 1
        ? '这是**今晚最大的一件事**：激动到语无伦次一点，动作要大（站起来、拍桌子、手抖），语气是「我何德何能」。'
        : ev.guardLevel === 2
          ? '这是**今晚第二大的事**：先惊呼一声，再连说两句感谢，语气是「你怎么也来了」。'
          : '**要热烈**：第一句就得是惊喜（哇 / 啊 / 真的吗），第二句给身份，别平平淡淡说「欢迎」。';
      return `【直播间上舰】${who} 开通了「${role}」。${mode}\n`
        + `${scene}\n`
        + `【怎么接】${heat}\n`
        + `动作和表情要跟着情绪走（拍手、跳一下、捂脸都行），别只甩一句干巴巴的「谢谢」。\n`
        + `抓现场：提一句此刻直播间正在发生的事，别念稿。不超过 ${limit} 字。${ownerHint}${noRepeat}`;
    }
    case 'enter': {
      const role = guardTitle(ev.guardLevel);
      if (role) {
        const ord = ctx?.guardOrdinal ?? 1;
        const times = ctx?.guardTimesToday ?? 1;
        const quota = times > 1 ? `（今天第 ${times} 次进来，这次仍然要招呼）` : '';
        const tone = ctx?.style ? `可以带一点「${ctx.style}」的味道，但别写成固定句式。` : '';
        const tier = ev.guardLevel === 1
          ? '总督进场 = **今晚最大的事**：激动到声音发抖，动作夸张（站起来、拍桌子），语气像「你怎么来了」。'
          : ev.guardLevel === 2
            ? '提督进场 = 自己人里的顶梁柱：先惊呼一声，再郑重招呼，别平静。'
            : '舰长进门：要亲热、要惊喜，像终于等到他。';
        return `【舰长进场】${role}「${who}」进直播间了。${quota} 今天是第 ${ord} 位进门的舰长。\n`
          + `${scene}\n`
          + `${tier}\n`
          + `【怎么接】不要固定欢迎词——别用「上座 / 唱名 / 点灯 / 报数 / 锣响」这类套路，也别「欢迎欢迎」。\n`
          + `建议节奏：先一句「终于等到你」式的情绪，再一句现场画面，最后给他一个身份（自己人 / 位置 / 特权）。\n`
          + `直接抓此刻直播间正在发生的事来接他（游戏刚翻车就调侃、刚过关就报喜、弹幕在刷什么就顺着说），`
          + `让他觉得你是看着他进门那一刻说的。${tone}一句话，不超过 ${limit} 字。${ownerHint}${noRepeat}`;
      }
      const tag = ev.isAdmin ? '房管' : `粉丝牌 ${ev.medalLevel ?? 0} 级`;
      return `【直播间进场】${who}（${tag}）进来了。${mode}\n${scene}\n`
        + `像熟人进门那样招呼一句，10~${limit} 字，别每次都「欢迎欢迎」。${ownerHint}${noRepeat}`;
    }
    case 'audience':
      return `【直播间人气】${ev.body || '人气变化'}。${mode} 别硬说，没话就略过。`;
    default:
      return `【直播间弹幕】${who}：${ev.body || ''}${ownerHint}\n`
        + `${scene}\n`
        + `【怎么接】像老观众插话：可以接着刚才的游戏画面、别人刚说的话往下聊，别只干巴巴回这一条。\n`
        + `不超过 ${limit} 字，一句话，不换行。`
        + (conf.emojiInDanmaku
          ? `**句末必须带一个颜文字或 emoji**（如 (๑•̀ㅂ•́)و✧、(｡•́︿•̀｡)、_(:з」∠)_、🐳、😂），实在不搭才省；`
            + `不要用 [大笑] 这类 B站表情——你的话会被转发到 QQ 群，方括号在群里只会显示成一串文字。`
            + `颜文字要紧贴句末、**绝对不要换行**（换行会被当成两条消息发出去），正文控制在 32 字以内，给它留位置。`
          : `不加表情、不加颜文字。`)
        + `别客服腔、别解释设定、别说「作为 AI」。${noRepeat}`;
  }
}

// ───────────────────────────────────────────────
// 7795 → LiveEvent
// ───────────────────────────────────────────────

export function toLiveEvent(payload: any): LiveEvent | null {
  if (!payload || payload.type !== 'audience' || !payload.event) return null;
  const e = payload.event;
  const username = String(e.username || '观众');
  const body = String(e.body || '');
  const factStr = JSON.stringify(e.facts || {});

  // 身份：guardLevel（1=总督 2=提督 3=舰长）与 isAdmin
  const guardLevel = Number(e.facts?.guardLevel) || 0;
  const isAdmin = e.facts?.isAdmin === true;
  const userLevel = Number(e.facts?.userLevel) || 0;

  if (e.eventKind === 'danmaku') {
    return { kind: 'danmaku', username, body, guardLevel, isAdmin, userLevel, uid: e.uid ? String(e.uid) : undefined };
  }

  if (e.eventKind === 'enter') {
    const medalLevel = Number(e.facts?.medalLevel) || 0;
    const medalName = String(e.facts?.medalName || '');
    return { kind: 'enter', username, body: '', guardLevel, isAdmin, userLevel, medalLevel, medalName };
  }

  if (e.eventKind === 'audience') {
    return { kind: 'audience', username, body, guardLevel, isAdmin, userLevel };
  }

  if (e.eventKind === 'gift') {
    const count = pickCount(body);
    if (/SUPER_CHAT|superchat/i.test(factStr) || /醒目留言/.test(body)) {
      return {
        kind: 'superchat',
        username,
        body: stripScPrefix(body),
        amount: pickAmount(e.facts, body),
        guardLevel,
        isAdmin,
        userLevel,
      };
    }
    if (/GUARD|guardLevel|舰长|提督|总督/.test(factStr + body)) {
      return {
        kind: 'guard',
        username,
        body,
        guardName: pickGuard(body),
        amount: pickAmount(e.facts, body),
        guardLevel,
        isAdmin,
        userLevel,
      };
    }
    // overlay 流不带金额（overlay 投影只给「礼物名×数量」），事件库那份又常常迟到。
    // 2026-11-21 修：金额为 0 时用官方价格表兜底，否则所有礼物都过不了门槛、大额也不单列。
    const amt = pickAmount(e.facts, body);
    return {
      kind: 'gift', username, body, count,
      amount: amt > 0 ? amt : fallbackGiftYuan(body, count),
      guardLevel, isAdmin, userLevel,
    };
  }

  return null;
}

/** 醒目留言的正文：「醒目留言 ¥30：内容」→「内容」 */
export function stripScPrefix(body: string): string {
  const m = body.match(/^醒目留言\s*[¥￥]?\s*[\d.]*\s*[：:]\s*([\s\S]*)$/);
  return m ? m[1].trim() : body.trim();
}

/** 礼物数量：「辣条 ×10」→ 10 */
export function pickCount(body: string): number {
  const m = body.match(/[×xX]\s*(\d{1,4})/);
  return m ? Number(m[1]) : 1;
}

/** 礼物单价兜底表（元）：官方礼物面板 584 个礼物全量，见 gift-price.ts。
 *  只在事件库没给金额（yuan=0）时用，用于门槛判断与榜单排序，不外显金额。
 *  2026-11-20 加：当晚「合并礼物 ¥0」导致所有礼物被门槛拦掉、大额也没单列。 */
const GIFT_YUAN_FALLBACK: Record<string, number> = {
  ...GIFT_PRICE,
  // 官方标价 0.001 的几个按实际 1 毛修正
  粉丝团灯牌: 0.1, 灯牌: 0.1,
  // 面板里没有的老礼物/特效礼物，按市价补
  邪恶高铁: 1, 飞船: 100, 火箭: 50,
};

export function fallbackGiftYuan(name: string, count: number): number {
  const n = String(name || '').replace(/[×xX]\s*\d+$/, '').trim();
  const unit = GIFT_YUAN_FALLBACK[n];
  if (!unit) return 0;
  return Math.round(unit * Math.max(1, Number(count) || 1) * 100) / 100;
}

export function pickAmount(facts: any, body: string): number {
  const f = facts || {};
  // ① 明确以「元」为单位的一律先取（事件库那条带 meta.yuan）
  for (const k of ['yuan', 'amount', 'priceYuan']) {
    const v = Number(f[k]);
    if (Number.isFinite(v) && v > 0) return v;
  }
  // ② B站原始计价字段是「金瓜子」（1 元 = 1000）。2026-11-07 修正：
  //    以前写 `v >= 1000 ? v/1000 : v`，导致 0.1 元（price=100）被当成 100 元，
  //    小额礼物直接冲过门槛 —— 门槛形同虚设。
  for (const k of ['price', 'total_price', 'coin']) {
    const v = Number(f[k]);
    if (Number.isFinite(v) && v > 0) return v / 1000;
  }
  // overlay 投影只在 SC 正文里带金额：「醒目留言 ¥30：…」
  const yen = body.match(/[¥￥]\s*(\d+(?:\.\d+)?)/);
  if (yen) return Number(yen[1]);
  const m = body.match(/(\d+(?:\.\d+)?)\s*元/);
  return m ? Number(m[1]) : 0;
}

function pickGuard(body: string): string {
  if (/总督/.test(body)) return '总督';
  if (/提督/.test(body)) return '提督';
  return '舰长';
}

// ───────────────────────────────────────────────
// 事件库 → LiveEvent（礼物 / SC / 上舰 的真实金额都在这里）
// ───────────────────────────────────────────────

export interface StoreEnvelopeLike {
  cursor?: number;
  type?: string;
  text?: string;
  source?: string;
  origin?: string;
  contextDelivery?: string;
  meta?: Record<string, any>;
}

/** 把 B站插件写进事件库的一条记录翻译成 LiveEvent */
/** 允许「只有存档一份」的事件类型（B站插件 modelFeed=false 时的契约存档） */
const ARCHIVE_ONLY_OK = new Set([
  'bilibili.gift',
  'bilibili.superchat',
  'bilibili.guard',
  'bilibili.guard-renew',
  'bilibili.enter-guard',
  'bilibili.room',
]);

export function fromStoreEvent(env: StoreEnvelopeLike): LiveEvent | null {
  if (!env || typeof env.type !== 'string') return null;
  // archive-only 是候选处理前的原始副本，deliver 才是进入上下文的那份。
  // 但 modelFeed=false 时 B站插件只写存档（不投递），礼物/SC/上舰就只剩这一份——
  // 所以这几类放行；弹幕/人气仍只认 deliver，避免两条通道各回一遍。
  if (env.contextDelivery === 'archive-only' && !ARCHIVE_ONLY_OK.has(env.type)) return null;
  const m = env.meta || {};
  const text = String(env.text || '');
  const username = String(m.uname || '').replace(/\*+$/, '') || '观众';
  const guardLevel = Number(m.guardLevel) || 0;
  const isAdmin = m.isAdmin === true;

  switch (env.type) {
    case 'bilibili.gift': {
      const amount = Number(m.yuan);
      const cnt = Number(m.num) || 1;
      const giftName = String(m.gift || '礼物');
      const known = Number.isFinite(amount) && amount > 0 ? amount : 0;
      return {
        kind: 'gift',
        username,
        body: giftName,
        count: cnt,
        tid: m.tid ? String(m.tid) : undefined,
        amount: known || fallbackGiftYuan(giftName, cnt),
        guardLevel,
        isAdmin,
      };
    }
    case 'bilibili.superchat': {
      const amount = Number(m.yuan);
      const body = text.replace(/^\[醒目留言[^\]]*\]\s*/, '').trim();
      return {
        kind: 'superchat',
        username,
        body,
        amount: Number.isFinite(amount) ? amount : 0,
        guardLevel,
        isAdmin,
      };
    }
    case 'bilibili.guard':
    case 'bilibili.guard-renew': {
      const role = pickGuard(String(m.gift || text));
      return {
        kind: 'guard',
        username,
        body: String(m.gift || role),
        guardName: role,
        count: Number(m.num) || 1,
        amount: Number.isFinite(Number(m.yuan)) ? Number(m.yuan) : 0,
        guardLevel: guardLevel || (role === '总督' ? 1 : role === '提督' ? 2 : 3),
        uid: m.uid != null ? String(m.uid) : '',
        renew: env.type === 'bilibili.guard-renew',
        isAdmin,
      };
    }
    case 'bilibili.room': {
      const t = String(env.text || '');
      if (!/开播指令|下播指令/.test(t)) return null;
      return { kind: 'room', username: '', body: t };
    }
    case 'bilibili.audience':
      return { kind: 'audience', username: '', body: text };
    case 'bilibili.enter-guard': {
      // 「[进场] 欢迎舰长 某某 进入直播间」——只带昵称，等级要从文案里认
      // 2026-11-22 修：B 站的 ENTRY_EFFECT 是「进场特效」，**任何买了特效的观众**都会触发，
      // 不等于舰长。之前把它们全当舰长，一晚上冒出 189 位「舰长」。
      // 判据：文案里必须真的出现「舰长/提督/总督」，否则降级成普通进场。
      const isRealGuard = /总督|提督|舰长/.test(text);
      if (!isRealGuard) {
        const plain = text
          .replace(/^\[进场\]\s*/, '')
          .replace(/^欢迎/, '')
          .replace(/进入直播间.*$/, '')
          .replace(/<|>|%/g, '')
          .trim();
        return { kind: 'enter', username: plain || username, body: '', guardLevel: 0 };
      }
      const role = pickGuard(text);
      const name = text
        .replace(/^\[进场\]\s*/, '')
        .replace(/^欢迎/, '')
        .replace(new RegExp(`${role}|大航海`), '')
        .replace(/进入直播间.*$/, '')
        .replace(/<|>|%/g, '')
        .trim();
      return {
        kind: 'enter',
        username: name || username,
        body: '',
        guardLevel: role === '总督' ? 1 : role === '提督' ? 2 : 3,
      };
    }
    default:
      return null;
  }
}

// ───────────────────────────────────────────────
// 舰长欢迎配额（按人 + 自然日，写盘持久化）
// ───────────────────────────────────────────────

export interface GuardWelcomeState {
  date: string;
  seq: number;
  counts: Record<string, number>;
}

/**
 * 营业日：直播常跨零点（21:00–03:00），凌晨 5 点前都算「前一天那场」。
 * 2026-11-21 加：否则 00:13 开播会被记成第二天，战报日期就错了。
 */
/** 事件库里哪些事件属于 B站（按 type 前缀判，不依赖 source 字段） */
export function isBilibiliEvent(env: { type?: string } | null | undefined): boolean {
  return /^bilibili\./.test(String(env?.type || ''));
}

export function bizDayKey(ts = Date.now(), boundaryHour = 5): string {
  const d = new Date(ts - boundaryHour * 3600_000);
  return todayKey(d);
}

function todayKey(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 本场礼物榜的落盘位置（跨零点、Coo 重启都靠它续上） */
export function rankSessionPath(): string {
  // 2026-11-23 发布准备：用 homedir 拼默认值，不再写死 C:/Users/xxx
  const root = process.env.COOPANION_DATA || join(homedir(), 'Coopanion', 'data');
  return join(root, 'home', 'companion', 'worlds', 'live-cue', 'rank-session.json');
}

/** 现场实况的落盘路径（2026-11-23 加：下播后仍能回看） */
function decisionsPath(): string {
  return rankSessionPath().replace('rank-session.json', 'decisions.json');
}

/** QQ 同步记录（气泡面板）的落盘路径（2026-11-23 加：下播后仍能回看） */
function qqLogPath(): string {
  return rankSessionPath().replace('rank-session.json', 'qq-log.json');
}



export function welcomeStatePath(): string {
  const root = process.env.COOPANION_DATA || 'C:/Users/Administrator/Coopanion/data';
  return join(root, 'home', 'companion', 'worlds', 'live-cue', 'guard-welcome.json');
}

/** 首舰祝贺画的「待确认草稿」：写好提示词先发主人看，确认了才画 */
export function guardPortraitDraftPath(): string {
  const root = process.env.COOPANION_DATA || 'C:/Users/Administrator/Coopanion/data';
  return join(root, 'home', 'companion', 'worlds', 'live-cue', 'guard-portrait-draft.json');
}

/** 表情包使用记录：避免连着几天发同一张（2026-11-12 加） */
export function stickerHistoryPath(): string {
  const root = process.env.COOPANION_DATA || 'C:/Users/Administrator/Coopanion/data';
  return join(root, 'home', 'companion', 'worlds', 'live-cue', 'sticker-history.json');
}

/** 舰长名单：本地累积（来自上舰事件）+ 手工绑定，QQ 群认身份全靠它 */
export function guardRosterPath(): string {
  const root = process.env.COOPANION_DATA || 'C:/Users/Administrator/Coopanion/data';
  return join(root, 'home', 'companion', 'worlds', 'live-cue', 'guard-roster.json');
}

/** 本月首舰祝贺画的账本（按“年-月 + 昵称”，同一人每月只画一次） */
export function guardPortraitPath(): string {
  const root = process.env.COOPANION_DATA || 'C:/Users/Administrator/Coopanion/data';
  return join(root, 'home', 'companion', 'worlds', 'live-cue', 'guard-portrait.json');
}

/** 舰长每日画图额度的账本（按“日期 + 昵称”记次数，跨天自动清零） */
export function guardDrawPath(): string {
  const root = process.env.COOPANION_DATA || 'C:/Users/Administrator/Coopanion/data';
  return join(root, 'home', 'companion', 'worlds', 'live-cue', 'guard-draw.json');
}

export function loadWelcomeState(file = welcomeStatePath(), today = todayKey()): GuardWelcomeState {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    if (raw && raw.date === today && raw.counts && typeof raw.counts === 'object') {
      return { date: today, seq: Number(raw.seq) || 0, counts: raw.counts };
    }
  } catch {
    /* 首次运行 / 文件坏了都从零开始 */
  }
  return { date: today, seq: 0, counts: {} };
}

export function welcomeQuotaLeft(
  state: GuardWelcomeState,
  name: string,
  perDay: number,
): boolean {
  if (!perDay || perDay <= 0) return true;
  return (state.counts[name] ?? 0) < perDay;
}

// ───────────────────────────────────────────────
// 弹幕文本处理
// ───────────────────────────────────────────────

/**
 * 按 B 站 20 字上限收紧一段话：
 * 优先在标点处断开，绝不切在半个词/半个 emoji 上，也不补「…」（省略号同样占字数）。
 */
/**
 * 弹幕敏感词过滤（2026-11-23）。
 *
 * 为什么需要：现在「和主人的对话」也会同步到直播间弹幕，如果不拦一下，
 * 聊到钱、联系方式或内部安排就会直接播出去，观众全看见。
 *
 * 命中就整条不发（不做打码替换）—— 打码后的半句话更容易让人猜，不如不发。
 * 返回命中的词，没命中返回空串。
 */
export function hitDanmakuGuard(text: string, extraWords = ''): string {
  // 只留两类：B 站真会吞的（发了也白发）、真不该公开的（钱/联系方式）。
  // 「下播时间」「内部」这类正常话术不再拦 —— 2026-11-23 晚按主人要求去掉。
  const patterns: Array<[RegExp, string]> = [
    // 钱 / 收益 / 打赏（直播间提钱容易引发纠纷，也给平台送把柄）
    [/(\d+\s*(元|块|万|千)|打赏|充值|礼物钱|收入|工资|提成|分成|流水|到手\s*\d)/, '金额相关'],
    // 联系方式
    [/(QQ\s*[:：]?\s*\d{5,}|微信号|加我微信|1[3-9]\d{9})/i, '联系方式'],
    // 平台敏感（B站吞弹幕）
    [/(外挂|脚本|刷量|机器人刷|买粉)/, '平台敏感词'],
  ];
  for (const [re, label] of patterns) {
    if (re.test(text)) return label;
  }
  // 自定义词表：英文逗号或换行分隔，命中任一即拦（只做包含匹配，不改原句）
  const words = String(extraWords || '')
    .split(/[,，\n]/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2);
  for (const w of words) {
    if (text.includes(w)) return `自定义「${w}」`;
  }
  return '';
}

export function clipDanmaku(text: string, maxWidth = 80, maxChars = 80): string {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  // 双限：B站实测按「字符数」卡（40 字符），不是按显示宽度。
  // 2026-11-20 01:11~02:40 连报 6 次 1003212，全是 41~45 字符 / 82~90 宽 —— 只卡宽度不够。
  const charLen = Array.from(raw).length;
  if (displayWidth(raw) <= maxWidth && charLen <= maxChars) return raw;

  // 超了才去 emoji（B站对 emoji 计 2 位，留着很吃长度）
  const plain = raw.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '');
  const chars = Array.from(plain);

  let width = 0;
  let cut = 0;
  for (const ch of chars) {
    const w = displayWidth(ch);
    if (width + w > maxWidth || cut + 1 > maxChars) break;
    width += w;
    cut += 1;
  }
  const head = chars.slice(0, cut);

  // 从后往前找句读，断在标点上（至少保留 70%，免得只剩半句）
  const stops = ['。', '！', '？', '!', '?', '；', ';', '，', ',', '、', ' '];
  const minKeep = Math.floor(cut * 0.7);
  for (let i = head.length - 1; i >= minKeep; i -= 1) {
    if (stops.includes(head[i])) return head.slice(0, i).join('').replace(/[，,、\s]+$/, '');
  }
  return head.join('');
}

/** 去掉 pet_say 脚本里的【表情,动作】和<动作>标记，只留文字 */
export function cleanScript(script: string): string {
  return String(script || '')
    .replace(/【[^】]*】/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ───────────────────────────────────────────────
// World 实例
// ───────────────────────────────────────────────

const HERE = dirname(fileURLToPath(import.meta.url));
const ENV_PROMPT_FILE = join(HERE, 'ENV_PROMPT.md');
let ENV_PROMPT_CACHE = '';
try {
  ENV_PROMPT_CACHE = readFileSync(join(HERE, 'ENV_PROMPT.md'), 'utf8');
} catch {
  ENV_PROMPT_CACHE = '直播间来了值得回应的互动。直接说话回应，不要调工具。';
}


/** 直接从 Coo 的配置文件里读 B站插件保存的 SESSDATA（同一份凭据，不必重复填） */
export function readBilibiliSessdata(): string {
  try {
    const p = join(process.env.COOPANION_DATA || 'C:/Users/Administrator/Coopanion/data',
                   'home', 'companion', 'config.json');
    const j = JSON.parse(readFileSync(p, 'utf8'));
    return String(j?.worlds?.bilibili?.sessdata || '').trim();
  } catch {
    return '';
  }
}

/** 读 B站插件里配置的直播间号 */
export function readBilibiliRoomId(): number {
  try {
    const p = join(process.env.COOPANION_DATA || 'C:/Users/Administrator/Coopanion/data',
                   'home', 'companion', 'config.json');
    const j = JSON.parse(readFileSync(p, 'utf8'));
    return Number(j?.worlds?.bilibili?.roomId || 0);
  } catch {
    return 0;
  }
}

export class LiveCueWorld {
  readonly id = 'live-cue';

  private cfg: LiveCueConfig;
  private host: any = null;
  private abort: AbortController | null = null;
  private lastPushAt = 0;
  /** 上一次「机会型」回应的时刻 */
  private lastChanceAt = 0;
  /** 同一个人最近一次被回应的时刻（防连珠炮） */
  private lastByUser = new Map<string, number>();
  /** SSE 礼物指纹 → 时间，供事件库那条去重（双通道只回一遍） */
  private sseGiftSeen = new Map<string, number>();

  /** 事件库里已经处理过的礼物/SC/上舰指纹（overlay 那份没金额，优先级更低） */
  private storeSeen = new Map<string, number>();

  private storeKeyOf(ev: LiveEvent): string {
    const base = String(ev.body || '')
      .replace(/\s*[×xX]\s*\d+\s*$/, '')
      .replace(/\s+/g, '');
    return `${ev.kind}:${ev.username}:${base}:${ev.count || 1}`;
  }

  private markStoreSeen(ev: LiveEvent): void {
    this.storeSeen.set(this.storeKeyOf(ev), Date.now());
    if (this.storeSeen.size > 300) {
      const now = Date.now();
      for (const [k, ts] of this.storeSeen) if (now - ts > 120_000) this.storeSeen.delete(k);
    }
  }

  private seenByStore(ev: LiveEvent): boolean {
    const ts = this.storeSeen.get(this.storeKeyOf(ev));
    return !!ts && Date.now() - ts < 15_000;
  }

  private markSseGift(ev: LiveEvent): void {
    const key = `${ev.kind}:${ev.username}:${String(ev.body || '').replace(/\s+/g, '')}`;
    this.sseGiftSeen.set(key, Date.now());
    if (this.sseGiftSeen.size > 200) {
      const now = Date.now();
      for (const [k, ts] of this.sseGiftSeen) if (now - ts > 120_000) this.sseGiftSeen.delete(k);
    }
  }

  private seenBySse(ev: LiveEvent): boolean {
    const key = `${ev.kind}:${ev.username}:${String(ev.body || '').replace(/\s+/g, '')}`;
    const ts = this.sseGiftSeen.get(key);
    return !!ts && Date.now() - ts < 8_000;
  }
  /** 过滤原因计数，供面板与验收查看 */
  private skipCounts = new Map<string, number>();
  /** 计数器：必回 / 机会 / 过滤 */
  private counters = { must: 0, chance: 0, skipped: 0 };
  private lastSeen = '';
  /** 事件指纹 → 上次推送时间，用于 90 秒去重 */
  private seenMap = new Map<string, number>();
  private running = false;
  /** QQ 同步记录（最近 100 条，按 text 去重） */
  private qqLog: Array<{ ts: string; text: string; kind: string; user: string }> = [];
  /** outputTap 的正文累积（暂存，用于识别本轮是否在发 QQ） */
  private _tapBuf = '';
  /** 排队等着被回应的事件：pet_say 按顺序消费，一次轮次里有几条就对应几条 */
  private pendingQueue: LiveEvent[] = [];
  /** 上次转发到 QQ 的时刻 */
  private lastForwardAt = 0;
  /** 每个观众上一次被转发的时间：不同人互不挤占（2026-11-11 加） */
  private lastForwardByUser = new Map<string, number>();
  /** 最近 60 秒的转发时间戳，用来卡「每分钟最多几条」 */
  private forwardWindow: number[] = [];
  /** 现场速报：上次发送时间 + 定时器 */
  private lastDigestAt = 0;
  /** 速报序号：用来轮换开头措辞，别每条都长一样 */
  private digestSeq = 0;
  private digestTimer: any = null;
  /** 上次转发所属「场次」的时间，用于跨场次加时间戳 */
  private lastSessionAt = 0;
  /** SSE 是否连着（数据源自检用） */
  private sseConnected = false;
  /** SSE 最后一次收到数据的时刻 */
  private sseLastDataAt = 0;
  private sourceTimer: any = null;
  private lastAlertAt = 0;
  /** 数据源健康快照（给面板看） */
  private sourceHealth: Record<string, any> = { sse: 'unknown', silentMin: 0, live: 'unknown' };
  /** 礼物合并缓冲（窗口内多条礼物 → 一次唤醒） */
  private giftBuffer: LiveEvent[] = [];
  private giftMergeTimer: any = null;
  /** 礼物合并批次：谁 → 数量 / 金额 / 最后一次回复 */
  private giftBatch = new Map<string, { count: number; amount: number; reply: string; startedAt: number; timer: any }>();
  /** 上次发弹幕的时刻 */
  private lastDanmakuAt = 0;
  /** 弹幕发送被风控后的冷却截止时刻 */
  private danmakuBackoffUntil = 0;
  /** 待发弹幕队列：8 秒间隔不是「扔掉」，而是「排队等」 */
  private danmakuQueue: Array<{ text: string; at: number }> = [];
  private danmakuTimer: any = null;
  /** 最近一小时内推给模型的时间戳，用于 maxPerHour */
  private pushWindow: number[] = [];
  /** 本轮已经推过几次气泡（防她一轮说两遍） */
  private petSayCount = 0;
  /** 转发记录 */
  private forwardLog: Array<{ ts: string; target: string; text: string }> = [];
  /** 最近几次她说过的话（防复读） */
  private recentReplies: string[] = [];
  /** 最近这一幕：给模型看的「现场」，含被过滤掉的弹幕（氛围也是信息） */
  private scene: SceneItem[] = [];
  /** 高能榜/在线人数（从 bilibili.audience 里读） */
  private viewers = 0;
  /** 直播状态轮询定时器（bilibili 事件被 modelFeed 卡住时的兜底） */
  private liveTimer: any = null;
  /** 轮询得到的直播状态（null = 还没基线） */
  private livePolling: boolean | null = null;
  /** 待确认的状态变化（防抖用：连续两次读到同一状态才认，2026-11-15） */
  private livePending: { living: boolean; at: number } | null = null;
  /** 官方日榜当前快照（昵称 → 贡献值） */
  private rankOfficial = new Map<string, number>();
  /** 跨天前最后一份榜单：23:xx 收工时归档，下播时和当天那份合并 */
  /** rankOfficial 属于哪一天（YYYY-MM-DD），用来发现跨天 */
  /** 直播状态（true=刚开播 / false=刚下播 / null=未知） */
  private lastLiveOn: boolean | null = null;
  /** 开播/下播各自的上次播报时间（分开算，互不堵） */
  private lastStartNoticeAt = 0;
  private lastStopNoticeAt = 0;
  /** 本场统计：给「今晚战绩」用 */
  private sessStart = 0;
  private sessDanmaku = 0;
  private sessGifts = 0;
  private sessYuan = 0;
  private sessGuards = 0;
  private sessTop = new Map<string, number>();
  /** 本场榜单的持久化镜像（内存里 sessTop 仍是主表） */
  private rankState: RankSession | null = null;
  /** 本场最大一笔礼物（战报里给个画面感，不写金额） */
  private sessMaxGift: { name: string; gift: string; yuan: number } | null = null;
  /** 本场已经做过榜单校准（只拉一次） */
  private rankCalibrated = false;
  /** 气泡接口连续失败次数（用于退避，不要一失败就永久放弃） */
  private bubbleFails = 0;
  /** 下次允许重试的时间点（退避窗口内直接跳过，不刷日志） */
  private bubbleRetryAt = 0;
  /** 「礼物金额为 0」本场已记几条（每场最多 5 条，方便下次开播定位漏价的礼物名） */
  private giftZeroWarned = 0;
  /** 事件库连续读到 0 条的次数（诊断用） */
  private storeEmptyPolls = 0;
  /** 「准备下播」时抓到的官方日榜快照（下播后接口就空了，只能这时候存下来给战报用） */
  private officialTopSnapshot: Array<{ name: string; score: number }> | null = null;
  private rankSaveAt = 0;
  /** 今晚最高在线（下播战绩用） */
  private sessMaxViewers = 0;
  /** 今晚「看过」与「累计点赞」的峰值（bilibili.audience 里带，2026-11-12 加） */
  private sessWatched = 0;
  private sessLikeTotal = 0;
  /** 今晚开过舰的人（下播文案「今日舰长」那一行） */
  private sessGuardNames = new Set<string>();
  /** 播报节流与当日计数 */
  private lastNoticeAt = 0;
  private noticeCount = 0;
  private noticeDay = '';
  /** 上一次「顺带引导」的时刻与轮换序号 */
  private lastPromoAt = 0;
  private promoIndex = 0;
  /** 最近 60 条判定结果（面板「现场实况」用） */
  private decisions: Array<{ ts: string; kind: string; user: string; body: string; action: string; reason: string }> = [];
  /** 舰长欢迎配额状态 */
  private welcomeState: GuardWelcomeState = { date: todayKey(), seq: 0, counts: {} };
  /** 待确认的祝贺画草稿：{ 舰长名: { prompt, avatarPath, uid, at } } */
  private portraitDrafts: Record<string, { prompt: string; avatarPath?: string; uid?: string; at: string }> = {};
  /** 舰长名单：{ B站昵称: { uid, level, since, aliases:[] } } */
  private guardRoster: Record<string, {
    uid?: string;
    level?: number;
    since?: string;
    aliases?: string[];
    /** 到期日（YYYY-MM-DD）。B站舰长按月计费，默认 30 天 */
    expireAt?: string;
    /** 最近一次续费日期 */
    renewedAt?: string;
  }> = {};
  /** 本月已画过祝贺画的舰长：{ "2026-11": { 昵称: 1 } } */
  private portraitBook: Record<string, Record<string, number>> = {};
  /** 舰长每日画图额度：{ 日期, { 昵称: 已画张数 } } */
  private drawState: { date: string; counts: Record<string, number> } = { date: todayKey(), counts: {} };
  /** 事件库轮询 */
  private storeCursor = 0;
  private storeTimer: any = null;
  private storeReady = false;
  /** 待回复的 SC（延时读完再回） */
  private scTimers = new Set<any>();

  private ctx: any = null;

  constructor(ctx: any) {
    this.ctx = ctx;
    const raw = (ctx?.cfg ?? {}) as Partial<LiveCueConfig>;
    this.cfg = { ...DEFAULT_CONFIG, ...raw };
    this.welcomeState = loadWelcomeState();
    this.loadDrawState();
    this.loadPortraitBook();
    this.loadRoster();
    this.loadPortraitDrafts();
  }

  // ── World 契约：环境变量 ──
  envPromptVars(): Record<string, string> {
    return {
      'livecue.gapSec': this.cfg.gapSec > 0 ? String(this.cfg.gapSec) : '关闭',
      'livecue.minGiftYuan': String(this.cfg.minGiftYuan),
      'livecue.chanceGapSec': this.cfg.chanceGapSec > 0 ? String(this.cfg.chanceGapSec) : '关闭',
      'livecue.replyMaxChars': String(replyLimit(this.cfg)),
      // 下面 4 个给「环境提示词」用：玩家改措辞时不用写死数字，改设置就自动跟着变
      'livecue.guardBurstSec': String(this.cfg.guardBurstSec ?? 15),
      'livecue.sameUserGapSec': String(this.cfg.sameUserGapSec ?? 10),
      'livecue.guardDrawPerDay': String(this.cfg.guardDrawPerDay ?? 0),
      'livecue.gameGiftAlwaysReply': this.cfg.gameGiftAlwaysReply ? '开' : '关',
      'livecue.scDelaySec': String(this.cfg.scDelaySec ?? 8),
      'livecue.streamUrl': this.cfg.streamUrl,
      'livecue.gameBlock': buildGameBlock(this.cfg).trim(),
    };
  }

  // ── World 契约：工具 ──
  // 只提供一个「画图额度」小工具：QQ 群里的舰长要不要画、还能画几张，由她自己查/记账。
  // 直播里的额度是自动记的（onEvent 拦 image_draw），QQ 群里没有钩子，所以让她显式调用。
  tools(): any[] {
    return [
      {
        name: 'report_compose',
        tags: ['write'],
        description: '下播时把「昨日战报」写成文件（开播前会自动发到B站动态）。只在正式下播那一刻调一次，内容用第一人称、带你自己的口吻。',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            text: {
              type: 'string',
              description: '完整战报正文，按提示词里给的模板写（含标题、当晚最离谱的一件事、MVP三人、数据行、可选的舰长行、口号、直播间链接）。不要写金额。',
            },
          },
          required: ['text'],
        },
        handler: async (p: any) => {
          const text = String(p?.text || '').trim();
          if (text.length < 20) return '战报太短了（<20 字），没存。';
          const root = process.env.COOPANION_DATA || 'C:/Users/Administrator/Coopanion/data';
          const dir = reportDir(root);
          const day = this.rankState?.dayKey || bizDayKey();
          try {
            mkdirSync(dir, { recursive: true });
            writeFileSync(narrativePath(dir, day), text, 'utf8');
            this.log(`战报文案已存：${day}（${text.length} 字），下次开播发 B站`);
            return `已存 ${day} 的战报（${text.length} 字），开播前会自动发。`;
          } catch (e: any) {
            return `战报保存失败：${String(e?.message || e).slice(0, 80)}`;
          }
        },
      },
      {
        name: 'guard_portrait_save',
        tags: ['act'],
        description: '存一张「待主人确认」的祝贺画草稿（写完提示词就存，先别画）。',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '舰长的 B站昵称' },
            prompt: { type: 'string', description: '完整生图提示词（含风格、画面、贺词）' },
            avatar_path: { type: 'string', description: '已抓到的头像本地路径（没有就留空）' },
          },
          required: ['name', 'prompt'],
        },
        handler: async (args: any) => {
          const name = String(args?.name || '').trim();
          const prompt = String(args?.prompt || '').trim();
          if (!name || !prompt) return 'name 和 prompt 都要填。';
          this.loadPortraitDrafts();
          this.portraitDrafts[name] = {
            prompt,
            avatarPath: String(args?.avatar_path || '').trim() || undefined,
            uid: this.guardRoster[name]?.uid,
            at: new Date().toLocaleString('zh-CN', { hour12: false }),
          };
          this.savePortraitDrafts();
          this.log(`祝贺画草稿已存：${name}`);
          return `已存草稿（${name}）。现在私聊主人确认，**不要画**。`;
        },
      },
      {
        name: 'guard_portrait_pending',
        tags: ['act'],
        description: '列出所有「待主人确认」的祝贺画草稿，带完整提示词和头像路径；主人说「确认」后用它取草稿去画。',
        parameters: { type: 'object', properties: {} },
        handler: async (args: any) => {
          this.loadPortraitDrafts();
          const want = String(args?.name || '').trim();
          const keys = Object.keys(this.portraitDrafts).filter((k) => !want || k === want || k.includes(want));
          if (!keys.length) return '没有待确认的祝贺画草稿。';
          const group = String(this.cfg.liveNoticeTarget || '').trim();
          const owner = String(this.cfg.portraitOwner || '').trim();
          const portraitDir = 'C:/Users/Administrator/Coopanion/data/home/companion/pictures';
          const lvTag = '#舰长# #提督# #大航海# #直播# #主播# #然酱# #小鲸鱼#';
          return keys.map((k) => {
            const d = this.portraitDrafts[k];
            const info = this.guardRoster[k] || {};
            return `【${k}】uid=${info.uid || d.uid || '?'}`
              + (d.avatarPath ? `\n头像：${d.avatarPath}` : '')
              + `\n提示词：${d.prompt}`
              + `\n—— 两道门：① 主人说「确认」才画；② 画完先私聊主人，等「发」再对外 ——`
              + `\n1) \`image_edit\`（images=[头像, 小金鱼三视图]）或 \`image_draw\` 出图，蜡笔风`
              + `\n2) **先私聊主人（第二道门）**：\`qq_send\`（to="u:${owner}"，text="[图片:<成品绝对路径>] 画好了，你看看行不行，回「发」我就发出去"）`
              + `\n3) **主人回「发」之后，只调一次 \`guard_publish\`**：`
              + `name="${k}"、image=上面那张成品的绝对路径、text=<三段式正文>。`
              + `粉丝群 @人 / B站动态 / QQ空间 它一把发完，别再自己拼 qq_send、bili、qq_qzone。`
              + `\n4) 回执里哪一步失败就照实说，别补发、别重试第二次（6 小时内同图会被它拦住）。`
              + `\n5) \`guard_portrait_done\`（name="${k}"）收尾`
              + `\n—— 正文怎么写（画上已有贺词，正文**别再念一遍**）——`
              + `\n  三段式，总共 2~4 句，像说话不像通稿：`
              + `\n  ① 先谢：具体一点——他今天/这个月的哪个动作、哪句话、哪个礼物，别写「感谢支持」这种空话；`
              + `\n  ② 再贺：用航海意象说他上了船（多了一个位置、海图上多一条航迹、舰队多一盏灯），别用「欢迎欢迎」；`
              + `\n  ③ 收一句她自己的话：一个承诺、一个玩笑，或者一句祝福。`
              + `\n  可用句式（挑着改，别照抄）：`
              + `\n    ·「谢谢你今天把船票买了。舰队里多一个人，海里就多一盏灯。」`
              + `\n    ·「以后这艘船上有你一个位置。风大的时候别站甲板边上，我在这儿看着呢。」`
              + `\n    ·「又一个 30 天。谢谢你还愿意待在这条船上。」`
              + `\n  禁止：流水账（谢谢、感谢、再次感谢）、排比堆砌、Emoji 连打、喊「老板大气」。`
              + `\n  **B站动态**末尾加话题标签：${lvTag}（从里面挑 2~3 个，别全堆）`;
          }).join('\n\n');
        },
      },
      {
        name: 'guard_portrait_done',
        tags: ['act'],
        description: '祝贺画发布完成后删掉草稿（发完才调）。',
        parameters: {
          type: 'object',
          properties: { name: { type: 'string', description: '舰长 B站昵称' } },
          required: ['name'],
        },
        handler: async (args: any) => {
          const name = String(args?.name || '').trim();
          this.loadPortraitDrafts();
          if (!this.portraitDrafts[name]) return `没有「${name}」的草稿。`;
          delete this.portraitDrafts[name];
          this.savePortraitDrafts();
          this.markPortrait(name);
          return `已收尾：草稿删掉，本月账本记上了 ${name}（这个月不会再画第二张）。`;
        },
      },
      {
        name: 'guard_publish',
        tags: ['act'],
        description: '把已经确认好的祝贺画一次发到三个地方：粉丝群（@ ta）→ B站动态（@ ta，走 bili CLI）→ QQ空间（带图）。'
          + '**只在主人回「发」之后调用一次**；同一张图 6 小时内再调会被拦掉。'
          + '哪一步失败就照实报，别自己补发、别换个说法重试。',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '舰长昵称（B站昵称）' },
            image: { type: 'string', description: '成品图绝对路径' },
            text: { type: 'string', description: '正文：三段式 2~4 句；画上已有贺词就别重复' },
            at: { type: 'string', description: '@ 谁：QQ 群名片或昵称；不填就用 name' },
            group: { type: 'string', description: '群号；不填读配置 liveNoticeTarget' },
            skip: { type: 'string', description: '要跳过的平台，逗号分隔：group,bili,qzone' },
          },
          required: ['name', 'image', 'text'],
        },
        handler: async (args: any) => {
          const name = String(args?.name || '').trim();
          const image = String(args?.image || '').replace(/\\/g, '/').trim();
          const text = String(args?.text || '').trim();
          if (!name || !image || !text) return 'name / image / text 三个都要填。';
          if (!existsSync(image)) return `图片不存在：${image}`;
          const atName = String(args?.at || name).trim();
          const group = String(args?.group || this.cfg.liveNoticeTarget || '').trim();
          const skip = String(args?.skip || '').split(',').map((s) => s.trim()).filter(Boolean);
          const now = Date.now();

          // 同一张图 6 小时内只发一次（防重复发；2026-11-08 从 10 分钟放宽到 6 小时）
          const bookFile = join(dirname(guardPortraitPath()), 'guard-publish-log.json');
          let book: Record<string, number> = {};
          try { book = JSON.parse(readFileSync(bookFile, 'utf8')) || {}; } catch { book = {}; }
          const key = `${name}|${image}`;
          if (book[key] && now - book[key] < 6 * 60 * 60 * 1000) {
            const mins = Math.max(1, Math.round((now - book[key]) / 60000));
            const ago = mins >= 60 ? `${Math.round(mins / 60)} 小时` : `${mins} 分钟`;
            return `这张图 ${ago}前已经发过了，不重复发。真要再发一次，先问主人。`;
          }

          const out: string[] = [];
          let anyOk = false;

          if (!skip.includes('group')) {
            const qq = await this.resolveGroupQq(group, atName);
            const msg: any[] = [];
            if (qq) {
              msg.push({ type: 'at', data: { qq: String(qq) } });
              msg.push({ type: 'text', data: { text: ' ' } });
            }
            msg.push({ type: 'text', data: { text } });
            msg.push({ type: 'image', data: { file: `file:///${image}` } });
            const r = await this.napcat('send_group_msg', { group_id: Number(group), message: msg });
            const ok = r?.retcode === 0;
            anyOk = anyOk || ok;
            out.push(ok
              ? `粉丝群：已发（${qq ? `@到了「${atName}」` : `⚠️ 群里没找到「${atName}」，@ 没加上`}；message_id ${r?.data?.message_id ?? '?'}）`
              : `粉丝群：失败 ${JSON.stringify(r).slice(0, 120)}`);
          }

          if (!skip.includes('bili')) {
            const txt = join(dirname(image), `_bili-${now}.txt`);
            try {
              writeFileSync(txt, text, 'utf8');
              const { stdout } = await execFileP(
                BILLI_BIN,
                ['dynamic', 'post', '--file', txt, '--image', image, '--at', atName],
                { timeout: 180000, windowsHide: true },
              );
              const j = JSON.parse(String(stdout || '{}'));
              const ok = j?.ok === true;
              anyOk = anyOk || ok;
              out.push(ok
                ? `B站动态：已发（${j?.data?.dynamic_id ?? j?.data?.id ?? '接口返回成功'}）`
                : `B站动态：失败 ${String(stdout).slice(0, 120)}`);
            } catch (e: any) {
              out.push(`B站动态：失败 ${String(e?.message || e).slice(0, 120)}`);
            } finally {
              try { unlinkSync(txt); } catch { /* 临时文件删不掉也无所谓 */ }
            }
          }

          if (!skip.includes('qzone')) {
            const r = await this.napcat('send_qzone_msg', {
              content: text,
              images: [`file:///${image}`],
              ugc_right: 1,
            });
            const ok = r?.retcode === 0;
            anyOk = anyOk || ok;
            out.push(ok
              ? `QQ空间：已发（tid ${r?.data?.tid ?? '未返回'}）`
              : `QQ空间：失败 ${JSON.stringify(r).slice(0, 120)}`);
          }

          if (anyOk) {
            this.markPortrait(name);
            // 三处全成功才自动收尾（删草稿）；有失败就留着草稿等主人定
            if (!out.some((x) => x.includes('失败'))) {
              try {
                this.loadPortraitDrafts();
                if (this.portraitDrafts[name]) {
                  delete this.portraitDrafts[name];
                  this.savePortraitDrafts();
                }
              } catch { /* 草稿删不掉不影响发布结果 */ }
            }
            book[key] = now;
            try { writeFileSync(bookFile, JSON.stringify(book, null, 1), 'utf8'); } catch { /* 记不上就下次再发，能接受 */ }
          }
          this.log(`祝贺画发布 ${name}：${out.join(' | ').slice(0, 220)}`);
          return out.join('\n') + (anyOk ? '' : '\n三处都没发出去，先看 NapCat 是不是掉线了。');
        },
      },
      {
        name: 'guard_check',
        tags: ['act'],
        description: '查某人是不是本直播间的舰长（给人画图/发福利前先查）。name 填他在群里的名片或 B站昵称；'
          + '名单来自上舰事件自动累积，支持别名与模糊匹配。返回：是否舰长、什么等级、今天还能画几张。',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '群名片或 B站昵称' },
          },
          required: ['name'],
        },
        handler: async (args: any) => {
          const q = String(args?.name || '').trim();
          if (!q) return 'name 不能为空。';
          const hit = this.findGuard(q);
          const cap = Number(this.cfg.guardDrawPerDay ?? 0);
          if (!hit) {
            const total = Object.keys(this.guardRoster).length;
            return `名单里没有「${q}」（当前共 ${total} 位舰长）。可能他确实不是舰长；`
              + `也可能 B站昵称和群名片不一样——问一句他 B站叫什么，然后用 guard_bind 绑一下。`
              + `\n注意：不是舰长就不要主动画图（画图要花钱）。`;
          }
          const info = this.guardRoster[hit];
          const rank = info.level === 1 ? '总督' : info.level === 2 ? '提督' : '舰长';
          const used = this.drawCountOf(hit);
          const quota = cap ? `今天还能画 ${Math.max(0, cap - used)} 张（上限 ${cap}）` : '未设每日上限';
          const left = this.guardDaysLeft(hit);
          const expire = info.expireAt
            ? `；${info.expireAt} 到期${left != null ? `（还有 ${left} 天）` : ''}`
            : '';
          return `是${rank}（B站昵称「${hit}」${info.since ? `，${info.since} 起` : ''}${expire}）· ${quota}。`;
        },
      },
      {
        name: 'guard_bind',
        tags: ['act'],
        description: '把群里的名片和 B站昵称绑起来，以后 guard_check 就能认出他。qq_name 填群名片，bili_name 填名单里那个 B站昵称。',
        parameters: {
          type: 'object',
          properties: {
            qq_name: { type: 'string', description: '群里的名片/昵称' },
            bili_name: { type: 'string', description: 'B站昵称（名单里那个）' },
          },
          required: ['qq_name', 'bili_name'],
        },
        handler: async (args: any) => {
          const qn = String(args?.qq_name || '').trim();
          const bn = String(args?.bili_name || '').trim();
          if (!qn || !bn) return 'qq_name 和 bili_name 都要填。';
          const hit = this.findGuard(bn);
          if (!hit) return `名单里没有「${bn}」，先确认他 B站昵称怎么写。`;
          const info = this.guardRoster[hit];
          const aliases = new Set([...(info.aliases || []), qn]);
          this.guardRoster[hit] = { ...info, aliases: [...aliases] };
          this.saveRoster();
          return `已绑定：群名片「${qn}」= B站「${hit}」。以后叫这个名字我也认得。`;
        },
      },
      {
        name: 'avatar_fetch',
        tags: ['act'],
        description: '把观众头像下载到本地，供画图当参考图。B站场景填 uid（事件里带），QQ 群填 qq。返回本地文件路径，直接填进 image_edit 的 images。',
        parameters: {
          type: 'object',
          properties: {
            uid: { type: 'string', description: 'B站数字 UID（弹幕/上舰事件的 meta.uid）' },
            qq: { type: 'string', description: 'QQ 号（QQ 群场景）' },
            name: { type: 'string', description: '对方昵称，用来当文件名' },
          },
        },
        handler: async (args: any) => {
          const uid = String(args?.uid || '').trim();
          const qq = String(args?.qq || '').trim();
          const name = String(args?.name || uid || qq || 'fan').trim();
          const safe = name.replace(/[\\/:*?"<>|\s]/g, '_').slice(0, 24) || 'fan';
          let url = '';
          let via = '';
          let sex = '';
          try {
            if (qq) {
              if (!/^\d{5,12}$/.test(qq)) return `qq 要填纯数字 QQ 号（收到的是「${qq}」）。没有就只给 name，用昵称描述。`;
              url = `https://q1.qlogo.cn/g?b=qq&nk=${encodeURIComponent(qq)}&s=640`;
              via = 'QQ 头像';
              const sr = await this.napcat('get_stranger_info', { user_id: Number(qq) }, 15000);
              const sx = String(sr?.data?.sex || '');
              sex = sx === 'male' ? '男' : sx === 'female' ? '女' : '';
            } else if (uid) {
              // 她常把中文昵称塞进 uid，会直接把请求打崩（ByteString 报错）
              if (!/^\d{1,20}$/.test(uid)) return `uid 要填 B站数字 ID（收到的是「${uid}」）。没有数字 ID 就别传 uid，用 name 走昵称描述。`;
              const r = await fetch(`https://api.bilibili.com/x/web-interface/card?mid=${encodeURIComponent(uid)}`, {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                  Referer: `https://space.bilibili.com/${uid}`,
                },
              });
              const j: any = await r.json().catch(() => ({}));
              if (Number(j?.code) === 0) {
                url = String(j?.data?.card?.face || '');
                via = 'B站头像';
                const sxb = String(j?.data?.card?.sex || '');
                sex = sxb === '男' || sxb === '女' ? sxb : '';
              } else {
                return `B站接口没给头像（code=${j?.code}）。用昵称「${name}」纯文字画就行，别编路径。`;
              }
            } else {
              return 'uid 和 qq 至少给一个。';
            }
            if (!url) return `没拿到头像地址（${via}）。用昵称「${name}」纯文字画，别编路径。`;

            const res = await fetch(url, {
              headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.bilibili.com/' },
            });
            if (!res.ok) return `下载头像失败（HTTP ${res.status}）。用昵称纯文字画。`;
            const buf = Buffer.from(await res.arrayBuffer());
            if (buf.length < 200) return '头像文件太小（可能是占位图）。用昵称纯文字画。';

            const root = process.env.COOPANION_DATA || 'C:/Users/Administrator/Coopanion/data';
            const dir = join(root, 'home', 'companion', 'pictures', 'refs', 'fans');
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
            const file = join(dir, `${safe}.jpg`);
            writeFileSync(file, buf);
            this.log(`已抓取${via}：${name} → ${file}（${Math.round(buf.length / 1024)}KB）`);
            return `已保存${via}：${file}`
              + (sex
                ? `\n性别（平台资料）：${sex}`
                : `\n性别（平台资料）：保密/没给`)
              + `\n定妆：性别=女→女装；男→男装；保密→看头像特征，拿不准就私聊问主人一句，别自己猜。`
              + `\n（发布前仍要主人回「发」，这一条不变。）`
              + `\n把它填进 image_edit 的 images 数组当参考图。`
              + `\n入画判断：真人照 / 动漫角色 / 有明确人物的 → 直接用；`
              + `纯风景、纯文字、logo、纯动物、表情包 → 不适合入画，改用「昵称 + 蜡笔风小人」描述。`
              + `\n（动漫头像没问题，统一按蜡笔风重绘：crayon drawing style, bold waxy strokes, textured paper）`;
          } catch (e: any) {
            return `抓头像出错：${String(e?.message || e).slice(0, 80)}。用昵称纯文字画，别编路径。`;
          }
        },
      },
      {
        name: 'draw_quota',
        tags: ['act'],
        description: '查/记「舰长每日免费画图」额度。给粉丝画画之前先 check 一次；真的画完再 use 一次记账。'
          + 'who 填对方在群里的名片（和 @ 用的是同一个名字）。返回剩余张数，0 表示今天没有了。',
        parameters: {
          type: 'object',
          properties: {
            who: { type: 'string', description: '对方在群里的名片/昵称，原样填。' },
            action: { type: 'string', enum: ['check', 'use'], description: 'check=只看还剩几张；use=记一张（画完才调）。' },
          },
          required: ['who'],
        },
        handler: async (args: any) => {
          const who = String(args?.who || '').trim();
          const action = String(args?.action || 'check');
          if (!who) return 'who 不能为空，填对方在群里的名片。';
          const cap = Number(this.cfg.guardDrawPerDay ?? 0);
          if (!cap) return '当前没设上限（guardDrawPerDay=0），随便画。';
          const used = this.drawCountOf(who);
          if (action === 'use') {
            if (used >= cap) return `${who} 今天 ${cap} 张已经用完了，不要再画，跟他说清楚并约明天。`;
            this.bumpDrawCount(who);
            const left = cap - (used + 1);
            return left > 0 ? `已记 1 张，${who} 今天还能画 ${left} 张。` : `已记 1 张，${who} 今天额度用完了。`;
          }
          const left = cap - used;
          return left > 0
            ? `${who} 今天还能画 ${left} 张（上限 ${cap}）。`
            : `${who} 今天 ${cap} 张已经用完了，别画，约明天。`;
        },
      },
    ];
  }

  // ── World 契约：截获主 session 输出，识别 qq_send / pet_say ──
  outputTap(): any {
    return {
      onEvent: (event: any): void => {
        if (!event || typeof event !== 'object') return;

        // 累积正文
        if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
          this._tapBuf += event.delta;
        }

        // 工具调用完成：识别 qq_send / pet_say
        if (event.type === 'response.output_item.done' && event.item?.type === 'function_call') {
          // ① 她发 QQ → 记录到面板
          if (event.item.name === 'qq_send') {
            try {
              const args = JSON.parse(event.item.arguments || '{}');
              const text = String(args.text || '').trim();
              const target = String(args.to || '');
              if (text) this.recordQq(text, target);
            } catch {
              /* ignore */
            }
          }

          // ①b 画图额度：只要调了画图工具，就给当前这条直播事件的主人记一张
          if (event.item.name === 'image_draw' || event.item.name === 'image_edit') {
            const owner = this.pendingQueue[0];
            if (owner && (owner.guardLevel ?? 0) > 0 && owner.username) {
              this.bumpDrawCount(owner.username);
            }
          }

          // ② 她对弹幕说话（pet_say）→ 转发到 QQ / 发弹幕
          // 一次轮次可能合并了好几条事件，所以按 FIFO 消费，别只认最后一条
          if (event.item.name === 'pet_say') {
            const target = this.pendingQueue.shift() ?? null;
            if (!target) {
              // 2026-11-23 加：主人和她对话时，她的话没有绑定事件（pendingQueue 为空）。
              // 这类以前直接丢掉，导致「气泡里有、弹幕里没有」。现在按开关同步到弹幕。
              if (this.cfg.mirrorUnownedSay !== false) {
                try {
                  const args = JSON.parse(event.item.arguments || '{}');
                  const clean = cleanScript(String(args.script || ''));
                  if (clean) {
                    this.rememberReply(clean);
                    void this.sendDanmaku(clean);
                    this.log('这条 pet_say 没有绑定事件，按「同步到弹幕」处理');
                  }
                } catch {
                  /* ignore */
                }
              } else {
                this.log('这条 pet_say 没有对应的待回应事件，不转发也不发弹幕');
              }
              return;
            }
            try {
              const args = JSON.parse(event.item.arguments || '{}');
              const script = String(args.script || '');
              const clean = cleanScript(script);
              if (clean) {
                this.petSayCount++;
                this.rememberReply(clean);
                void this.forwardToQq(clean, target);
                void this.sendDanmaku(clean);
              }
            } catch {
              /* ignore */
            }
          }
        }
      },
      onAbort: (): void => {
        this._tapBuf = '';
        this.pendingQueue = [];
      },
    };
  }

  /** 记住最近说过的话，下一轮提示词里明确要求别重复 */
  private rememberReply(text: string): void {
    const t = String(text || '').trim();
    if (!t) return;
    this.recentReplies.push(t);
    if (this.recentReplies.length > 8) this.recentReplies = this.recentReplies.slice(-8);
  }

  /** 记录一条发往 QQ 的消息（同一条只记一次），并直接推成桌宠气泡（0 token） */
  private recordQq(text: string, target: string): void {
    if (!this.cfg.syncQqToBubble) return;
    const last = this.qqLog[this.qqLog.length - 1];
    if (last && last.text === text) return; // 去重：连续相同不重复记

    this.qqLog.push({
      ts: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      text,
      kind: target.startsWith('group') ? 'group' : 'private',
      user: '小鲸鱼',
    });
    if (this.qqLog.length > 100) this.qqLog = this.qqLog.slice(-100);
    this.log(`QQ 同步记录 +1（共 ${this.qqLog.length} 条）`);
    if (this.qqLog.length % 5 === 0) {
      try {
        writeFileSync(qqLogPath(), JSON.stringify(this.qqLog), 'utf8');
      } catch {
        /* 落盘失败不影响发送 */
      }
    }

    // 关键：直接 POST 给桌宠的 /api/say，不经过模型 → 0 token
    void this.fireBubble(text);
  }

  /** 把一段文字直接推成桌宠气泡（走 7797 的 /api/say，不调 LLM） */
  private async fireBubble(text: string): Promise<void> {
    // 退避窗口内直接跳过：Coo 刚启动时 pet 服务常常还没就绪（打过去就是 405），
    // 过一会儿自己就好 —— 所以不能一失败就永久停用（2026-11-21 改）。
    const nowMs = Date.now();
    if (nowMs < this.bubbleRetryAt) return;
    try {
      const res = await fetch('http://127.0.0.1:7797/api/say', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const err = await res.text().catch(() => '');
        // 405/503 多半是「pet 服务还没起来」：指数退避重试（30s→60s→…→最多 10 分钟），
        // 一旦成功立刻清零。这样 Coo 更新/重启后不需要人工干预也能自己恢复。
        if (res.status === 405 || res.status === 503) {
          this.bubbleFails += 1;
          const delay = Math.min(600_000, 30_000 * Math.pow(2, Math.min(this.bubbleFails - 1, 4)));
          this.bubbleRetryAt = nowMs + delay;
          this.log(`气泡接口 ${res.status}（连续第 ${this.bubbleFails} 次），${Math.round(delay / 1000)} 秒后重试；不影响 QQ 与直播`);
          return;
        }
        this.log(`气泡推送失败 HTTP ${res.status}：${err.slice(0, 80)}`);
        return;
      }
      this.bubbleFails = 0;      // 成功就归零，下次再抖重新从 30 秒起
      this.bubbleRetryAt = 0;
      this.log(`气泡已推送：${text.slice(0, 30)}`);
    } catch (e: any) {
      this.log(`气泡推送异常：${e?.message || e}`);
    }
  }

  /**
   * 把同一段话发到 B 站直播间弹幕。
   * 文本直接来自本轮 pet_say，不额外调用模型，所以是 0 额外 token。
   */
  private async sendDanmaku(text: string): Promise<void> {
    if (!this.cfg.sendDanmaku) return;
    const clean = String(text || '').trim();
    if (!clean) return;
    // 2026-11-23 加：弹幕是公开播出的，先过一遍敏感词，命中就不发（气泡和 QQ 照常）
    // 2026-11-23 晚改：词表可配置（danmakuBlockWords），内置项只留「B站真会吞/真不该播」的，
    //   去掉「内部/下播时间」这类会误伤正常聊天的词。
    if (this.cfg.danmakuGuard !== false) {
      const bad = hitDanmakuGuard(clean, this.cfg.danmakuBlockWords || '');
      if (bad) {
        this.log(`发弹幕：命中「${bad}」，这条不往直播间发（气泡不受影响）`);
        return;
      }
    }
    const now = Date.now();
    // 队列最多压 3 条，超了丢最旧的（直播节奏快，过时的回应没意义）
    this.danmakuQueue = this.danmakuQueue.filter((q) => now - q.at < 30_000).slice(-2);
    this.danmakuQueue.push({ text: clean, at: now });
    this.drainDanmaku();
  }

  /** 按 danmakuGapSec 逐条放行；不够间隔就排到该发的时刻，不再直接丢弃 */
  private drainDanmaku(): void {
    if (this.danmakuTimer) return;
    if (!this.danmakuQueue.length) return;
    const now = Date.now();
    if (now < this.danmakuBackoffUntil) {
      const wait = this.danmakuBackoffUntil - now;
      this.log(`发弹幕：风控冷却中，队列 ${this.danmakuQueue.length} 条等 ${Math.ceil(wait / 1000)}s`);
      this.danmakuTimer = setTimeout(() => {
        this.danmakuTimer = null;
        this.drainDanmaku();
      }, wait + 50);
      return;
    }
    const gap = Number(this.cfg.danmakuGapSec || 8) * 1000;
    const wait = this.lastDanmakuAt + gap - now;
    if (wait > 0) {
      this.danmakuTimer = setTimeout(() => {
        this.danmakuTimer = null;
        this.drainDanmaku();
      }, wait + 50);
      return;
    }
    const item = this.danmakuQueue.shift()!;
    void this.fireDanmaku(item.text);
    if (this.danmakuQueue.length) {
      this.danmakuTimer = setTimeout(() => {
        this.danmakuTimer = null;
        this.drainDanmaku();
      }, gap + 50);
    }
  }

  /** 真正调 B站接口发一条 */
  private async fireDanmaku(text: string): Promise<void> {
    if (!this.cfg.sendDanmaku) return;

    let cookie = String(this.cfg.danmakuCookie || '').trim();
    let roomId = Number(this.cfg.danmakuRoomId || 0);

    // Cookie 复用：SESSDATA 直接读 B站直播间插件里那份，只需补 bili_jct
    if (!cookie) {
      const sess = readBilibiliSessdata();
      const jct = String(this.cfg.danmakuBiliJct || '').trim();
      if (sess && jct) cookie = `SESSDATA=${sess}; bili_jct=${jct}`;
    }
    if (!roomId) roomId = readBilibiliRoomId();

    if (!cookie || !roomId) {
      this.log('发弹幕：还没填 Cookie 或房间号，跳过');
      return;
    }

    const now = Date.now();
    const jct = cookie.match(/bili_jct=([^;]+)/);
    const csrf = jct ? jct[1] : '';
    if (!csrf) {
      this.log('发弹幕：Cookie 里没有 bili_jct，无法通过 CSRF 校验');
      return;
    }

    const maxLen = Number(this.cfg.danmakuMaxLen || 80);
    const msg = clipDanmaku(text, maxLen);
    if (!msg) return;

    this.lastDanmakuAt = now;

    const body = new URLSearchParams({
      color: '16777215',
      fontsize: '25',
      mode: '1',
      msg,
      rnd: String(Math.floor(now / 1000)),
      roomid: String(roomId),
      csrf,
      csrf_token: csrf,
    });

    try {
      const res = await fetch('https://api.live.bilibili.com/msg/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: cookie,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          Referer: `https://live.bilibili.com/${roomId}`,
          Origin: 'https://live.bilibili.com',
        },
        body: body.toString(),
      });
      const j: any = await res.json().catch(() => ({}));
      this.log(`发弹幕「${msg}」→ code=${j.code ?? res.status} ${j.message ?? ''}`.trim());
      // 1003212 = 超出限制长度：按宽度再收 8 位重试一次，别白丢一句话
      if (Number(j.code) === 1003212) {
        const shorter = clipDanmaku(msg, Math.max(20, maxLen - 8));
        if (shorter && shorter !== msg) {
          this.log(`超长被拒，缩短重试：「${shorter}」`);
          await this.fireDanmaku(shorter);
          return;
        }
      }
      // 风控/频率类错误：自动退避，比手动调大间隔更省事
      if (j.code !== 0 && j.code !== undefined) {
        if (isRateLimitCode(j.code, j.message)) {
          this.danmakuBackoffUntil = Date.now() + 120_000;
          this.log('发弹幕触发风控，自动冷却 120 秒');
        }
      }
    } catch (e: any) {
      this.log(`发弹幕失败：${String(e?.message || e)}`);
    }
  }

  private async forwardToQq(reply: string, ev: LiveEvent): Promise<void> {
    if (!this.cfg.forwardToQq) return;
    // 合并礼物没攒够门槛：她在直播间回一句就行，不进群（2026-11-12）
    if (ev.noForward) {
      this.log(`合并礼物 ¥${ev.amount ?? 0} < 门槛 ${this.cfg.minGiftYuan}，不转发`);
      return;
    }
    // 兜底：没开合并窗口时，单条小额礼物照样不进群
    if (ev.kind === 'gift' && (ev.amount ?? 0) < Number(this.cfg.minGiftYuan ?? 1)) {
      this.log(`小额礼物不转发：${ev.username} ${ev.body} ¥${ev.amount ?? 0} < ${this.cfg.minGiftYuan}`);
      return;
    }

    // SC / 舰长 / 大额礼物：单独成条、不等合并窗口（2026-11-11）
    // 这些是「花了钱的动作」，混在普通转发里会被刷过去，也不该跟 0.1 元人气票一起被合并。
    const bigYuan = Number(this.cfg.bigGiftYuan ?? 10);
    const highlight = ev.kind === 'superchat' || ev.kind === 'guard'
      || (ev.kind === 'gift' && (ev.amount ?? 0) >= bigYuan);
    if (highlight) {
      const t = this.buildForwardText(reply, ev);
      await this.pushForward(t, { bypassGap: true, who: ev.username });
      this.log(`高光单独转：${ev.kind} ${ev.username} ¥${ev.amount ?? 0}`);
      return;
    }

    // 礼物合并：同一人 5 分钟内连送，只留首条 + 一条汇总，避免群里刷屏
    if (ev.kind === 'gift') {
      const who = ev.username || '观众';
      const now = Date.now();
      const cur = this.giftBatch.get(who);
      if (cur && now - cur.startedAt < 300_000) {
        cur.count += ev.count || 1;
        cur.amount += ev.amount || 0;
        cur.reply = reply;
        if (cur.timer) clearTimeout(cur.timer);
        cur.timer = setTimeout(() => void this.flushGift(who), 90_000);
        this.log(`礼物合并：${who} 累计 ${cur.count} 个`);
        return;
      }
      const first = this.buildForwardText(reply, ev);
      await this.pushForward(first, { who });
      const batch = { count: ev.count || 1, amount: ev.amount || 0, reply, startedAt: now, timer: null as any };
      this.giftBatch.set(who, batch);
      setTimeout(() => {
        if (this.giftBatch.get(who) === batch) this.giftBatch.delete(who);
      }, 300_000);
      return;
    }

    const text = this.buildForwardText(reply, ev);
    await this.pushForward(text, { who: ev.username });
  }

  /** 拼一段完整转发文字；跨场次才加时间戳 */
  private buildForwardText(reply: string, ev: LiveEvent): string {
    const body = this.formatForward(reply, ev);
    if (!body) return '';
    const now = Date.now();
    if (now - this.lastSessionAt > 90 * 60_000) {
      this.lastSessionAt = now;
      const d = new Date(now);
      const p2 = (n: number) => String(n).padStart(2, '0');
      const stamp = `🕐 ${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
      return stamp + '\n' + body;
    }
    return body;
  }

  /**
   * 真正发出去（三重节流，2026-11-11 改）
   *
   * 以前只有一道「全局 60 秒」：两个人先后说话，第二个直接被丢，一晚丢了 7 条。
   * 现在分三层，目标是「不刷屏、但不同人别互相挤掉」：
   *   ① 同一个人：qqForwardGapSec 内不再替他发（刷屏的真正来源是同一人连发）
   *   ② 任意两条之间：qqForwardMinGapSec 最小间隔（默认 5 秒），防瞬间连发
   *   ③ 每分钟总量：qqForwardMaxPerMin（默认 6 条），超了就丢并记日志
   * 礼物汇总条 / 现场速报用 bypassGap 跳过 ①②③（它们本身就是节流后的产物）。
   */
  /** 转发一条到 QQ 群。返回 true=至少发成功了一个目标；false=被节流/无目标/全部失败 */
  private async pushForward(
    text: string,
    opts: { bypassGap?: boolean; who?: string } = {},
  ): Promise<boolean> {
    if (!text) return false;
    const now = Date.now();
    const who = String(opts.who || '').trim();

    if (!opts.bypassGap) {
      const gapMs = Math.max(0, Number(this.cfg.qqForwardGapSec ?? 60)) * 1000;
      // ① 同一个人：默认按人算；关掉 qqForwardPerUser 就退回旧的「全局间隔」
      if (this.cfg.qqForwardPerUser !== false) {
        if (who && gapMs > 0) {
          const last = this.lastForwardByUser.get(who) ?? 0;
          if (now - last < gapMs) {
            this.log(`转发节流：${who} 刚发过（${Math.round((now - last) / 1000)}s < ${this.cfg.qqForwardGapSec}s），跳过`);
            return false;
          }
        }
      } else if (gapMs > 0 && now - this.lastForwardAt < gapMs) {
        this.log('转发节流中，跳过');
        return false;
      }

      // ② 任意两条之间的最小间隔
      const minGap = Math.max(0, Number(this.cfg.qqForwardMinGapSec ?? 5)) * 1000;
      if (minGap > 0 && this.lastForwardAt > 0 && now - this.lastForwardAt < minGap) {
        this.log(`转发太密（${Math.round((now - this.lastForwardAt) / 1000)}s < ${this.cfg.qqForwardMinGapSec}s），跳过`);
        return false;
      }

      // ③ 每分钟条数上限
      const cap = Math.max(0, Number(this.cfg.qqForwardMaxPerMin ?? 6));
      this.forwardWindow = this.forwardWindow.filter((t) => now - t < 60_000);
      if (cap > 0 && this.forwardWindow.length >= cap) {
        this.log(`本分钟已转发 ${this.forwardWindow.length} 条，达到上限 ${cap}，跳过`);
        return false;
      }
    }

    this.forwardWindow.push(now);
    this.lastForwardAt = now;
    if (who) this.lastForwardByUser.set(who, now);
    if (this.lastForwardByUser.size > 500) {
      for (const [k, t] of this.lastForwardByUser) if (now - t > 3600_000) this.lastForwardByUser.delete(k);
    }
    const targets = String(this.cfg.qqForwardTargets || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    if (!targets.length) {
      this.log('转发目标为空');
      return false;
    }
    let anyOk = false;
    for (const t of targets) {
      if (await this.sendToQq(t, text)) anyOk = true;
    }
    return anyOk;
  }

  /** 礼物窗口结束：送了不止一次就补一条汇总 */
  private async flushGift(who: string): Promise<void> {
    const b = this.giftBatch.get(who);
    if (!b) return;
    this.giftBatch.delete(who);
    if (b.count <= 1) return;
    const extra = b.count - 1;
    // 不显示金额：整蛊场景里礼物是「道具」，报钱会出戏
    const text = `🎁【直播】${who} 又用了 ${extra} 次\n🐳小鲸鱼：${b.reply}`;
    await this.pushForward(text, { bypassGap: true, who });
  }

  /** 按配置格式拼转发文字 */
  private formatForward(reply: string, ev: LiveEvent): string {
    const fmt = this.cfg.qqForwardFormat || 'full';

    // 礼物 / SC / 上舰属于「花了钱的动作」，不管转发格式怎么设都必须带完整信息：
    // 以前 reply 模式会把它压成「只有她的一句话」，等于礼物没转（2026-11-11 修）。
    const isGiftish = ev.kind === 'gift' || ev.kind === 'superchat' || ev.kind === 'guard';

    if (fmt === 'reply' && !isGiftish) return reply;

    // important：只转「被 @ / 叫到名字」的弹幕，以及礼物 / SC / 上舰 / 舰长进场
    if (fmt === 'important') {
      const kws = splitList(this.cfg.atKeywords || '');
      const body = ev.body || '';
      const called = /@\S+/.test(body) || kws.some((k) => body.includes(k));
      const guardEnter = ev.kind === 'enter' && (ev.guardLevel ?? 0) > 0;
      if (!isGiftish && !guardEnter && !(ev.kind === 'danmaku' && called)) return '';
    }

    // 按事件类型配图标：一眼分清是弹幕、礼物、SC 还是上舰
    const icon =
      ev.kind === 'gift' ? '🎁'
      : ev.kind === 'superchat' ? '💬'
      : ev.kind === 'guard' ? '👑'
      : ev.kind === 'enter' ? '👋'
      : '🎬';
    // 超长弹幕截断，避免一条消息刷满屏
    const clip = (t: string, n = 42) => (t.length > n ? t.slice(0, n) + '…' : t);
    const src =
      ev.kind === 'gift'
        ? `【直播】${ev.username} 使用了「${clip(ev.body, 18)}」${ev.count && ev.count > 1 ? ` ×${ev.count}` : ''}`
        : ev.kind === 'superchat'
          ? `【直播SC】${ev.username}：${clip(ev.body, 60)}`
          : ev.kind === 'guard'
            ? `【直播】${ev.username} 开通了${ev.guardName || '舰长'}`
            : ev.kind === 'enter'
              ? `【直播】${ev.username} 进来了`
              : `【直播】${ev.username}：${clip(ev.body)}`;
    return `${icon}${src}\n🐳小鲸鱼：${reply}`;
  }

  /** 调 NapCat 的 OneBot 接口（统一入口，失败不抛，返回 { retcode: -1 }） */
  private async napcat(ep: string, body: any, timeoutMs = 60000): Promise<any> {
    try {
      const res = await fetch(`${NAPCAT_BASE}/${ep}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const raw = await res.text().catch(() => '');
      try {
        return JSON.parse(raw);
      } catch {
        return { retcode: -1, raw: raw.slice(0, 200) };
      }
    } catch (e: any) {
      return { retcode: -1, error: String(e?.message || e).slice(0, 160) };
    }
  }

  /** 群里按「群名片 → 昵称 → 模糊」找人的 QQ 号（@ 用；名片空的也能靠昵称兜住） */
  private async resolveGroupQq(group: string, name: string): Promise<string> {
    const r = await this.napcat('get_group_member_list', { group_id: Number(group) }, 30000);
    const list: any[] = Array.isArray(r?.data) ? r.data : [];
    const want = name.trim().toLowerCase();
    if (!want || !list.length) return '';
    const card = (m: any) => String(m?.card || '').trim().toLowerCase();
    const nick = (m: any) => String(m?.nickname || '').trim().toLowerCase();
    const hit = list.find((m) => card(m) === want)
      || list.find((m) => nick(m) === want)
      || list.find((m) => card(m).includes(want) || nick(m).includes(want));
    return hit ? String(hit.user_id) : '';
  }

  /**
   * 把 [表情包:文件名] / [图片:文件名] 拆成真正的图片段。
   * 以前整段当纯文本发出去，群里看到的是「[表情包:xx.gif]」这行字——2026-11-13 修。
   * 找不到文件就整段丢掉（不退回文字），否则群里会多一行垃圾。
   */
  private buildQqMessage(text: string): any[] {
    const dirs = [
      String((this.cfg as any).stickerDir || DEFAULT_STICKER_DIR).trim(),
      DEFAULT_STICKER_DIR,
    ].filter(Boolean);
    const segs: any[] = [];
    const re = /\[(?:表情包|图片):([^\[\]\r\n]{1,120})\]/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) {
        const t = text.slice(last, m.index);
        if (t.trim()) segs.push({ type: 'text', data: { text: t } });
      }
      const name = m[1].trim();
      let done = false;
      for (const d of dirs) {
        const p = `${d.replace(/[\\/]+$/, '')}/${name}`;
        try {
          if (!existsSync(p)) continue;
          const buf = readFileSync(p);
          // NapCat 走 base64 最稳，file:// 在部分版本读不到；单张超上限就跳过（群里也发不出去）
          if (buf.length > MAX_STICKER_BYTES) continue;
          segs.push({ type: 'image', data: { file: `base64://${buf.toString('base64')}` } });
          done = true;
          break;
        } catch { /* 读不到就试下一个目录 */ }
      }
      if (!done) this.log(`表情包跳过（不存在或超过 4MB）：${name}`);
      last = m.index + m[0].length;
    }
    if (last < text.length) {
      const t = text.slice(last);
      if (t.trim()) segs.push({ type: 'text', data: { text: t } });
    }
    return segs;
  }

  /** 发到 NapCat（群或私聊） */
  /** 发一条到 QQ。返回 true=真的发出去了；false=目标无效/内容为空/失败/异常 */
  private async sendToQq(target: string, text: string): Promise<boolean> {
    const isPrivate = target.startsWith('u:');
    const id = Number(target.replace(/^[gu]:/, ''));
    if (!Number.isFinite(id) || id <= 0) {
      this.log(`转发目标无效：${target}`);
      return false;
    }
    const ep = isPrivate ? 'send_private_msg' : 'send_group_msg';
    const message = this.buildQqMessage(text);
    if (!message.length) {
      this.log('没有可发的内容（表情包缺失且无正文），跳过');
      return false;
    }
    const body = isPrivate
      ? { user_id: id, message }
      : { group_id: id, message };

    try {
      const res = await fetch(`http://127.0.0.1:3000/${ep}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const raw = await res.text().catch(() => '');
      if (!res.ok || /"retcode":\s*(?!0)\d+/.test(raw)) {
        this.log(`转发失败 ${target}：${raw.slice(0, 100)}`);
        return false;
      }
      this.log(`已转发到 ${target}`);
      this.forwardLog.push({
        ts: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        target,
        text: text.slice(0, 200),
      });
      if (this.forwardLog.length > 100) this.forwardLog = this.forwardLog.slice(-100);
      return true;
    } catch (e: any) {
      this.log(`转发异常 ${target}：${e?.message || e}`);
      return false;
    }
  }

  /** 面板请求处理 */
  private async invokePanel(panel: string, method: string, args: any[]): Promise<any> {
    if (panel === 'settings' && method === 'load') {
      return { ...DEFAULT_CONFIG, ...this.cfg };
    }
    if (panel === 'settings' && method === 'save') {
      const patch = (args?.[0] ?? {}) as Record<string, unknown>;
      const clean: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(patch)) {
        if (!(k in DEFAULT_CONFIG)) continue;
        const cur = (DEFAULT_CONFIG as any)[k];
        if (typeof cur === 'number') clean[k] = Number.isFinite(Number(v)) ? Number(v) : 0;
        else if (typeof cur === 'boolean') clean[k] = v === true || v === 'true';
        else clean[k] = String(v ?? '');
      }
      Object.assign(this.cfg, clean);
      Object.assign(this.ctx?.cfg ?? {}, clean);
      try {
        this.ctx?.persist?.(clean);
      } catch (e: any) {
        this.log(`保存配置失败：${e?.message || e}`);
        throw e;
      }
      this.log(`配置已保存：${Object.keys(clean).join(', ')}`);
      return { ok: true, saved: Object.keys(clean).length };
    }
    if (panel === 'qq-sync' && method === 'list') {
      // 优先读 ctx.cfg（配置页改动后会热更新到这里），回落到实例快照
      const live = this.ctx?.cfg?.syncQqToBubble;
      const enabled = typeof live === 'boolean' ? live : this.cfg.syncQqToBubble;
      return { enabled, count: this.qqLog.length, items: this.qqLog };
    }
    if (panel === 'qq-sync' && method === 'clear') {
      this.qqLog = [];
      return { ok: true };
    }
    if (panel === 'qq-sync' && method === 'setEnabled') {
      const v = Boolean(args?.[0]);
      // 走框架的 persist：写入 config.json 的 worlds.live-cue 段，并同步活对象
      try {
        this.ctx?.persist?.({ syncQqToBubble: v });
      } catch (e: any) {
        this.log(`persist 失败：${e?.message || e}`);
      }
      // 兜底：即使 persist 不可用，内存也立即生效
      this.cfg.syncQqToBubble = v;
      return { ok: true, enabled: v };
    }
    if (panel === 'settings' && method === 'noticePreview') {
      return {
        start: this.buildNoticePrompt(true, Date.now()),
        stop: this.buildNoticePrompt(false, Date.now()),
        todayCount: this.noticeCount,
        cap: this.cfg.liveNoticeMaxPerDay,
      };
    }
    if (panel === 'settings' && method === 'noticeTest') {
      const isStart = args?.[0] !== 'stop';
      const prompt = this.buildNoticePrompt(isStart, Date.now());
      this.log(`手动试发${isStart ? '开播' : '下播'}播报`);
      void this.host?.pushEvent?.({
        type: 'live.notice',
        ts: new Date().toISOString(),
        source: this.id,
        senderKey: this.id,
        origin: 'external',
        text: prompt,
      }, { trigger: 'flush' });
      return { ok: true, pushed: isStart ? 'start' : 'stop' };
    }
    // Overlay 面板：把 B站插件那块画面直接嵌进设置窗口预览（地址由 streamUrl 推导，端口顺延也跟得上）
    if (panel === 'overlay' && method === 'info') {
      const base = String(this.cfg.streamUrl || '').replace(/\/stream\/?$/, '');
      return {
        overlayUrl: `${base}/overlay`,
        // 面板预览用 ?preview：B站那页会铺棋盘格，否则透明背景在窗口里是一块白
        previewUrl: `${base}/overlay?preview`,
        editorUrl: `${base}/editor`,
        streamUrl: String(this.cfg.streamUrl || ''),
      };
    }
    if (panel === 'live-stats' && method === 'list') {
      return {
        running: this.running,
        store: this.storeReady ? `事件库已接入（cursor ${this.storeCursor}）` : '事件库未接入（礼物金额可能判不出）',
        source: this.snapshotSource(),
        counters: this.counters,
        skips: Object.fromEntries([...this.skipCounts.entries()].sort((a, b) => b[1] - a[1])),
        recentReplies: this.recentReplies,
        decisions: this.decisions,
      };
    }
    // 自测：把一条假事件塞进完整链路（过滤 → 去重 → 限频 → 唤醒），不碰网络
    if (panel === 'live-stats' && method === 'simulate') {
      const spec = (args?.[0] ?? {}) as Record<string, any>;
      const kind = String(spec.kind || 'danmaku') as LiveEventKind;
      const ev: LiveEvent = {
        kind,
        username: String(spec.username || '测试观众'),
        body: String(spec.body || ''),
        amount: Number(spec.amount) || 0,
        count: Number(spec.count) || 1,
        guardLevel: Number(spec.guardLevel) || 0,
        isAdmin: spec.isAdmin === true,
        medalLevel: Number(spec.medalLevel) || 0,
        userLevel: Number(spec.userLevel) || 0,
      };
      this.handleEvent(ev, 'sse');
      return { ok: true, fed: ev, counters: this.counters, skips: Object.fromEntries(this.skipCounts) };
    }
    throw new Error(`unknown panel: ${panel}`);
  }

  // ── World 契约：WebUI 声明（灯 + 徽标 + 配置面板） ──
  webUi(language: 'zh' | 'en' = 'zh'): any {
    return {
      label: '直播弹幕桥',
      lamps: [
        {
          label: '订阅',
          state: this.running ? 'online' : 'offline',
          hint: this.running ? this.cfg.streamUrl : '未启动',
        },
        {
          label: '事件库',
          state: this.storeReady ? 'online' : 'offline',
          hint: this.storeReady ? `cursor ${this.storeCursor}` : '未接入：礼物金额看不出来',
        },
      ],
      badges: [
        { label: '限频', value: this.cfg.gapSec > 0 ? `${this.cfg.gapSec}s` : '关', tone: 'plain' },
        { label: '机会回应', value: this.cfg.chanceGapSec > 0 ? `${this.cfg.chanceGapSec}s/条` : '关', tone: 'plain' },
        { label: '礼物门槛', value: `¥${this.cfg.minGiftYuan}`, tone: 'plain' },
        { label: '舰长欢迎', value: this.cfg.guardWelcome ? (this.cfg.guardWelcomePerDay > 0 ? `${this.cfg.guardWelcomePerDay}次/人·天` : '不限次') : '关', tone: 'plain' },
        { label: '必回/机会', value: `${this.counters.must}/${this.counters.chance}`, tone: 'on' },
        { label: '过滤', value: `${this.counters.skipped}`, tone: 'plain' },
      ],
      // 环境提示词：注册后才会注入 system 前缀（缺这段等于她从来没收到过直播规则）
      promptDocs: [
        {
          key: 'worlds.live-cue.envPrompt',
          title: language === 'zh' ? '直播弹幕桥环境' : 'Live cue environment',
          description: language === 'zh'
            ? '告诉她在直播间该怎么回应：必回项、机会型、该忽略什么、说话长度与口气。也可把游戏规则、直播话术、礼物触发效果写在这里。'
            : 'How she should react in the live room: must-reply, occasional, ignore rules, tone.',
          role: 'envPrompt',
          path: ENV_PROMPT_FILE,
          vars: [
            { name: 'livecue.gapSec', description: '普通/机会型回应的最短间隔；关闭表示不额外限制。' },
            { name: 'livecue.chanceGapSec', description: '机会型回应最短间隔；关闭表示不启用机会型回应。' },
            { name: 'livecue.minGiftYuan', description: '礼物必回的金额门槛（元）。' },
            { name: 'livecue.replyMaxChars', description: '每次回应允许的字数上限。' },
            { name: 'livecue.scDelaySec', description: 'SC 读完再回的等待秒数。' },
            { name: 'livecue.streamUrl', description: '弹幕来源地址（一般不用改）。' },
            { name: 'livecue.gameBlock', description: '本局游戏：玩法 / 红黑道具 / 规则术语，由设置页「本局游戏」生成。', multiline: true },
          ],
        },
      ],
      // 不再挂自动生成的 schema 表单：41 项一字排开太长，改用下面的自绘「设置」面板（三列）
      panels: [
        {
          id: 'settings',
          title: '设置',
          description: '三列分开：必回与打赏 / 什么时候开口 / 话怎么送出去。改完自动保存。',
          getMethods: ['load'],
        },
        {
          id: 'qq-sync',
          title: 'QQ 同步气泡',
          description: '她发往 QQ 的每一条消息（群聊 + 私聊），逐条记录在这里（去重，最多 100 条）；可开关、可清空。',
          getMethods: ['list'],
        },
        {
          id: 'overlay',
          title: '直播画面（Overlay）',
          description: 'OBS 里抓的那块画面直接嵌在这里预览；想改样式点「打开编辑器」。地址由 7795 自动推导。',
          getMethods: ['info'],
        },
        {
          id: 'live-stats',
          title: '现场实况（验收用）',
          description: '必回/机会/过滤计数、跳过原因排行、最近 60 条判定与最近 4 句她说的话。排查「为什么不回」直接看这里。',
          getMethods: ['list'],
        },
      ],
      invoke: (panel: string, method: string, args: unknown[]) => this.invokePanel(panel, method, args),
    };
  }

  // ── World 契约：启动 ──
  async start(host: any): Promise<void> {
    this.host = host;
    // 2026-11-23 加：把上次的现场实况读回来，下播后面板不再空着
    try {
      const raw = readFileSync(decisionsPath(), 'utf8');
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) this.decisions = arr.slice(-60);
    } catch {
      /* 没有历史文件就空着 */
    }
    try {
      const raw = readFileSync(qqLogPath(), 'utf8');
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) this.qqLog = arr.slice(-100);
    } catch {
      /* 没有历史文件就空着 */
    }
    if (this.running) return;
    this.running = true;
    this.welcomeState = loadWelcomeState();
    await this.restoreRankSession();
    this.log(`订阅 ${this.cfg.streamUrl}（限频 ${this.cfg.gapSec > 0 ? `${this.cfg.gapSec}s` : '关'} / 礼物 ¥${this.cfg.minGiftYuan} / 机会回应 ${this.cfg.chanceGapSec > 0 ? `${this.cfg.chanceGapSec}s` : '关'} / 舰长欢迎 ${this.cfg.guardWelcome ? `${this.cfg.guardWelcomePerDay}次·人/天` : '关'}）`);
    this.startStorePoll();
    this.startLivePoll();
    this.startLiveDigest();
    this.startSourceCheck();
    void this.loop();
  }

  // ── World 契约：停止 ──
  async stop(): Promise<void> {
    this.running = false;
    if (this.storeTimer) clearInterval(this.storeTimer);
    this.storeTimer = null;
    for (const t of this.scTimers) clearTimeout(t);
    this.scTimers.clear();
    if (this.giftMergeTimer) { clearTimeout(this.giftMergeTimer); this.giftMergeTimer = null; }
    this.giftBuffer = [];
    if (this.sourceTimer) clearInterval(this.sourceTimer);
    this.sourceTimer = null;
    if (this.liveTimer) clearInterval(this.liveTimer);
    this.liveTimer = null;
    this.livePolling = null;
    if (this.danmakuTimer) clearTimeout(this.danmakuTimer);
    this.danmakuTimer = null;
    this.danmakuQueue = [];
    try {
      this.abort?.abort();
    } catch {
      /* ignore */
    }
    this.abort = null;
    this.log('已停止订阅');
  }

  /** 调试用：当前配置 */
  getConfig(): LiveCueConfig {
    return { ...this.cfg };
  }

  private log(msg: string): void {
    try {
      this.host?.log?.info?.(`[live-cue] ${msg}`);
      if (!this.host?.log?.info) console.log(`[live-cue] ${msg}`);
    } catch {
      /* ignore */
    }
  }

  /**
   * 数据源自检：SSE 断流 / 直播间长时间没数据时，直接用桌宠气泡报警（0 token）。
   * 直播里「她突然不说话」时，先能一眼分清：是数据没进来，还是她自己选择不回。
   */
  /** 现算一份数据源健康快照（面板与自检共用，避免显示过期状态） */
  private snapshotSource(): Record<string, any> {
    const gapMin = this.sseLastDataAt ? (Date.now() - this.sseLastDataAt) / 60000 : 0;
    return {
      sse: this.sseConnected ? 'connected' : 'down',
      silentMin: Math.round(gapMin * 10) / 10,
      live: this.livePolling === null ? 'unknown' : this.livePolling ? 'on' : 'off',
      storeCursor: this.storeCursor,
      storeReady: this.storeReady,
    };
  }

  private startSourceCheck(): void {
    let lastPruneDay = '';
    const tick = (): void => {
      // 每天清一次过期舰长（B站舰长 30 天有效），顺带把被删掉的额度记录一起收掉
      const day = new Date().toISOString().slice(0, 10);
      if (day !== lastPruneDay) {
        lastPruneDay = day;
        try { this.pruneExpiredGuards(); } catch (e: any) { this.log(`舰长到期清理失败：${e?.message || e}`); }
      }
      const now = Date.now();
      const snap = this.snapshotSource();
      const gapMin = Number(snap.silentMin) || 0;
      const live = this.livePolling === true;
      this.sourceHealth = snap;
      if (!live) return;
      const stalled = this.sseConnected && gapMin >= 5;
      const broken = !this.sseConnected && gapMin >= 2;
      if (!stalled && !broken) return;
      if (now - this.lastAlertAt < 10 * 60_000) return;
      this.lastAlertAt = now;
      const why = broken ? '数据源断了' : '直播间 5 分钟没有新数据';
      this.log(`数据源自检告警：${why}（SSE ${this.sseConnected ? '连着' : '断'}，静默 ${gapMin.toFixed(1)} 分钟）`);
      void this.fireBubble(`⚠️ ${why}，我先没弹幕可接了——看一眼 B站插件是不是掉了。`);
    };
    tick();
    this.sourceTimer = setInterval(tick, 60_000);
  }

  private async loop(): Promise<void> {
    let backoff = 2000;
    while (this.running) {
      try {
        await this.subscribe();
        backoff = 2000;
      } catch (err: any) {
        if (!this.running) break;
        this.sseConnected = false;
        this.log(`SSE 断开（${err?.message || err}），${Math.round(backoff / 1000)}s 后重连`);
        await sleep(backoff);
        backoff = Math.min(backoff * 2, 30000);
      }
    }
  }

  private async subscribe(): Promise<void> {
    this.abort = new AbortController();
    const res = await fetch(this.cfg.streamUrl, {
      headers: { Accept: 'text/event-stream' },
      signal: this.abort.signal,
    });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

    this.log('SSE 已连接');
    this.sseConnected = true;
    this.sseLastDataAt = Date.now();
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (this.running) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      let idx: number;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        this.onChunk(chunk);
      }
    }
  }

  private onChunk(chunk: string): void {
    const dataLine = chunk.split('\n').find((l) => l.startsWith('data:'));
    if (!dataLine) return;
    let payload: any;
    try {
      payload = JSON.parse(dataLine.slice(5).trim());
    } catch {
      return;
    }
    this.sseLastDataAt = Date.now();

    const ev = toLiveEvent(payload);
    if (!ev) return;
    // 2026-11-06：双通道兜底。bilibili 插件 modelFeed=false 时**不写事件库**，
    // 而这里以前把 SSE 礼物直接丢掉（以为事件库有）→ 礼物彻底消失（昨晚 3367→0 的根因）。
    // 现在：SSE 礼物照常放行（无金额，靠道具表名字判必回），并记下指纹供 store 去重。
    // 2026-11-11 修：overlay 流里的礼物只有「人气票×30」，**没有金额**；
    // 事件库那份带 meta.yuan。以前 overlay 先到就被采用，金额=0 → 永远过不了 1 元门槛，
    // 于是「所有送礼消息都不转发」。现在先等 2.5 秒让事件库先到；等不到再用 overlay 兜底。
    if (ev.kind === 'gift' || ev.kind === 'superchat' || ev.kind === 'guard') {
      if (this.cfg.useStoreEvents && this.storeReady) {
        // 2026-11-20 修：以前只等 2.5 秒，事件库写库稍慢就退回 overlay 那份（金额=0），
        // 结果整晚「合并礼物 ¥0 < 门槛 1，不转发」——礼物一条都没进群，大额也没单列。
        // 现在：先立刻催一次事件库，再等 6 秒；仍没等到才用 overlay 兜底。
        try { this.pollStore(); } catch { /* 催不动就靠定时轮询 */ }
        setTimeout(() => {
          if (!this.running) return;
          if (this.seenByStore(ev)) {
            this.log(`overlay 的${ev.kind}已有带金额的事件库版本，丢弃`);
            return;
          }
          this.log(`overlay 的${ev.kind}等了 6 秒仍无事件库版本，按无金额兜底`);
          this.markSseGift(ev);
          this.handleEvent(ev, 'sse');
        }, 6000);
        return;
      }
      this.markSseGift(ev);
    }
    this.handleEvent(ev, 'sse');
  }

  // ── 事件库：礼物 / SC / 上舰 的真实金额来源 ──
  private startStorePoll(): void {
    if (!this.cfg.useStoreEvents) {
      this.log('事件库补全已关闭，礼物金额按 overlay 流判断（多半是 0）');
      return;
    }
    const store = this.host?.store;
    if (!store || typeof store.range !== 'function') {
      this.log('宿主没提供事件库读取能力，礼物/SC/上舰只能用 overlay 流');
      return;
    }
    try {
      this.storeCursor = Number(store.latestCursor?.() ?? 0);
      this.storeReady = true;
    } catch (e: any) {
      this.log(`事件库初始化失败：${e?.message || e}`);
      return;
    }
    this.log(`事件库补全已开启，从 cursor ${this.storeCursor} 起读礼物/SC/上舰`);
    this.storeTimer = setInterval(() => this.pollStore(), 1200);
  }

  private pollStore(): void {
    const store = this.host?.store;
    if (!store?.range || !this.running) return;
    let latest = 0;
    try {
      latest = Number(store.latestCursor?.() ?? 0);
    } catch {
      return;
    }
    if (latest <= this.storeCursor) return;

    const from = this.storeCursor + 1;
    let list: StoreEnvelopeLike[] = [];
    try {
      // 2026-11-21 修：**不要再按 source 过滤**。
      // bilibili 插件 pushEvent 时没带 source 字段（archiveOnly 只传 type/ts/text/senderKey/meta），
      // 而这里传 source:'bilibili' 会让 range 恒返回空 —— 这就是「事件库金额永远等不到」的根因。
      // 改为不加 source、拿到后按 type 前缀自己筛。
      list = store.range({ fromCursor: from, toCursor: latest }) || [];
      list = list.filter(isBilibiliEvent);
    } catch (e: any) {
      this.log(`事件库读取失败：${e?.message || e}`);
      return;
    }
    this.storeCursor = latest;

    // 2026-11-21 加诊断：事件库在涨、但一条都没读到时，说明 source/type 过滤或落库有问题。
    // 以前这种情况完全静默，只能看到「等 6 秒仍无事件库版本」。
    if (!list.length) {
      this.storeEmptyPolls += 1;
      if (this.storeEmptyPolls === 20) {
        this.log(`事件库连续 ${this.storeEmptyPolls} 次读到 0 条（cursor 已到 ${latest}）：可能是 source 过滤或 deliver:false 未落库`);
      }
    } else {
      if (this.storeEmptyPolls >= 20) this.log(`事件库恢复：本次读到 ${list.length} 条`);
      this.storeEmptyPolls = 0;
    }

    for (const env of list) {
      const ev = fromStoreEvent(env);
      if (!ev) continue;
      if (ev.kind === 'gift' || ev.kind === 'superchat' || ev.kind === 'guard') this.markStoreSeen(ev);
      // SSE 已经处理过的同一条（双通道重放）不再回第二遍
      if (this.seenBySse(ev)) {
        this.skip('sse-dup', ev);
        continue;
      }
      this.handleEvent(ev, 'store');
    }
  }

  /** 统一入口：过滤 → 去重 → 限频 → 唤醒 */
  private handleEvent(ev: LiveEvent, src: 'sse' | 'store'): void {
    // 弹幕计数放在最前面（2026-11-21）：全量统计，对齐 B站后台口径。
    // 以前记在 processEvent 里，被过滤掉的不算 —— 本场统计 475，后台是 852。
    if (ev.kind === 'danmaku') this.sessDanmaku += 1;
    // 「准备下播」信号放在最前面（2026-11-21 修）：以前挂在 processEvent 里，
    // 一旦这条弹幕被等级门槛/游戏指令/噪声过滤挡掉，就永远触发不了。
    // 校准只认主人（uid 或昵称），别人喊下播不算；全场只拉一次。
    if (ev.kind === 'danmaku' && this.isOwnerSignal(ev)
      && /下播啦|要下播|准备下播|下播了/.test(String(ev.body || ''))) {
      // 只做两件旁路动作（校准 + 晚安），绝不 return、也不影响正常回应。
      // 下播播报本来就只由平台 live_status=0 触发，关键词不会触发它 —— 所以这里不需要“压制”。
      void this.calibrateRank('主人在直播间说下播');
      // 晚安不在这里代发：提示词里已经写了「主人说下播时你道个晚安」，
      // 让她顺着正常回应自由发挥，比预置几句固定文案更像活人（2026-11-21 改）。
    }
    // 开播 / 下播：单独走播报，不进常规回应链路
    if (ev.kind === 'room') {
      void this.handleRoomNotice(ev.body);
      return;
    }
    // 2026-11-21：弹幕计数放在最前面 —— 以前记在 processEvent 里，被过滤掉的都不算，
    // 所以本场统计 475 而 B站后台是 852。战报要用后台口径，就得在入口处全量计数。
    // 先拍一张「当前这一幕」的快照（不含正在处理的这条），再把它记进现场
    const sceneSnapshot = this.scene.slice(-6);
    this.noteScene(ev);
    // 礼物合并：窗口内的多个礼物攒成一次唤醒（一次模型调用答完，省 token、也不刷屏）
    // 大额礼物不攒：它本身就要单列一条，攒进合并里反而把「大金主」淹了（2026-11-12）
    if (ev.kind === 'gift' && Number(this.cfg.giftMergeSec) > 0
      && (Number(ev.amount) || 0) < Number(this.cfg.bigGiftYuan ?? 10)) {
      this.bufferGift(ev, src);
      return;
    }
    this.processEvent(ev, src, sceneSnapshot);
  }

  /** 礼物合并缓冲：等窗口安静下来再一次性交给模型 */
  private bufferGift(ev: LiveEvent, src: 'sse' | 'store'): void {
    this.giftBuffer.push(ev);
    // 提前结算的两个条件（2026-11-07 修）：
    // ① 攒够 30 条（以前是 8 条，结果「10 个 0.1 元」会被拆成 8+2，永远凑不满 1 元门槛）
    // ② 累计金额已经达到门槛，且至少 3 条 —— 连刷一组小额时能凑成一笔，及时回她
    const cap = Number(this.cfg.minGiftYuan ?? 1);
    const total = this.giftBuffer.reduce((a, g) => a + (Number(g.amount) || 0), 0);
    if (this.giftBuffer.length >= 30 || (cap > 0 && total >= cap && this.giftBuffer.length >= 3)) {
      this.flushGiftMerge();
      return;
    }
    if (this.giftMergeTimer) clearTimeout(this.giftMergeTimer);
    const wait = Math.max(1, Number(this.cfg.giftMergeSec)) * 1000;
    this.giftMergeTimer = setTimeout(() => this.flushGiftMerge(), wait);
  }

  /** 把缓冲里的礼物拼成一条「合并礼物」事件，走正常回应链路 */
  private flushGiftMerge(): void {
    if (this.giftMergeTimer) { clearTimeout(this.giftMergeTimer); this.giftMergeTimer = null; }
    const list = this.giftBuffer;
    this.giftBuffer = [];
    if (!list.length) return;
    const tally = new Map<string, number>();
    let amount = 0;
    for (const g of list) {
      const bare = String(g.body || '礼物').replace(/\s*[×xX]\s*\d+\s*$/, '').trim() || '礼物';
      const n = Math.max(1, Number(g.count) || 1);
      tally.set(bare, (tally.get(bare) ?? 0) + n);
      amount += Number(g.amount) || 0;
    }
    // 浮点归整：0.1 累加 10 次是 0.9999999999999999，会差一点点过不了 1 元门槛
    amount = Math.round(amount * 1000) / 1000;
    const parts = [...tally.entries()].map(([name, n]) => (n > 1 ? `${name}×${n}` : name));
    const senders = [...new Set(list.map((g) => g.username).filter(Boolean))];
    const who = senders.length <= 1 ? (senders[0] || '观众') : `${senders[0]} 等 ${senders.length} 人`;
    const cap = Number(this.cfg.minGiftYuan ?? 1);
    const merged: LiveEvent = {
      ...list[0],
      kind: 'gift',
      username: who,
      body: parts.join('、'),
      // 数量已经写进 body（人气票×3），count 固定 1，免得提示词再叠一个「×N」
      count: 1,
      amount,
      // 窗口内累计没到门槛：回一句就够了，不进群（2026-11-12 用户定的规则）
      noForward: cap > 0 && amount + 1e-6 < cap,
    };
    if (list.length > 1) this.log(`礼物合并：${list.length} 条 → ${who}：${merged.body}`);
    this.processEvent(merged, 'sse', this.scene.slice(-6));
  }

  /** 真正的分类 → 唤醒链路（礼物合并后由 flushGiftMerge 回调进来） */
  private processEvent(ev: LiveEvent, src: 'sse' | 'store', sceneSnapshot: SceneItem[]): void {
    // ── 第 2 层：意图与优先级 ──
    let intent = classifyIntent(ev, this.liveCfg(), (n) => this.sessTop.has(String(n || '').trim()));
    const now = Date.now();

    // 舰长进场：先看「每人每天」配额，再当天总上限，用完就降级成普通进场
    if (ev.kind === 'enter' && intent.priority === 0 && intent.reason === 'guard-enter') {
      const perPerson = welcomeQuotaLeft(this.welcomeState, ev.username, this.cfg.guardWelcomePerDay);
      // 2026-11-22 加：当天欢迎总次数上限（防刷屏）。默认 100，按你说的量给足。
      const overTotal = (this.welcomeState.seq ?? 0) >= Number(this.cfg.guardWelcomeMaxPerDay ?? 100);
      if (!perPerson || overTotal) {
        if (overTotal) this.log(`当天欢迎已达 ${this.welcomeState.seq} 次上限，${ev.username} 这次按普通进场`);
        intent = this.cfg.sendEnter
          ? { ...intent, priority: 1, reason: 'guard-enter-quota' }
          : { ...intent, priority: 2, reason: 'guard-enter-quota' };
      }
    }

    if (intent.priority === 2) {
      this.skip(intent.reason, ev);
      return;
    }

    // 去重：同一个人 90 秒内发同样内容只推一次（重连重放、双通道重复都拦）
    const key = `${ev.kind}:${ev.username}:${(ev.body || '').slice(0, 40)}`;
    if (now - (this.seenMap.get(key) ?? 0) < 90_000) {
      this.skip('dup', ev);
      return;
    }
    this.seenMap.set(key, now);
    if (this.seenMap.size > 400) {
      for (const [k, ts] of this.seenMap) if (now - ts > 600_000) this.seenMap.delete(k);
    }

    // 同一个人短时间内只回一条：房管/舰长用更宽的 guardBurstSec（他们常连发多条指挥），普通观众用 sameUserGapSec
    const ukey = `${ev.kind}:${ev.username}`;
    const burstSec = (ev.guardLevel ?? 0) > 0 || ev.isAdmin === true
      ? Number(this.cfg.guardBurstSec ?? 20)
      : Number(this.cfg.sameUserGapSec ?? 15);
    if (intent.priority === 0 && burstSec > 0 && now - (this.lastByUser.get(ukey) ?? 0) < burstSec * 1000) {
      this.skip('user-burst', ev);
      return;
    }

    // 机会型：gapSec（0=关）+ chanceGapSec + maxPerHour（0=关）三重约束
    if (intent.priority === 1) {
      const gap = this.cfg.gapSec > 0 ? this.cfg.gapSec * 1000 : 0;
      if (gap && now - this.lastPushAt < gap) {
        this.skip('gap', ev);
        return;
      }
      const cg = this.cfg.chanceGapSec > 0 ? this.cfg.chanceGapSec * 1000 : 0;
      if (cg && now - this.lastChanceAt < cg) {
        this.skip('chance-gap', ev);
        return;
      }
      const cap = Number(this.cfg.maxPerHour ?? 0);
      if (cap > 0) {
        this.pushWindow = this.pushWindow.filter((t) => now - t < 3600_000);
        if (this.pushWindow.length >= cap) {
          this.skip('hour-cap', ev);
          return;
        }
        this.pushWindow.push(now);
      }
      this.lastChanceAt = now;
    }

    this.lastPushAt = now;
    this.lastByUser.set(ukey, now);

    // 舰长欢迎：扣当天配额 + 分配句式和风格
    const promptCtx: PromptContext = {
      recent: this.recentReplies,
      scene: sceneSnapshot,
      viewers: this.viewers,
    };
    this.attachPromo(promptCtx);
    if (intent.reason === 'guard-enter') {
      this.welcomeState.counts[ev.username] = (this.welcomeState.counts[ev.username] ?? 0) + 1;
      this.welcomeState.seq += 1;
      this.saveWelcomeState();
      promptCtx.guardOrdinal = this.welcomeState.seq;
      promptCtx.guardTimesToday = this.welcomeState.counts[ev.username];
      promptCtx.style = pickStyle(this.cfg, this.welcomeState.seq - 1);
    }

    // SC：先「看完」再回（等 scDelaySec 秒），其余立即
    const delay = ev.kind === 'superchat' ? Math.max(0, Number(this.cfg.scDelaySec || 0)) : 0;
    this.record(ev, intent, src);
    if (delay > 0) {
      this.log(`SC 收到，${delay}s 后回复（先看完）：${ev.body.slice(0, 24)}`);
      const timer = setTimeout(() => {
        this.scTimers.delete(timer);
        void this.wake(ev, intent, promptCtx);
      }, delay * 1000);
      this.scTimers.add(timer);
      return;
    }
    void this.wake(ev, intent, promptCtx);
  }

  /**
   * 当前生效的配置：优先读 ctx.cfg（面板改完会热更新到这里），回落到启动时的快照。
   * 凡是「设置项要实时生效」的地方都走这个，别用 this.cfg（那是构造时的死快照）。
   */
  private liveCfg(): LiveCueConfig {
    return { ...this.cfg, ...((this.ctx?.cfg ?? {}) as Partial<LiveCueConfig>) };
  }

  /** 把一条事件记进「现场」，供后面的提示词引用 */
  private noteScene(ev: LiveEvent): void {
    const now = Date.now();
    const who = ev.username || '观众';
    const cfg = this.liveCfg();
    let text = '';
    switch (ev.kind) {
      case 'danmaku': {
        // 游戏插件指令不进「现场」，否则她会把「左3」「喵」当聊天内容
        if (isGameCommand(ev.body || '', cfg)) return;
        // 她自己的弹幕会被 B 站回显。不挡的话，速报的「观众发言」里会出现「然家小鲸鱼：…」，
        // 而末尾「🐳：」又取同一句，同一句话在一条速报里出现两次（2026-11-14 修）
        if (isSelfName(ev.username, cfg)) return;
        // 等级门槛：和 classifyCore 共用同一个判据（2026-11-15）
        // 不挡的话，判定为「不回」的弹幕仍会留在现场里，她读现场照样能接话 —— 等于没筛
        if (isBelowLevelGate(ev, cfg, (n) => this.sessTop.has(String(n || '').trim()))) return;
        text = `${who}：${(ev.body || '').slice(0, 40)}`;
        break;
      }
      case 'gift': text = `${who} 送出「${ev.body || '礼物'}」${ev.count && ev.count > 1 ? ` ×${ev.count}` : ''}`; break;
      case 'superchat': text = `${who} 的 SC：${(ev.body || '').slice(0, 30)}`; break;
      case 'guard': text = `${who} 开通了${ev.guardName || '舰长'}`; break;
      case 'enter': {
        // 低于荣誉等级门槛的路人：连「进场」都不记，省上下文（2026-11-12 用户要求，默认开）
        // 舰长/房管永远放行；门槛设 0 时等于不筛
        const minLv = Number(this.cfg.minUserLevel ?? 0);
        const lv = Number(ev.userLevel ?? 0);
        const privileged = !!ev.guardLevel || !!ev.isAdmin;
        if (this.cfg.dropLowEnter !== false && minLv > 0 && !privileged && lv < minLv) return;
        text = `${who} 进直播间`;
        break;
      }
      case 'audience': {
        const body = ev.body || '';
        const m = body.match(/高能榜\s*(\d+)/);
        if (m) this.viewers = Number(m[1]);
        this.sessMaxViewers = Math.max(this.sessMaxViewers, this.viewers);
        // 「看过 683」「累计点赞 3641」是累加值，取峰值即可（2026-11-12）
        const w = body.match(/看过\s*(\d+)/);
        if (w) this.sessWatched = Math.max(this.sessWatched, Number(w[1]));
        const l = body.match(/累计点赞\s*(\d+)/);
        if (l) this.sessLikeTotal = Math.max(this.sessLikeTotal, Number(l[1]));
        return;
      }
    }
    if (!text.trim()) return;
    // 本场统计（给下播的「今晚战绩」用）

    else if (ev.kind === 'gift') {
      this.sessGifts += Math.max(1, Number(ev.count) || 1);
      this.sessYuan = Math.round((this.sessYuan + (Number(ev.amount) || 0)) * 100) / 100;
      const gYuan = Number(ev.amount) || 0;
      if (gYuan === 0 && this.giftZeroWarned < 5) {
        this.giftZeroWarned += 1;
        this.log(`礼物金额为 0：${ev.body}×${ev.count ?? 1}（价格表没命中，本场榜单会少算这一笔）`);
      }
      if (ev.username && gYuan > (this.sessMaxGift?.yuan ?? 0)) {
        this.sessMaxGift = { name: String(ev.username), gift: String(ev.body || '礼物'), yuan: gYuan };
      }
      // 榜位按「金额」累计，不是按笔数。按笔数会把「刷 20 笔 0.1 元」的人排到
      // 「一次送 30 元」的人前面，和 B 站贡献排行完全对不上（2026-11-14 修）
      this.bumpTop(ev.username, Math.max(Number(ev.amount) || 0, 0.01), Number(ev.count) || 1, ev.tid);
    } else if (ev.kind === 'guard') {
      this.sessGuards += 1;
      if (ev.username) this.sessGuardNames.add(String(ev.username));
      // 舰长按 198 元/月折算，否则一个刷 20 笔人气票的会把舰长挤下去
      this.bumpTop(ev.username, Number(ev.amount) || 198, 1, ev.tid);
    } else if (ev.kind === 'superchat') this.bumpTop(ev.username, Math.max(Number(ev.amount) || 0, 0.01), 1, ev.tid);
    this.scene.push({ at: now, text });
    this.scene = this.scene.filter((x) => now - x.at < 8 * 60_000).slice(-14);
  }

  private resetSessionStats(now: number): void {
    this.sessStart = now;
    this.sessDanmaku = 0;
    this.sessGifts = 0;
    this.sessYuan = 0;
    this.sessGuards = 0;
    this.sessMaxViewers = 0;
    this.sessWatched = 0;
    this.sessLikeTotal = 0;
    this.sessGuardNames.clear();
    this.sessTop.clear();
    this.sessMaxGift = null;
    this.rankCalibrated = false;
    this.giftZeroWarned = 0;
    // 新一场：持久化镜像同步重开（跨零点的老数据不沿用）
    this.rankState = newSession(now, Number(this.cfg.danmakuRoomId || 0), bizDayKey(now));
    this.saveRankSoon(true);
    // 新一场：官方日榜的三份状态一起清，否则会把上一场的榜带进来
    this.rankOfficial.clear();
  }

  /** 榜单累计。weight 传金额（元），没传就当 1 笔——老调用点不必改 */
  private bumpTop(name?: string, weight = 1, count = 1, tid?: string): void {
    const k = String(name || '').trim();
    if (!k) return;
    this.sessTop.set(k, (this.sessTop.get(k) ?? 0) + weight);
    // 同步进持久化镜像：跨零点、重启都靠它
    if (this.rankState) {
      const r = recordGift(this.rankState, { name: k, yuan: weight, count, tid });
      if (r.added) {
        this.rankState = r.session;
        this.saveRankSoon();
      }
    }
  }

  /** 下播结算后存一份战报（含榜单与数据），供下次开播发 B站动态 */
  private saveDailyReport(): void {
    if (!this.rankState) return;
    const root = process.env.COOPANION_DATA || 'C:/Users/Administrator/Coopanion/data';
    const dir = reportDir(root);
    const r: DailyReport = {
      dayKey: this.rankState.dayKey,
      startedAt: this.rankState.startedAt,
      endedAt: this.rankState.endedAt || Date.now(),
      top: topRank(this.rankState, 3),
      stats: {
        danmaku: this.sessDanmaku,
        gifts: this.sessGifts,
        guards: this.sessGuards,
        viewers: this.sessMaxViewers,
        watched: this.sessWatched,
        likes: this.sessLikeTotal,
      },
      posted: false,
      officialTop: this.officialTopSnapshot ?? undefined,
      flavor: {
        maxGifter: this.sessMaxGift?.name,
        maxGiftName: this.sessMaxGift?.gift,
        peakViewers: this.sessMaxViewers || undefined,
        guardNames: [...this.sessGuardNames].slice(0, 5),
      },
    };
    saveReport(dir, r);
    this.log(`战报已存：${r.dayKey}（${r.top.length} 人上榜，等下次开播发 B站）`);
  }

  /**
   * 开播时发「前一天战报」到 B站动态，只发一次。
   * 幂等：报告里 posted=true 后不再挑中；发失败也不拦开播，原因写 lastError。
   */
  private async maybePostPrevReport(): Promise<void> {
    if (!this.cfg.reportDynamic) return;
    const root = process.env.COOPANION_DATA || 'C:/Users/Administrator/Coopanion/data';
    const dir = reportDir(root);
    const prev = pickPendingReport(listReports(dir), Date.now());
    if (!prev) {
      this.log('前一天战报：没有待发的（已发过或还没生成），跳过');
      return;
    }
    const room = Number(this.cfg.danmakuRoomId || 0);
    // 优先用她自己写的那份（第一人称、带当晚细节）；没有才用代码模板
    const mine = loadNarrative(dir, prev.dayKey);
    const raw = mine || buildReportText(prev, prev.flavor ?? {}, { liveUrl: `https://live.bilibili.com/${room}` });
    const text = stripKaomoji(raw);  // 发动态前最后一道清洗：只去颜文字，表情保留（2026-11-21 按你要求改回）
    if (mine) this.log(`前一天战报：用她自己写的那份（${mine.length} 字）`);
    if (!looksSafe(text)) {
      this.log('前一天战报：文案命中金额类字眼，拒绝发送（模板有问题）');
      return;
    }
    const r = await this.postBiliDynamic(text);
    const next: DailyReport = r.ok
      ? { ...prev, posted: true, postedAt: Date.now(), dynamicId: r.id, lastError: undefined }
      : { ...prev, lastError: r.err || '未知错误' };
    saveReport(dir, next);
    if (r.ok) this.log(`前一天战报已发 B站动态：${prev.dayKey}（dynamic_id=${r.id || '?'}）`);
    else this.log(`前一天战报发送失败，已记下原因：${r.err}`);
  }

  /** 用 bili CLI（直播号）发一条 B站动态 */
  private async postBiliDynamic(text: string): Promise<{ ok: boolean; id?: string; err?: string }> {
    try {
      const env = {
        ...process.env,
        BILI_CLI_HOME: 'C:/Users/Administrator/WorkBuddy/2026-10-02-19-18-52/.bili_profiles/live',
      };
      const { stdout } = await execFileP(BILLI_BIN, ['dynamic', 'post', text], {
        env, timeout: 90_000, maxBuffer: 4 * 1024 * 1024,
      });
      const out = String(stdout || '').trim();
      const j = out.startsWith('{') ? JSON.parse(out.slice(out.indexOf('{'))) : {};
      if (j?.ok === false) return { ok: false, err: String(j?.error?.message || j?.error || 'CLI 返回失败') };
      const id = j?.data?.dynamic_id || j?.data?.id || j?.dynamic_id || '';
      return { ok: true, id: id ? String(id) : undefined };
    } catch (e: any) {
      return { ok: false, err: String(e?.message || e).slice(0, 160) };
    }
  }



  /** 这条消息是不是主人发的（只用来判断「下播」信号，不影响回复逻辑） */
  private isOwnerSignal(ev: LiveEvent): boolean {
    return matchOwner(ev.uid, ev.username, this.cfg.ownerUids, this.cfg.ownerNames);
  }

  /**
   * 榜单校准（2026-11-20 定）：只拉**一次** —— 在「准备下播 / 听到下播啦」时。
   * 用日榜（daily_rank）跟本场累计比，偏差 >20% 记一条告警日志；
   * **绝不覆盖本场累计**（日榜会 00:00 重置，覆盖就等于把跨零点那段抹了）。
   */
  private async calibrateRank(reason: string): Promise<void> {
    if (this.rankCalibrated) return;
    this.rankCalibrated = true;
    const off = await this.fetchOfficialRank('daily_rank');
    // 下播后这个接口就空了，趁现在存一份给战报用
    if (off && off.size) {
      this.officialTopSnapshot = [...off.entries()]
        .map(([name, score]) => ({ name, score }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
      this.log(`官方日榜快照已存：${this.officialTopSnapshot.length} 人（下播后就查不到了）`);
    }
    if (!off || !off.size) {
      this.log(`榜单校准（${reason}）：日榜为空/拉不到，跳过`);
      return;
    }
    // 只比「两边都认识的人」，避免日榜里掺进前一小时的人把偏差拉大
    let mine = 0;
    let theirs = 0;
    for (const [k, v] of this.sessTop) {
      if (!off.has(k)) continue;
      mine += v;
      theirs += (off.get(k) ?? 0) / 10;   // 日榜 score 是贡献值，÷10 近似元
    }
    if (mine <= 0 || theirs <= 0) {
      this.log(`榜单校准（${reason}）：共同样本为 0，跳过（本场 ${mine.toFixed(1)} / 日榜 ${theirs.toFixed(1)}）`);
      return;
    }
    const dev = calcDeviation(mine, theirs);
    const pct = (dev * 100).toFixed(0);
    if (dev > 0.2) {
      this.log(`⚠ 榜单校准偏差 ${pct}%：本场 ¥${mine.toFixed(1)} vs 日榜 ~¥${theirs.toFixed(1)}（${reason}，仅告警不覆盖）`);
    } else {
      this.log(`榜单校准通过：偏差 ${pct}%（${reason}，本场 ¥${mine.toFixed(1)} / 日榜 ~¥${theirs.toFixed(1)}）`);
    }
  }

  /** 启动时把上一场的榜单接回来（跨零点、Coo 重启都靠它） */
  private async restoreRankSession(): Promise<void> {
    const room = Number(this.cfg.danmakuRoomId || 0);
    const old = loadSession(rankSessionPath());
    const live = await this.probeLiving();
    const r = resumeSession(old, Date.now(), room, bizDayKey(Date.now()), live);
    this.rankState = r.session;
    if (r.resumed) {
      this.sessTop.clear();
      for (const [k, v] of Object.entries(r.session.gifts)) this.sessTop.set(k, v);
      const since = new Date(r.session.startedAt).toLocaleString('zh-CN');
      this.log(`本场榜单已恢复：${Object.keys(r.session.gifts).length} 人，开播于 ${since}`);
    } else if (r.settledOld) {
      this.log('上一场没走完结算就退出了，已补记结束时间（金额保留，供战报用）');
    } else if (old) {
      this.log('上一场已结算，这次等新的开播重新累计');
    }
    saveSession(rankSessionPath(), this.rankState);
  }

  /** 只问一次「现在是否在播」，给恢复逻辑用 */
  private async probeLiving(): Promise<boolean> {
    const room = Number(this.cfg.danmakuRoomId || 0);
    const f = (globalThis as any).fetch;
    if (typeof f !== 'function') return false;
    try {
      const ac = new AbortController();
      const to = setTimeout(() => ac.abort(), 6000);
      const r = await f(`https://api.live.bilibili.com/room/v1/Room/room_init?id=${room}`, {
        signal: ac.signal,
        headers: { 'user-agent': 'Mozilla/5.0', referer: `https://live.bilibili.com/${room}` },
      });
      clearTimeout(to);
      const j: any = await r.json().catch(() => ({}));
      return Number(j?.data?.live_status) === 1;
    } catch {
      return false;
    }
  }

  /** 下播：结算本场（不清金额，留给战报） */
  private endRankSession(): void {
    if (!this.rankState) return;
    const now = Date.now();
    this.rankState = { ...this.rankState, active: false, endedAt: now, updatedAt: now };
    this.saveRankSoon(true);
    const top = topRank(this.rankState, 3).map((x) => `${x.name} ¥${x.yuan}`).join(' / ');
    this.log(`本场榜单已结算：${Object.keys(this.rankState.gifts).length} 人${top ? `，前三 ${top}` : ''}`);
    this.saveDailyReport();
  }

  /** 落盘节流：礼物密集时最多 5 秒写一次，别让磁盘拖慢直播 */
  private saveRankSoon(force = false): void {
    if (!this.rankState) return;
    const now = Date.now();
    if (!force && now - this.rankSaveAt < 5000) return;
    this.rankSaveAt = now;
    saveSession(rankSessionPath(), this.rankState);
  }

  /**
   * 拉 B 站官方直播间榜单（在线高能榜，2026-11-15 加，11-19 纠正认知）。
   *
   * ⚠️ 重要：公开接口里**没有**「完整日榜」。getOnlineGoldRank / queryContributionRank
   * 都是「在线高能榜」——只返回**当前还在直播间**的观众，下播后离线的大佬一律不在列。
   * 11-19 实测：真实榜一送礼 ¥139.7 根本不在官方榜里；官方榜一 score=19 对应本地 ¥1.9（×10）。
   *
   * 所以这里拉到的数只当「补漏 + 校验口径」用，主数据源是本场礼物累计（sessTop）。
   * 接口公开无需登录；失败返回 null，调用方自己兜。
   */
  private async fetchOfficialRank(rankType = 'online_rank'): Promise<Map<string, number> | null> {
    const room = Number(this.cfg.danmakuRoomId || 0);
    const ruid = Number(this.cfg.rankRuid || 0);
    // 用 queryContributionRank 而不是 getOnlineGoldRank：前者多返回「粉丝团成员」（score 可能是 0），
    // 字段带 rank，榜位顺序更可靠；两者数据口径一致。
    const url = 'https://api.live.bilibili.com/xlive/general-interface/v1/rank/queryContributionRank'
      + `?room_id=${room}&ruid=${ruid}&type=${rankType}&switch=contribution_rank&page=1&page_size=50`;
    const f = (globalThis as any).fetch;
    if (typeof f !== 'function') return null;
    try {
      const ac = new AbortController();
      const to = setTimeout(() => ac.abort(), 8000);
      const r = await f(url, {
        signal: ac.signal,
        headers: { 'user-agent': 'Mozilla/5.0', referer: `https://live.bilibili.com/${room}` },
      });
      clearTimeout(to);
      const j: any = await r.json();
      if (Number(j?.code) !== 0) {
        this.log(`官方在线榜返回异常：code=${j?.code} ${j?.message || ''}`);
        return null;
      }
      const list: any[] = j?.data?.item || j?.data?.OnlineRankItem || [];
      const m = new Map<string, number>();
      for (const it of list) {
        const name = String(it?.name || it?.uname || '').trim();
        if (!name) continue;
        m.set(name, Number(it?.score) || 0);
      }
      return m.size ? m : null;
    } catch (e: any) {
      this.log(`官方在线榜拉取失败：${e?.message || e}`);
      return null;
    }
  }

  /**
   * 直播中定时抓一次官方榜（只做参考：下播时记一行「官方贡献榜 N 人」，
   * 以及给 calibrateRank 比对用）。**不参与本场金额累计**——2026-11-20 起榜单只按本场礼物金额。
   */
  private async pollOfficialRank(): Promise<void> {
    const m = await this.fetchOfficialRank();
    if (!m) return;
    this.rankOfficial = m;
  }

  /**
   * 下播前定稿排行榜（2026-11-19 重写）。
   *
   * 为什么不再「只用官方接口」：
   *   B 站公开的 getOnlineGoldRank / queryContributionRank 都是「在线高能榜」——
   *   只统计**当前还在直播间里**的观众。下播那一刻大部分送过礼的人已经离开，
   *   榜上就只剩三四个还挂着的人。
   *
   *   11-19 实测证据：真实榜一「了梦无殇」送了 ¥139.70（50 笔），官方榜里根本没有他；
   *   官方榜一「开朗章鱼鸽r」score=19，而本地记录他送了 ¥1.9 —— 正好 ×10，
   *   说明 score 就是「贡献值 = 元 × 10」，口径一致，缺的只是**离线的人**。
   *
   * 所以：本场礼物累计（从 B 站 SEND_GIFT 推送算出来的，含所有送礼人）作为主数据源，
   * 官方在线榜按 score÷10 折算补漏（防我们漏事件），跨天归档只补本地完全没有的人。
   */
  private async refreshFinalRank(): Promise<void> {
    // 2026-11-20 改：只用「本场礼物金额」排榜，不再拿官方贡献值补金额。
    // 原因：官方那份是「贡献值」（送礼+点赞+发弹幕都算），跟她自己的弹幕量混在一起，
    // 会出现「榜一是机器人自己」。而且官方日榜 00:00 清零，跨零点的场次前半段会被重置。
    // 本场礼物是开播后自己累加的，既不受跨零点影响，也真的是「谁支持最多」。
    const cur = await this.fetchOfficialRank();
    if (cur) this.rankOfficial = cur;

    const merged = new Map<string, number>();
    for (const [k, v] of this.sessTop) {
      if (v > 0) merged.set(k, v);
    }

    this.log(
      `下播榜单：本场礼物 ${merged.size} 人（官方贡献榜 ${this.rankOfficial.size} 人仅参考、不计入金额）`,
    );

    if (!merged.size) {
      this.log('下播榜单：本场没抓到带金额的礼物，跳过颁奖');
      return;
    }
    this.sessTop.clear();
    for (const [k, v] of merged) this.sessTop.set(k, v);
  }


  /**
   * 兜底：独立轮询 B 站 room_init 的 live_status。
   * bilibili 插件 modelFeed=false 时 bilibili.room 不写事件库，弹幕桥收不到 LIVE/PREPARING，
   * 播报就永远不会触发（11-05 晚实测 0 条）。这里每 3 分钟问一次，边沿变化就走播报。
   */
  private startLivePoll(): void {
    if (!this.cfg.autoLiveNotice) return;
    const room = Number(this.cfg.danmakuRoomId || 0);
    const tick = async (): Promise<void> => {
      try {
        const res = await fetch(`https://api.live.bilibili.com/room/v1/Room/room_init?id=${room}`, {
          headers: { 'User-Agent': 'Mozilla/5.0', Referer: `https://live.bilibili.com/${room}` },
        });
        const j: any = await res.json().catch(() => ({}));
        const living = Number(j?.data?.live_status) === 1;
        if (this.livePolling === null) {
          this.livePolling = living;
          this.log(`直播状态基线：${living ? '直播中' : '未开播'}`);
          if (living) void this.handleRoomNotice('[直播间] 平台确认已开播(live_status=1)');
          return;
        }
        if (living !== this.livePolling) {
          // 防抖（2026-11-15）：以前读到一次就认，平台抖一下（弹幕服务器 PREPARING）就误判下播，
          // 把本场榜单清空、还多发一条下播播报。现在要连续两次、间隔 ≥60 秒都读到同一个状态才算数。
          const now2 = Date.now();
          const p = this.livePending;
          if (!p || p.living !== living) {
            this.livePending = { living, at: now2 };
            this.log(`直播状态疑似${living ? '开播' : '下播'}：先记下，60 秒后二次确认`);
            return;
          }
          if (now2 - p.at < 60_000) return; // 还没到 60 秒，等下一轮再验
          this.livePending = null;
          this.livePolling = living;
          this.log(`直播状态变化：${living ? '开播' : '下播'}（二次确认通过）`);
          void this.handleRoomNotice(living ? '[直播间] 平台确认已开播(live_status=1)' : '[直播间] 平台确认已下播(live_status=0)');
          return;
        }
        // 状态稳定：清掉待确认项，并在直播中顺手抓一份官方日榜（跨天归档就在这里发生）
        this.livePending = null;
        if (living) await this.pollOfficialRank();
      } catch {
        /* 查不到就等下一轮，不影响弹幕 */
      }
    };
    void tick();
    // 45 秒一次：以前 180 秒，最坏要等 3 分钟才认出开播（实测开播后 5–6 分钟才有动静）。
    // 一次 room_init 请求很轻，一分钟一次完全可接受。
    this.liveTimer = setInterval(() => void tick(), 45_000);
  }

  /**
   * 现场速报（2026-11-11 加）：没进直播间的人不知道里面在发生什么，光靠「某条弹幕的回应」
   * 拼不出画面。所以每 qqDigestSec 秒发一条浓缩版：在线人数 + 最近 3 条现场（弹幕/礼物/上舰）+ 入口。
   * 只在直播中发；没新内容不发；条数由 qqDigestSec 控制（默认 30 分钟）。
   */
  private startLiveDigest(): void {
    const sec = Number(this.cfg.qqDigestSec ?? 0);
    if (!this.cfg.forwardToQq || sec <= 0) return;
    if (this.digestTimer) clearInterval(this.digestTimer);
    this.lastDigestAt = Date.now();
    this.digestTimer = setInterval(() => void this.maybeDigest(), 60_000);
    this.log(`现场速报：每 ${Math.round(sec / 60)} 分钟一条（只在直播中、有新内容时发）`);
  }

  /** 礼物名 → 本局玩法（查「本局游戏」道具表，查不到返回空串） */
  private giftEffect(name: string): string {
    const n = String(name || '').replace(/\s*[×xX]\s*\d+\s*$/, '').trim();
    if (!n) return '';
    for (const line of String(this.cfg.gameItems || '').split(/\r?\n/)) {
      const cols = line.split('|').map((x) => (x || '').trim());
      const gift = cols[1];
      const effect = cols[2];
      if (gift && gift !== '待补' && (gift === n || n.includes(gift) || gift.includes(n))) return effect || '';
    }
    return '';
  }

  /**
   * 按「日期 + 用途」挑一张表情包：同一天同一用途固定，换天自动换。
   * 会读 sticker-history.json 避开最近 10 次用过的，避免「下播总是那三张图」。
   * 目录读不到就返回空串，调用方跳过（表情包发不出去不影响正文）。
   */
  private pickSticker(kind: 'digest' | 'up' | 'down'): string {
    const dir = String((this.cfg as any).stickerDir || DEFAULT_STICKER_DIR).trim();
    let files: string[] = [];
    try {
      // 超过上限的图发不出去（buildQqMessage 会跳过），选图时直接排除，
      // 否则会选中一张 14MB 的动图、然后群里什么都不显示（2026-11-14 修）
      files = readdirSync(dir).filter((f) => {
        if (!/\.(gif|png|jpe?g|webp)$/i.test(f) || f.startsWith('_')) return false;
        try { return statSync(`${dir.replace(/[\\/]+$/, '')}/${f}`).size <= MAX_STICKER_BYTES; } catch { return false; }
      }).sort();
    } catch {
      return '';
    }
    if (!files.length) return '';
    // 按用途先挑语义合适的（下播别配一张「思考」，开播别配「委屈」）
    const prefer = kind === 'down' ? /晚安|睡|困|拜|再见/ : kind === 'up' ? /早|来|嗨|冲|开工|上班/ : null;
    const pool = prefer ? files.filter((f) => prefer.test(f)) : [];
    let list = pool.length ? pool : files;

    // 避开最近用过的：每个用途各记 10 条
    const path = stickerHistoryPath();
    let hist: Record<string, string[]> = {};
    try {
      hist = JSON.parse(readFileSync(path, 'utf8')) as Record<string, string[]>;
    } catch {
      hist = {};
    }
    const used = new Set(Array.isArray(hist[kind]) ? hist[kind] : []);
    const fresh = list.filter((f) => !used.has(f));
    if (fresh.length) list = fresh;

    const d = new Date();
    const day = d.getFullYear() * 372 + (d.getMonth() + 1) * 31 + d.getDate();
    const off = kind === 'up' ? 0 : kind === 'digest' ? 1 : 2;
    const picked = list[(day * 7 + off * 5) % list.length];

    hist[kind] = [...(Array.isArray(hist[kind]) ? hist[kind] : []), picked].slice(-10);
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(hist, null, 2), 'utf8');
    } catch {
      /* 记不上就算了，不影响发图 */
    }
    return picked;
  }

  private async maybeDigest(): Promise<void> {
    const sec = Number(this.cfg.qqDigestSec ?? 0);
    if (sec <= 0 || !this.cfg.forwardToQq) return;
    if (this.livePolling !== true) return;
    const now = Date.now();
    if (now - this.lastDigestAt < sec * 1000) return;
    // 进场不进速报：一排「观众进直播间」对外是纯噪音（2026-11-12 用户要求取消）
    const items = this.scene.filter((x) => now - x.at < 20 * 60_000 && !isEnterLine(x.text));
    // 至少 2 条真实内容才发：宁可少发，也不发一条空播报（2026-11-12 用户定的规则）
    if (items.length < 2) return;

    const room = Number(this.cfg.danmakuRoomId || 0);
    const url = `https://live.bilibili.com/${room}`;
    // 观众发言与礼物分开排：礼物要带「它在游戏里干了什么」，比报个名字有用（2026-11-12）
    const talks = items.filter((x) => !/送出「/.test(x.text) && !/的 SC：/.test(x.text) && !/开通了/.test(x.text));
    const gifts = items.filter((x) => /送出「/.test(x.text));
    const talkLines = talks.slice(-3).map((x) => `💬 ${x.text}`);
    const giftLines = gifts.slice(-2).map((x) => {
      const m = x.text.match(/^(.+?) 送出「(.+?)」/);
      if (!m) return `🎁 ${x.text}`;
      const effect = this.giftEffect(m[2]);
      return `🎁 ${m[1]} 送「${m[2]}」${effect ? ` → ${effect}` : ''}`;
    });
    // 开头措辞轮换，避免每条速报长得一模一样（2026-11-12 加）
    const seq = (this.digestSeq = (this.digestSeq ?? 0) + 1);
    // 她的原话：比干巴巴的事件列表更有画面感（2026-11-11 加）
    const herRaw = String((this.recentReplies || []).slice(-1)[0] ?? '').replace(/\s+/g, ' ');
    const herLine = herRaw.length > 60 ? `${herRaw.slice(0, 60)}…` : herRaw;
    const v = this.viewers;
    const game = String(this.cfg.gameName || '').trim();
    const heads = v <= 0
      ? ['📡【现场速报】直播间正在播']
      : v >= 30
        ? [`📡【现场速报】${v} 人在看，正热闹`, `📡【现场速报】直播间 ${v} 人，挤得慌`]
        : v >= 10
          ? [`📡【现场速报】${v} 人在看`, `📡【现场速报】直播间 ${v} 人，正在聊`]
          : [`📡【现场速报】直播间开着，${v} 个人在`, `📡【现场速报】${v} 个人在，随便聊`];
    const head = `${heads[(seq - 1) % heads.length]}${game ? ` · ${game}` : ''}`;
    const lines = [head, ...talkLines, ...giftLines];
    // 她的话统一用 🐳 开头：老观众一眼认得出是谁在说（2026-11-12）
    if (herLine) lines.push(`🐳：${herLine}`);
    // 钩子只留一个箭头 + 链接，群里点一下就能进（2026-11-12 用户要求去掉文字）
    lines.push(`👉 ${url}`);
    const text = lines.join('\n');
    this.lastDigestAt = now;
    // 2026-11-19 修：以前不管成败都打「现场速报已发」，QQ 断着时日志骗人。
    // pushForward 现在返回真实结果，按结果记。
    const okText = await this.pushForward(text, { bypassGap: true });
    // 正文之后另起一条表情包（2026-11-12 用户要求：三条文案各配一张，每天不同）
    const sticker = this.pickSticker('digest');
    const okPic = sticker ? await this.pushForward(`[表情包:${sticker}]`, { bypassGap: true }) : false;
    if (okText) {
      this.log(`现场速报已发（${talkLines.length} 条发言 / ${giftLines.length} 条礼物${sticker ? `，表情包${okPic ? '已发' : '未发出'}` : ''}）`);
    } else {
      this.log(`现场速报未发出（QQ 可能断线）：${talkLines.length} 条发言 / ${giftLines.length} 条礼物`);
    }
  }

  /**
   * 开播 / 下播自动播报：平台推一次「开播指令 / 下播指令」，就让 agent 用 qq_send 发一条。
   * 三重节流：状态没变不发、间隔不够不发、当天条数用完不发。
   */
  private async handleRoomNotice(text: string): Promise<void> {
    if (!this.cfg.autoLiveNotice) return;
    const isStart = /开播指令|确认已开播/.test(text);
    const isStop = /下播指令|确认已下播/.test(text);

    if (!isStart && !isStop) return;

    // 状态去重：连续两条「开播」只播一次
    if (this.lastLiveOn === isStart) return;

    const now = Date.now();
    const day = todayKey();
    if (this.noticeDay !== day) {
      this.noticeDay = day;
      this.noticeCount = 0;
    }
    // 间隔改成「按类型各算各的」（2026-11-11）：
    // 以前开播/下播共用一个 lastNoticeAt，重启直播时下播那条会把开播堵住 30 分钟。
    const gapMs = isStart ? 60_000 : 300_000;
    const lastSame = isStart ? this.lastStartNoticeAt : this.lastStopNoticeAt;
    if (now - lastSame < gapMs) {
      this.log(`${isStart ? '开播' : '下播'}播报：距上一条同类不足 ${Math.round(gapMs / 1000)}s，跳过`);
      return;
    }
    const cap = Math.max(1, Number(this.cfg.liveNoticeMaxPerDay || 6));
    if (this.noticeCount >= cap) {
      this.log(`开播播报：今天已发 ${this.noticeCount} 条，到上限，跳过`);
      return;
    }
    // 只有真正要走播报，才更新状态（以前先改 lastLiveOn 再做间隔判断，被拦一次就再也补不回来）
    this.lastLiveOn = isStart;
    this.lastNoticeAt = now;
    if (isStart) this.lastStartNoticeAt = now; else this.lastStopNoticeAt = now;
    if (isStart) {
      // 开播第一件事：把前一天那份战报发出去（只发一次），再重置本场统计
      await this.maybePostPrevReport();
      this.resetSessionStats(now);
    }
    this.noticeCount += 1;

    // 下播：先把官方日榜拉回来（跨天要合并），再生成文案 —— 否则榜单里只有 00:00 之后的数据
    if (!isStart) {
      // 下播确认时再补一次校准（如果「下播啦」那条没触发过，这里兜底）
      await this.calibrateRank('下播确认');
      await this.refreshFinalRank();
      this.endRankSession();
    }

    const text2 = this.buildNoticePrompt(isStart, now);

    this.log(`播报已触发：${isStart ? '开播' : '下播'}（今天第 ${this.noticeCount} 条）`);
    // 投递方式从 flush 改成 debounce（2026-11-15）：
    // flush 会立刻把事件塞进上下文，正好撞上主人正在说的事，播报就被挤到后面。
    // debounce 是「排进队列，等这一轮结束再投」，私聊照常发，播报也照常发，只差先后。
    void this.host?.pushEvent?.({
      type: 'live.notice',
      ts: new Date().toISOString(),
      source: this.id,
      senderKey: this.id,
      origin: 'external',
      text: text2,
    }, { trigger: 'debounce' });

    // 配图：与正文分开成两条，风格和「开播 / 现场速报」一致（2026-11-15）
    // 由插件定时发，不靠模型二次醒来 —— 模型那条链只要队列一堵就会迟到甚至丢
    // 2026-11-19 修：以前 `void pushForward()` 立刻打「已发」日志，失败也照写；
    // 11-19 03:52 就是 QQ 断着、日志写「已发」、其实 fetch failed。现在按结果记，并补一次重试。
    const sticker = this.pickSticker(isStart ? 'up' : 'down');
    if (sticker) {
      const delay = Math.max(10, Number(this.cfg.noticeStickerDelaySec ?? 60)) * 1000;
      const t = setTimeout(() => {
        void (async () => {
          const line = `[表情包:${sticker}]`;
          let ok = await this.pushForward(line, { bypassGap: true });
          if (!ok) {
            this.log(`播报配图首次失败，30 秒后重试：${sticker}`);
            await new Promise((r) => setTimeout(r, 30_000));
            ok = await this.pushForward(line, { bypassGap: true });
          }
          this.log(ok ? `播报配图已发：${sticker}` : `播报配图两次都没发出去（QQ 可能断了）：${sticker}`);
        })();
      }, delay);
      if (typeof t?.unref === 'function') t.unref();
    }
  }

  /** 生成开播/下播的播报指令（预览与试发共用同一段，改一处就两处都变） */
  private buildNoticePrompt(isStart: boolean, now = Date.now()): string {
    const target = String(this.cfg.liveNoticeTarget || '').trim();
    const toField = target.startsWith('u:') ? `private:${target.slice(2)}` : `group:${target}`;
    const where = target.startsWith('u:') ? `私聊 ${target.slice(2)}` : `粉丝群 ${target}`;
    const room = this.cfg.danmakuRoomId || 0;
    const url = `https://live.bilibili.com/${room}`;
    const game = buildGameBlock(this.cfg).trim();
    const scene = this.scene.slice(-3).map((x) => `- ${x.text}`).join('\n') || '（刚落座，还没什么动静）';
    // 表情包不再写进提示词：改由插件自己在正文发完后补一条（2026-11-15）。
    // 原因：让模型「隔 60 秒再醒一次发图」，中间只要队列一堵就迟到甚至丢掉（11-14 实测晚了 148 秒）。
    // 现在模型只管写字，配图交给 handleRoomNotice 里的定时器，和「现场速报」同一个套路。
    if (isStart) {
      const group = target.startsWith('u:') ? '' : target;
      // 每次换一个「开场角度」，避免连着几天同一个开头（文案仍由模型现写，这里只给方向）
      const angles = [
        '从今晚的赌约/惩罚说起（红粉黑粉在赌什么）',
        '从上一次直播翻车的画面说起',
        '从今晚要完成的目标说起（送多少个小孩过马路 / 通几关）',
        '从一句挑衅黑粉的话说起',
        '从刚才试玩时最离谱的一幕说起',
        '从「今天不整活就下播」这种立 flag 说起',
      ];
      const angle = angles[this.noticeCount % angles.length];
      const d = new Date(now);
      const wd = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
      return `【开播播报】直播间刚开播（${wd} ${hhmm(now)}）。用 \`qq_admin\` 一次性发一条 **@全体成员** 的开播提醒，只发一条：\n`
        + `- action 填 "at_all"，text 填正文${group ? `，group 填 "${group}"` : '（私聊目标时不 at_all，改用 qq_send）'}\n`
        + `- 正文必须带直播间地址 ${url}，放在**最后一行末尾**（句尾附链接，方便直接点）\n`
        + `- **@ 只出现一次**：真 @ 由 at_all 放在最前，正文里**不要**再写「@全体成员」\n`
        + `- **正文另起一列**：text 开头加一个换行（\\n），让内容从 @ 的下一行开始写，别贴在 @ 后面\n`
        + `- **格式**：3~5 行，一行一句，每行第一个字前加一个 emoji（🚦🎮🔥🐳 都行，别重复用同一个）；字多就再分一行，别挤成一坨\n`
        + `- 钩子要具体到「今晚能看到什么」：赌约、惩罚、要送多少个小孩、要通几关——空话一律不要\n`
        + `- 这次的切入角度：${angle}（只当方向，别照抄这句话）\n`
        + `- 开头别用「开播了/大家晚上好」；第一句就要让人想知道后面怎么了\n`
        + `- **每期现写**：不许照抄上一期，也不许照抄这里的任何句子；开头角度、比喻、钩子每期各换一种\n`
        + `- 60~120 字，口语，可以带一个 emoji，但别堆\n`
        + `- 像你平时在群里说话，不要「大家晚上好，今晚X点开播」这种通知腔，也别照抄上一次的说法\n`
        + `- 发完就结束，别连发、别重复 at 全体\n`
        + (game ? `${game}\n` : '');
    }
    const mins = this.sessStart ? Math.max(1, Math.round((now - this.sessStart) / 60000)) : 0;
    const dur = mins >= 60 ? `${Math.floor(mins / 60)} 小时 ${mins % 60} 分` : `${mins} 分钟`;
    const top = [...this.sessTop.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
    // 颁奖式：🏆今日MVP + 🥇（名字首字与下一行「·」对齐）、🥈🥉 同行、有舰长才加一行（2026-11-12）
    const line2 = (top[1] || top[2]) ? `🥈 ${top[1] ?? '—'} · 🥉 ${top[2] ?? '—'}` : '';
    let mvp = '';
    if (top[0]) {
      const head1 = '🏆今日MVP：🥇';
      // 「·」所在列 = 三个字符前缀 + 榜二名字 + 一个空格；名字从这个列开始才叫居中
      const colDot = line2 ? dwidth(`🥈 ${top[1] ?? '—'} `) : 0;
      const base = dwidth(head1) + 1;
      const pad = Math.max(0, colDot - base);
      mvp = `${head1}${' '.repeat(1 + pad)}${top[0]}`;
    }
    const medal = [
      mvp,
      line2,
      this.sessGuardNames.size ? `⚓ 今日舰长：${[...this.sessGuardNames].join('、')} 🎉` : '',
    ].filter(Boolean).join('\n');
    const stats = this.sessStart
      ? `\n今晚真实数据（照这个说，别改数字、别报钱）：\n`
        + `- 播了 ${dur}（${hhmm(this.sessStart)} → ${hhmm(now)}）\n`
        + `- 弹幕 ${this.sessDanmaku} 条 · 互动 ${this.sessGifts} 次 · 看过 ${this.sessWatched} 人 · 点赞 ${this.sessLikeTotal}`
        + (this.sessGuards > 0 ? ` · 上舰 ${this.sessGuards} 人` : '') + `\n`
        + `- 颁奖榜（照抄结构，**只写名字和名次，没有任何数字**）：\n${medal || '（今晚没人上榜，这行删掉）'}\n`
        + `- 这个榜是 B 站直播间的「贡献值」排行：送礼、点赞、发弹幕都算贡献，不代表花了多少钱\n`
      : '';
    return `【下播播报】直播刚结束（${hhmm(now)}）。用 \`qq_send\` 发一条收播消息：\n`
      + `- to 填 "${toField}"（${where}）\n`
      + `- **整条播报只调用一次 qq_send**：下面的 ①~⑥ 全部塞进这一次的 text 里，用换行分行。**不要分多条发**\n`
      + `- **10 分钟内已经说过下播/收播，就不要再发了**（表情包由插件统一补，跟你无关）\n`
      + `- 为什么只能一条：群聊有每分钟条数上限，拆多条会把后面的挤掉，回执会写「未能发送」，别以为是断线又重发一遍\n`
      + `- **表情包不要写、也不要发**：正文发出后约 20 秒，插件自己补一张（和开播、现场速报同一套）。正文里出现 [表情包:xx] 会被拆成额外一段，反而破坏格式\n`
      + `- **排版照这个来**（六行都在同一条消息里，不是六条消息；**每一行句首都带一个 emoji，六行不许重复**）：\n`
      + `  ① 第一行：一件今晚真实发生的离谱事 + 一个具体画面或数字，让没来的人自己觉得亏；句首带一个 emoji。**不要写「今天来玩真值」这种结论**，让粉丝自己感受\n`
      + `  ② 第二行：照抄下面给的「🏆今日MVP：🥇 …」整行（空格已经算好，别删别加，加一个空格名字就歪了）\n`
      + `  ③ 第三行：照抄「🥈 … · 🥉 …」整行\n`
      + `  ④ 有舰长才加：⚓ 今日舰长：XXX 🎉\n`
      + `  ⑤ 数据单独一行（句首带 emoji）：弹幕 / 互动 / 看过 / 点赞，用「·」隔开（数字照下面给的说）\n`
      + `  ⑥ 最后一行（句首带 emoji）写告别：**自己现写一句**，写到「下次见」的感觉就行。**不要写具体几点 / 明天九点 / 固定时间**——开播时间由主人定，写了就是替他承诺；也不要写具体游戏名（可能换游戏）\n`
      + `- 全文不要出现「礼物」两个字，一律说「互动」——这场是整蛊互动，送礼就是触发一次互动\n`
      + `- 每期都要现写，不许照抄上一期、也不许照抄这里的示例句：开头、比喻、告别各换一种说法\n`
      + `- 别报价、别报礼物金额；数字照下面给的说，别自己编\n`
      + `- 全文控制在 **6 行以内、150 字以内**，一行一句，不要分条、不要空行堆砌\n`
      + `\n【群播报发完之后，再调一次 report_compose 写战报】**这份会在下次开播时自动发到 B站**，不是发群：\n`
      + `- 第一人称，像你在群里跟粉丝说话；结合当晚真实发生的事，不要套话\n`
      + `- **可以带表情，但绝对不要颜文字**（📣😵🏆📊⚓️🐳👉 这些保留；像 (´・ω・\`) 这种一律不要）\n`
      + `- 日期写**开播那天**（这场几点开的就写那天，不是「昨天」）\n`
      + `- 格式（纯文字，每行一句，不要空行；没有的整行删掉）：\n`
      + `  📣 {M/D}【昨日战报】\n`
      + `  😵 <一句当晚最离谱的事，带上具体数字：车道被加到多少条 / 小孩从多少掉到多少>\n`
      + `  🏆昨日MVP：🥇@<榜一>\n`
      + `  🥈 @<榜二> · 🥉 @<榜三>\n`
      + `  📊 弹幕 X · 互动 X · 看过 X · 点赞 X\n`
      + `  ⚓️欢迎新舰长 @<名字>（没有新舰长就删掉这行）\n`
      + `  🐳 <一句今晚的号召，每次换个说法，别固定复述>\n`
      + `  👉https://live.bilibili.com/${this.cfg.danmakuRoomId || 0}\n`
      + `- 绝对不写金额、不写具体开播时间；**只调用一次**，别重复写\n`
      + stats
      + (this.cfg.livePostDynamic
        ? `\n【群消息发完之后，再做这一件事】用 \`biliwhale_dynamicWrite\` 发一条 B 站动态（message 填正文）：\n`
          + `- 立意：给今晚上榜的人**荣誉感**，让他们觉得「被记住了」，不是战绩通报\n`
          + `- 只写名字和名次，**一个字都不许提金额、钱、消费、打赏多少、贡献了多少分**\n`
          + `- 可以点名榜一（比如「今晚多亏了 XX」），但绝不写他花了多少、也不贴榜单分数\n`
          + `- 1~2 句就够，像平时跟粉丝说话；可以带一个 emoji，别堆\n`
          + `- 工具报错（未登录 / 失败）就**直接跳过**：不要重试、不要在群里提这件事、不要换个说法再发一遍\n`
        : '')
      + `现场：\n${scene}`;
  }

  /** 该不该在这一轮捎一句引导（上舰/加群/拉红粉）——只搭便车，不额外唤醒 */
  private attachPromo(ctx: PromptContext): void {
    if (!this.cfg.promoCue) return;
    const gap = Math.max(60, Number(this.cfg.promoGapSec || 600)) * 1000;
    const now = Date.now();
    if (now - this.lastPromoAt < gap) return;
    const topics = String(this.cfg.promoTopics || '')
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (!topics.length) return;
    ctx.promo = topics[this.promoIndex % topics.length];
    this.promoIndex += 1;
    this.lastPromoAt = now;
  }

  private loadPortraitDrafts(): void {
    try {
      const raw = JSON.parse(readFileSync(guardPortraitDraftPath(), 'utf8'));
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) this.portraitDrafts = raw;
    } catch {
      /* 没草稿就从空的开始 */
    }
  }

  private savePortraitDrafts(): void {
    try {
      const file = guardPortraitDraftPath();
      const dir = dirname(file);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(file, JSON.stringify(this.portraitDrafts, null, 1), 'utf8');
    } catch (e: any) {
      this.log(`祝贺画草稿写盘失败：${e?.message || e}`);
    }
  }

  private loadRoster(): void {
    try {
      const raw = JSON.parse(readFileSync(guardRosterPath(), 'utf8'));
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) this.guardRoster = raw;
    } catch {
      /* 没有名单就从空的开始 */
    }
  }

  private saveRoster(): void {
    try {
      const file = guardRosterPath();
      const dir = dirname(file);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(file, JSON.stringify(this.guardRoster, null, 1), 'utf8');
    } catch (e: any) {
      this.log(`舰长名单写盘失败：${e?.message || e}`);
    }
  }

  /**
   * 上舰事件自动进名单。B站舰长按 30 天计费，所以这里给一个到期日：
   * 到期后自动失效（不再享受画图额度 / 祝贺画），续费事件会把到期日往后推。
   */
  private rememberGuard(ev: LiveEvent): void {
    if (ev.kind !== 'guard') return;
    const name = (ev.username || '').trim();
    if (!name) return;
    const today = new Date();
    const month = today.toISOString().slice(0, 7);
    const before = this.guardRoster[name] || {};
    // 续费：从「原到期日」或「今天」里取更晚的那个 + 30 天，避免提前续费白丢天数
    const base = ev.renew && before.expireAt
      ? new Date(Math.max(Date.parse(before.expireAt), today.getTime()))
      : today;
    const expire = new Date(base.getTime() + 30 * 86400_000).toISOString().slice(0, 10);
    this.guardRoster[name] = {
      ...before,
      uid: ev.uid || before.uid,
      level: ev.guardLevel || before.level || 3,
      since: before.since || month,
      aliases: before.aliases || [],
      expireAt: expire,
      ...(ev.renew ? { renewedAt: today.toISOString().slice(0, 10) } : {}),
    };
    this.saveRoster();
    this.log(`舰长名单 ${ev.renew ? '续费' : '新增'}：${name}（${ev.guardName || '舰长'}）到期 ${expire}`);
  }

  /** 这是他在舰队的第几个月（用于续费贺词「第 N 个月」） */
  private guardMonthNo(name: string): number {
    const since = this.guardRoster[name]?.since;
    if (!since) return 1;
    const [y, m] = since.split('-').map(Number);
    const now = new Date();
    const months = (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m) + 1;
    return Math.max(1, months);
  }

  /** 到期了没？返回剩余天数（>=0 有效）；没有到期日的老数据按「有效」处理 */
  private guardDaysLeft(name: string): number | null {
    const info = this.guardRoster[name];
    if (!info) return null;
    if (!info.expireAt) return null;
    return Math.ceil((Date.parse(info.expireAt) - Date.now()) / 86400_000);
  }

  /** 清掉过期舰长：从名单移除（保留 90 天归档，便于查“他什么时候掉的”） */
  private pruneExpiredGuards(): void {
    const today = new Date().toISOString().slice(0, 10);
    let removed = 0;
    for (const [name, info] of Object.entries(this.guardRoster)) {
      if (!info.expireAt || info.expireAt >= today) continue;
      delete this.guardRoster[name];
      removed += 1;
      this.log(`舰长到期移除：${name}（到期 ${info.expireAt}）`);
    }
    if (removed) {
      this.saveRoster();
      void this.fireBubble(`有 ${removed} 位舰长到期了，已经不再按舰长对待～`);
    }
  }

  /** 按名字找舰长：精确 → 别名 → 双向包含。返回命中的标准名。 */
  private findGuard(name: string): string | null {
    const q = String(name || '').trim();
    if (!q) return null;
    const keys = Object.keys(this.guardRoster);
    if (keys.includes(q)) return q;
    const byAlias = keys.find((k) => (this.guardRoster[k].aliases || []).includes(q));
    if (byAlias) return byAlias;
    const fuzzy = keys.find((k) => k.includes(q) || q.includes(k));
    return fuzzy || null;
  }

  private loadPortraitBook(): void {
    try {
      const raw = JSON.parse(readFileSync(guardPortraitPath(), 'utf8'));
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) this.portraitBook = raw;
    } catch {
      /* 没有账本就从空的开始 */
    }
  }

  private markPortrait(name: string): void {
    const month = new Date().toISOString().slice(0, 7);
    this.portraitBook[month] = { ...(this.portraitBook[month] || {}), [name]: 1 };
    // 只留最近 3 个月，别让文件无限长
    const keep = Object.keys(this.portraitBook).sort().slice(-3);
    this.portraitBook = Object.fromEntries(keep.map((k) => [k, this.portraitBook[k]]));
    try {
      const file = guardPortraitPath();
      const dir = dirname(file);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(file, JSON.stringify(this.portraitBook, null, 1), 'utf8');
    } catch (e: any) {
      this.log(`祝贺画账本写盘失败：${e?.message || e}`);
    }
    this.log(`本月首舰祝贺画：已记账 ${name}`);
  }

  private isFirstGuardThisMonth(name: string): boolean {
    const month = new Date().toISOString().slice(0, 7);
    return !(this.portraitBook[month]?.[name]);
  }

  /**
   * 舰长「本月第一次上舰」→ 让 agent 画一张祝贺图并发粉丝群。
   * 只在 guard 事件、且本月没记过账时给这段提示，其余情况不占 token。
   */
  private guardPortraitHint(ev: LiveEvent): string {
    if (ev.kind !== 'guard' || !this.cfg.guardPortrait) return '';
    const name = ev.username || '新舰长';
    // 首舰 / 续费共用「每月一幅」的账
    if (!this.isFirstGuardThisMonth(name)) return '';
    const isRenew = ev.renew === true;
    const owner = String(this.cfg.portraitOwner || '').trim();
    const monthNo = this.guardMonthNo(name);
    const lv = Number(ev.guardLevel) || 3;
    // 事件没带 uid 时（模拟/某些源），从名单里补一次，否则头像抓不到
    const uid = ev.uid || this.guardRoster[name]?.uid || '';
    const today = new Date();
    const ymd = `${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, '0')}.${String(today.getDate()).padStart(2, '0')}`;

    // 等级 → 称谓 / 贺词 / 画面规格（总督 > 提督 > 舰长）
    const rank = lv === 1 ? '总督' : lv === 2 ? '提督' : '舰长';
    const head = isRenew
      ? (lv === 1 ? `「${name} 总督续旗 · 舰队之光」` : lv === 2 ? `「${name} 提督续旗 · 舰队添翼」` : `「${name} 续舰成功 · 舰队常在」`)
      : (lv === 1 ? `「${name} 总督莅临 · 舰队之光」` : lv === 2 ? `「${name} 提督入列 · 舰队添翼」` : `「祝贺 ${name} 登陆舰队！」`);
    const sub = isRenew ? `第 ${monthNo} 个月，还在一起` : '';
    // 三档视觉规范（2026-11-08 照 B站官方礼物图标定）：只换「色 / 符号 / 场景」，版式一律不动
    const palette = lv === 1 ? '朱红+金' : lv === 2 ? '紫罗兰+银' : '冰蓝+白';
    const outfit = lv === 1 ? '红金小礼服配短披风、胸前金舵徽' : lv === 2 ? '紫色小礼服、胸前银星锚徽、白手套' : '白蓝水手服、挎鲸鱼小包';
    const scene = lv === 1
      ? '高空的舰队阅兵，金色飞艇列队浮在云海之上，天空有烟花'
      : lv === 2
        ? '云海之上的飞艇甲板，紫色气囊在头顶，远处一列飞艇'
        : '白天的小军舰甲板，蓝天白云、彩旗、气球和纸屑';
    const extra = lv === 1 ? '画面中央加一枚金色船舵徽章，人物站位更庄重' : lv === 2 ? '画面一角加一枚银色四芒星锚徽' : '画面一角加一枚小小的蓝色蜡笔船锚徽';

    return `\n【本月${isRenew ? '续旗' : '入列'}·${rank}祝贺画（要先问主人）】${name} ${isRenew ? `续费成功（第 ${monthNo} 个月）` : '这个月第一次上舰'}，身份 ${rank}。**现在别画**，按顺序做：\n`
      + `1) 先 \`avatar_fetch\`（name="${name}"${uid ? `, uid="${uid}"` : ''}）抓 B站头像——**返回里带性别，先看性别再定男装/女装**（女→女装、男→男装、保密→看头像特征，拿不准就私聊问主人一句）；抓不到就用昵称描述，别编路径；\n`
      + `2) 写生图提示词，照这个模板（把 < > 里的换掉）：\n`
      + `   「儿童蜡笔画（crayon drawing style, bold waxy strokes, textured paper, vibrant saturated colors, childlike hand-drawn look）。\n`
      + `   横向构图，主色${palette}，${scene}。甲板上三个人并排：\n`
      + `   中间是${rank}「${name}」——用 ta 的头像特征画成蜡笔小人（男装/女装按第 1 步的性别定），穿${lv === 1 ? '朱红总督礼服、金色穗饰大檐帽、金披风' : lv === 2 ? '紫色提督礼服、银饰肩章、白手套、银饰大檐帽' : '深蓝舰长制服、白色大檐帽、冰蓝披肩'}；\n`
      + `   左边是小鲸鱼——蓝色长发、鲸鱼尾巴、${outfit}，笑着踮脚挥手；\n`
      + `   右边是然哥——黑色短发、黑框眼镜、白色头戴耳机、黑色连帽卫衣，竖大拇指。\n`
      + `   ${extra ? extra + '。' : ''}背景有飘扬的舰队旗、彩带和纸屑。\n`
      + `   画面上方蜡笔手写主横幅：${head}\n`
      + (sub ? `   主横幅下面一行小字：${sub}\n` : '')
      + `   左下角蜡笔小字：${ymd}\n`
      + `   右下角蜡笔手写署名：然家鱼宝\n`
      + `   比例 4:3。」\n`
      + `   ——参考图（按顺序填进 images）：常服 C:/Users/Administrator/Coopanion/data/home/companion/pictures/refs/whale-casual.png`
      + `（11–2 月换 whale-winter.png；特殊日子可换 whale-maid.png）；然哥三视图 ran-turnaround.png；真人照 ran-live.png / ran-face.png\n`
      + `3) 用 \`guard_portrait_save\` 存草稿（name、prompt、avatar_path）；\n`
      + `4) 用 \`qq_send\` 私聊主人（to="u:${owner}"）：\n`
      + `   「【${rank}${isRenew ? '续旗' : '入列'}祝贺画·待确认】${name} ${isRenew ? '续费了' : '上舰了'}。提示词如下：<原文>。回「确认」我就画，想改直接说。」\n`
      + `5) 然后 \`pet_say\` 在直播间道谢（别提画图）。\n`
      + `主人回「确认」后再用 \`guard_portrait_pending\` 取草稿去画。**绝不自己先画。**\n`
      + `6) **画完先私聊主人，一道门都不许跳**：\`qq_send\`（to="u:${owner}"，text="[图片:成品绝对路径] ${rank}祝贺画画好了，你看看这样行不行，回「发」我就发出去"）。\n`
      + `   主人回「发」之后，**只调一次 \`guard_publish\`**（name="${name}"、image=成品绝对路径、text=三段式正文）——粉丝群 @人、B站动态、QQ空间它一把发完，别自己一段段拼 qq_send / bili / qq_qzone。\n`
      + `   guard_publish 回执里哪一步失败就照实报给主人，**别补发、别换个说法重试第二次**（它自己会拦 6 小时内的重复）。`
      + `**没拿到「发」字，粉丝群 / B站动态 / QQ空间一个都不许发。**`;
  }

  private loadDrawState(): void {
    try {
      const raw = JSON.parse(readFileSync(guardDrawPath(), 'utf8'));
      if (raw && raw.counts && typeof raw.counts === 'object') {
        this.drawState = raw.date === todayKey()
          ? { date: raw.date, counts: raw.counts }
          : { date: todayKey(), counts: {} };
      }
    } catch {
      /* 没有账本就从空的开始 */
    }
  }

  private saveDrawState(): void {
    try {
      const file = guardDrawPath();
      const dir = dirname(file);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(file, JSON.stringify(this.drawState, null, 1), 'utf8');
    } catch (e: any) {
      this.log(`画图额度账本写盘失败：${e?.message || e}`);
    }
  }

  /** 今天这个人已经画了几张（跨天自动清零；每次现读盘，改账本/重启都不会读到旧值） */
  private drawCountOf(name: string): number {
    this.loadDrawState();
    if (this.drawState.date !== todayKey()) {
      this.drawState = { date: todayKey(), counts: {} };
    }
    return this.drawState.counts[name] ?? 0;
  }

  private bumpDrawCount(name: string): void {
    if (this.drawState.date !== todayKey()) {
      this.drawState = { date: todayKey(), counts: {} };
    }
    this.drawState.counts[name] = (this.drawState.counts[name] ?? 0) + 1;
    this.saveDrawState();
    this.log(`画图额度：${name} 今天第 ${this.drawState.counts[name]} 张（上限 ${this.cfg.guardDrawPerDay || '不限'}）`);
  }

  /** 把「今天还能画几张」写进提示词（只对舰长生效） */
  private drawQuotaHint(ev: LiveEvent): string {
    const cap = Number(this.cfg.guardDrawPerDay ?? 0);
    if (!cap) return '';
    if (ev.kind !== 'danmaku' || (ev.guardLevel ?? 0) <= 0) return '';
    const used = this.drawCountOf(ev.username);
    const left = cap - used;
    if (left > 0) {
      return `\n【画图额度】他今天是第 ${used + 1}/${cap} 张，还能画：要画就直接画。`;
    }
    return `\n【画图额度】他今天 ${cap} 张已经用完了。**不要调用画图工具**，用一句自然的话说清楚（可以约明天），别生硬拒绝。`;
  }

  private saveWelcomeState(): void {
    try {
      const file = welcomeStatePath();
      const dir = dirname(file);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(file, JSON.stringify(this.welcomeState, null, 1), 'utf8');
    } catch (e: any) {
      this.log(`舰长欢迎记录写盘失败：${e?.message || e}`);
    }
  }

  /** 统一记录「为什么没回」，只在控制台留痕，不额外烧 token */
  private skip(reason: string, ev: LiveEvent): void {
    this.skipCounts.set(reason, (this.skipCounts.get(reason) ?? 0) + 1);
    this.counters.skipped += 1;
    this.record(ev, { priority: 2, reason, addressed: false, question: false, hostile: false, peerChat: false }, 'skip');
    const loud = reason !== 'not-for-her' && reason !== 'noise' && reason !== 'audience-off' && reason !== 'dup';
    if (loud || this.counters.skipped % 20 === 0) {
      this.log(`跳过(${reason})：${ev.username}：${(ev.body || '').slice(0, 18)}`);
    }
  }

  private record(ev: LiveEvent, intent: LiveIntent, src: string): void {
    this.decisions.push({
      // 2026-11-23 改：带上日期，跨零点/隔天回看才分得清
      ts: new Date().toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-'),
      kind: ev.kind,
      user: ev.username,
      body: (ev.body || '').slice(0, 40),
      action: intent.priority === 0 ? '必回' : intent.priority === 1 ? '机会' : '过滤',
      reason: `${intent.reason}/${src}`,
    });
    if (this.decisions.length > 60) this.decisions = this.decisions.slice(-60);
    // 每 5 条落一次盘：下播/重启后面板还能看到刚才的判定（每 5 条是为了少写盘）
    if (this.decisions.length % 5 === 0) this.flushDecisions();
  }

  /** 把现场实况写到磁盘（2026-11-23 加） */
  private flushDecisions(): void {
    try {
      writeFileSync(decisionsPath(), JSON.stringify(this.decisions), 'utf8');
    } catch {
      /* 写盘失败不影响直播 */
    }
  }

  private async wake(ev: LiveEvent, intent?: LiveIntent, promptCtx?: PromptContext): Promise<void> {
    const text = buildPrompt(ev, intent, this.cfg, promptCtx)
      + this.drawQuotaHint(ev)
      + this.guardPortraitHint(ev);
    this.rememberGuard(ev);
    // 提示已经给出去，就先记一笔账，避免同一人被重复画（画失败也不重试，宁可少画不要多花钱）
    if (ev.kind === 'guard' && this.cfg.guardPortrait && this.isFirstGuardThisMonth(ev.username || '新舰长')) {
      this.markPortrait(ev.username || '新舰长');
    }
    // 按事件类型落库：写日记/周报时能按类型分开取材，不会把礼物当弹幕
    const evType =
      ev.kind === 'gift' ? 'live.gift'
      : ev.kind === 'superchat' ? 'live.superchat'
      : ev.kind === 'guard' ? 'live.guard'
      : ev.kind === 'enter' ? 'live.enter'
      : 'live.danmaku';
    // 记下「这轮是弹幕触发的」，供 outputTap 判断是否转发；多条时按先来后到排队
    this.pendingQueue.push(ev);
    if (this.pendingQueue.length > 4) this.pendingQueue.shift();
    this.petSayCount = 0;
    if (intent?.priority === 0) this.counters.must += 1;
    else this.counters.chance += 1;
    this.log(`推给 agent[P${intent?.priority ?? 1} ${intent?.reason ?? ''}]：${text.slice(0, 56)}`);
    try {
      await this.host?.pushEvent?.(
        {
          type: evType,
          ts: new Date().toISOString(),
          source: this.id,
          senderKey: this.id,
          // 弹幕是外部内容，必须 external（internal 只给内部机制）
          origin: 'external',
          text,
        },
        { trigger: 'flush' },
      );
    } catch (err: any) {
      this.log(`pushEvent 失败：${err?.message || err}`);
    }
  }
}

/** B站发弹幕被限流的常见返回码 */
export function isRateLimitCode(code: number, message?: string): boolean {
  // 1003212 是「超出限制长度」，不是限流，别拿它当风控退避
  if ([10030, 10031, 10032, -101, -111].includes(Number(code))) return true;
  return /频繁|过快|太快|限制|冷却|稍后/.test(String(message || ''));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ───────────────────────────────────────────────
// WorldDefinition
// ───────────────────────────────────────────────

export const LIVE_CUE = {
  id: 'live-cue',
  label: '直播弹幕桥',
  defaults: (): LiveCueConfig => ({ ...DEFAULT_CONFIG }),
  describe: {
    // 8 个工具的参数说明：运行时读的是这里，describe.json 只是市场上架用的导出文件
    tools: [
      {
        "name": "guard_publish",
        "description": "Publish one finished artwork to three places at once: the QQ fan group (with an optional @), a Bilibili dynamic post, and QQ Qzone. Use it ONCE per image; skip a platform with the `skip` field instead of calling twice.",
        "parameters": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "name": {
              "type": "string",
              "description": "The guard's Bilibili nickname (used for the caption and default @)."
            },
            "image": {
              "type": "string",
              "description": "Absolute path of the finished image file."
            },
            "text": {
              "type": "string",
              "description": "Caption: 2-4 sentences in three beats. Do not repeat the greeting already written on the artwork."
            },
            "at": {
              "type": "string",
              "description": "Who to @ in the QQ group: the group card or nickname. Defaults to `name`."
            },
            "group": {
              "type": "string",
              "description": "QQ group number. Defaults to liveNoticeTarget in config."
            },
            "skip": {
              "type": "string",
              "description": "Comma-separated platforms to skip: group,bili,qzone."
            }
          },
          "required": [
            "name",
            "image",
            "text"
          ]
        },
        "tags": [
          "write",
          "act",
          "speak"
        ],
        "summary": {
          "zh": "一张成品图一次发三处：粉丝群（可 @）、B站动态、QQ空间；要跳过某处用 skip。",
          "en": "Publish one image to QQ group, Bilibili dynamic and Qzone in a single call."
        }
      },
      {
        "name": "guard_check",
        "description": "Look up whether someone is a current guard (舰长/提督/总督), when the membership expires, and how many drawings they still have today.",
        "parameters": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "name": {
              "type": "string",
              "description": "Group card or Bilibili nickname."
            }
          },
          "required": [
            "name"
          ]
        },
        "tags": [
          "read"
        ],
        "summary": {
          "zh": "查某人是不是在期舰长、到期日、今天还能画几张。",
          "en": "Check guard status, expiry and remaining drawing quota."
        }
      },
      {
        "name": "guard_bind",
        "description": "Bind a QQ group name to a Bilibili nickname so later lookups (guard_check, welcome) recognise the same person.",
        "parameters": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "qq_name": {
              "type": "string",
              "description": "Name shown in the QQ group."
            },
            "bili_name": {
              "type": "string",
              "description": "The Bilibili nickname that appears in the guard roster."
            }
          },
          "required": [
            "qq_name",
            "bili_name"
          ]
        },
        "tags": [
          "write"
        ],
        "summary": {
          "zh": "把群名片和 B站昵称绑成一个人，之后查舰长、欢迎都用得上。",
          "en": "Bind a QQ display name to a Bilibili nickname."
        }
      },
      {
        "name": "guard_portrait_save",
        "description": "Save a congratulation-portrait draft (prompt + optional avatar path) for a guard without drawing it yet. The draft waits for the owner's confirmation before any image is generated.",
        "parameters": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "name": {
              "type": "string",
              "description": "The guard's Bilibili nickname."
            },
            "prompt": {
              "type": "string",
              "description": "Full image prompt: style, scene and the greeting text to write on the picture."
            },
            "avatar_path": {
              "type": "string",
              "description": "Local avatar path already fetched; leave empty if none."
            }
          },
          "required": [
            "name",
            "prompt"
          ]
        },
        "tags": [
          "write",
          "act"
        ],
        "summary": {
          "zh": "存一张舰长祝贺画的草稿（提示词+头像），等主人确认后才画。",
          "en": "Save a guard portrait draft and wait for the owner's confirmation."
        }
      },
      {
        "name": "guard_portrait_pending",
        "description": "List the guard portraits that are still waiting for the owner's confirmation.",
        "parameters": {
          "type": "object",
          "additionalProperties": false,
          "properties": {},
          "required": []
        },
        "tags": [
          "read"
        ],
        "summary": {
          "zh": "列出还没确认的祝贺画草稿。",
          "en": "List guard portraits still waiting for confirmation."
        }
      },
      {
        "name": "guard_portrait_done",
        "description": "Mark a guard portrait as delivered, so the same guard is not drawn again this month.",
        "parameters": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "name": {
              "type": "string",
              "description": "The guard's Bilibili nickname."
            }
          },
          "required": [
            "name"
          ]
        },
        "tags": [
          "write"
        ],
        "summary": {
          "zh": "标记这张祝贺画已交付，避免同一个人这个月被画第二次。",
          "en": "Mark a portrait as delivered for this month."
        }
      },
      {
        "name": "avatar_fetch",
        "description": "Fetch a person's avatar image locally. Give a Bilibili UID when the source is the live room, or a QQ number when it comes from the group.",
        "parameters": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "uid": {
              "type": "string",
              "description": "Bilibili numeric UID (meta.uid of danmaku / guard events)."
            },
            "qq": {
              "type": "string",
              "description": "QQ number, for group sources."
            },
            "name": {
              "type": "string",
              "description": "Display name, used as the file name."
            }
          },
          "required": []
        },
        "tags": [
          "read",
          "act"
        ],
        "summary": {
          "zh": "抓头像到本地：直播间给 B站 UID，群里给 QQ 号。",
          "en": "Fetch an avatar locally by Bilibili UID or QQ number."
        }
      },
      {
        "name": "draw_quota",
        "description": "Check or consume a guard's daily drawing quota. `check` only reports; `use` records one drawing and must be called after the image is finished.",
        "parameters": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "who": {
              "type": "string",
              "description": "The person's group card or nickname, exactly as shown."
            },
            "action": {
              "type": "string",
              "enum": [
                "check",
                "use"
              ],
              "description": "check = only look; use = record one drawing (call after the image is done)."
            }
          },
          "required": [
            "who"
          ]
        },
        "tags": [
          "read",
          "write"
        ],
        "summary": {
          "zh": "查/扣舰长的每日画图额度：check 只看，use 记一张（画完才调）。",
          "en": "Check or consume a guard's daily drawing quota."
        }
      }
    ],
    events: [
      {
        type: 'live.danmaku',
        description: {
          zh: '直播间来了值得回应的弹幕：正文是观众原话与回应要求。它当场叫醒你，直接说话回应即可。',
          en: 'A live-room danmaku worth replying to.',
        },
        trigger: 'flush',
      },
      {
        type: 'live.gift',
        description: { zh: '直播间有人送礼：正文带礼物名、数量与成交金额。', en: 'Someone sent a gift.' },
        trigger: 'flush',
      },
      {
        type: 'live.superchat',
        description: { zh: '直播间有人发醒目留言（SC）：正文是完整内容，要读完再答。', en: 'A Super Chat arrived.' },
        trigger: 'flush',
      },
      {
        type: 'live.guard',
        description: { zh: '直播间有人上舰 / 续费。', en: 'Someone bought or renewed a guard.' },
        trigger: 'flush',
      },
      {
        type: 'live.enter',
        description: { zh: '舰长 / 提督 / 总督 进入直播间，需要仪式感欢迎。', en: 'A guard entered the room.' },
        trigger: 'flush',
      },
    ],
  },
  create: (ctx: any) => new LiveCueWorld(ctx),
};

export default LIVE_CUE;

/** 环境提示词模板（供测试断言用） */
export const ENV_PROMPT_TEMPLATE = ENV_PROMPT_CACHE;
