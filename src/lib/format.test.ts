import { describe, expect, it } from 'vitest';

import {
  feedbackVerdictLabel,
  formatBytes,
  formatDuration,
  gradeHint,
  gradeLabel,
  originDescription,
  originLabel,
  relativeDue,
  schedulerLabel,
  sourceKindLabel,
  statusLabel,
  trustLabel,
  truncate,
} from '@/lib/format';
import { normalizeError } from '@/lib/bridge';

describe('format labels', () => {
  it('maps scheduler and UI states without leaking raw ids', () => {
    expect(statusLabel('ai_failed')).toBe('AI 失败');
    expect(statusLabel('feedback')).toBe('待确认');
    expect(statusLabel('confirmed')).toBe('已确认');
    expect(schedulerLabel('relearning')).toBe('重学');
    expect(gradeLabel(2)).toBe('独立想起');
    expect(gradeHint(2)).toBe('没有提示，自己完整想起');
    expect(feedbackVerdictLabel('insufficient_evidence')).toBe('证据不足');
  });

  it('keeps provenance explicit', () => {
    expect(originLabel('source_exact')).toBe('原题');
    expect(originLabel('adapted')).toBe('改编');
    expect(originLabel('generated')).toBe('新编');
    expect(originDescription('generated')).toContain('自行编写');
    expect(trustLabel(0)).toBe('示例 / 外部');
    expect(sourceKindLabel('external')).toBe('外部片段');
  });

  it('formats bytes and durations for export and review meters', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(5_000)).toBe('0:05');
    expect(formatDuration(65_000)).toBe('1:05');
    expect(truncate('折页', 8)).toBe('折页');
    expect(truncate('折页是一个自学工具', 4)).toBe('折页是一…');
  });

  it('describes due dates relative to today', () => {
    const today = new Date();
    const key = (offset: number) => {
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
        date.getDate(),
      ).padStart(2, '0')}`;
    };
    expect(relativeDue(null)).toBe('未开始');
    expect(relativeDue(key(0))).toBe('今天到期');
    expect(relativeDue(key(1))).toBe('明天到期');
    expect(relativeDue(key(3))).toBe('3 天后到期');
    expect(relativeDue(key(-2))).toBe('逾期 2 天');
  });
});

describe('normalizeError', () => {
  it('preserves structured codes and messages', () => {
    expect(normalizeError({ code: 'model_empty', message: '模型返回了空内容。' })).toEqual({
      code: 'model_empty',
      message: '模型返回了空内容。',
    });
    expect(normalizeError('network down')).toEqual({ code: 'error', message: 'network down' });
    expect(normalizeError(null).code).toBe('unknown');
  });
});
