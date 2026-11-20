import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  BookOpen,
  Check,
  LayoutGrid,
  Moon,
  PlusCircle,
  RotateCcw,
  Sun,
} from 'lucide-react';

import { BrandMark } from '@/components/BrandMark';
import { Spinner } from '@/components/ui';
import { normalizeError } from '@/lib/bridge';
import { guidedStudy, type GuidedRun, type GuidedSourceProof } from '@/lib/guided-study';
import { useApp } from '@/store';

import '@/styles/guided-study.css';

const DRAFT_DELAY = 400;
const DONE_REFRESH_INTERVAL = 60_000;
const ANSWER_LIMIT = 2500;
type DraftState = 'idle' | 'pending' | 'saving' | 'saved' | 'failed';

export function StudyScreen() {
  const navigate = useApp((state) => state.navigate);
  const theme = useApp((state) => state.theme);
  const setTheme = useApp((state) => state.setTheme);
  const markOnboarded = useApp((state) => state.markOnboarded);
  const refreshAll = useApp((state) => state.refreshAll);

  const [run, setRun] = useState<GuidedRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadVersion, setLoadVersion] = useState(0);
  const [draft, setDraft] = useState('');
  const [draftState, setDraftState] = useState<DraftState>('idle');
  const [busy, setBusy] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [confirmSwitch, setConfirmSwitch] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const active = useRef(true);
  const request = useRef(false);
  const actionVersion = useRef(0);
  const stageTitle = useRef<HTMLHeadingElement>(null);
  const draftTimer = useRef<number | null>(null);
  const draftWrites = useRef(Promise.resolve());
  const activeDraft = useRef<{ attemptId: string; text: string; saved: string } | null>(null);
  const doneLessonId = run?.stage === 'done' ? run.lesson.id : null;

  function cancelDraftTimer() {
    if (draftTimer.current !== null) window.clearTimeout(draftTimer.current);
    draftTimer.current = null;
  }

  function applyRun(next: GuidedRun | null) {
    cancelDraftTimer();
    const text = next?.stage === 'question' ? next.draft ?? '' : '';
    activeDraft.current = next?.stage === 'question' ? { attemptId: next.attemptId, text, saved: text } : null;
    setDraft(text);
    setDraftState(text ? 'saved' : 'idle');
    setRun(next);
  }

  useEffect(() => {
    active.current = true;
    let mounted = true;
    setLoading(true);
    setLoadError('');
    void guidedStudy.getRun().then(
      (next) => {
        if (!mounted) return;
        applyRun(next);
        setLoading(false);
      },
      (reason) => {
        if (!mounted) return;
        setLoadError(normalizeError(reason).message);
        setLoading(false);
      },
    );
    return () => {
      mounted = false;
      active.current = false;
      cancelDraftTimer();
    };
  }, [loadVersion]);

  useEffect(() => {
    stageTitle.current?.focus();
    setConfirmSwitch(false);
  }, [run?.stage, run?.current, loading]);

  useEffect(() => {
    if (!doneLessonId) return;
    let disposed = false;
    let refreshing = false;

    async function refreshDue() {
      if (disposed || refreshing || document.hidden || request.current) return;
      const version = actionVersion.current;
      refreshing = true;
      try {
        const next = await guidedStudy.getRun();
        if (disposed || request.current || version !== actionVersion.current ||
            next?.stage !== 'done' || next.lesson.id !== doneLessonId) return;
        const { nextDueLabel, reviewAvailable } = next;
        setRun((current) => {
          if (current?.stage !== 'done' || current.lesson.id !== doneLessonId ||
              (current.nextDueLabel === nextDueLabel && current.reviewAvailable === reviewAvailable)) return current;
          return { ...current, nextDueLabel, reviewAvailable };
        });
      } catch {
        // Keep the last saved completion visible if a background read fails.
      } finally {
        refreshing = false;
      }
    }

    window.addEventListener('focus', refreshDue);
    document.addEventListener('visibilitychange', refreshDue);
    const interval = window.setInterval(refreshDue, DONE_REFRESH_INTERVAL);
    return () => {
      disposed = true;
      window.removeEventListener('focus', refreshDue);
      document.removeEventListener('visibilitychange', refreshDue);
      window.clearInterval(interval);
    };
  }, [doneLessonId]);

  useEffect(() => {
    if (run?.stage !== 'compare') return;
    const compareRun = run;
    function onKey(event: KeyboardEvent) {
      if (busy || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (event.key === '1' && compareRun.answer !== null) {
        event.preventDefault();
        void act(() => guidedStudy.confirmAnswer({ attemptId: compareRun.attemptId, grade: 2 }));
      } else if (event.key === '2') {
        event.preventDefault();
        void act(() => guidedStudy.confirmAnswer({ attemptId: compareRun.attemptId, grade: 0 }));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [run, busy]);

  function saveCurrentDraft() {
    cancelDraftTimer();
    const captured = activeDraft.current;
    if (!captured || request.current) return;
    const { attemptId, text } = captured;
    draftWrites.current = draftWrites.current.then(async () => {
      const current = activeDraft.current;
      if (!active.current || request.current || !current ||
          current.attemptId !== attemptId || current.text !== text) return;
      if (current.saved === text) {
        setDraftState(text ? 'saved' : 'idle');
        return;
      }
      setDraftState('saving');
      try {
        await guidedStudy.saveDraft({ attemptId, draft: text });
        const latest = activeDraft.current;
        if (!active.current || latest?.attemptId !== attemptId) return;
        latest.saved = text;
        if (latest.text === text) setDraftState(text ? 'saved' : 'idle');
      } catch {
        if (active.current && activeDraft.current?.attemptId === attemptId &&
            activeDraft.current.text === text) setDraftState('failed');
      }
    });
  }

  function changeDraft(text: string) {
    if (!activeDraft.current || request.current) return;
    activeDraft.current.text = text;
    setDraft(text);
    setDraftState('pending');
    cancelDraftTimer();
    draftTimer.current = window.setTimeout(saveCurrentDraft, DRAFT_DELAY);
  }

  async function act(operation: () => Promise<GuidedRun>, submit = false) {
    if (request.current) return;
    request.current = true;
    actionVersion.current += 1;
    setBusy(true);
    setError('');
    if (submit) cancelDraftTimer();
    let failed = false;
    try {
      if (submit) await draftWrites.current;
      const next = await operation();
      if (active.current) applyRun(next);
    } catch (reason) {
      failed = true;
      if (active.current) setError(normalizeError(reason).message);
    } finally {
      request.current = false;
      if (active.current) {
        setBusy(false);
        if (failed && submit) saveCurrentDraft();
      }
    }
  }

  function submitDraftAnswer() {
    const answer = draft.trim();
    if (run?.stage !== 'question' || !answer) return;
    void act(() => guidedStudy.submitAnswer({ attemptId: run.attemptId, answer }), true);
  }

  function checkAnswer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submitDraftAnswer();
  }

  async function enterWorkbench() {
    await markOnboarded();
    await refreshAll();
    navigate({ name: 'today' });
  }

  async function switchTopic() {
    if (resetting || busy) return;
    setResetting(true);
    setError('');
    try {
      await guidedStudy.reset();
      await refreshAll();
      navigate({ name: 'onboarding' }, { replace: true });
    } catch (reason) {
      setError(normalizeError(reason).message);
    } finally {
      setResetting(false);
    }
  }

  const progressPercent = !run
    ? 0
    : run.stage === 'done'
      ? 100
      : Math.round(((run.current - (run.stage === 'read' ? 0.65 : run.stage === 'question' ? 0.35 : 0.1)) / Math.max(1, run.total)) * 100);

  const topbar = (
    <div className="guided-topbar">
      <div className="guided-brand">
        <BrandMark size={24} />
        <span>折页</span>
        <span className="guided-brand-wordmark">FOLD</span>
      </div>
      <div className="guided-progress-track" aria-hidden="true">
        <div className="guided-progress-fill" style={{ width: `${Math.max(8, progressPercent)}%` }} />
      </div>
      <div className="guided-util-actions">
        <button
          type="button"
          className="guided-util-btn"
          aria-label={theme === 'ink' ? '切换为纸色主题' : '切换为墨色主题'}
          onClick={() => void setTheme(theme === 'ink' ? 'paper' : 'ink')}
        >
          {theme === 'ink' ? <Sun size={13} aria-hidden="true" /> : <Moon size={13} aria-hidden="true" />}
          {theme === 'ink' ? '纸色' : '墨色'}
        </button>
        {run ? (
          <button
            type="button"
            className="guided-util-btn"
            disabled={busy || resetting}
            onClick={() => {
              if (run.stage === 'done') void switchTopic();
              else setConfirmSwitch((value) => !value);
            }}
          >
            <PlusCircle size={13} aria-hidden="true" /> 换个主题
          </button>
        ) : null}
        <button type="button" className="guided-util-btn" onClick={() => void enterWorkbench()}>
          <LayoutGrid size={13} aria-hidden="true" /> 完整工作台
        </button>
      </div>
    </div>
  );

  if (loading || loadError || !run) {
    return (
      <main className="guided-flow guided-study">
        {topbar}
        <div className="guided-layout">
          <section className="guided-step">
            <h1 ref={stageTitle} tabIndex={-1}>{loading ? '打开学习' : loadError ? '未能打开学习进度' : '还没有准备好的课程'}</h1>
            {loading ? (
              <p className="guided-status" role="status"><Spinner /> 正在读取本机学习进度</p>
            ) : loadError ? (
              <>
                <p className="guided-error" role="alert">{loadError}</p>
                <div className="guided-actions">
                  <button type="button" className="btn btn-primary" onClick={() => setLoadVersion((value) => value + 1)}>
                    重新读取
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => void enterWorkbench()}>
                    进入完整工作台
                  </button>
                </div>
              </>
            ) : (
              <div className="guided-actions">
                <button type="button" className="btn btn-primary" onClick={() => navigate({ name: 'onboarding' }, { replace: true })}>
                  准备一节课 <ArrowRight size={15} aria-hidden="true" />
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => void enterWorkbench()}>
                  进入完整工作台
                </button>
              </div>
            )}
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="guided-flow guided-study">
      {topbar}
      <div className="guided-layout">
        <header className="guided-study-header">
          <div>
            <h1 className="guided-lesson-title">{run.lesson.title}</h1>
            {run.lesson.topic !== run.lesson.title ? <p className="guided-muted">{run.lesson.topic}</p> : null}
          </div>
          {run.stage !== 'done' ? <span className="guided-count">{run.current} / {run.total}</span> : null}
        </header>

        {run.lesson.overview ? (
          <div className="guided-overview-card">{run.lesson.overview}</div>
        ) : null}

        <div className="guided-item-pills" aria-label="本节卡片进度">
          {Array.from({ length: run.total }, (_, idx) => {
            const num = idx + 1;
            const isDone = run.stage === 'done' || num < run.current;
            const isActive = run.stage !== 'done' && num === run.current;
            return (
              <span
                key={num}
                className={`guided-item-pill${isDone ? ' done' : ''}${isActive ? ' active' : ''}`}
              >
                {isDone ? <Check size={11} aria-hidden="true" /> : num}
                <span>第 {num} 题</span>
              </span>
            );
          })}
        </div>

        {confirmSwitch ? (
          <div className="guided-overview-card" role="region" aria-label="确认切换主题">
            <p className="guided-lesson-copy">确定放弃当前课节进度并选择新主题吗？</p>
            <div className="guided-actions" style={{ marginTop: 10 }}>
              <button type="button" className="btn btn-danger btn-sm" disabled={resetting} onClick={() => void switchTopic()}>
                {resetting ? <Spinner /> : <PlusCircle size={14} aria-hidden="true" />} 确认换个主题
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmSwitch(false)}>
                继续学习当前课
              </button>
            </div>
          </div>
        ) : null}

        <section className="guided-step" aria-labelledby="guided-stage-title" aria-busy={busy}>
          {run.stage === 'read' ? (
            <>
              <h2 id="guided-stage-title" ref={stageTitle} tabIndex={-1}>讲解</h2>
              <p className="guided-lesson-copy">{run.explanation}</p>
              <div className="guided-example">
                <h3>例子</h3>
                <p className="guided-lesson-copy">{run.example}</p>
              </div>
              <StudySource source={run.source} />
              <StudyError error={error} />
              <div className="guided-actions">
                <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void act(() => guidedStudy.startQuestion(run.lesson.id, run.cardId))}>
                  {busy ? <Spinner /> : <ArrowRight size={15} aria-hidden="true" />} 答一题
                </button>
              </div>
            </>
          ) : run.stage === 'question' ? (
            <form className="guided-form" onSubmit={checkAnswer}>
              <h2 id="guided-stage-title" ref={stageTitle} tabIndex={-1}>想一想</h2>
              <p className="guided-prompt">{run.prompt}</p>
              <label className="guided-field" htmlFor="guided-answer">
                你的答案
                <textarea
                  id="guided-answer"
                  className="textarea"
                  rows={4}
                  maxLength={ANSWER_LIMIT}
                  disabled={busy}
                  value={draft}
                  aria-describedby="guided-answer-hint"
                  onChange={(event) => changeDraft(event.target.value)}
                  onBlur={saveCurrentDraft}
                  onKeyDown={(event) => {
                    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                      event.preventDefault();
                      submitDraftAnswer();
                    }
                  }}
                />
              </label>
              <span id="guided-answer-hint" className="guided-muted">按 Ctrl / ⌘ + Enter 可快速提交。</span>
              <div className="guided-draft">
                <p className={draftState === 'failed' ? 'guided-error' : 'guided-muted'} role={draftState === 'failed' ? 'alert' : 'status'}>
                  {draftState === 'saved' ? '草稿已保存'
                    : draftState === 'failed' ? '草稿未保存'
                      : draftState === 'saving' || draftState === 'pending' ? '草稿正在保存…' : ''}
                </p>
                {draftState === 'failed' ? (
                  <button className="btn btn-ghost btn-sm" type="button" onClick={saveCurrentDraft} disabled={busy}>重新保存草稿</button>
                ) : null}
              </div>
              <StudyError error={error} />
              <div className="guided-actions">
                <button className="btn btn-primary" type="submit" disabled={busy || !draft.trim()}>
                  {busy ? <Spinner /> : <ArrowRight size={15} aria-hidden="true" />} 看答案
                </button>
                <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => void act(() => guidedStudy.submitAnswer({ attemptId: run.attemptId, answer: null }), true)}>
                  想不起来
                </button>
              </div>
            </form>
          ) : run.stage === 'compare' ? (
            <>
              <h2 id="guided-stage-title" ref={stageTitle} tabIndex={-1}>核对答案</h2>
              <p className="guided-prompt">{run.prompt}</p>
              <dl className="guided-compare">
                <div><dt>你的答案</dt><dd>{run.answer ?? '想不起来'}</dd></div>
                <div><dt>参考答案</dt><dd>{run.referenceAnswer}</dd></div>
              </dl>
              {run.correction ? <p className="guided-lesson-copy">{run.correction}</p> : null}
              <StudySource source={run.source} />
              <StudyError error={error} />
              <div className="guided-actions">
                {run.answer === null ? (
                  <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void act(() => guidedStudy.confirmAnswer({ attemptId: run.attemptId, grade: 0 }))}>
                    {busy ? <Spinner /> : <ArrowRight size={15} aria-hidden="true" />} 下次再练
                  </button>
                ) : (
                  <>
                    <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void act(() => guidedStudy.confirmAnswer({ attemptId: run.attemptId, grade: 2 }))}>
                      {busy ? <Spinner /> : <Check size={15} aria-hidden="true" />} 我答对了
                    </button>
                    <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => void act(() => guidedStudy.confirmAnswer({ attemptId: run.attemptId, grade: 0 }))}>
                      我需要再练
                    </button>
                  </>
                )}
              </div>
              <p className="guided-muted">
                {run.answer === null ? '快捷键：按 2 确认下次再练' : '快捷键：按 1 我答对了 · 按 2 我需要再练'}
              </p>
            </>
          ) : (
            <>
              <h2 id="guided-stage-title" ref={stageTitle} tabIndex={-1}>本节完成</h2>
              <p className="guided-ready-title"><Check size={18} aria-hidden="true" /> 已保存 {run.completed} 题</p>
              {run.nextDueLabel ? <p className="guided-muted">下次复习：{run.nextDueLabel}</p> : null}
              <StudyError error={error} />
              <div className="guided-done-actions">
                {run.reviewAvailable ? (
                  <button className="btn btn-primary" type="button" disabled={busy || resetting} onClick={() => void act(() => guidedStudy.beginReview(run.lesson.id))}>
                    {busy ? <Spinner /> : <RotateCcw size={15} aria-hidden="true" />} 开始复习
                  </button>
                ) : null}
                <button
                  className={run.reviewAvailable ? 'btn btn-subtle' : 'btn btn-primary'}
                  type="button"
                  disabled={busy || resetting}
                  onClick={() => void switchTopic()}
                >
                  {resetting ? <Spinner /> : <PlusCircle size={15} aria-hidden="true" />} 学习新主题
                </button>
                <button className="btn btn-ghost" type="button" disabled={busy || resetting} onClick={() => void enterWorkbench()}>
                  <LayoutGrid size={15} aria-hidden="true" /> 进入完整工作台
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}

function StudySource({ source }: { source?: GuidedSourceProof }) {
  if (!source) return null;
  return (
    <details className="guided-details guided-study-source">
      <summary><BookOpen size={13} aria-hidden="true" /> 资料出处</summary>
      <p>{source.label}</p>
      {source.excerpt ? (
        <>
          <p className="guided-muted">依据摘自折页整理的资料笔记，并非原站引文。</p>
          <p className="guided-lesson-copy">{source.excerpt}</p>
        </>
      ) : null}
      {source.url ? <p className="guided-source-url">{source.url}</p> : null}
      {source.material ? (
        <>
          <p className="guided-muted">完整本地笔记</p>
          <pre tabIndex={0} aria-label="完整本地笔记">{source.material}</pre>
        </>
      ) : null}
    </details>
  );
}

function StudyError({ error }: { error: string }) {
  return error ? <p className="guided-error" role="alert">{error}</p> : null;
}
