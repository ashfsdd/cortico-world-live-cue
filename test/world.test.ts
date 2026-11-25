import { describe, it, expect } from 'vitest';
import {
  LIVE_CUE,
  DEFAULT_CONFIG,
  shouldReply,
  buildPrompt,
  toLiveEvent,
  LiveCueWorld,
  ENV_PROMPT_TEMPLATE,
} from '../src/index.ts';

describe('manifest', () => {
  it('id / label 正确', () => {
    expect(LIVE_CUE.id).toBe('live-cue');
    expect(LIVE_CUE.label).toBe('直播弹幕桥');
  });

  it('defaults 返回完整配置', () => {
    const d = LIVE_CUE.defaults();
    expect(d.streamUrl).toContain('7795');
    expect(d.gapSec).toBeGreaterThanOrEqual(0);
    expect(d.minGiftYuan).toBeGreaterThanOrEqual(0);
  });

  it('describe 声明了 live.danmaku 事件', () => {
    const ev = LIVE_CUE.describe.events.find((e: any) => e.type === 'live.danmaku');
    expect(ev).toBeTruthy();
    expect(ev.trigger).toBe('flush');
  });
});

describe('shouldReply', () => {
  const cfg = { ...DEFAULT_CONFIG, minUserLevel: 0 };

  it('纯 666 不回', () => {
    expect(shouldReply({ kind: 'danmaku', username: 'a', body: '666666' }, cfg)).toBe(false);
  });

  it('纯表情不回', () => {
    expect(shouldReply({ kind: 'danmaku', username: 'a', body: '😂😂😂' }, cfg)).toBe(false);
  });

  it('空弹幕不回', () => {
    expect(shouldReply({ kind: 'danmaku', username: 'a', body: '   ' }, cfg)).toBe(false);
  });

  it('@ 了她就回', () => {
    expect(shouldReply({ kind: 'danmaku', username: 'a', body: '@鱼宝 在吗' }, cfg)).toBe(true);
  });

  it('问句就回', () => {
    expect(shouldReply({ kind: 'danmaku', username: 'a', body: '今天播什么？' }, cfg)).toBe(true);
  });

  it('长弹幕回', () => {
    expect(shouldReply({ kind: 'danmaku', username: 'a', body: '主播这个操作是真的离谱' }, cfg)).toBe(true);
  });

  it('礼物达门槛必回，小额也进机会型', () => {
    expect(shouldReply({ kind: 'gift', username: 'a', body: '小心心', amount: 1 }, cfg)).toBe(true);
    expect(shouldReply({ kind: 'gift', username: 'a', body: '火箭', amount: 10 }, cfg)).toBe(true);
    expect(shouldReply({ kind: 'gift', username: 'a', body: '辣条', amount: 0.1 }, cfg)).toBe(true);
  });

  it('SC 和上舰默认都回', () => {
    expect(shouldReply({ kind: 'superchat', username: 'a', body: '问个事', amount: 30 }, cfg)).toBe(true);
    expect(shouldReply({ kind: 'guard', username: 'a', body: '', guardName: '舰长' }, cfg)).toBe(true);
  });
});

describe('buildPrompt', () => {
  it('弹幕提示词含用户名和正文', () => {
    const p = buildPrompt({ kind: 'danmaku', username: '昆明', body: '今天播吗' });
    expect(p).toContain('昆明');
    expect(p).toContain('今天播吗');
    expect(p).toContain('直播间弹幕');
  });

  it('礼物提示词含金额', () => {
    const p = buildPrompt({ kind: 'gift', username: 'Au', body: '火箭', amount: 100 });
    expect(p).toContain('礼物');
    expect(p).toContain('100');
  });

  it('上舰提示词含等级', () => {
    const p = buildPrompt({ kind: 'guard', username: '黑夜', body: '', guardName: '提督' });
    expect(p).toContain('提督');
  });
});

describe('toLiveEvent', () => {
  it('忽略非 audience 消息', () => {
    expect(toLiveEvent({ type: 'snapshot' })).toBeNull();
    expect(toLiveEvent({ type: 'announcement', agentAnnouncement: { text: 'hi' } })).toBeNull();
  });

  it('解析弹幕', () => {
    const ev = toLiveEvent({
      type: 'audience',
      event: { eventKind: 'danmaku', username: '小明', body: '你好', facts: {} },
    });
    expect(ev).toMatchObject({ kind: 'danmaku', username: '小明', body: '你好' });
  });

  it('解析弹幕里的舰长身份', () => {
    const ev = toLiveEvent({
      type: 'audience',
      event: { eventKind: 'danmaku', username: '舰长A', body: '主播好', facts: { guardLevel: 3 } },
    });
    expect(ev?.guardLevel).toBe(3);
  });

  it('解析弹幕里的管理员身份', () => {
    const ev = toLiveEvent({
      type: 'audience',
      event: { eventKind: 'danmaku', username: '管理B', body: '注意言行', facts: { isAdmin: true } },
    });
    expect(ev?.isAdmin).toBe(true);
  });

  it('解析普通礼物', () => {
    const ev = toLiveEvent({
      type: 'audience',
      event: { eventKind: 'gift', username: '小红', body: '小心心', facts: { price: 1000 } },
    });
    expect(ev?.kind).toBe('gift');
    expect(ev?.amount).toBe(1);
  });

  it('识别 SC', () => {
    const ev = toLiveEvent({
      type: 'audience',
      event: { eventKind: 'gift', username: '小刚', body: '醒目留言', facts: { SUPER_CHAT: true } },
    });
    expect(ev?.kind).toBe('superchat');
  });

  it('识别上舰', () => {
    const ev = toLiveEvent({
      type: 'audience',
      event: { eventKind: 'gift', username: '小美', body: '开通了舰长', facts: { guardLevel: 3 } },
    });
    expect(ev?.kind).toBe('guard');
    expect(ev?.guardName).toBe('舰长');
  });
});

describe('LiveCueWorld', () => {
  it('能构造，envPrompt 模板有内容', () => {
    const w = new LiveCueWorld({ cfg: {} });
    expect(ENV_PROMPT_TEMPLATE.length).toBeGreaterThan(100);
    expect(ENV_PROMPT_TEMPLATE).toContain('不要调');
    expect(w.id).toBe('live-cue');
  });

  it('envPromptVars 返回带前缀的变量', () => {
    const w = new LiveCueWorld({ cfg: { gapSec: 45, minGiftYuan: 10 } });
    const v = w.envPromptVars();
    expect(v['livecue.gapSec']).toBe('45');
    expect(v['livecue.minGiftYuan']).toBe('10');
    expect(v['livecue.streamUrl']).toContain('7795');
    expect(v['livecue.gameBlock']).toContain('本局游戏');
  });

  it('tools() 给七个：额度 / 身份 / 头像 / 祝贺画三件套', () => {
    const w = new LiveCueWorld({ cfg: { ...DEFAULT_CONFIG } });
    const ts = w.tools();
    expect(ts.map((x: any) => x.name).sort()).toEqual([
      'avatar_fetch', 'draw_quota', 'guard_bind', 'guard_check',
      'guard_portrait_done', 'guard_portrait_pending', 'guard_portrait_save', 'guard_publish',
      'report_compose',
    ]);
    const quota = ts.find((x: any) => x.name === 'draw_quota');
    expect(quota.parameters.required).toContain('who');
    const avatar = ts.find((x: any) => x.name === 'avatar_fetch');
    expect(avatar.parameters.properties).toHaveProperty('uid');
    expect(avatar.parameters.properties).toHaveProperty('qq');
  });

  it('webUi() 返回灯泡和徽标', () => {
    const w = new LiveCueWorld({ cfg: {} });
    const ui = w.webUi();
    expect(ui.label).toBe('直播弹幕桥');
    expect(ui.lamps.length).toBe(2);
    expect(ui.badges.length).toBe(6);
  });

  it('defaults() 含 enabled: false', () => {
    expect(LIVE_CUE.defaults().enabled).toBe(false);
  });

  it('create 能造出实例', () => {
    const w = LIVE_CUE.create({ cfg: {} });
    expect(w).toBeInstanceOf(LiveCueWorld);
  });

  it('stop() 可安全调用（未启动时）', async () => {
    const w = new LiveCueWorld({ cfg: {} });
    await expect(w.stop()).resolves.toBeUndefined();
  });
});
