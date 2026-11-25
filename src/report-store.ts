/**
 * 下播战报（2026-11-20 新增）
 *
 * 规则（用户定的）：
 *   - 当晚简报只发**群**一次，下播时发完就算完；
 *   - **前一天战报**在开播时发**B站动态**一次，不许再往群里发一遍；
 *   - 两边都不许重复，所以战报要落盘 + 带 posted 标记（幂等）。
 *
 * 文案红线：只写名字/名次/数据，不写金额、不写具体开播时间。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ReportTop {
  name: string;
  yuan: number;
  count: number;
}

export interface DailyReport {
  /** 这场是哪天开的（YYYY-MM-DD） */
  dayKey: string;
  startedAt: number;
  endedAt: number;
  top: ReportTop[];
  stats: {
    danmaku: number;
    gifts: number;
    guards: number;
    viewers?: number;
    watched?: number;
    likes?: number;
  };
  /** 已经发过 B站动态了吗（幂等闸门） */
  posted: boolean;
  postedAt?: number;
  dynamicId?: string;
  /** 发失败时的原因，便于排查，不阻断下一场 */
  lastError?: string;
  /** 「准备下播」时抓到的官方日榜快照（贡献值口径，只作参考/校准） */
  officialTop?: Array<{ name: string; score: number }>;
  /** 当天的事件素材（最大一笔、峰值人数、舰长名单），发的时候拼进文案 */
  flavor?: { maxGifter?: string; maxGiftName?: string; peakViewers?: number; guardNames?: string[] };
}

export function reportDir(root: string): string {
  return join(root, 'home', 'companion', 'worlds', 'live-cue', 'reports');
}

export function reportPath(dir: string, dayKey: string): string {
  return join(dir, `report-${dayKey}.json`);
}

/** 小鲸鱼自己写的那份战报（第一人称、带当晚细节）；存在就优先用 */
export function narrativePath(dir: string, dayKey: string): string {
  return join(dir, `report-${dayKey}.txt`);
}

export function loadNarrative(dir: string, dayKey: string): string | null {
  try {
    const p = narrativePath(dir, dayKey);
    if (!existsSync(p)) return null;
    const t = readFileSync(p, 'utf8').trim();
    // 太短（<20 字）或太长（>900 字）都不像正经战报，退回模板
    if (t.length < 20 || t.length > 900) return null;
    return t;
  } catch {
    return null;
  }
}

export function saveReport(dir: string, r: DailyReport): void {
  try {
    // 2026-11-21 修：目录不存在时 writeFileSync 直接抛错，被 catch 吞掉 → 战报 JSON 从来没落盘
    mkdirSync(dir, { recursive: true });
    writeFileSync(reportPath(dir, r.dayKey), JSON.stringify(r, null, 1), 'utf8');
  } catch {
    /* 写不了就算了，下一场还会再生成 */
  }
}

export function loadReport(dir: string, dayKey: string): DailyReport | null {
  const p = reportPath(dir, dayKey);
  try {
    if (!existsSync(p)) return null;
    const v = JSON.parse(readFileSync(p, 'utf8'));
    return v && typeof v === 'object' && v.dayKey ? (v as DailyReport) : null;
  } catch {
    try {
      renameSync(p, `${p}.bad-${Date.now()}`);
    } catch {
      /* 备份失败不影响主流程 */
    }
    return null;
  }
}

/** 列出所有战报（按 dayKey 倒序），给「找上一场」用 */
export function listReports(dir: string): DailyReport[] {
  try {
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => /^report-\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .map((f) => {
        try {
          return JSON.parse(readFileSync(join(dir, f), 'utf8')) as DailyReport;
        } catch {
          return null;
        }
      })
      .filter((x): x is DailyReport => !!x && typeof x.dayKey === 'string')
      .sort((a, b) => b.dayKey.localeCompare(a.dayKey));
  } catch {
    return [];
  }
}

/**
 * 挑「该发的那一份」：比本场更早、且还没发过动态的最近一场。
 * 同一份只会被挑中一次（发完置 posted=true）。
 */
export function pickPendingReport(reports: DailyReport[], currentStart: number): DailyReport | null {
  const cands = reports
    .filter((r) => !r.posted && Number(r.endedAt) > 0 && Number(r.endedAt) < currentStart)
    .sort((a, b) => b.endedAt - a.endedAt);
  return cands[0] ?? null;
}

function nf(n: number): string {
  return Number.isFinite(n) ? String(Math.round(n)) : '0';
}

/**
 * 战报正文（纯代码生成，不经过模型 —— 保证同样的数据永远得到同样的文案，也避免写金额）
 * @param age 距离那场结束多久（小时），用于「昨晚 / 昨晚那场」措辞
 */
export interface ReportFlavor {
  /** 本场最大一笔礼物名（不写金额） */
  maxGiftName?: string;
  /** 谁送的 */
  maxGifter?: string;
  /** 本场峰值在线 */
  peakViewers?: number;
  /** 额外想带一句的事件（比如「小孩差一把没清零」），最多取一条 */
  extraLine?: string;
  /** 本场新舰长（战报里欢迎一下） */
  guardNames?: string[];
}

export interface ReportOptions {
  /** 直播间链接，带上方便开播前看到的人直接点进来 */
  liveUrl?: string;
}

/**
 * 战报正文：按当天实际数据现拼，不是固定模板。
 * 组成：标题（日期+一句概括）→ 事件（有才写）→ 前三名 → 数据 → 钩子 + 链接。
 * 红线：不写金额、不写具体开播时间；同样的输入永远得到同样的输出（可测）。
 */
/** 用日期做种子挑句式：同一天永远同一套（可测），不同天自然换说法 */
function pickByDay<T>(pool: T[], dayKey: string, salt: number): T {
  let h = salt;
  for (const ch of dayKey) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return pool[h % pool.length];
}

const OPENERS = [
  '昨天那场，差点又没刹住。',
  '昨晚这一场，比我预想的还狠。',
  '昨天收工的时候，我人都是软的。',
  '昨晚的节奏，一开始就没人想收。',
];

const HOOKS = [
  '今晚照旧，红粉集合，黑粉退散。',
  '今晚继续，谁来都不许提前走。',
  '今晚还开，红粉提前占位。',
  '今晚见，看谁能把小孩送过马路。',
];

/**
 * 战报正文（发 B站动态用）。
 * 规则：纯文字，不带 emoji/颜文字；数据一律取当天真实值，缺就整行不写（绝不编）；
 * 句式按日期轮换，不是固定模板复读。
 */
export function buildReportText(r: DailyReport, flavor: ReportFlavor = {}, opts: ReportOptions = {}): string {
  const lines: string[] = [];
  const d = new Date(r.startedAt);
  const mmdd = `${d.getMonth() + 1}/${d.getDate()}`;
  const s = r.stats;
  const day = r.dayKey || mmdd;

  lines.push(`📣 ${mmdd}【昨日战报】`);

  // 事件行：优先她自己写的那句（当天真事），没有就用可核实的数据，不编
  if (flavor.extraLine) {
    lines.push(`😵 ${flavor.extraLine}`);
  } else if (flavor.maxGifter && flavor.maxGiftName) {
    lines.push(`😵 ${pickByDay(OPENERS, day, 7)}昨晚最猛的一波是${flavor.maxGifter}的${flavor.maxGiftName}。`);
  }

  // 榜单：只写有名字的，缺就整行不写
  const t = r.top.filter((x) => x.name);
  if (t.length) {
    lines.push(`🏆昨日MVP：🥇@${t[0].name}`);
    const rest = t.slice(1, 3).map((x, i) => `${i === 0 ? '🥈' : '🥉'} @${x.name}`);
    if (rest.length) lines.push(rest.join(' · '));
  }

  // 数据行：只写真实有的
  const bits: string[] = [];
  if (s.danmaku) bits.push(`弹幕 ${nf(s.danmaku)}`);
  if (s.gifts) bits.push(`互动 ${nf(s.gifts)}`);
  if (s.viewers) bits.push(`看过 ${nf(s.viewers)}`);
  if (s.likes) bits.push(`点赞 ${nf(s.likes)}`);
  if (bits.length) lines.push(`📊 ${bits.join(' · ')}`);

  // 舰长行：没有就不写
  const guards = (flavor.guardNames ?? []).filter(Boolean);
  if (guards.length) lines.push(`⚓️欢迎新舰长 @${guards.slice(0, 2).join(' @')}`);

  lines.push(`🐳 ${pickByDay(HOOKS, day, 13)}`);
  if (opts.liveUrl) lines.push(`👉${opts.liveUrl}`);
  return lines.join('\n');
}

/**
 * 发 B站动态前最后一道清洗：**只去颜文字**，表情保留（2026-11-21 按用户要求改回）。
 * 例：(´・ω・`) / (｡･ω･｡) 这类整段删掉；正常括号里的中文不动。
 */
export function stripKaomoji(text: string): string {
  return String(text || '')
    .replace(/[（(][^（）()]{0,24}[｡･ﾟω´｀∀♡☆★][^（）()]{0,24}[）)]/g, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 粗校验：文案不该出现金额类字眼（防止以后改模板时手滑） */
export function looksSafe(text: string): boolean {
  return !/[¥￥]\s*\d|\d+\s*元|打赏|充値|充值|消费了多少/.test(text);
}
