import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CONFIG,
  shouldReply,
  isPureNumber,
  isPureEmoji,
  isSpam,
  type LiveEvent,
} from '../src/index.ts';

const cfg = { ...DEFAULT_CONFIG, minUserLevel: 0 }; // 门槛用例在下面单独设值
const dm = (body: string, extra: Partial<LiveEvent> = {}): LiveEvent => ({
  kind: 'danmaku',
  username: '测试',
  body,
  ...extra,
});

describe('isPureNumber', () => {
  it('666 / 233 / 123456 是纯数字', () => {
    expect(isPureNumber('666')).toBe(true);
    expect(isPureNumber('233')).toBe(true);
    expect(isPureNumber('123456')).toBe(true);
  });

  it('带文字的不是', () => {
    expect(isPureNumber('666啊')).toBe(false);
    expect(isPureNumber('主播6')).toBe(false);
  });

  it('空串不是', () => {
    expect(isPureNumber('')).toBe(false);
    expect(isPureNumber('   ')).toBe(false);
  });
});

describe('isPureEmoji', () => {
  it('纯 emoji 是', () => {
    expect(isPureEmoji('😂😂😂')).toBe(true);
    expect(isPureEmoji('🎉')).toBe(true);
    expect(isPureEmoji('👍👍')).toBe(true);
  });

  it('纯符号是', () => {
    expect(isPureEmoji('？？？')).toBe(true);
    expect(isPureEmoji('！！！')).toBe(true);
    expect(isPureEmoji('...')).toBe(true);
  });

  it('带文字的不是', () => {
    expect(isPureEmoji('哈哈哈😂')).toBe(false);
    expect(isPureEmoji('好耶🎉')).toBe(false);
  });

  it('带数字的不是', () => {
    expect(isPureEmoji('666😂')).toBe(false);
  });
});

describe('isSpam', () => {
  it('同一字符连刷是刷屏', () => {
    expect(isSpam('6666666')).toBe(true);
    expect(isSpam('哈哈哈哈哈哈')).toBe(true);
    expect(isSpam('aaaaaaaa')).toBe(true);
  });

  it('超长是刷屏', () => {
    expect(isSpam('啊'.repeat(130))).toBe(true);
  });

  it('字符种类极少但很长是刷屏', () => {
    expect(isSpam('啊啊啊啊啊啊啊')).toBe(true);
  });

  it('正常短句不是', () => {
    expect(isSpam('主播这操作建议投稿')).toBe(false);
    expect(isSpam('今天播到几点')).toBe(false);
  });
});

describe('shouldReply —— 屏蔽开关', () => {
  it('纯数字被屏蔽（默认开）', () => {
    expect(shouldReply(dm('666'), cfg)).toBe(false);
    expect(shouldReply(dm('123456'), cfg)).toBe(false);
  });

  it('关掉 blockPureNumber 后纯数字仍被"必须有文字"规则拦', () => {
    // 屏蔽开关只是第一道；后面还有「必须含中文/英文」的要求
    const c = { ...cfg, blockNoise: false };
    expect(shouldReply(dm('12345678'), c)).toBe(false);
  });

  it('纯表情被屏蔽（默认开）', () => {
    expect(shouldReply(dm('😂😂😂'), cfg)).toBe(false);
    expect(shouldReply(dm('？？？'), cfg)).toBe(false);
  });

  it('刷屏被屏蔽（默认开）', () => {
    expect(shouldReply(dm('6666666'), cfg)).toBe(false);
    expect(shouldReply(dm('哈哈哈哈哈哈'), cfg)).toBe(false);
  });

  it('关掉 blockSpam 后长重复句（带文字、够长）能过', () => {
    const c = { ...cfg, blockNoise: false };
    // 8 个字、含中文、重复只有 5 连（不到 6 连）→ 不算 spam
    expect(shouldReply(dm('哈哈哈哈哈真搞笑'), c)).toBe(true);
  });

  it('正常问句不受影响', () => {
    expect(shouldReply(dm('今天播到几点？'), cfg)).toBe(true);
  });
});

describe('shouldReply —— 舰长/管理员同样受过滤（优先只影响排队）', () => {
  it('舰长的纯数字弹幕也会被过滤', () => {
    expect(shouldReply(dm('666', { guardLevel: 3 }), cfg)).toBe(false);
  });

  it('提督/总督的纯数字也拦', () => {
    expect(shouldReply(dm('666', { guardLevel: 2 }), cfg)).toBe(false);
    expect(shouldReply(dm('666', { guardLevel: 1 }), cfg)).toBe(false);
  });

  it('管理员的纯表情也拦', () => {
    expect(shouldReply(dm('😂😂😂', { isAdmin: true }), cfg)).toBe(false);
  });

  it('但舰长说正常内容照样能过', () => {
    expect(shouldReply(dm('主播这个操作真离谱', { guardLevel: 3 }), cfg)).toBe(true);
  });

  it('管理员的刷屏也拦', () => {
    expect(shouldReply(dm('哈哈哈哈哈哈', { isAdmin: true }), cfg)).toBe(false);
  });

  it('普通观众的纯数字还是被屏蔽', () => {
    expect(shouldReply(dm('666', { guardLevel: 0 }), cfg)).toBe(false);
  });
});

describe('shouldReply —— 用户等级门槛', () => {
  it('minUserLevel=0 时不限等级', () => {
    const c = { ...cfg, minUserLevel: 0 };
    expect(shouldReply(dm('主播这个操作真离谱', { userLevel: 0 }), c)).toBe(true);
  });

  it('minUserLevel=10 时，等级 5 被屏蔽', () => {
    const c = { ...cfg, minUserLevel: 10 };
    expect(shouldReply(dm('主播这个操作真离谱', { userLevel: 5 }), c)).toBe(false);
  });

  it('minUserLevel=10 时，等级 15 通过', () => {
    const c = { ...cfg, minUserLevel: 10 };
    expect(shouldReply(dm('主播这个操作真离谱', { userLevel: 15 }), c)).toBe(true);
  });

  it('等级门槛对礼物/SC/上舰不生效（只拦弹幕）', () => {
    const c = { ...cfg, minUserLevel: 50 };
    expect(shouldReply({ kind: 'gift', username: 'A', body: '火箭', amount: 100, userLevel: 1 }, c)).toBe(true);
    expect(shouldReply({ kind: 'superchat', username: 'A', body: '问个事', amount: 30, userLevel: 1 }, c)).toBe(true);
  });

  // 2026-11-20 改：门槛只拦「普通观众」。舰长/房管是付费与职务身份，
  // 按产品口径豁免（见 isBelowLevelGate），不然大航海说话她装看不见。
  it('舰长不受等级门槛限制（豁免）', () => {
    const c = { ...cfg, minUserLevel: 50 };
    expect(shouldReply(dm('主播这个操作真离谱', { userLevel: 1, guardLevel: 3 }), c)).toBe(true);
  });

  it('管理员不受等级门槛限制（豁免）', () => {
    const c = { ...cfg, minUserLevel: 50 };
    expect(shouldReply(dm('注意点这个操作', { userLevel: 1, isAdmin: true }), c)).toBe(true);
  });

  it('普通观众仍被等级门槛拦住（豁免不是失效）', () => {
    const c = { ...cfg, minUserLevel: 50 };
    expect(shouldReply(dm('路过看看', { userLevel: 1 }), c)).toBe(false);
  });
});

describe('shouldReply —— 礼物不受屏蔽影响', () => {
  it('小礼物仍按金额门槛判断（不受刷屏屏蔽影响）', () => {
    const ev: LiveEvent = { kind: 'gift', username: 'A', body: '666666', amount: 10 };
    expect(shouldReply(ev, cfg)).toBe(true);
  });

  it('SC 和上舰仍全开', () => {
    expect(shouldReply({ kind: 'superchat', username: 'A', body: '', amount: 30 }, cfg)).toBe(true);
    expect(shouldReply({ kind: 'guard', username: 'A', body: '', guardName: '舰长' }, cfg)).toBe(true);
  });
});
