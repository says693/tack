import { beforeAll, describe, expect, it } from 'vitest';

import { normalizeError } from '@/lib/bridge';
import { mockInvoke } from '@/mock/backend';
import { guidedMock } from '@/mock/guided-study';
import type { AttemptView, QueuePreview, ReviewResult, TaskOutcome } from '@/types';

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
  it('hides answer before submission and confirms a review exactly once per idempotency key', async () => {
    const outcome = await mockInvoke<TaskOutcome>('next_task');
    expect(outcome.task).toBeTruthy();
    const task = outcome.task!;
    const attempt = task.attempt;
    expect(attempt.revision.answer).toBe('');
    expect(attempt.card.answerPreview).toBe('');

    const answered = await mockInvoke<AttemptView>('submit_answer', {
      input: {
        attemptId: attempt.id,
        answer: attempt.card.mode === 'self' ? '蓝色盒存放待登记条目，绿色盒存放已登记条目。' : '登记完成后从蓝色盒移入绿色盒。',
        latencyMs: 6_000,
        cloudAck: true,
      },
    });
    expect(answered.firstAnswer.trim().length).toBeGreaterThan(0);
    expect(answered.revision.answer.length).toBeGreaterThan(0);
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

  it('avoids immediate re-draw on blank abandon, gates objected reviews, and keeps grade-0 out of new cards', async () => {
    const firstDraw = await mockInvoke<TaskOutcome>('next_task');
    expect(firstDraw.task).toBeTruthy();
    const skippedConceptId = firstDraw.task!.attempt.conceptId;

    await mockInvoke('abandon_attempt', { attemptId: firstDraw.task!.attempt.id });
    const nextDraw = await mockInvoke<TaskOutcome>('next_task');
    expect(nextDraw.task).toBeTruthy();
    expect(nextDraw.task!.attempt.conceptId).not.toBe(skippedConceptId);

    const forgotAttempt = await mockInvoke<AttemptView>('submit_answer', {
      input: {
        attemptId: nextDraw.task!.attempt.id,
        answer: '【想不起来】',
        latencyMs: 2_000,
        cloudAck: false,
      },
    });
    expect(forgotAttempt.status).toBe('awaiting_self');
    expect(forgotAttempt.feedbackMode).toBe('self');
    expect(forgotAttempt.suggestedGrade).toBe(0);

    await mockInvoke('raise_objection', {
      attemptId: forgotAttempt.id,
      reason: '需要重新核对证据',
    });

    let blockedError: unknown = null;
    try {
      await mockInvoke('confirm_review', {
        input: { attemptId: forgotAttempt.id, grade: 0, idempotencyKey: `obj-${forgotAttempt.id}` },
      });
    } catch (error) {
      blockedError = error;
    }
    expect(normalizeError(blockedError).code).toBe('attempt_objected');

    const resolved = await mockInvoke<AttemptView>('switch_to_self', { attemptId: forgotAttempt.id });
    expect(resolved.status).toBe('awaiting_self');

    const forgotten = await mockInvoke<ReviewResult>('confirm_review', {
      input: { attemptId: forgotAttempt.id, grade: 0, idempotencyKey: `obj-resolved-${forgotAttempt.id}` },
    });
    expect(forgotten.state).toBe('relearning');

    const preview = await mockInvoke<QueuePreview>('queue_preview');
    expect(preview.new.some((card) => card.conceptId === forgotAttempt.conceptId)).toBe(false);
  });
});

describe('guided study browser preview', () => {
  it('supports 5 keyword-matched topics, custom material, and lesson reset', async () => {
    await guidedMock.saveKey('');
    for (const [query, expectedId] of [
      ['反射', 'optics-reflection'],
      ['方程', 'algebra-linear-equations'],
      ['循环', 'python-control-flow'],
      ['http', 'network-http-basics'],
      ['氧化', 'chemistry-redox'],
    ] as const) {
      const found = await guidedMock.findSources(query);
      expect(found).toHaveLength(1);
      expect(found[0].id).toBe(expectedId);
    }

    const customNote =
      '热力学第一定律说明能量既不能凭空产生，也不会凭空消失。\n它只能从一种形式转化为另一种形式，或者从一个物体转移到另一个物体。\n在转化和转移的过程中，能量的总量保持不变。';
    const customSources = await guidedMock.findSources(customNote);
    expect(customSources).toHaveLength(1);
    expect(customSources[0].id).toBe('custom-user-source');

    const generated = await guidedMock.generate({
      topic: customNote,
      sourceIds: ['custom-user-source'],
      cloudAck: true,
    });
    expect(generated.stage).toBe('read');
    expect(generated.total).toBe(3);

    const reset = await guidedMock.reset();
    expect(reset.modelConfigured).toBe(true);
    expect(reset.run).toBeNull();
  });
});
