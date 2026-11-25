import { describe, it, expect } from 'vitest';
import { LIVE_CUE_DEFAULTS, liveCueConfigGroup } from '../src/config.ts';
import { LIVE_CUE } from '../src/index.ts';

describe('LIVE_CUE_DEFAULTS', () => {
  it('含 enabled 且默认关闭（由装配层开启）', () => {
    expect(LIVE_CUE_DEFAULTS.enabled).toBe(false);
  });

  it('节流与礼物门槛默认值合理（限频默认关，礼物 1 元起必回）', () => {
    expect(LIVE_CUE_DEFAULTS.gapSec).toBe(0);
    expect(LIVE_CUE_DEFAULTS.minGiftYuan).toBe(1); // 门槛 1 元；道具表命中的礼物由 gameGiftAlwaysReply 兜底
    expect(LIVE_CUE_DEFAULTS.gameGiftAlwaysReply).toBe(false); // 默认关：1 元门槛说了算，0.1 元别刷屏
    expect(LIVE_CUE_DEFAULTS.chanceGapSec).toBe(35);
    expect(LIVE_CUE_DEFAULTS.minUserLevel).toBe(1);
  });

  it('四个开关默认全开', () => {
    expect(LIVE_CUE_DEFAULTS.replyOnAt).toBe(true);
    expect(LIVE_CUE_DEFAULTS.replyOnQuestion).toBe(true);
    expect(LIVE_CUE_DEFAULTS.replyOnSuperChat).toBe(true);
    expect(LIVE_CUE_DEFAULTS.replyOnGuard).toBe(true);
  });

  it('streamUrl 指向 7795', () => {
    expect(LIVE_CUE_DEFAULTS.streamUrl).toContain('7795');
  });

  it('defaults() 与 LIVE_CUE_DEFAULTS 一致', () => {
    const d = LIVE_CUE.defaults();
    expect(d.gapSec).toBe(LIVE_CUE_DEFAULTS.gapSec);
    expect(d.minGiftYuan).toBe(LIVE_CUE_DEFAULTS.minGiftYuan);
    expect(d.enabled).toBe(false);
  });
});

describe('liveCueConfigGroup', () => {
  it('id / owner 正确', () => {
    const g = liveCueConfigGroup('zh');
    expect(g.id).toBe('world:live-cue');
    expect(g.owner).toBe('world:live-cue');
  });

  it('有 schema 且是 object', () => {
    const g = liveCueConfigGroup('zh');
    expect(g.schema.type).toBe('object');
    expect(g.schema.properties).toBeTruthy();
  });

  it('配置项齐全，路径都在 worlds.live-cue. 下', () => {
    const g = liveCueConfigGroup('zh');
    const keys = Object.keys(g.schema.properties);
    // 不再写死数量（每加一个配置就要改测试，容易漏改）；改为「不少于历史值」+ 下面的 defaults 全覆盖检查
    expect(keys.length).toBeGreaterThanOrEqual(76);
    for (const k of keys) {
      expect(k.startsWith('worlds.live-cue.')).toBe(true);
    }
    expect(keys).toContain('worlds.live-cue.gapSec');
    expect(keys).toContain('worlds.live-cue.minGiftYuan');
    expect(keys).toContain('worlds.live-cue.replyOnAt');
    expect(keys).toContain('worlds.live-cue.replyOnGift');
    // 2026-11-21 加：默认值里有、schema 里没有 = 设置页看不到这一项（ownerUids 就这样漏过一轮）
    // enabled 由装配层管，不进设置页
    // enabled 由装配层管；syncQqToBubble 是面板页开关（设计上不进配置页）
    const skip = new Set(['enabled', 'syncQqToBubble']);
    for (const k of Object.keys(LIVE_CUE_DEFAULTS)) {
      if (skip.has(k)) continue;
      expect(keys).toContain(`worlds.live-cue.${k}`);
    }
    expect(keys).toContain('worlds.live-cue.chanceReply');
    expect(keys).toContain('worlds.live-cue.chanceGapSec');
    expect(keys).toContain('worlds.live-cue.blockHostile');
    expect(keys).toContain('worlds.live-cue.blockPeerChat');
    expect(keys).toContain('worlds.live-cue.useStoreEvents');
    expect(keys).toContain('worlds.live-cue.guardWelcome');
    expect(keys).toContain('worlds.live-cue.guardWelcomePerDay');
    expect(keys).toContain('worlds.live-cue.guardWelcomeStyles');
    expect(keys).toContain('worlds.live-cue.scDelaySec');
    expect(keys).toContain('worlds.live-cue.cheapGiftAsChance');
    expect(keys).toContain('worlds.live-cue.blockUsers');
    expect(keys).toContain('worlds.live-cue.replyMaxChars');
    expect(keys).toContain('worlds.live-cue.selfNames');
    expect(keys).toContain('worlds.live-cue.gameGiftAlwaysReply');
    expect(keys).toContain('worlds.live-cue.guardBurstSec');
    expect(keys).toContain('worlds.live-cue.sameUserGapSec');
    expect(keys).toContain('worlds.live-cue.emojiInDanmaku');
    expect(keys).toContain('worlds.live-cue.replyEmoteOnly');
    expect(keys).toContain('worlds.live-cue.giftMergeSec');
    expect(keys).toContain('worlds.live-cue.petActionRate');
    expect(keys).toContain('worlds.live-cue.guardDrawPerDay');
    expect(keys).toContain('worlds.live-cue.guardPortrait');
    expect(keys).toContain('worlds.live-cue.blockWords');
    expect(keys).toContain('worlds.live-cue.blockPatterns');
    expect(keys).toContain('worlds.live-cue.gameName');
    expect(keys).toContain('worlds.live-cue.gameItems');
    expect(keys).toContain('worlds.live-cue.gameRules');
    expect(keys).toContain('worlds.live-cue.autoLiveNotice');
    expect(keys).toContain('worlds.live-cue.liveNoticeTarget');
    expect(keys).toContain('worlds.live-cue.gameBrief');
    expect(keys).toContain('worlds.live-cue.promoCue');
    expect(keys).toContain('worlds.live-cue.promoGapSec');
    expect(keys).toContain('worlds.live-cue.promoTopics');

  });

  it('gapSec 有范围约束', () => {
    const g = liveCueConfigGroup('zh');
    const p = g.schema.properties['worlds.live-cue.gapSec'];
    expect(p.type).toBe('integer');
    expect(p.minimum).toBe(0);
    expect(p.maximum).toBe(600);
    expect(p['x-hot']).toBe(true);
  });

  it('minGiftYuan 是 number 且有范围', () => {
    const g = liveCueConfigGroup('zh');
    const p = g.schema.properties['worlds.live-cue.minGiftYuan'];
    expect(p.type).toBe('number');
    expect(p.minimum).toBe(0);
  });

  it('六个开关都是 boolean（syncQqToBubble 只在面板页，不在配置页）', () => {
    const g = liveCueConfigGroup('zh');
    for (const k of ['replyOnAt', 'replyOnQuestion', 'replyOnSuperChat', 'replyOnGuard',
                     'blockNoise', 'prioritizeGuard']) {
      expect(g.schema.properties[`worlds.live-cue.${k}`].type).toBe('boolean');
    }
    // 已从配置页移除
    expect(g.schema.properties['worlds.live-cue.syncQqToBubble']).toBeUndefined();
    // 但默认值还在（面板页要用）
    expect(LIVE_CUE_DEFAULTS.syncQqToBubble).toBe(true);
  });

  it('统一噪声开关默认开，旧的三个独立开关已删除', () => {
    expect(LIVE_CUE_DEFAULTS.blockNoise).toBe(true);
    const g = liveCueConfigGroup('zh');
    expect(g.schema.properties['worlds.live-cue.blockSpam']).toBeUndefined();
    expect(g.schema.properties['worlds.live-cue.blockPureNumber']).toBeUndefined();
    expect(g.schema.properties['worlds.live-cue.blockPureEmoji']).toBeUndefined();
  });

  it('四个转发配置齐全', () => {
    const g = liveCueConfigGroup('zh');
    expect(g.schema.properties['worlds.live-cue.forwardToQq'].type).toBe('boolean');
    expect(g.schema.properties['worlds.live-cue.qqForwardTargets'].type).toBe('string');
    expect(g.schema.properties['worlds.live-cue.qqForwardFormat'].type).toBe('string');
    expect(g.schema.properties['worlds.live-cue.qqForwardFormat'].enum).toEqual(['reply', 'full', 'important']);
    expect(g.schema.properties['worlds.live-cue.qqForwardGapSec'].type).toBe('integer');
    expect(LIVE_CUE_DEFAULTS.forwardToQq).toBe(false);
    expect(LIVE_CUE_DEFAULTS.qqForwardTargets).toBe('');  // 0.8.0 起默认留空，由用户填
    expect(LIVE_CUE_DEFAULTS.qqForwardFormat).toBe('important');
  });

  it('等级门槛默认为 0（不限）且标了 x-hot', () => {
    const g = liveCueConfigGroup('zh');
    expect(g.schema.properties['worlds.live-cue.minUserLevel'].type).toBe('integer');
    expect(g.schema.properties['worlds.live-cue.minUserLevel'].minimum).toBe(0);
    expect(g.schema.properties['worlds.live-cue.minUserLevel']['x-hot']).toBe(true);
    expect(LIVE_CUE_DEFAULTS.minUserLevel).toBe(1);
  });

  it('身份优先开关默认开且标了 x-hot', () => {
    const g = liveCueConfigGroup('zh');
    expect(g.schema.properties['worlds.live-cue.prioritizeGuard']['x-hot']).toBe(true);
    expect(LIVE_CUE_DEFAULTS.prioritizeGuard).toBe(true);
  });

  it('中英文都能生成（且标题不同）', () => {
    const zh = liveCueConfigGroup('zh');
    const en = liveCueConfigGroup('en');
    expect(zh.schema.title).toBe('直播弹幕桥');
    expect(en.schema.title).toBe('Live Danmaku Bridge');
    // 字段路径必须一致（否则配置写不回同一处）
    expect(Object.keys(zh.schema.properties).sort()).toEqual(
      Object.keys(en.schema.properties).sort(),
    );
  });
});

describe('webUi()', () => {
  it('不再挂自动 schema 表单，改为自绘「设置」面板（三列）', () => {
    const w = LIVE_CUE.create({ cfg: {} });
    const ui = w.webUi('zh');
    expect(ui.config).toBeUndefined();
    const ids = ui.panels.map((p: any) => p.id);
    expect(ids).toContain('settings');
    expect(ids).toContain('qq-sync');
    expect(ids).toContain('live-stats');
  });

  it('schema 仍可单独生成（面板回退用）', () => {
    const g = liveCueConfigGroup('zh');
    expect(g.schema.properties['worlds.live-cue.blockWords']).toBeTruthy();
  });

  it('lamps 反映运行状态', () => {
    const w = LIVE_CUE.create({ cfg: {} });
    const ui = w.webUi('zh');
    expect(ui.lamps.length).toBe(2);
    expect(ui.lamps[0].state).toBe('offline'); // 未启动
  });

  it('badges 显示当前节流和礼物门槛', () => {
    const w = LIVE_CUE.create({ cfg: { gapSec: 45, minGiftYuan: 10 } });
    const ui = w.webUi('zh');
    const vals = ui.badges.map((b: any) => String(b.value));
    expect(vals).toContain('45s');
    expect(vals).toContain('¥10');
  });
});
