// 测试隔离：让舰长欢迎配额写进临时目录，别污染真实 state
process.env.COOPANION_DATA = mkdtempSync(join(tmpdir(), 'livecue-data-'));
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_CONFIG,
  LiveCueWorld,
  fromStoreEvent,
  clipDanmaku,
  stripScPrefix,
  pickCount,
  pickStyle,
  buildPrompt,
  replyLimit,
  loadWelcomeState,
  welcomeQuotaLeft,
  isRateLimitCode,
  displayWidth,
  isGameCommand,
  classifyIntent,
} from '../src/index.ts';

const cfg = DEFAULT_CONFIG;

function makeWorld(over: Partial<any> = {}) {
  const c = { ...DEFAULT_CONFIG, gapSec: 0, chanceGapSec: 0, maxPerHour: 0, scDelaySec: 0, ...over };
  const w = new LiveCueWorld({ cfg: c });
  const pushed: any[] = [];
  (w as any).host = {
    pushEvent: async (e: any) => {
      pushed.push(e);
    },
    log: { info: () => {} },
  };
  return { w, pushed };
}

describe('事件库事件翻译（礼物 / SC / 上舰 的真实金额）', () => {
  it('礼物带 meta.yuan，金额不再丢', () => {
    const ev = fromStoreEvent({
      type: 'bilibili.gift',
      contextDelivery: 'deliver',
      text: '[礼物 ¥1|守***] 粉丝团灯牌×10',
      meta: { uname: '守***', gift: '粉丝团灯牌', num: 10, yuan: 1, guardLevel: 0 },
    });
    expect(ev).toMatchObject({ kind: 'gift', username: '守', body: '粉丝团灯牌', count: 10, amount: 1 });
  });

  it('SC 正文去掉「[醒目留言 ¥30|某人]」前缀，保留完整内容', () => {
    const ev = fromStoreEvent({
      type: 'bilibili.superchat',
      contextDelivery: 'deliver',
      text: '[醒目留言 ¥30|小杰] 主播能教我这一关怎么过吗，卡了三天了',
      meta: { uname: '小杰', yuan: 30 },
    });
    expect(ev?.kind).toBe('superchat');
    expect(ev?.amount).toBe(30);
    expect(ev?.body).toBe('主播能教我这一关怎么过吗，卡了三天了');
  });

  it('上舰带 role 与等级', () => {
    const ev = fromStoreEvent({
      type: 'bilibili.guard',
      contextDelivery: 'deliver',
      text: '[上舰 ¥198|小美] 开通了 舰长×1',
      meta: { uname: '小美', gift: '舰长', num: 1, yuan: 198 },
    });
    expect(ev).toMatchObject({ kind: 'guard', guardName: '舰长', amount: 198 });
    expect(ev?.guardLevel).toBe(3);
  });

  it('舰长进场从文案里认出身份', () => {
    const ev = fromStoreEvent({
      type: 'bilibili.enter-guard',
      contextDelivery: 'deliver',
      text: '[进场] 欢迎提督 老王 进入直播间',
      meta: { uid: 123 },
    });
    expect(ev?.kind).toBe('enter');
    expect(ev?.username).toBe('老王');
    expect(ev?.guardLevel).toBe(2);
  });

  it('弹幕的 archive-only 副本不处理（避免双回）', () => {
    expect(fromStoreEvent({ type: 'bilibili.danmaku', contextDelivery: 'archive-only', meta: {} })).toBeNull();
    expect(fromStoreEvent({ type: 'bilibili.audience', contextDelivery: 'archive-only', meta: {} })).toBeNull();
  });

  it('礼物 / SC / 上舰的 archive-only 存档要处理（B站插件 modelFeed=false 的契约）', () => {
    const ev = fromStoreEvent({
      type: 'bilibili.gift',
      contextDelivery: 'archive-only',
      text: '人气票',
      meta: { uname: '小杰', gift: '人气票', num: 3, yuan: 0.3 },
    });
    expect(ev).toMatchObject({ kind: 'gift', username: '小杰', body: '人气票', count: 3 });
    expect(fromStoreEvent({ type: 'bilibili.superchat', contextDelivery: 'archive-only', text: '[醒目留言] 你好', meta: { uname: 'A', yuan: 30 } }))
      .toMatchObject({ kind: 'superchat', amount: 30 });
    expect(fromStoreEvent({ type: 'bilibili.guard', contextDelivery: 'archive-only', text: '舰长', meta: { uname: 'B', gift: '舰长' } }))
      .toMatchObject({ kind: 'guard' });
  });

  it('不认识的事件类型返回 null', () => {
    expect(fromStoreEvent({ type: 'bilibili.danmaku', meta: {} })).toBeNull();
  });
});

describe('舰长进场欢迎：每次不同 + 每人每天限次', () => {
  it('舰队等级映射成档位名', () => {
    const ev = (lvl: number) => classifyIntent({ kind: 'enter', username: 'a', body: '', guardLevel: lvl }, cfg);
    expect(ev(3).reason).toBe('guard-enter');
    expect(ev(3).priority).toBe(0);
    // 关掉开关后退回普通进场逻辑
    const off = { ...cfg, guardWelcome: false };
    expect(classifyIntent({ kind: 'enter', username: 'a', body: '', guardLevel: 3 }, off).reason).not.toBe('guard-enter');
  });

  it('同日同人超额后降级为机会型', async () => {
    const { w, pushed } = makeWorld({ guardWelcomePerDay: 1 });
    const feed = (name: string) =>
      (w as any).onChunk('data: ' + JSON.stringify({
        type: 'audience',
        event: { eventKind: 'enter', username: name, body: '', facts: { guardLevel: 3 } },
      }));
    feed('舰长甲');
    await vi.waitFor(() => expect(pushed.length).toBe(1));
    expect(pushed[0].type).toBe('live.enter');
    // 同一人再进（换掉 90 秒去重键里的时间不可能，所以直接查配额函数）
    expect(welcomeQuotaLeft((w as any).welcomeState, '舰长甲', 1)).toBe(false);
    expect(welcomeQuotaLeft((w as any).welcomeState, '舰长乙', 1)).toBe(true);
  });

  it('perDay = 0 时不限次数', () => {
    const state = { date: '2026-11-05', seq: 9, counts: { 甲: 99 } };
    expect(welcomeQuotaLeft(state, '甲', 0)).toBe(true);
  });

  it('跨天自动清零', () => {
    const dir = mkdtempSync(join(tmpdir(), 'livecue-'));
    const file = join(dir, 'guard-welcome.json');
    writeFileSync(file, JSON.stringify({ date: '2026-11-04', seq: 5, counts: { 甲: 3 } }), 'utf8');
    const st = loadWelcomeState(file, '2026-11-05');
    expect(st.counts).toEqual({});
    expect(st.seq).toBe(0);
  });

  it('欢迎风格按序号轮换，不重复', () => {
    const c = { ...cfg, guardWelcomeStyles: '锣鼓开场,点名报到,点灯上座' };
    const picked = [0, 1, 2, 3].map((i) => pickStyle(c, i));
    expect(picked).toEqual(['锣鼓开场', '点名报到', '点灯上座', '锣鼓开场']);
  });

  it('舰长进场提示词带名次、风格，并要求别复读', () => {
    const p = buildPrompt(
      { kind: 'enter', username: '老王', body: '', guardLevel: 2 },
      { priority: 0, reason: 'guard-enter', addressed: false, question: false, hostile: false, peerChat: false },
      cfg,
      { guardOrdinal: 3, guardTimesToday: 1, style: '点灯上座', recent: ['欢迎欢迎'] },
    );
    expect(p).toContain('提督');
    expect(p).toContain('老王');
    expect(p).toContain('点灯上座');
    expect(p).toContain('第 3 位');
    expect(p).toContain('别换个说法');
  });
});

describe('SC：整条读完再回', () => {
  it('SC 正文完整进入提示词，不被截断', () => {
    const long = '主播我想问一下这个游戏第二关那个会飞的怪到底怎么打，我每次都在那里死';
    const p = buildPrompt({ kind: 'superchat', username: '小杰', body: long, amount: 30 }, undefined, cfg);
    expect(p).toContain(long);
    expect(p).toContain('先');
    expect(p).toContain('30');
  });

  it('delay > 0 时延时推送，0 时立即推', async () => {
    const { w, pushed } = makeWorld({ scDelaySec: 1 });
    (w as any).onChunk('data: ' + JSON.stringify({
      type: 'audience',
      event: {
        eventKind: 'gift',
        username: '小杰',
        body: '醒目留言 ¥30：问个问题',
        facts: { SUPER_CHAT_MESSAGE: true, price: 30000 },
      },
    }));
    expect(pushed.length).toBe(0);
    await vi.waitFor(() => expect(pushed.length).toBe(1), { timeout: 3000 });
    expect(pushed[0].type).toBe('live.superchat');
  });
});

describe('弹幕字数上限', () => {
  it('短句原样返回', () => {
    expect(clipDanmaku('这波操作太顶了', 20)).toBe('这波操作太顶了');
  });

  it('超长在标点处断开，不补省略号', () => {
    const s = '主播这个操作是真的离谱，我看你走了三次都没过去，笑死我了';
    const out = clipDanmaku(s, 20);
    expect(Array.from(out).length).toBeLessThanOrEqual(20);
    expect(out).not.toContain('…');
    expect(out.endsWith('，')).toBe(false);
  });

  it('需要截断时顺手去掉 emoji（B站对 emoji 计数不稳）', () => {
    const out = clipDanmaku('笑死😂😂这也能输的吗我真的服了你这个操作太顶了', 20);
    expect(Array.from(out).length).toBeLessThanOrEqual(20);
    expect(out).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('没超长时保留原文（不误删表情）', () => {
    expect(clipDanmaku('笑死😂😂', 20)).toBe('笑死😂😂');
  });

  it('提示词字数按弹幕上限收紧（B站实测 80 字）', () => {
    expect(replyLimit({ ...cfg, sendDanmaku: true, replyMaxChars: 60, danmakuMaxLen: 80 })).toBe(60);
    expect(replyLimit({ ...cfg, sendDanmaku: true, replyMaxChars: 120, danmakuMaxLen: 80 })).toBe(80);
    expect(replyLimit({ ...cfg, sendDanmaku: false, replyMaxChars: 60 })).toBe(60);
  });
});

describe('B站弹幕长度：按半角位算', () => {
  it('中文/全角标点/emoji 各占 2 位，英文数字半角标点各占 1 位', () => {
    expect(displayWidth('测')).toBe(2);
    expect(displayWidth('a')).toBe(1);
    expect(displayWidth('1')).toBe(1);
    expect(displayWidth(',')).toBe(1);
    expect(displayWidth('，')).toBe(2);
    expect(displayWidth('🐳')).toBe(2);
    expect(displayWidth('测'.repeat(40))).toBe(80);
    expect(displayWidth('a'.repeat(80))).toBe(80);
  });

  it('40 汉字 = 80 位刚好不超；41 汉字就超', () => {
    expect(clipDanmaku('测'.repeat(40), 80)).toBe('测'.repeat(40));
    expect(displayWidth(clipDanmaku('测'.repeat(41), 80))).toBeLessThanOrEqual(80);
  });

  it('中英混排按位累加，不会腰斩半个词', () => {
    const out = clipDanmaku('abc' + '测'.repeat(39), 80);
    expect(displayWidth(out)).toBeLessThanOrEqual(80);
    expect(out.startsWith('abc')).toBe(true);
  });
});

describe('猫猫养成指令拦截', () => {
  const c = cfg;
  it('单字指令与带数字指令都识别', () => {
    for (const t of ['喵', '修炼', '查询', '背包', '左3', '右9', '购买12', '买入3', '召唤喵娘', '发神金2', '滚月饼', '猫猫冲撞']) {
      expect(isGameCommand(t, c)).toBe(true);
    }
  });

  it('正常聊天不误伤', () => {
    for (const t of ['左边那个小孩怎么又掉下去了', '主播查询一下这关怎么过', '我买了个键盘', '喵喵好可爱']) {
      expect(isGameCommand(t, c)).toBe(false);
    }
  });
});

describe('开播 / 下播播报', () => {
  it('开播事件 → 推一条 live.notice，带直播间地址与游戏名', async () => {
    const { w, pushed } = makeWorld({ autoLiveNotice: true, liveNoticeTarget: '123456789' });
    (w as any).handleEvent({ kind: 'room', username: '', body: '[直播间] 平台已推送开播指令:直播画面已对观众可见' }, 'store');
    await vi.waitFor(() => expect(pushed.length).toBe(1), { timeout: 2000 });
    expect(pushed[0].type).toBe('live.notice');
    expect(pushed[0].text).toContain('live.bilibili.com');
    expect(pushed[0].text).toContain('at_all');
    expect(pushed[0].text).toContain('123456789');
    expect(pushed[0].text).toContain('本局游戏');
  });

  it('连续两条开播只播一次；下播紧随其后被间隔挡住', async () => {
    const { w, pushed } = makeWorld({ autoLiveNotice: true, liveNoticeGapSec: 1800 });
    const room = (t: string) => (w as any).handleEvent({ kind: 'room', username: '', body: t }, 'store');
    room('[直播间] 平台已推送开播指令:直播画面已对观众可见');
    room('[直播间] 平台已推送开播指令:直播画面已对观众可见');
    room('[直播间] 平台已推送下播指令:直播已结束');
    await new Promise((r) => setTimeout(r, 80));
    expect(pushed.length).toBe(1);
  });

  it('关掉开关就一条都不发', async () => {
    const { w, pushed } = makeWorld({ autoLiveNotice: false });
    (w as any).handleEvent({ kind: 'room', username: '', body: '[直播间] 平台已推送开播指令' }, 'store');
    await new Promise((r) => setTimeout(r, 60));
    expect(pushed.length).toBe(0);
  });
});

describe('SC / 礼物 文本小工具', () => {
  it('stripScPrefix 去前缀', () => {
    expect(stripScPrefix('醒目留言 ¥30：内容在这')).toBe('内容在这');
    expect(stripScPrefix('就是普通一句话')).toBe('就是普通一句话');
  });

  it('pickCount 读数量', () => {
    expect(pickCount('粉丝团灯牌 ×10')).toBe(10);
    expect(pickCount('小心心')).toBe(1);
  });

  it('风控码识别', () => {
    expect(isRateLimitCode(10031)).toBe(true);
    expect(isRateLimitCode(-101)).toBe(true);
    expect(isRateLimitCode(123, '发送太频繁')).toBe(true);
    expect(isRateLimitCode(0)).toBe(false);
  });
});
