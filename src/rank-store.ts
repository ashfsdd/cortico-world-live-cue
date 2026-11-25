/**
 * 本场礼物榜的持久化状态（2026-11-20 新增）
 *
 * 解决三件事：
 *   1) 跨零点：B站日榜 00:00 重置，本场累计从**开播时刻**算，不受影响；
 *   2) Coo 重启：榜单落盘到 worlds/live-cue/rank-session.json，重启后接着累加，不清零；
 *   3) 异常回退：下播没走完就崩了（active 但长时间不在直播）→ 启动时自动结算，不会串场。
 *
 * 去重口径：B站礼物事件可能重投（重连/补档），用 tid 去重；没有 tid 的用
 * `名字|礼物|数量|秒级时间` 兜底 —— 宁可少算一次，也不要同一笔礼物算两遍。
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

export interface RankSession {
  /** 本场开播时刻（ms） */
  startedAt: number;
  /** 开播那天的 YYYY-MM-DD（战报归档用） */
  dayKey: string;
  room: number;
  /** 还在进行中 */
  active: boolean;
  endedAt?: number;
  /** 昵称 → 元 */
  gifts: Record<string, number>;
  /** 昵称 → 件数 */
  counts: Record<string, number>;
  /** 已计入的礼物指纹（最多 1000 条） */
  seen: string[];
  updatedAt: number;
}

export interface GiftInput {
  name: string;
  yuan: number;
  count?: number;
  tid?: string;
  at?: number;
}

const MAX_SEEN = 1000;

export function newSession(now: number, room: number, dayKey: string): RankSession {
  return { startedAt: now, dayKey, room, active: true, gifts: {}, counts: {}, seen: [], updatedAt: now };
}

/** 礼物指纹：优先 tid；没有就退化到「名字|秒级时间|金额」 */
export function giftKey(g: GiftInput): string {
  if (g.tid) return `t:${g.tid}`;
  const at = Math.floor((g.at ?? Date.now()) / 1000);
  return `h:${g.name}|${at}|${g.yuan}`;
}

export interface RecordResult {
  session: RankSession;
  added: boolean;
  reason?: 'dup' | 'bad-name' | 'bad-amount';
}

/** 记一笔礼物；重复/脏数据直接跳过，永远返回一个新对象（不改原对象，方便测试） */
export function recordGift(s: RankSession, g: GiftInput, now = Date.now()): RecordResult {
  const name = String(g.name || '').trim();
  if (!name) return { session: s, added: false, reason: 'bad-name' };
  const yuan = Number(g.yuan);
  if (!Number.isFinite(yuan) || yuan < 0) return { session: s, added: false, reason: 'bad-amount' };

  const key = giftKey({ ...g, at: g.at ?? now });
  if (s.seen.includes(key)) return { session: s, added: false, reason: 'dup' };

  const counts = { ...s.counts, [name]: (s.counts[name] ?? 0) + Math.max(1, Number(g.count) || 1) };
  const gifts = { ...s.gifts, [name]: Math.round(((s.gifts[name] ?? 0) + yuan) * 100) / 100 };
  const seen = [...s.seen, key];
  if (seen.length > MAX_SEEN) seen.splice(0, seen.length - MAX_SEEN);
  return { session: { ...s, gifts, counts, seen, updatedAt: now }, added: true };
}

/** 榜前 N：只算金额 > 0 的人，金额相同按件数、再按名字稳定排序（避免顺序抖动） */
export function topRank(s: RankSession, n = 3): Array<{ name: string; yuan: number; count: number }> {
  return Object.entries(s.gifts)
    .filter(([, v]) => Number.isFinite(v) && v > 0)
    .map(([name, yuan]) => ({ name, yuan, count: s.counts[name] ?? 1 }))
    .sort((a, b) => b.yuan - a.yuan || b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, n);
}

/**
 * 重启恢复：把老 session 接上。
 * - 还在直播（liveNow）且老 session.active → 原样保留（跨零点也不清）
 * - 已经不在直播 → 结算老 session，另开一个新的（等下次开播）
 */
export function resumeSession(
  old: RankSession | null,
  now: number,
  room: number,
  dayKey: string,
  liveNow: boolean,
): { session: RankSession; resumed: boolean; settledOld: boolean } {
  if (!old) return { session: newSession(now, room, dayKey), resumed: false, settledOld: false };
  if (old.active && liveNow) {
    // 跨天也续：**dayKey 不更新**（2026-11-20 定：一场直播只归属开播那天，
    // 跨零点后的后半夜仍算「前一天那场」，否则战报会写成第二天的日期）；
    // 只有金额和 seen 原样带过来。
    return { session: { ...old, room, updatedAt: now }, resumed: true, settledOld: false };
  }
  if (old.active && !liveNow) {
    // 崩溃/掉线没结算：补一个结束时间，金额原样保留，供下播战报用
    return {
      session: { ...old, active: false, endedAt: old.endedAt ?? old.updatedAt ?? now, updatedAt: now },
      resumed: false,
      settledOld: true,
    };
  }
  return { session: newSession(now, room, dayKey), resumed: false, settledOld: false };
}

/** 结构校验：坏数据一律判 false，调用方按「重新开一场」处理 */
export function validateSession(v: any): v is RankSession {
  if (!v || typeof v !== 'object') return false;
  if (!Number.isFinite(Number(v.startedAt)) || Number(v.startedAt) <= 0) return false;
  if (typeof v.active !== 'boolean') return false;
  if (typeof v.gifts !== 'object' || v.gifts === null) return false;
  for (const [k, x] of Object.entries(v.gifts)) {
    if (!k || !Number.isFinite(Number(x)) || Number(x) < 0) return false;
  }
  if (!Array.isArray(v.seen)) return false;
  return true;
}

export function loadSession(path: string): RankSession | null {
  try {
    if (!existsSync(path)) return null;
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    if (!validateSession(raw)) {
      // 坏文件留证据，别静默覆盖
      renameSync(path, `${path}.bad-${Date.now()}`);
      return null;
    }
    return raw;
  } catch {
    try {
      renameSync(path, `${path}.bad-${Date.now()}`);
    } catch {
      /* 备份失败也不影响主流程 */
    }
    return null;
  }
}

export function saveSession(path: string, s: RankSession): void {
  try {
    writeFileSync(path, JSON.stringify(s, null, 1), 'utf8');
  } catch {
    /* 落盘失败不能影响直播；下次变更会再试 */
  }
}

/**
 * 榜单偏差：|本场 - 日榜| / max(两边)，返回 0~1。
 * 只用来决定「要不要告警」，永远不拿去覆盖本场累计（日榜 00:00 会重置）。
 */
export function calcDeviation(mine: number, theirs: number): number {
  const a = Number(mine) || 0;
  const b = Number(theirs) || 0;
  const base = Math.max(a, b);
  if (base <= 0) return 0;
  return Math.abs(a - b) / base;
}

/**
 * 这条消息是不是主人发的（"下播"信号只认他）。
 * uids/names 是逗号分隔的配置串；uid 命中优先，昵称兜底；两边都空 = 一律不认。
 */
export function matchOwner(
  uid: string | undefined,
  name: string,
  uids: string,
  names: string,
): boolean {
  const split = (v: string) => String(v || '').split(/[,，\s]+/).filter(Boolean);
  const uidList = split(uids);
  const nameList = split(names);
  const u = String(uid || '').trim();
  if (u && uidList.includes(u)) return true;
  const n = String(name || '').trim();
  return !!n && nameList.includes(n);
}
