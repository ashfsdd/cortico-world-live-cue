import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  saveReport, loadReport, listReports, pickPendingReport, buildReportText, looksSafe, stripKaomoji,
  type DailyReport,
} from '../src/report-store.ts';

function mk(over: Partial<DailyReport> = {}): DailyReport {
  return {
    dayKey: '2026-11-20',
    startedAt: new Date('2026-11-20T00:01:00+08:00').getTime(),
    endedAt: new Date('2026-11-20T03:16:00+08:00').getTime(),
    top: [
      { name: '了梦无殇', yuan: 29.8, count: 3 },
      { name: '臭团团', yuan: 19.9, count: 1 },
    ],
    stats: { danmaku: 206, gifts: 53, guards: 0, viewers: 1151 },
    posted: false,
    ...over,
  };
}

describe('前一天战报：重复发布防护', () => {
  it('发过的（posted=true）不会再被挑中', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rep-'));
    const r = mk();
    saveReport(dir, r);
    const next = new Date('2026-11-21T00:01:00+08:00').getTime();
    expect(pickPendingReport(listReports(dir), next)?.dayKey).toBe('2026-11-20');

    saveReport(dir, { ...r, posted: true, postedAt: Date.now(), dynamicId: '123' });
    expect(pickPendingReport(listReports(dir), next)).toBeNull();
  });

  it('只挑比本场更早的；比本场晚的不发', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rep2-'));
    saveReport(dir, mk({ dayKey: '2026-11-20' }));
    const before = new Date('2026-11-20T00:00:00+08:00').getTime();
    expect(pickPendingReport(listReports(dir), before)).toBeNull();
  });

  it('发失败（lastError）不会被误标成已发，下次还会重试', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rep3-'));
    saveReport(dir, mk({ lastError: 'CLI 超时' }));
    const next = new Date('2026-11-21T00:01:00+08:00').getTime();
    const p = pickPendingReport(listReports(dir), next);
    expect(p).not.toBeNull();
    expect(p!.lastError).toBe('CLI 超时');
  });

  it('多份待发时，挑最近那一场', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rep4-'));
    saveReport(dir, mk({ dayKey: '2026-11-18', endedAt: new Date('2026-11-18T03:00:00+08:00').getTime() }));
    saveReport(dir, mk({ dayKey: '2026-11-19', endedAt: new Date('2026-11-19T03:00:00+08:00').getTime() }));
    const next = new Date('2026-11-21T00:01:00+08:00').getTime();
    expect(pickPendingReport(listReports(dir), next)?.dayKey).toBe('2026-11-19');
  });
});

describe('战报文案', () => {
  it('只有名字/名次/数据，没有金额字眼', () => {
    const t = buildReportText(mk());
    expect(t).toContain('🏆昨日MVP：🥇@了梦无殇');
    expect(t).toContain('弹幕 206');
    expect(t).not.toMatch(/¥|元/);
    expect(looksSafe(t)).toBe(true);
  });

  it('不写具体开播时间（只有「今晚继续」）', () => {
    const t = buildReportText(mk());
    expect(t).not.toMatch(/九点|21:00|明天.*点/);
  });

  it('模板里手滑写了金额会被 looksSafe 拦下', () => {
    expect(looksSafe('今晚多谢 ¥30')).toBe(false);
    expect(looksSafe('他打赏了 30 元')).toBe(false);
  });
});

describe('战报读写', () => {
  it('落盘 → 读回一致；坏文件返 null 不崩', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rep5-'));
    saveReport(dir, mk());
    expect(loadReport(dir, '2026-11-20')?.stats.danmaku).toBe(206);
    expect(loadReport(dir, '2026-11-19')).toBeNull();
  });
});

describe('战报文案：动态化（2026-11-20 改）', () => {
  it('带最大一笔事件 + 链接，且仍然没有金额', () => {
    const t = buildReportText(
      mk({ stats: { danmaku: 320, gifts: 60, guards: 1, viewers: 1200, likes: 2487 } }),
      { maxGifter: '臭团团', maxGiftName: '钻石戒指', peakViewers: 1200, guardNames: ['新舰长A'] },
      { liveUrl: 'https://live.bilibili.com/123456' },
    );
    expect(t).toContain('昨晚最猛的一波是臭团团的钻石戒指');
    expect(t).toContain('⚓️欢迎新舰长 @新舰长A');
    expect(t).toContain('📣');
    expect(t).toContain('https://live.bilibili.com/123456');
    expect(t).not.toMatch(/¥|元/);
    expect(looksSafe(t)).toBe(true);
  });

  it('数据平淡时不硬凑「炸了」，标题回到简洁版', () => {
    const t = buildReportText(mk());
    expect(t).toContain('📣 11/20【昨日战报】');
    expect(t).not.toContain('⚓️');
  });
});

describe('发 B站前的清洗（2026-11-21 加）', () => {
  it('emoji 和颜文字都去掉，正文不受影响', () => {
    const t = stripKaomoji('📣 11/20 昨日战报\n😵 昨晚好猛 (｡･ω･｡) 真的\n🐳 今晚继续');
    expect(t).toContain('📣');
    expect(t).not.toContain('(｡･ω･｡)');
    expect(t).toContain('11/20 昨日战报');
    expect(t).toContain('真的');
  });

  it('正常括号里的中文不被误删', () => {
    expect(stripKaomoji('来了三个（都是舰长）')).toContain('（都是舰长）');
  });
});

describe('战报话术轮换（2026-11-21 加）', () => {
  it('不同日期生成不同文案，不是固定模板复读', () => {
    const days = ['2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'];
    const texts = days.map((d) => buildReportText(mk({ dayKey: d }), {}, {}));
    const uniq = new Set(texts);
    expect(uniq.size).toBeGreaterThan(1);   // 至少两种说法
  });

  it('同一天生成的结果稳定（可测、可复现）', () => {
    const a = buildReportText(mk({ dayKey: '2026-11-21' }), {}, {});
    const b = buildReportText(mk({ dayKey: '2026-11-21' }), {}, {});
    expect(a).toBe(b);
  });
});
