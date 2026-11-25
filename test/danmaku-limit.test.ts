import { describe, it, expect } from 'vitest';
import { clipDanmaku, hitDanmakuGuard, displayWidth, fallbackGiftYuan } from '../src/index.ts';

/**
 * 2026-11-20 实测口径（直播号直发，房间未开播也能发）：
 *   40 汉字 → code=0；41 汉字 → 1003212
 *   80 英文 → code=0；81 英文 → 1003212
 * 结论：上限是 80 个半角位 —— ASCII 可见字符 1 位，其余（汉字/标点/颜文字/emoji）2 位。
 */
describe('弹幕长度：B站实测口径', () => {
  it('40 个汉字正好 80 位，原样通过', () => {
    const s = '一'.repeat(40);
    expect(displayWidth(s)).toBe(80);
    expect(clipDanmaku(s)).toBe(s);
  });

  it('41 个汉字是 82 位，必须截', () => {
    const s = '二'.repeat(41);
    expect(displayWidth(s)).toBe(82);
    expect(Array.from(clipDanmaku(s)).length).toBeLessThanOrEqual(40);
    expect(displayWidth(clipDanmaku(s))).toBeLessThanOrEqual(80);
  });

  it('80 个英文原样，81 个英文要截', () => {
    const ok = 'a'.repeat(80);
    expect(displayWidth(ok)).toBe(80);
    expect(clipDanmaku(ok)).toBe(ok);
    const over = 'b'.repeat(81);
    expect(displayWidth(clipDanmaku(over))).toBeLessThanOrEqual(80);
  });

  it('颜文字按 2 位算（旧算法算 1 位，才放过了 83 位的真超长）', () => {
    const s = '三位哥一起扔人气票，小孩数又开始晃了…然哥盯紧车道，别让后车撞上去 (｡•́︿•̀｡)';
    expect(displayWidth(s)).toBeGreaterThan(80);
    expect(displayWidth(clipDanmaku(s))).toBeLessThanOrEqual(80);
  });

  it('英文标点算 1 位', () => {
    expect(displayWidth('abc,.')) .toBe(5);
  });
});

describe('礼物价格兜底', () => {
  it('常见礼物按官方面板价', () => {
    expect(fallbackGiftYuan('钻石戒指', 1)).toBeCloseTo(19.9, 2);
    expect(fallbackGiftYuan('撒花', 1)).toBeCloseTo(9.9, 2);
    expect(fallbackGiftYuan('人气票', 3)).toBeCloseTo(0.3, 2);
  });

  it('不认识的礼物返回 0，不瞎猜', () => {
    expect(fallbackGiftYuan('不存在的礼物', 1)).toBe(0);
  });
});



describe('弹幕敏感词过滤（2026-11-23 加）', () => {
  it('金额类命中', () => {
    expect(hitDanmakuGuard('这场到手 5000 元')).toBeTruthy();
    expect(hitDanmakuGuard('今晚充值不少')).toBeTruthy();
  });
  it('联系方式命中', () => {
    expect(hitDanmakuGuard('加我微信聊')).toBeTruthy();
    expect(hitDanmakuGuard('QQ: 123456789')).toBeTruthy();
  });
  it('普通闲聊不误伤', () => {
    expect(hitDanmakuGuard('今天小孩过马路真难')).toBe('');
    expect(hitDanmakuGuard('成磊哥又送一张')).toBe('');
  });
});
