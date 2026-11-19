import { beforeAll, describe, expect, it } from 'vitest';

import { normalizeError } from '@/lib/bridge';
import { mockInvoke } from '@/mock/backend';
import type { AttemptView, ReviewResult, TaskOutcome } from '@/types';

class MemoryStorage {
  private values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }
}

beforeAll(() => {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });
});

describe('browser demo backend', () => {
  it('confirms a review exactly once per idempotency key', async () => {
    const outcome = await mockInvoke<TaskOutcome>('next_task');
    expect(outcome.task).toBeTruthy();
    const task = outcome.task!;
    const attempt = task.attempt;

    const answered = await mockInvoke<AttemptView>('submit_answer', {
      input: {
        attemptId: attempt.id,
        answer: attempt.card.mode === 'self' ? '蓝色盒存放待登记条目，绿色盒存放已登记条目。' : '登记完成后从蓝色盒移入绿色盒。',
        latencyMs: 6_000,
        cloudAck: true,
      },
    });
    expect(answered.firstAnswer.trim().length).toBeGreaterThan(0);
    expect(['awaiting_self', 'feedback']).toContain(answered.status);
    if (answered.card.mode === 'ai') {
      expect(answered.feedback).toBeTruthy();
      expect(answered.feedback?.evidence.length).toBeGreaterThan(0);
    }

    const grade = answered.suggestedGrade ?? 2;
    const key = `vitest-${attempt.id}`;
    const first = await mockInvoke<ReviewResult>('confirm_review', {
      input: { attemptId: attempt.id, grade, idempotencyKey: key },
    });
    expect(first.alreadyExisted).toBe(false);
    expect(first.reviewId.startsWith('rev')).toBe(true);
    expect(first.intervalDays).toBeGreaterThanOrEqual(1);
    expect(first.dueOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const duplicate = await mockInvoke<ReviewResult>('confirm_review', {
      input: { attemptId: attempt.id, grade, idempotencyKey: key },
    });
    expect(duplicate.alreadyExisted).toBe(true);
    expect(duplicate.reviewId).toBe(first.reviewId);
    expect(duplicate.dueOn).toBe(first.dueOn);

    let conflict: unknown = null;
    try {
      await mockInvoke<ReviewResult>('confirm_review', {
        input: { attemptId: attempt.id, grade: grade === 3 ? 0 : 3, idempotencyKey: key },
      });
    } catch (error) {
      conflict = error;
    }
    expect(normalizeError(conflict).code).toBe('idempotency_conflict');

    const after = await mockInvoke<TaskOutcome>('next_task');
    expect(after.task?.attempt.id).not.toBe(attempt.id);
  });
});
