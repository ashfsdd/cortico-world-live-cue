import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  newSession, recordGift, topRank, resumeSession, validateSession, loadSession, saveSession,
  calcDeviation, matchOwner,
} from '../src/rank-store.ts';

const T = (s: string) => new Date(s).getTime();

describe('本场榜单：跨零点', () => {
  it('00:00 前后继续累加，不清零', () => {
    let s = newSession(T('2026-11-19T23:50:00+08:00'), 123456, '2026-11-19');
    s = recordGift(s, { name: '了梦无殇', yuan: 19.9, tid: 'a1' }, T('2026-11-19T23:55:00+08:00')).session;
    // 跨过零点
    s = recordGift(s, { name: '了梦无殇', yuan: 9.9, tid: 'a2' }, T('2026-11-20T00:05:00+08:00')).session;
    s = recordGift(s, { name: '臭团团', yuan: 5, tid: 'a3' }, T('2026-11-20T00:06:00+08:00')).session;

    expect(s.gifts['了梦无殇']).toBeCloseTo(29.8, 2);
    expect(s.startedAt).toBe(T('2026-11-19T23:50:00+08:00'));   // 开播时刻不变
    expect(topRank(s)[0].name).toBe('了梦无殇');
  });

  it('重启时跨天也续：金额不动，dayKey 仍归开播那天（不改成第二天）', () => {
    let s = newSession(T('2026-11-19T22:00:00+08:00'), 123456, '2026-11-19');
    s = recordGift(s, { name: '甲', yuan: 10, tid: 'x1' }).session;
    const r = resumeSession(s, T('2026-11-20T01:00:00+08:00'), 123456, '2026-11-20', true);
    expect(r.resumed).toBe(true);
    expect(r.session.gifts['甲']).toBe(10);
    expect(r.session.dayKey).toBe('2026-11-19');   // 归属开播日
    expect(r.session.startedAt).toBe(s.startedAt);
  });
});

describe('本场榜单：Coo 重启', () => {
  it('直播中断线重启 → 恢复后接着累加，不清零', () => {
    let s = newSession(T('2026-11-20T00:01:00+08:00'), 123456, '2026-11-20');
    s = recordGift(s, { name: '乙', yuan: 19.9, tid: 'b1' }).session;

    // 模拟重启：内存丢了，从盘上读回来
    const dir = mkdtempSync(join(tmpdir(), 'rank-'));
    const f = join(dir, 'rank-session.json');
    saveSession(f, s);
    const back = loadSession(f);
    expect(back).not.toBeNull();

    const r = resumeSession(back, T('2026-11-20T00:30:00+08:00'), 123456, '2026-11-20', true);
    expect(r.resumed).toBe(true);
    const after = recordGift(r.session, { name: '乙', yuan: 9.9, tid: 'b2' }).session;
    expect(after.gifts['乙']).toBeCloseTo(29.8, 2);
  });

  it('下播没走完就崩了 → 启动时自动结算，不串到下一场', () => {
    let s = newSession(T('2026-11-19T21:00:00+08:00'), 123456, '2026-11-19');
    s = recordGift(s, { name: '丙', yuan: 5, tid: 'c1' }).session;
    const r = resumeSession(s, T('2026-11-20T10:00:00+08:00'), 123456, '2026-11-20', false);
    expect(r.settledOld).toBe(true);
    expect(r.session.active).toBe(false);
    expect(r.session.gifts['丙']).toBe(5);      // 老数据留给战报
  });
});

describe('重复发布防护 / 去重', () => {
  it('同一个 tid 重投两次只算一次', () => {
    let s = newSession(Date.now(), 1, '2026-11-20');
    const r1 = recordGift(s, { name: '丁', yuan: 19.9, tid: 'dup-1' });
    const r2 = recordGift(r1.session, { name: '丁', yuan: 19.9, tid: 'dup-1' });
    expect(r1.added).toBe(true);
    expect(r2.added).toBe(false);
    expect(r2.reason).toBe('dup');
    expect(r2.session.gifts['丁']).toBeCloseTo(19.9, 2);
  });

  it('没有 tid 时按「名字|秒|金额」兜底去重，同一个礼物不会被算两遍', () => {
    const at = T('2026-11-20T01:00:00+08:00');
    const s0 = newSession(at, 1, '2026-11-20');
    const a = recordGift(s0, { name: '戊', yuan: 0.1, count: 10, at }, at);
    const b = recordGift(a.session, { name: '戊', yuan: 0.1, count: 10, at }, at);
    expect(a.added).toBe(true);
    expect(b.added).toBe(false);
    expect(b.session.gifts['戊']).toBeCloseTo(0.1, 2);
  });
});

describe('榜单恢复与一致性校验', () => {
  it('坏文件 → 判 null 并留 .bad 备份，不覆盖原文件', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rank-bad-'));
    const f = join(dir, 'rank-session.json');
    writeFileSync(f, '{ this is not json', 'utf8');
    expect(loadSession(f)).toBeNull();
    expect(existsSync(f)).toBe(false);
    expect(readdirSync(dir).some((x) => x.includes('.bad-'))).toBe(true);
  });

  it('字段残缺/金额为负 → validateSession 拒绝', () => {
    expect(validateSession(null)).toBe(false);
    expect(validateSession({})).toBe(false);
    expect(validateSession({ startedAt: 1, active: true, gifts: { a: -1 }, seen: [] })).toBe(false);
    expect(validateSession({ startedAt: 1, active: true, gifts: { a: 1 }, seen: [] })).toBe(true);
  });

  it('落盘 → 读回，内容一致', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rank-ok-'));
    const f = join(dir, 'rank-session.json');
    let s = newSession(T('2026-11-20T00:01:00+08:00'), 123456, '2026-11-20');
    s = recordGift(s, { name: '己', yuan: 9.9, tid: 'e1' }).session;
    saveSession(f, s);
    const back = loadSession(f)!;
    expect(back.gifts['己']).toBeCloseTo(9.9, 2);
    expect(back.seen).toContain('t:e1');
  });
});

describe('榜单排序', () => {
  it('只按金额，0 元不进榜；同额按件数', () => {
    let s = newSession(Date.now(), 1, '2026-11-20');
    s = recordGift(s, { name: 'A', yuan: 0, tid: 'p1' }).session;
    s = recordGift(s, { name: 'B', yuan: 10, tid: 'p2' }).session;
    s = recordGift(s, { name: 'C', yuan: 10, count: 3, tid: 'p3' }).session;
    const top = topRank(s, 5);
    expect(top.map((x) => x.name)).toEqual(['C', 'B']);
  });
});

describe('榜单偏差（校准用）', () => {
  it('两边相等 → 0', () => {
    expect(calcDeviation(10, 10)).toBe(0);
  });
  it('差一半 → 0.5', () => {
    expect(calcDeviation(10, 20)).toBeCloseTo(0.5, 5);
  });
  it('一边为 0 → 1（完全对不上）', () => {
    expect(calcDeviation(0, 5)).toBe(1);
    expect(calcDeviation(5, 0)).toBe(1);
  });
  it('都为空 → 0，不产生假告警', () => {
    expect(calcDeviation(0, 0)).toBe(0);
    expect(calcDeviation(NaN as any, 0)).toBe(0);
  });
});

describe('「下播」只认主人', () => {
  const UIDS = '1234567890123456789';
  const NAMES = '然酱丶重生版';

  it('UID 命中就认（优先于昵称）', () => {
    expect(matchOwner('1234567890123456789', '随便什么名', UIDS, NAMES)).toBe(true);
  });
  it('昵称兜底（没有 uid 时）', () => {
    expect(matchOwner(undefined, '然酱丶重生版', UIDS, NAMES)).toBe(true);
  });
  it('别人说下播 → 不认', () => {
    expect(matchOwner('999', '路人甲', UIDS, NAMES)).toBe(false);
  });
  it('配置为空 → 一律不认（不会误触发）', () => {
    expect(matchOwner('1234567890123456789', '然酱丶重生版', '', '')).toBe(false);
  });
});

describe('事件库事件过滤（2026-11-21 修）', () => {
  it('只看 bilibili.* 前缀，不依赖 source 字段', async () => {
    const { isBilibiliEvent } = await import('../src/index.ts');
    expect(isBilibiliEvent({ type: 'bilibili.gift' })).toBe(true);
    expect(isBilibiliEvent({ type: 'bilibili.danmaku' })).toBe(true);
    expect(isBilibiliEvent({ type: 'qq.message' })).toBe(false);
    expect(isBilibiliEvent({ type: '' })).toBe(false);
    expect(isBilibiliEvent(null)).toBe(false);
  });
});
