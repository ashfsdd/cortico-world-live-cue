// 测试隔离：让舰长欢迎配额写进临时目录，别污染真实 state
process.env.COOPANION_DATA = mkdtempSync(join(tmpdir(), 'livecue-data-'));
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { DEFAULT_CONFIG, LiveCueWorld } from '../src/index.ts';

/**
 * 真·端到端：起一个本地 SSE 服务，让世界通过真实 fetch 订阅，
 * 再走「解析 → 过滤 → 去重 → 限频 → 推送」全链路，断言最终推给 agent 的事件。
 */

type Frame = { delayMs: number; payload: any };

function startSse(frames: Frame[]): Promise<{ url: string; server: Server }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (!req.url?.startsWith('/stream')) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(': hello\n\n');
      let t = 0;
      for (const f of frames) {
        t += f.delayMs;
        setTimeout(() => {
          try {
            res.write(`data: ${JSON.stringify(f.payload)}\n\n`);
          } catch {
            /* 客户端已断开 */
          }
        }, t);
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ url: `http://127.0.0.1:${port}/stream`, server });
    });
  });
}

const aud = (event: Record<string, any>) => ({ type: 'audience', event });

function makeHost() {
  const pushed: any[] = [];
  return {
    pushed,
    host: {
      pushEvent: async (e: any) => {
        pushed.push(e);
      },
      log: { info: () => {} },
    },
  };
}

let srv: Server | null = null;
afterEach(async () => {
  if (!srv) return;
  // SSE 是长连接，close() 会一直等；先把连接掐掉再关
  (srv as any).closeAllConnections?.();
  await new Promise<void>((r) => srv!.close(() => r()));
  srv = null;
});

describe('E2E：真实 SSE → 唤醒链路', () => {
  it('弹幕 / 礼物 / SC / 舰长进场 各走各的类型，重复的被挡', async () => {
    const frames: Frame[] = [
      { delayMs: 30, payload: aud({ eventKind: 'danmaku', username: '小杰', body: '小鲸鱼你在看吗', facts: {} }) },
      { delayMs: 120, payload: aud({ eventKind: 'gift', username: '守一', body: '粉丝团灯牌 ×10', facts: { price: 1000 } }) },
      { delayMs: 120, payload: aud({ eventKind: 'gift', username: '小美', body: '醒目留言 ¥30：这关到底怎么过', facts: { SUPER_CHAT_MESSAGE: true } }) },
      { delayMs: 120, payload: aud({ eventKind: 'enter', username: '老王', body: '', facts: { guardLevel: 2 } }) },
      // 与第一条完全相同 → 90 秒去重必须挡住
      { delayMs: 120, payload: aud({ eventKind: 'danmaku', username: '小杰', body: '小鲸鱼你在看吗', facts: {} }) },
    ];
    const { url, server } = await startSse(frames);
    srv = server;

    const { pushed, host } = makeHost();
    const w = new LiveCueWorld({
      cfg: { ...DEFAULT_CONFIG, streamUrl: url, scDelaySec: 1, useStoreEvents: false, chanceGapSec: 0, maxPerHour: 0, minUserLevel: 0, giftMergeSec: 0 },
    });
    await w.start(host);

    await vi.waitFor(() => expect(pushed.length).toBeGreaterThanOrEqual(4), { timeout: 6000 });
    await new Promise((r) => setTimeout(r, 400));

    const types = pushed.map((p) => p.type);
    expect(types).toContain('live.danmaku');
    expect(types).toContain('live.gift');
    expect(types).toContain('live.superchat');
    expect(types).toContain('live.enter');
    // 重复那条不推
    expect(pushed.length).toBe(4);

    // 礼物提示词带真实金额
    const gift = pushed.find((p) => p.type === 'live.gift');
    expect(gift.text).toContain('1 元');
    // SC 提示词带完整正文
    const sc = pushed.find((p) => p.type === 'live.superchat');
    expect(sc.text).toContain('这关到底怎么过');
    // 舰长进场带档位与仪式感要求
    const enter = pushed.find((p) => p.type === 'live.enter');
    expect(enter.text).toContain('提督');
    expect(enter.text).toContain('不要固定欢迎词');
    expect(enter.text).toContain('【现场】');

    await w.stop();
  }, 15000);
});

describe('E2E：事件库 → 唤醒链路', () => {
  it('host.store 里的 bilibili.gift 带金额进入必回通道', async () => {
    const { pushed } = makeHost();
    const envelopes = [
      {
        cursor: 1,
        type: 'bilibili.gift',
        source: 'bilibili',
        origin: 'external',
        contextDelivery: 'deliver',
        text: '[礼物 ¥5|小杰] 棒棒糖×1',
        meta: { uname: '小杰', gift: '棒棒糖', num: 1, yuan: 5, guardLevel: 0 },
      },
      {
        // 同一条的 archive-only 副本，必须忽略
        cursor: 2,
        type: 'bilibili.gift',
        source: 'bilibili',
        origin: 'external',
        contextDelivery: 'archive-only',
        text: '[礼物 ¥5|小杰] 棒棒糖×1',
        meta: { uname: '小杰', gift: '棒棒糖', num: 1, yuan: 5 },
      },
      {
        cursor: 3,
        type: 'bilibili.superchat',
        source: 'bilibili',
        origin: 'external',
        contextDelivery: 'deliver',
        text: '[醒目留言 ¥50|阿明] 想看主播再跳一次',
        meta: { uname: '阿明', yuan: 50 },
      },
    ];
    let latest = 0;
    const host = {
      pushEvent: async (e: any) => {
        pushed.push(e);
      },
      log: { info: () => {} },
      store: {
        latestCursor: () => latest,
        range: (q: any) => envelopes.filter((e) => e.cursor >= (q.fromCursor ?? 0) && e.cursor <= (q.toCursor ?? 0)),
      },
    };
    const w = new LiveCueWorld({
      cfg: { ...DEFAULT_CONFIG, streamUrl: 'http://127.0.0.1:1/stream', scDelaySec: 0, chanceGapSec: 0, giftMergeSec: 0 },
    });
    await w.start(host);
    // 世界启动时把游标定位在「当下」，之后新增的事件才处理——模拟直播进行中
    latest = envelopes.length;
    // 手动触发一次轮询（不等 1.2 秒定时器）
    (w as any).pollStore();

    await vi.waitFor(() => expect(pushed.length).toBe(2), { timeout: 3000 });
    const gift = pushed.find((p) => p.type === 'live.gift');
    expect(gift.text).toContain('5 元');
    expect(gift.text).toContain('棒棒糖');
    const sc = pushed.find((p) => p.type === 'live.superchat');
    expect(sc.text).toContain('想看主播再跳一次');
    await w.stop();
  }, 15000);
});
