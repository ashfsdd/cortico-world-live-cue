import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_CONFIG, LiveCueWorld } from '../src/index.ts';

/** 同 routing.test 的脚手架：拦住 pushEvent，看看到底推了几次 */
function makeWorld(over: Partial<any> = {}) {
  const cfg = { ...DEFAULT_CONFIG, gapSec: 0, chanceGapSec: 90, maxPerHour: 0, minUserLevel: 0, giftMergeSec: 1, sameUserGapSec: 0, ...over };
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

const gift = (username: string, body: string) => ({
  eventKind: 'gift',
  username,
  body,
  facts: { giftName: body, price: 1000 },
});

describe('礼物合并窗口', () => {
  it('窗口内的多个礼物只叫一次模型，数量合并正确', async () => {
    const { pushed, feed } = makeWorld();
    feed(gift('小杰', '人气票 ×3'));
    feed(gift('小美', '鼓掌声'));
    expect(pushed.length).toBe(0); // 窗口内不推
    await vi.waitFor(() => expect(pushed.length).toBe(1), { timeout: 3000 });
    expect(pushed[0].type).toBe('live.gift');
    expect(pushed[0].text).toContain('人气票×3');
    expect(pushed[0].text).toContain('鼓掌声');
    expect(pushed[0].text).toContain('2 人'); // 两位送礼人合并成一条
  });

  it('窗口外的新礼物另起一次', async () => {
    const { pushed, feed } = makeWorld();
    feed(gift('小杰', '人气票'));
    await vi.waitFor(() => expect(pushed.length).toBe(1), { timeout: 3000 });
    feed(gift('小美', '冰晶吊坠'));
    await vi.waitFor(() => expect(pushed.length).toBe(2), { timeout: 3000 });
  });

  it('关掉合并（giftMergeSec=0）时每个礼物各推一次', async () => {
    const { pushed, feed } = makeWorld({ giftMergeSec: 0 });
    feed(gift('小杰', '人气票'));
    feed(gift('小美', '鼓掌声'));
    await vi.waitFor(() => expect(pushed.length).toBe(2), { timeout: 3000 });
  });

  it('单个 0.1 元不到门槛 → 不回、不推给模型', async () => {
    const { pushed, feed } = makeWorld({ minGiftYuan: 1, cheapGiftAsChance: false });
    feed({ eventKind: 'gift', username: '小杰', body: '辣条', facts: { giftName: '辣条', price: 100 } });
    await new Promise((r) => setTimeout(r, 2200));
    expect(pushed.length).toBe(0);
  });

  it('同一窗口内 10 个 0.1 元合并成 1 元 → 达门槛，照常必回', async () => {
    const { pushed, feed } = makeWorld({ minGiftYuan: 1, cheapGiftAsChance: false, giftMergeSec: 2 });
    for (let i = 0; i < 10; i += 1) {
      feed({ eventKind: 'gift', username: '小杰', body: '辣条', facts: { giftName: '辣条', price: 100 } });
    }
    // 核心：10 个 0.1 元累积成 1 元，能过门槛并只唤醒一次（文本格式另测）
    await vi.waitFor(() => expect(pushed.length).toBe(1), { timeout: 8000 });
  }, 15000);
});
