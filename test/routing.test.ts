import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_CONFIG, LiveCueWorld } from '../src/index.ts';

/** 造一个世界实例，拦住 pushEvent，方便断言「到底推没推」 */
function makeWorld(over: Partial<any> = {}) {
  const cfg = { ...DEFAULT_CONFIG, gapSec: 0, chanceGapSec: 90, maxPerHour: 0, scDelaySec: 0, minUserLevel: 0, giftMergeSec: 0, ...over };
  const w = new LiveCueWorld({ cfg });
  const pushed: any[] = [];
  (w as any).host = {
    pushEvent: async (e: any) => {
      pushed.push(e);
    },
    log: { info: () => {} },
  };
  const feed = (event: Record<string, any>) =>
    (w as any).onChunk('data: ' + JSON.stringify({ type: 'audience', event }));
  return { w, pushed, feed };
}

const dm = (body: string, facts: Record<string, any> = {}) => ({
  eventKind: 'danmaku',
  username: '小杰',
  body,
  facts,
});

describe('路由层：必回项一定推', () => {
  it('叫她名字 → 推', async () => {
    const { pushed, feed } = makeWorld();
    feed(dm('小鲸鱼在吗'));
    await vi.waitFor(() => expect(pushed.length).toBe(1));
    expect(pushed[0].type).toBe('live.danmaku');
  });

  it('礼物达门槛 → 推', async () => {
    const { pushed, feed } = makeWorld();
    feed({ eventKind: 'gift', username: '小杰', body: '小心心', facts: { price: 10000 } });
    await vi.waitFor(() => expect(pushed.length).toBe(1));
    expect(pushed[0].type).toBe('live.gift');
  });

  it('SC / 上舰 → 推', async () => {
    const { pushed, feed } = makeWorld();
    feed({ eventKind: 'gift', username: 'a', body: '醒目留言：问个问题', facts: { price: 30000 } });
    feed({ eventKind: 'gift', username: 'b', body: '开通了舰长', facts: {} });
    await vi.waitFor(() => expect(pushed.length).toBeGreaterThanOrEqual(1));
    expect(pushed.some((p) => p.type === 'live.superchat')).toBe(true);
  });
});

describe('路由层：该过滤的一条都不推', () => {
  it('普通闲聊 → 不推', async () => {
    const { pushed, feed } = makeWorld();
    feed(dm('哈哈哈'));
    await new Promise((r) => setTimeout(r, 30));
    expect(pushed.length).toBe(0);
  });

  it('@别人 → 不推', async () => {
    const { pushed, feed } = makeWorld();
    feed(dm('@小杰 你吃饭了吗'));
    await new Promise((r) => setTimeout(r, 30));
    expect(pushed.length).toBe(0);
  });

  it('辱骂 → 不推（舰长也不豁免）', async () => {
    const { pushed, feed } = makeWorld();
    feed(dm('主播傻逼', { guardLevel: 3 }));
    await new Promise((r) => setTimeout(r, 30));
    expect(pushed.length).toBe(0);
  });

  it('30 秒内连发同一句 → 只推一次', async () => {
    const { pushed, feed } = makeWorld();
    feed(dm('小鲸鱼在吗'));
    feed(dm('小鲸鱼在吗'));
    await vi.waitFor(() => expect(pushed.length).toBe(1));
  });
});

describe('限频开关', () => {
  it('gapSec = 0 时不限频（两条必回都能推）', async () => {
    const { pushed, feed } = makeWorld({ gapSec: 0 });
    feed(dm('小鲸鱼在吗'));
    // 换一个人：同一个人 20 秒内只回一条是另一条防刷规则
    feed({ eventKind: 'danmaku', username: '阿明', body: '鱼宝 出来', facts: {} });
    await vi.waitFor(() => expect(pushed.length).toBe(2));
  });
});
