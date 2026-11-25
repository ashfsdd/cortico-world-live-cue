import { describe, it, expect } from 'vitest';
import { cleanScript } from '../src/index.ts';

describe('cleanScript', () => {
  it('去掉【表情,动作】标记', () => {
    expect(cleanScript('【happy, wave】在呢在呢~')).toBe('在呢在呢~');
  });

  it('去掉<动作>标记', () => {
    expect(cleanScript('今天也辛苦啦<眨眼>要不要歇会儿')).toBe('今天也辛苦啦要不要歇会儿');
  });

  it('两种标记混合', () => {
    expect(cleanScript('【happy】好耶<wave>明天见')).toBe('好耶明天见');
  });

  it('压缩多余空白', () => {
    expect(cleanScript('  你好    世界  ')).toBe('你好 世界');
  });

  it('空脚本返回空串', () => {
    expect(cleanScript('')).toBe('');
    expect(cleanScript('【happy】')).toBe('');
  });

  it('纯文字原样返回', () => {
    expect(cleanScript('主播这操作真离谱')).toBe('主播这操作真离谱');
  });
});
