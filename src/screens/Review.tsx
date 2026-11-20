import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CircleHelp,
  Clock,
  CornerDownRight,
  FileWarning,
  Flag,
  ListChecks,
  Quote,
  RefreshCw,
  Sparkles,
  Timer,
  X,
} from 'lucide-react';

import { Modal } from '@/components/Modal';
import { Loading, ErrorState, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { isTauri, normalizeError } from '@/lib/bridge';
import {
  feedbackVerdictLabel,
  formatDuration,
  gradeHint,
  gradeLabel,
  originLabel,
  relativeDue,
  schedulerLabel,
} from '@/lib/format';
import { useApp } from '@/store';
import type { AttemptView, QueueStats, ReviewResult, Task } from '@/types';

function idempotencyKey(attemptId: string): string {
  const storageKey = `fold:idem:${attemptId}`;
  const existing = localStorage.getItem(storageKey);
  if (existing) return existing;
  const key =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(storageKey, key);
  return key;
}

function draftKey(attemptId: string): string {
  return `fold:draft:${attemptId}`;
}

const VERDICT_CLASS: Record<string, string> = {
  correct: 'correct',
  partial: 'partial',
  wrong: 'wrong',
  insufficient_evidence: 'insufficient',
};

export function ReviewScreen({ attemptId }: { attemptId: string | null }) {
  const navigate = useApp((state) => state.navigate);
  const goBack = useApp((state) => state.goBack);
  const history = useApp((state) => state.history);
  const model = useApp((state) => state.model);
  const toast = useApp((state) => state.toast);
  const settings = useApp((state) => state.settings);
  const applyOverview = useApp((state) => state.applyOverview);
  const refreshOverview = useApp((state) => state.refreshOverview);

  function leaveReview() {
    if (history.length > 0) goBack();
    else navigate({ name: 'today' });
  }

  const [task, setTask] = useState<Task | null>(null);
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<{ name: string; reason: string }[]>([]);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [grade, setGrade] = useState<number | null>(null);
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [hintBusy, setHintBusy] = useState(false);
  const [practice, setPractice] = useState('');
  const [practiceBusy, setPracticeBusy] = useState(false);
  const [objectionOpen, setObjectionOpen] = useState(false);
  const [objection, setObjection] = useState('');
  const [abandonOpen, setAbandonOpen] = useState(false);
  const [startedAt, setStartedAt] = useState(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const idemRef = useRef('');
  const answerRef = useRef<HTMLTextAreaElement | null>(null);

  function applyAttempt(next: AttemptView, previous?: Task | null) {
    setTask((current) => {
      const base = previous ?? current;
      return base ? { ...base, attempt: next } : null;
    });
    if (next.suggestedGrade !== null && next.status === 'feedback') {
      setGrade((current) => current ?? next.suggestedGrade);
    }
    if (next.status === 'awaiting_self') {
      setGrade(next.suggestedGrade ?? null);
    }
    setHint(next.hintUsed ? next.hintText ?? next.feedback?.hint ?? null : null);
    if (next.status === 'awaiting') {
      setStartedAt(Date.now());
      setElapsed(0);
    }
  }

  function applyTask(next: Task) {
    setTask(next);
    setStats(next.stats);
    setResult(null);
    setActionError(null);
    setMessage(null);
    setBlocked([]);
    setStartedAt(Date.now());
    setElapsed(0);
    idemRef.current = idempotencyKey(next.attempt.id);
    setAnswer(
      next.attempt.firstAnswer ||
        localStorage.getItem(draftKey(next.attempt.id)) ||
        '',
    );
    setGrade(next.attempt.suggestedGrade ?? null);
    setHint(next.attempt.hintUsed ? next.attempt.hintText ?? next.attempt.feedback?.hint ?? null : null);
    setPractice('');
    setObjection('');
  }

  async function open(specific: string | null) {
    setLoading(true);
    setError(null);
    setResult(null);
    setTask(null);
    setMessage(null);
    setActionError(null);
    try {
      if (specific) {
        const found = await api.getTask(specific);
        if (found) {
          applyTask(found);
          return;
        }
      }
      const outcome = await api.nextTask();
      setStats(outcome.stats);
      setBlocked(outcome.blocked);
      setMessage(outcome.message);
      if (outcome.task) {
        applyTask(outcome.task);
      } else {
        setTask(null);
      }
    } catch (err) {
      setError(normalizeError(err).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void open(attemptId);
    // The screen is remounted for each review session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId]);

  useEffect(() => {
    if (!task || task.attempt.status !== 'awaiting') return;
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [task?.attempt.id, task?.attempt.status, startedAt]);

  useEffect(() => {
    if (!task || task.attempt.status !== 'awaiting') return;
    const key = draftKey(task.attempt.id);
    if (answer) localStorage.setItem(key, answer);
    else localStorage.removeItem(key);
  }, [answer, task?.attempt.id, task?.attempt.status]);

  const attempt = task?.attempt ?? null;
  const question = attempt?.card.question ?? '';
  const referenceAnswer = attempt?.revision.answer ?? '';
  const verdict = attempt?.feedback?.verdict ?? attempt?.verdict ?? null;
  const isSelf = attempt?.card.mode === 'self' || attempt?.feedbackMode === 'self';
  const canGrade =
    Boolean(attempt) &&
    ['feedback', 'awaiting_self'].includes(attempt!.status) &&
    grade !== null;
  const showFeedback = Boolean(
    attempt && ['feedback', 'insufficient', 'objected'].includes(attempt.status),
  );
  const progress = stats
    ? Math.min(
        100,
        Math.round(
          (stats.completedToday /
            Math.max(
              1,
              stats.completedToday +
                Math.min(stats.dueCount, stats.reviewRemaining) +
                Math.min(stats.newAvailable, stats.newRemaining),
            )) *
            100,
        ),
      )
    : 0;

  async function submit() {
    if (!attempt || busy) return;
    if (!answer.trim()) {
      setActionError('先写下你的答案，再提交。');
      answerRef.current?.focus();
      return;
    }
    if (!isSelf && isTauri && !model?.configured) {
      setActionError('尚未配置模型。请先点击「改为自评」完成本次回忆，或在设置里连接模型。');
      return;
    }
    const cloudSeen = settings?.cloudNoticeSeen ?? false;
    if (!isSelf && !cloudSeen) {
      const ok = await useApp.getState().requireCloud();
      if (!ok) return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const latency = Math.max(0, Date.now() - startedAt);
      const next = await api.submitAnswer(attempt.id, answer.trim(), latency, false);
      localStorage.removeItem(draftKey(attempt.id));
      applyAttempt(next);
      if (next.status === 'ai_failed') {
        setActionError(next.aiError ?? '批改没有完成。你的首次答案已保留。');
      }
    } catch (err) {
      const normalized = normalizeError(err);
      if (normalized.code === 'cloud_notice_required') {
        try {
          const found = await api.getTask(attempt.id);
          if (found) applyTask(found);
        } catch {
          // The answer is still preserved even if the task cannot be re-read.
        }
        setActionError('你的答案已经保存，但发送范围还没有确认。允许发送后请确认并重试批改。');
      } else {
        setActionError(normalized.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function submitForgot() {
    if (!attempt || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const latency = Math.max(0, Date.now() - startedAt);
      const next = await api.submitAnswer(attempt.id, '【想不起来】', latency, false);
      localStorage.removeItem(draftKey(attempt.id));
      applyAttempt(next);
      setGrade(0);
    } catch (err) {
      setActionError(normalizeError(err).message);
    } finally {
      setBusy(false);
    }
  }

  async function retryGrade() {
    if (!attempt || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const next = await useApp.getState().withCloud((ack) => api.retryGrade(attempt.id, ack));
      applyAttempt(next);
      if (next.status === 'ai_failed') setActionError(next.aiError ?? 'AI 反馈仍不可用。');
    } catch (err) {
      setActionError(normalizeError(err).message);
    } finally {
      setBusy(false);
    }
  }

  async function switchSelf() {
    if (!attempt || busy) return;
    setBusy(true);
    try {
      const next = await api.switchToSelf(attempt.id);
      applyAttempt(next);
      toast('info', '已改为自评', '这次不会再把答案发送给模型。请对照参考答案自己决定评级。');
    } catch (err) {
      setActionError(normalizeError(err).message);
    } finally {
      setBusy(false);
    }
  }

  async function requestHint() {
    if (!attempt || hintBusy) return;
    setHintBusy(true);
    try {
      const text = await api.requestHint(attempt.id);
      if (text) {
        setHint(text);
        setTask((current) =>
          current
            ? {
                ...current,
                attempt: { ...current.attempt, hintUsed: true, hintText: text },
              }
            : current,
        );
      } else {
        toast('info', '这次没有额外提示', '继续用自己的话说；提示不是答案。');
      }
    } catch (err) {
      toast('error', '没有取到提示', normalizeError(err).message);
    } finally {
      setHintBusy(false);
    }
  }

  async function confirm() {
    if (!attempt || grade === null || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const nextResult = await api.confirmReview({
        attemptId: attempt.id,
        grade,
        idempotencyKey: idemRef.current || idempotencyKey(attempt.id),
      });
      setResult(nextResult);
      applyOverview(nextResult.overview);
      void refreshOverview();
      toast(
        'success',
        nextResult.alreadyExisted ? '这次结果已经存在' : '已写入下一次',
        nextResult.alreadyExisted
          ? '同一个提交键返回了原结果，没有重复排期。'
          : `下次复习：${nextResult.nextDueLabel}`,
      );
    } catch (err) {
      setActionError(normalizeError(err).message);
    } finally {
      setBusy(false);
    }
  }

  async function savePractice() {
    if (!attempt || !practice.trim() || practiceBusy) return;
    setPracticeBusy(true);
    try {
      const next = await api.practiceAnswer(attempt.id, practice.trim());
      applyAttempt(next);
      setPractice('');
      toast('success', '练习已附在本次记录里', '它不会覆盖首次答案，也不改变评级建议。');
    } catch (err) {
      toast('error', '练习没有保存', normalizeError(err).message);
    } finally {
      setPracticeBusy(false);
    }
  }

  async function submitObjection() {
    if (!attempt || !objection.trim()) return;
    try {
      await api.raiseObjection(attempt.id, objection.trim());
      setObjectionOpen(false);
      setTask((current) =>
        current && current.attempt.status !== 'confirmed'
          ? { ...current, attempt: { ...current.attempt, status: 'objected' } }
          : current,
      );
      toast('success', '异议已记录', '它不会自动改分。请重新检查证据，再决定自己的评级。');
    } catch (err) {
      toast('error', '异议没有保存', normalizeError(err).message);
    }
  }

  async function abandon() {
    if (!attempt || busy) return;
    setBusy(true);
    try {
      await api.abandonAttempt(attempt.id);
      localStorage.removeItem(draftKey(attempt.id));
      setAbandonOpen(false);
      toast('info', '已跳过这张', '没有写入排期，到期日保持原样。');
      await open(null);
    } catch (err) {
      toast('error', '没有跳过', normalizeError(err).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!attempt || !['feedback', 'awaiting_self'].includes(attempt.status) || result) return;
    function onKey(event: KeyboardEvent) {
      if (busy || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const inField = Boolean(target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && grade !== null) {
        event.preventDefault();
        void confirm();
        return;
      }
      if (!inField && !event.ctrlKey && !event.metaKey && ['0', '1', '2', '3'].includes(event.key)) {
        event.preventDefault();
        setGrade(Number(event.key));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [attempt?.id, attempt?.status, busy, grade, result]);

  if (loading) {
    return (
      <div className="review-screen">
        <Loading label="正在取下一张…" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="review-screen">
        <ErrorState message={error} onRetry={() => void open(attemptId)} />
      </div>
    );
  }

  if (result) {
    return (
      <div className="review-screen">
        <div className="review-top">
          <button type="button" className="icon-btn" aria-label="关闭" onClick={leaveReview}>
            <X size={16} />
          </button>
          <div className="review-top-title">已确认</div>
          <div className="review-top-meta">
            <span className="chip chip-jade">{result.mode === 'ai' ? 'AI 参考 · 你确认' : '自评'}</span>
          </div>
        </div>
        <div className="result-screen">
          <div className="result-seal">
            {result.intervalDays}
            <span style={{ position: 'absolute', bottom: 22, fontSize: 9, fontFamily: 'var(--font-mono)', letterSpacing: '0.1em' }}>
              天
            </span>
          </div>
          <h2 className="result-title">这一页折好了。</h2>
          <div className="result-due">
            下次复习
            <strong>{result.nextDueLabel}</strong>
            <span className="faint tiny">{result.dueOn}</span>
          </div>
          <p className="result-copy">
            评级 {result.grade} · {gradeLabel(result.grade)}。到期日由你的最终确认写入，不使用模拟的「今天已完成」。
            {result.alreadyExisted ? ' 这次提交命中了同一个幂等键，返回原结果，没有重复排期。' : ''}
          </p>
          <div className="result-actions">
            <button type="button" className="btn btn-primary" onClick={() => void open(null)}>
              下一张
              <ArrowRight size={14} />
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => navigate({ name: 'today' })}>
              回到今日
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!task || !attempt) {
    return (
      <div className="review-screen">
        <div className="review-top">
          <button type="button" className="icon-btn" aria-label="关闭" onClick={leaveReview}>
            <X size={16} />
          </button>
          <div className="review-top-title">复习</div>
          <div className="review-top-meta">
            <span>没有待领任务</span>
          </div>
        </div>
        <div className="review-empty">
          <ListChecks size={46} className="faint" style={{ opacity: 0.4 }} />
          <h2>{stats?.dueCount === 0 && stats?.newAvailable === 0 ? '今天已经清空' : '这一刻没有可领取的任务'}</h2>
          <p>{message ?? '去读一段新材料，或先检查一下被暂停的卡片。'}</p>
          <div className="review-empty-stats">
            <div className="review-empty-stat">
              <strong>{stats?.dueCount ?? 0}</strong>
              <span>到期</span>
            </div>
            <div className="review-empty-stat">
              <strong>{stats?.newAvailable ?? 0}</strong>
              <span>新卡</span>
            </div>
            <div className="review-empty-stat">
              <strong>{stats?.completedToday ?? 0}</strong>
              <span>今日完成</span>
            </div>
          </div>
          {blocked.length > 0 ? (
            <div className="blocked-strip" style={{ maxWidth: 420, textAlign: 'left' }}>
              <AlertTriangle size={15} />
              <div className="blocked-copy">
                {blocked[0].name}：{blocked[0].reason}
              </div>
            </div>
          ) : null}
          <div className="result-actions">
            <button type="button" className="btn btn-primary" onClick={() => navigate({ name: 'today' })}>
              回到今日
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => navigate({ name: 'library' })}>
              去读一段
            </button>
          </div>
        </div>
      </div>
    );
  }

  const answered = Boolean(attempt.firstAnswer.trim());
  const feedback = attempt.feedback;
  const canConfirmStatus = ['feedback', 'awaiting_self'].includes(attempt.status);
  const insufficient = attempt.status === 'insufficient' || verdict === 'insufficient_evidence';

  return (
    <div className="review-screen">
      <div className="review-top">
        <button type="button" className="icon-btn" aria-label="离开复习" onClick={goBack}>
          <ArrowLeft size={16} />
        </button>
        <div className="review-top-title">{attempt.card.conceptName}</div>
        <div className="review-top-meta">
          <span className="chip chip-plain">{task.kind === 'new' ? '新卡' : '到期复习'}</span>
          <span>{attempt.isDemo ? '演示' : '本地记录'}</span>
        </div>
        <div className="review-progress">
          <i style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="review-body">
        <div className="review-inner">
          <div className="question-paper paper-card">
            <div className="question-top">
              <span className="question-label">Question</span>
              <span className="chip chip-plain">{originLabel(attempt.card.exerciseOrigin)}</span>
              {attempt.card.sourceTitle ? <span className="chip">{attempt.card.sourceTitle}</span> : null}
              {isSelf ? <span className="chip chip-jade">自评 · 不调用模型</span> : null}
              {attempt.hintUsed ? <span className="chip chip-amber">用过提示</span> : null}
            </div>
            <div className="question-text">{question}</div>
            <div className="question-hint">
              {isSelf
                ? '先独立想起。提交后对照参考答案，由你决定评级；不会把答案发到云端。'
                : '先独立想起，不要打开原文。提交后会保存首次答案，再把卡片与证据交给模型反馈；最终评级由你确认。'}
            </div>
          </div>

          {!answered && attempt.status === 'awaiting' ? (
            <div className="answer-panel">
              <textarea
                ref={answerRef}
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                placeholder="用你自己的话回答。写不清楚也没关系，先留下真实的提取痕迹。"
                disabled={busy}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                    event.preventDefault();
                    void submit();
                  }
                }}
              />
              <div className="answer-meta">
                <span>
                  <Timer size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
                  {formatDuration(elapsed * 1000)} · 首次答案提交后不可改写
                </span>
                <span>{answer.length} 字</span>
              </div>
              {actionError ? <div className="form-error">{actionError}</div> : null}
              <div className="review-actions">
                <div className="left">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={leaveReview}>
                    暂时离开
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAbandonOpen(true)}>
                    跳过这张
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void submitForgot()}>
                    想不起来
                  </button>
                  {!isSelf ? (
                    <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void switchSelf()}>
                      改为自评
                    </button>
                  ) : null}
                </div>
                <div className="right">
                  <span className="tiny faint">Ctrl / ⌘ + Enter</span>
                  <button type="button" className="btn btn-primary" disabled={busy || !answer.trim()} onClick={() => void submit()}>
                    {busy ? <Spinner /> : <CornerDownRight size={14} />}
                    {busy ? '保存并批改…' : isSelf ? '保存并自评' : '提交作答'}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="answer-saved">
                <div className="eyebrow">你的首次答案</div>
                <div className="answer-saved-text">{attempt.firstAnswer}</div>
                <div className="answer-meta" style={{ marginTop: 8 }}>
                  <span>
                    <Clock size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
                    用时 {formatDuration(attempt.latencyMs ?? elapsed * 1000)}
                  </span>
                  <span>{attempt.firstAnswer.length} 字</span>
                </div>
              </div>

              {attempt.status === 'grading' || (busy && !feedback) ? (
                <div className="insight-card" style={{ alignItems: 'center' }}>
                  <Spinner size={16} />
                  <div>
                    <div className="step-title">正在对照证据…</div>
                    <div className="step-copy">你的答案已经保存。即使批改失败，也不会丢掉这次作答。</div>
                  </div>
                </div>
              ) : null}

              {attempt.status === 'ai_failed' ? (
                <div className="ai-error-box">
                  <div className="ai-error-title">
                    <FileWarning size={14} />
                    AI 反馈没有完成
                  </div>
                  <div className="ai-error-copy">
                    {attempt.aiError || '没有拿到有效反馈。'} 首次答案仍然保留，你可以重试，或明确切换成自评。
                  </div>
                  <div className="ai-error-actions">
                    <button type="button" className="btn btn-sm btn-subtle" disabled={busy} onClick={() => void retryGrade()}>
                      {busy ? <Spinner size={12} /> : <RefreshCw size={12} />}
                      重试批改
                    </button>
                    <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => void switchSelf()}>
                      改为自评
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => navigate({ name: 'settings', section: 'model' }, {
                        returnTo: { name: 'review', attemptId: attempt.id },
                      })}
                    >
                      检查模型设置
                    </button>
                  </div>
                </div>
              ) : null}

              {showFeedback && feedback ? (
                <div className="feedback-card">
                  <div className="verdict-row">
                    <span className={`verdict-stamp ${VERDICT_CLASS[feedback.verdict] ?? ''}`}>
                      {feedbackVerdictLabel(feedback.verdict)}
                    </span>
                    <div className="verdict-model">
                      {feedback.model ?? '模型未标注'}
                      <br />
                      {attempt.feedbackMode === 'self' ? '自评 · 未使用模型' : '仅作参考 · 评级由你决定'}
                    </div>
                  </div>

                  {feedback.hits.length > 0 ? (
                    <div className="feedback-block">
                      <div className="feedback-block-title">
                        <Check size={11} /> 做到的
                      </div>
                      <ul className="feedback-list">
                        {feedback.hits.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {feedback.observedErrors.length > 0 ? (
                    <div className="feedback-block">
                      <div className="feedback-block-title">
                        <AlertTriangle size={11} /> 需要修正
                      </div>
                      <ul className="feedback-list errors">
                        {feedback.observedErrors.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {feedback.missingPoints.length > 0 ? (
                    <div className="feedback-block">
                      <div className="feedback-block-title">
                        <CircleHelp size={11} /> 还缺什么
                      </div>
                      <ul className="feedback-list missing">
                        {feedback.missingPoints.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {feedback.evidence.length > 0 ? (
                    <div className="feedback-block">
                      <div className="feedback-block-title">
                        <Quote size={11} /> 可核对证据
                      </div>
                      {feedback.evidence.map((item) => (
                        <div key={`${item.chunkId}-${item.excerpt.slice(0, 8)}`} className="evidence-box">
                          <div className="evidence-excerpt">“{item.excerpt}”</div>
                          <div className="evidence-meta">
                            <span>{item.sourceTitle ?? '来源未提供'}</span>
                            {item.label ? (
                              <>
                                <span>·</span>
                                <span>{item.label}</span>
                              </>
                            ) : null}
                            <span className={`chip ${item.matched ? 'chip-jade' : 'chip-danger'}`}>
                              {item.matched ? '逐字定位成功' : '未能在当前版本定位'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="feedback-block">
                      <div className="feedback-block-title">
                        <FileWarning size={11} /> 证据
                      </div>
                      <div className="settings-note">
                        这次没有可核对的原文证据。折页不会把它当成「答对」，也不会给出可用于排期的评分。
                      </div>
                    </div>
                  )}

                  {feedback.note ? <p className="field-hint" style={{ marginTop: 10 }}>{feedback.note}</p> : null}

                  <div className="feedback-block">
                    <div className="feedback-block-title">
                      <Quote size={11} /> 参考答案
                    </div>
                    <div className="self-answer">{referenceAnswer}</div>
                  </div>

                  {attempt.status === 'objected' ? (
                    <div className="ai-error-box" style={{ marginTop: 12 }}>
                      <div className="ai-error-title">
                        <Flag size={14} /> 已对这次反馈提出异议
                      </div>
                      <div className="ai-error-copy">
                        提出异议后不能直接沿用旧反馈写入排期。请转为自评重评，或重新请求 AI 批改后再确认。
                      </div>
                      <div className="ai-error-actions">
                        <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void switchSelf()}>
                          改为自评重评
                        </button>
                        <button type="button" className="btn btn-sm btn-subtle" disabled={busy} onClick={() => void retryGrade()}>
                          {busy ? <Spinner size={12} /> : <RefreshCw size={12} />}
                          重新请求批改
                        </button>
                      </div>
                    </div>
                  ) : attempt.status !== 'insufficient' ? (
                    <>
                      <div className="feedback-block">
                        <div className="feedback-block-title">
                          <Sparkles size={11} /> 需要一句提示？
                        </div>
                        {hint ? (
                          <div className="hint-box">{hint}</div>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-sm btn-ghost"
                            disabled={hintBusy || isSelf}
                            onClick={() => void requestHint()}
                          >
                            {hintBusy ? <Spinner size={12} /> : <CircleHelp size={12} />}
                            看提示（会记入本次）
                          </button>
                        )}
                      </div>

                      <div className="practice-box">
                        <div className="field-label">
                          <span>再写一遍（可选）</span>
                          <span className="tiny faint">{attempt.practiceAnswers.length} 次练习</span>
                        </div>
                        <textarea
                          className="textarea"
                          value={practice}
                          onChange={(event) => setPractice(event.target.value)}
                          placeholder="看完反馈后，用自己的话重写一次。练习会附在本次记录里，但不覆盖首次答案。"
                        />
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
                          <button
                            type="button"
                            className="btn btn-sm btn-subtle"
                            disabled={practiceBusy || !practice.trim()}
                            onClick={() => void savePractice()}
                          >
                            {practiceBusy ? <Spinner size={12} /> : <CornerDownRight size={12} />}
                            记录练习
                          </button>
                        </div>
                        {attempt.practiceAnswers.length > 0 ? (
                          <div className="practice-list">
                            {attempt.practiceAnswers.map((item) => (
                              <div key={item.at} className="practice-row">
                                <span className="faint tiny">{new Date(item.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
                                <span>{item.answer}</span>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>

                      <div className="review-action-dock">
                        <div className="feedback-block" style={{ marginTop: 0 }}>
                          <div className="feedback-block-title">
                            <ListChecks size={11} /> 这次由你决定评级（按键 0–3）
                          </div>
                          <div className="grade-grid">
                            {[0, 1, 2, 3].map((value) => (
                              <button
                                key={value}
                                type="button"
                                className={`grade-option${grade === value ? ' active' : ''}${
                                  attempt.suggestedGrade === value ? ' suggested is-suggested' : ''
                                }`}
                                onClick={() => setGrade(value)}
                              >
                                <span className="grade-title">
                                  {value} · {gradeLabel(value)}
                                </span>
                                <span className="grade-desc">{gradeHint(value)}</span>
                              </button>
                            ))}
                          </div>
                          {attempt.suggestedGrade !== null ? (
                            <p className="field-hint" style={{ marginTop: 7 }}>
                              模型建议 {attempt.suggestedGrade} · {gradeLabel(attempt.suggestedGrade)}。
                              这只是建议，确认时写入的是你选中的数字。
                            </p>
                          ) : null}
                        </div>

                        {actionError ? <div className="form-error">{actionError}</div> : null}

                        <div className="review-confirm-row">
                          <div className="review-confirm-note">
                            确认后才会写入下一次到期日。点击两次不会重复排期；同一个提交键只会产生一份结果。
                          </div>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => setObjectionOpen(true)}
                            >
                              <Flag size={12} /> 对反馈有异议
                            </button>
                            <button
                              type="button"
                              className="btn btn-primary"
                              disabled={!canGrade || busy}
                              onClick={() => void confirm()}
                            >
                              {busy ? <Spinner /> : <Check size={14} />}
                              确认评级并排期
                            </button>
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="review-confirm-row">
                      <div className="review-confirm-note">
                        证据不足时不会写入排期，也不会用「部分正确」来掩盖无法核对的事实。
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setObjectionOpen(true)}>
                          提出异议
                        </button>
                        <button type="button" className="btn btn-subtle btn-sm" onClick={() => setAbandonOpen(true)}>
                          结束本次，不改排期
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}

              {isSelf && attempt.status === 'awaiting_self' ? (
                <div className="self-assess">
                  <div className="self-assess-title">
                    <Sparkles size={16} /> 对照参考答案，自己评级
                  </div>
                  <div className="self-assess-copy">
                    {attempt.firstAnswer === '【想不起来】'
                      ? '你标记了「想不起来」，建议选 0 · 忘记，明天再重新提取一次。'
                      : '这张卡是自评模式，不会调用模型。请先看自己的答案，再展开参考答案。'}
                  </div>
                  <details open={attempt.firstAnswer === '【想不起来】'} style={{ marginTop: 10 }}>
                    <summary className="link" style={{ cursor: 'pointer', display: 'inline-block' }}>
                      展开参考答案
                    </summary>
                    <div className="self-answer">{referenceAnswer}</div>
                  </details>
                  <div className="review-action-dock" style={{ marginTop: 12 }}>
                    <div className="grade-grid">
                      {[0, 1, 2, 3].map((value) => (
                        <button
                          key={value}
                          type="button"
                          className={`grade-option${grade === value ? ' active' : ''}${
                            attempt.suggestedGrade === value ? ' suggested is-suggested' : ''
                          }`}
                          onClick={() => setGrade(value)}
                        >
                          <span className="grade-title">
                            {value} · {gradeLabel(value)}
                          </span>
                          <span className="grade-desc">{gradeHint(value)}</span>
                        </button>
                      ))}
                    </div>
                    {actionError ? <div className="form-error">{actionError}</div> : null}
                    <div className="review-confirm-row">
                      <div className="review-confirm-note">自评也使用同一套调度器。到期日会如实写入。</div>
                      <button type="button" className="btn btn-primary" disabled={!canGrade || busy} onClick={() => void confirm()}>
                        {busy ? <Spinner /> : <Check size={14} />}
                        确认评级并排期
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              {!feedback && !isSelf && attempt.status === 'awaiting_ack' ? (
                <div className="insight-card">
                  <AlertTriangle size={16} className="amber" />
                  <div style={{ flex: 1 }}>
                    <div className="step-title">还差一次发送确认</div>
                    <div className="step-copy">首次云端批改前需要确认发送范围。答案已保留，确认后重试即可。</div>
                  </div>
                  <button type="button" className="btn btn-sm btn-subtle" onClick={() => void retryGrade()}>
                    确认并重试
                  </button>
                </div>
              ) : null}

              {!feedback && !isSelf && attempt.status === 'objected' ? (
                <div className="ai-error-box">
                  <div className="ai-error-title">
                    <Flag size={14} /> 你已提出异议
                  </div>
                  <div className="ai-error-copy">异议不会自动改分。请先转为自评重评，或重新请求 AI 批改后再确认。</div>
                  <div className="ai-error-actions">
                    <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void switchSelf()}>
                      改为自评重评
                    </button>
                    <button type="button" className="btn btn-sm btn-subtle" disabled={busy} onClick={() => void retryGrade()}>
                      重新请求批改
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      <Modal
        open={objectionOpen}
        title="对这次反馈提出异议"
        subtitle="异议会写入本地事件日志，并保留原始反馈。它不会让模型自动改分，也不会跳过你的最终确认。"
        onClose={() => setObjectionOpen(false)}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setObjectionOpen(false)}>
              取消
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!objection.trim()}
              onClick={() => void submitObjection()}
            >
              <Flag size={14} /> 记录异议
            </button>
          </>
        }
      >
        <label className="field">
          <span className="field-label">理由</span>
          <textarea
            className="textarea"
            value={objection}
            onChange={(event) => setObjection(event.target.value)}
            placeholder="例如：反馈漏掉了「登记完成」这个条件；或证据片段与题目无关。"
          />
        </label>
      </Modal>

      <Modal
        open={abandonOpen}
        title={answered ? '放弃这次作答？' : '跳过这张？'}
        subtitle={
          answered
            ? '首次答案会保留为「已放弃」记录，但不会写入任何到期日。下次仍会按原来的真实到期日出现。'
            : '还没有作答，可以直接放回队列。不会伪造完成记录。'
        }
        onClose={() => setAbandonOpen(false)}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setAbandonOpen(false)}>
              继续作答
            </button>
            <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void abandon()}>
              {busy ? <Spinner /> : <X size={14} />}
              跳过，不改排期
            </button>
          </>
        }
      >
        <div className="settings-note">
          折页不会把「看过答案」算成「记住了」。跳过就是跳过，队列会保留。
        </div>
      </Modal>
    </div>
  );
}
