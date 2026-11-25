import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG, classifyIntent, type LiveEvent } from '../src/index.ts';

const cfg = { ...DEFAULT_CONFIG, minUserLevel: 0 }; // 门槛单独在 filter.test 里测
const dm = (body: string, extra: Partial<LiveEvent> = {}): LiveEvent => ({
  kind: 'danmaku',
  username: '观众',
  body,
  ...extra,
});
const P = (ev: LiveEvent, c = cfg) => classifyIntent(ev, c);

describe('必回（P0）：100% 不受限频', () => {
  it('礼物达到门槛 → gift', () => {
    const r = P({ kind: 'gift', username: '小杰', body: '小心心', amount: 10 });
    expect(r.priority).toBe(0);
    expect(r.reason).toBe('gift');
  });

  it('门槛为 0 时所有礼物都必回（游戏道具 0.1 元也是玩法）', () => {
    const r = P({ kind: 'gift', username: '小杰', body: '辣条', amount: 0.1 }, { ...cfg, minGiftYuan: 0 });
    expect(r.priority).toBe(0);
    expect(r.reason).toBe('gift');
  });

  it('命中道具表的礼物即使 0 元（overlay 无金额）也必回（需显式打开开关）', () => {
    const r = P({ kind: 'gift', username: '小杰', body: '人气票 ×10', amount: 0 }, { ...cfg, gameGiftAlwaysReply: true });
    expect(r.priority).toBe(0);
    expect(r.reason).toBe('gift-game-item');
  });

  it('设了金额门槛 + 关掉 cheapGiftAsChance 时，非道具小额礼物不回', () => {
    const c = { ...cfg, minGiftYuan: 1, cheapGiftAsChance: false, gameGiftAlwaysReply: false };
    const r = P({ kind: 'gift', username: '小杰', body: '辣条', amount: 0.1 }, c);
    expect(r.priority).toBe(2);
    expect(r.reason).toBe('gift-below-threshold');
  });

  it('SC 开着 → superchat；关掉 → 不回', () => {
    expect(P({ kind: 'superchat', username: 'a', body: '问题', amount: 30 }).priority).toBe(0);
    const off = { ...cfg, replyOnSuperChat: false };
    expect(P({ kind: 'superchat', username: 'a', body: '问题' }, off).reason).toBe('sc-off');
  });

  it('上舰 → guard；关掉 → 不回', () => {
    expect(P({ kind: 'guard', username: 'a', body: '', guardName: '舰长' }).priority).toBe(0);
    const off = { ...cfg, replyOnGuard: false };
    expect(P({ kind: 'guard', username: 'a', body: '' }, off).reason).toBe('guard-off');
  });

  it('叫她名字 / @她 → 必回', () => {
    expect(P(dm('小鲸鱼在吗')).reason).toBe('at-or-keyword');
    expect(P(dm('@小鲸鱼 出来聊天')).reason).toBe('at-or-keyword');
  });

  it('舰长/房管的普通弹幕 → 必回', () => {
    expect(P(dm('今天播到几点', { guardLevel: 3 })).reason).toBe('guard-admin');
    expect(P(dm('这游戏真难', { isAdmin: true })).reason).toBe('guard-admin');
  });
});

describe('不回（P2）：过滤层', () => {
  it('纯 B站表情（[米饭]）→ 机会型，不再是噪声丢弃', () => {
    const r = P(dm('[米饭]'), { ...cfg, replyEmoteOnly: true });
    expect(r.priority).toBe(1);
    expect(r.reason).toBe('emote');
  });

  it('关掉 replyEmoteOnly 后纯表情仍被过滤', () => {
    const c = { ...cfg, replyEmoteOnly: false };
    expect(P(dm('[米饭]'), c).reason).toBe('noise');
  });

  it('她自己的弹幕（B站回声）→ 不回，避免自问自答', () => {
    expect(P(dm('铛——提督上座！', { username: '然家小鲸鱼' })).reason).toBe('self-echo');
    expect(P(dm('铛——提督上座！', { username: '然家小鲸鱼' })).priority).toBe(2);
  });

  it('屏蔽名单里的人 → 不回', () => {
    const c = { ...cfg, blockUsers: '捣乱的家伙' };
    expect(P(dm('小鲸鱼在吗', { username: '一个捣乱的家伙' }), c).reason).toBe('blocked-user');
  });

  it('噪声：纯数字 / 纯表情', () => {
    expect(P(dm('666')).reason).toBe('noise');
    expect(P(dm('😂😂😂')).reason).toBe('noise');
  });

  it('不友善：辱骂直接不理（舰长也不豁免）', () => {
    expect(P(dm('主播傻逼')).reason).toBe('hostile');
    expect(P(dm('主播傻逼', { guardLevel: 3 })).priority).toBe(2);
  });

  it('说给别人：@别人 / 点名对话 → 不插话', () => {
    expect(P(dm('@小杰 你吃饭了吗')).reason).toBe('peer-chat');
    expect(P(dm('小杰 你来了')).reason).toBe('peer-chat');
  });

  it('没点名她、也不是问句 → 不回', () => {
    expect(P(dm('哈哈哈')).reason).toBe('not-for-her');
  });

  it('机会回应关掉后，问句也不回', () => {
    const off = { ...cfg, chanceGapSec: 0 };
    expect(P(dm('今天播到几点'), off).reason).toBe('not-for-her');
  });
});

describe('机会型（P1）：受间隔约束', () => {
  it('没点名她的问句 → question', () => {
    expect(P(dm('今天播到几点')).reason).toBe('question');
  });

  it('有内容的闲聊 → chatty', () => {
    expect(P(dm('这游戏我昨天也卡在这一关')).reason).toBe('chatty');
  });
});
