import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Check,
  FileWarning,
  Pause,
  PenLine,
  Play,
  RotateCcw,
  Sparkles,
} from 'lucide-react';

import { Modal } from '@/components/Modal';
import { ErrorState, Loading, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { normalizeError } from '@/lib/bridge';
import {
  formatDateCN,
  originDescription,
  originLabel,
  relativeDue,
  schedulerLabel,
  statusLabel,
} from '@/lib/format';
import { useApp } from '@/store';
import type { CardDetail, ExerciseOrigin } from '@/types';

const ORIGINS: ExerciseOrigin[] = ['source_exact', 'adapted', 'generated', 'unspecified'];

function statusTone(status: string): string {
  if (status === 'draft') return 'chip-amber';
  if (status === 'active') return 'chip-jade';
  if (status === 'paused') return 'chip-danger';
  return 'chip-plain';
}

export function CardDetailScreen({ cardId }: { cardId: string }) {
  const navigate = useApp((state) => state.navigate);
  const goBack = useApp((state) => state.goBack);
  const refreshOverview = useApp((state) => state.refreshOverview);
  const toast = useApp((state) => state.toast);
  const [detail, setDetail] = useState<CardDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [origin, setOrigin] = useState<ExerciseOrigin>('generated');
  const [originNote, setOriginNote] = useState('');
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  const applyDetail = useCallback((next: CardDetail) => {
    setDetail(next);
    setQuestion(next.revisions[0]?.question ?? '');
    setAnswer(next.revisions[0]?.answer ?? '');
    setExcerpt(next.revisions[0]?.evidenceExcerpt ?? '');
    setOrigin(next.revisions[0]?.exerciseOrigin ?? 'generated');
    setOriginNote(next.revisions[0]?.originNote ?? '');
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await api.card(cardId);
      applyDetail(next);
    } catch (err) {
      setError(normalizeError(err).message);
    } finally {
      setLoading(false);
    }
  }, [applyDetail, cardId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveEdit() {
    if (!detail || busy) return;
    if (!question.trim() || !answer.trim()) {
      toast('error', '题目与答案都不能为空');
      return;
    }
    setBusy('save');
    try {
      const result = await api.updateCard(detail.summary.id, {
        question: question.trim(),
        answer: answer.trim(),
        evidenceChunkId: detail.evidence?.id ?? null,
        evidenceExcerpt: excerpt.trim(),
        exerciseOrigin: origin,
        originNote: originNote.trim() || null,
      });
      applyDetail(result.card);
      setEditing(false);
      await refreshOverview();
      if (result.needsScheduleDecision) {
        toast(
          'info',
          '修订已保存，需要排期决定',
          '这张卡在启用中改变了含义。请选择保留原排期，或重置这个概念。',
        );
      } else if (result.semanticChange) {
        toast('success', '修订已保存', '历史修订仍保留，旧复习记录没有被改写。');
      } else {
        toast('success', '已保存');
      }
    } catch (err) {
      toast('error', '保存失败', normalizeError(err).message);
    } finally {
      setBusy(null);
    }
  }

  async function accept() {
    if (!detail || busy) return;
    setBusy('accept');
    try {
      const next = await api.acceptCard(detail.summary.id);
      applyDetail(next);
      await refreshOverview();
      toast('success', '卡片已收下', '已加入新卡队列。到期日会从下一次复习开始计算。');
    } catch (err) {
      toast('error', '收下失败', normalizeError(err).message);
    } finally {
      setBusy(null);
    }
  }

  async function pause() {
    if (!detail || busy) return;
    setBusy('pause');
    try {
      const next = await api.pauseCard(detail.summary.id, '手动暂停');
      applyDetail(next);
      await refreshOverview();
      toast('success', '已暂停');
    } catch (err) {
      toast('error', '暂停失败', normalizeError(err).message);
    } finally {
      setBusy(null);
    }
  }

  async function resolve(decision: 'keep' | 'reset') {
    if (!detail || busy) return;
    setBusy(decision);
    try {
      const next = await api.resolveCardRevision(detail.summary.id, decision);
      applyDetail(next);
      setResetOpen(false);
      await refreshOverview();
      toast(
        'success',
        decision === 'keep' ? '已保留原排期' : '已重置这个概念',
        decision === 'keep' ? '卡片恢复启用。' : '下次会以新卡出现；旧的复习历史仍在。',
      );
    } catch (err) {
      toast('error', '操作失败', normalizeError(err).message);
    } finally {
      setBusy(null);
    }
  }

  async function archive() {
    if (!detail || busy) return;
    setBusy('archive');
    try {
      await api.archiveCard(detail.summary.id);
      await refreshOverview();
      setArchiveOpen(false);
      toast('success', '卡片已归档');
      navigate({ name: 'cards' });
    } catch (err) {
      toast('error', '归档失败', normalizeError(err).message);
    } finally {
      setBusy(null);
    }
  }

  function locateEvidence() {
    if (!detail?.evidence || !detail.summary.sourceId) return;
    sessionStorage.setItem(
      'fold:focus',
      JSON.stringify({
        sourceId: detail.summary.sourceId,
        start: detail.evidence.startUtf16,
        end: detail.evidence.endUtf16,
      }),
    );
    navigate({
      name: 'reader',
      sourceId: detail.summary.sourceId,
      revisionId: detail.evidence.revisionId,
    });
  }

  if (loading && !detail) {
    return (
      <div className="card-detail-screen">
        <Loading label="正在打开卡片…" />
      </div>
    );
  }

  if (error && !detail) {
    return (
      <div className="card-detail-screen">
        <ErrorState message={error} onRetry={() => void load()} />
      </div>
    );
  }

  if (!detail) return null;

  const summary = detail.summary;
  const concept = detail.concept;
  const current = detail.revisions[0];
  const canEdit = summary.status !== 'archived';
  const paused = summary.status === 'paused';

  return (
    <div className="card-detail-screen">
      <div className="card-detail-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" className="icon-btn" aria-label="返回" onClick={goBack}>
            <ArrowLeft size={16} />
          </button>
          <div className="eyebrow truncate" style={{ flex: 1 }}>{summary.conceptName}</div>
          <button type="button" className="link" style={{ fontSize: 10 }} onClick={() => navigate({ name: 'cards' })}>
            全部卡片
          </button>
        </div>
        <h1 className="card-detail-title" style={{ marginTop: 10 }}>
          {current?.question ?? summary.question}
        </h1>
        <div className="card-detail-meta">
          <span className={`chip ${statusTone(summary.status)}`}>{statusLabel(summary.status)}</span>
          <span className="chip chip-plain">{summary.mode === 'self' ? '自评卡' : 'AI 参考'}</span>
          <span className="chip chip-plain">{originLabel(current?.exerciseOrigin ?? summary.exerciseOrigin)}</span>
          {summary.sourceTitle ? (
            <span className="chip">{summary.sourceTitle}</span>
          ) : (
            <span className="chip chip-danger">无来源证据</span>
          )}
          <span className="chip chip-plain">{schedulerLabel(concept.state)}</span>
        </div>
        {!editing ? (
          <div className="card-detail-actions">
            {summary.status === 'draft' ? (
              <button type="button" className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => void accept()}>
                {busy === 'accept' ? <Spinner size={12} /> : <Check size={13} />}
                收下并加入队列
              </button>
            ) : null}
            {canEdit ? (
              <button type="button" className="btn btn-sm btn-subtle" onClick={() => setEditing(true)}>
                <PenLine size={13} />
                编辑题目与证据
              </button>
            ) : null}
            {summary.status === 'active' ? (
              <button type="button" className="btn btn-sm btn-ghost" disabled={Boolean(busy)} onClick={() => void pause()}>
                {busy === 'pause' ? <Spinner size={12} /> : <Pause size={12} />}
                暂停
              </button>
            ) : null}
            {summary.status !== 'archived' ? (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setArchiveOpen(true)}>
                归档
              </button>
            ) : null}
            {summary.status === 'active' ? (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                style={{ marginLeft: 'auto' }}
                onClick={() => navigate({ name: 'today' })}
              >
                回到今日
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="scroll card-detail-scroll">
        {paused ? (
          <div className="decision-box">
            <div className="decision-head">
              <RotateCcw size={15} />
              <span>这张卡已暂停</span>
            </div>
            <p className="field-hint" style={{ marginTop: 5 }}>
              {summary.pausedReason || '排期已暂停，不会出现在队列里。'}
              {summary.pausedReason?.includes('修订') ? ' 这次修订改变了题目或答案的含义。' : ''}
            </p>
            <div className="decision-actions">
              <button type="button" className="btn btn-sm btn-subtle" disabled={Boolean(busy)} onClick={() => void resolve('keep')}>
                {busy === 'keep' ? <Spinner size={12} /> : <Play size={12} />}
                保留原排期，恢复
              </button>
              <button type="button" className="btn btn-sm btn-ghost" disabled={Boolean(busy)} onClick={() => setResetOpen(true)}>
                <RotateCcw size={12} />
                重置这个概念
              </button>
            </div>
          </div>
        ) : null}

        {editing ? (
          <div className="panel-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="section-label">编辑卡片</div>
            <label className="field">
              <span className="field-label">
                <span>题目</span>
                <span className="tiny faint">修改会造成新的历史修订</span>
              </span>
              <textarea
                className="textarea"
                style={{ minHeight: 82 }}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">答案</span>
              <textarea
                className="textarea"
                style={{ minHeight: 92 }}
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">
                <span>证据摘录</span>
                <span className="tiny faint">{excerpt.length} 字</span>
              </span>
              <textarea
                className="textarea"
                style={{ minHeight: 72 }}
                value={excerpt}
                onChange={(event) => setExcerpt(event.target.value)}
                placeholder="必须是这段原文中真实存在的文字，批改时会逐字核对。"
              />
            </label>
            <div className="form-row">
              <label className="field">
                <span className="field-label">题目来源</span>
                <select className="select" value={origin} onChange={(event) => setOrigin(event.target.value as ExerciseOrigin)}>
                  {ORIGINS.map((item) => (
                    <option key={item} value={item}>
                      {originLabel(item)}
                    </option>
                  ))}
                </select>
                <span className="field-hint">{originDescription(origin)}</span>
              </label>
              <label className="field">
                <span className="field-label">来源备注</span>
                <input
                  className="input"
                  value={originNote}
                  onChange={(event) => setOriginNote(event.target.value)}
                  placeholder="例如：由原文新编，改动了数字"
                />
              </label>
            </div>
            {detail.evidence ? (
              <div className="evidence-box" style={{ marginTop: 0 }}>
                <div className="evidence-excerpt">“{detail.evidence.quoteExact.slice(0, 220)}”</div>
                <div className="evidence-meta">
                  <span>{summary.sourceTitle ?? '来源未提供'}</span>
                  <span>·</span>
                  <span>{detail.evidence.locator ?? '原文'}</span>
                </div>
              </div>
            ) : (
              <div className="settings-note">
                这张卡没有绑定原文证据。AI 批改会拒绝给分；你可以保留它作为自评卡，或从阅读页重新建卡。
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 7 }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setEditing(false);
                  applyDetail(detail);
                }}
                disabled={Boolean(busy)}
              >
                取消
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void saveEdit()} disabled={Boolean(busy)}>
                {busy === 'save' ? <Spinner /> : <Check size={14} />}
                保存修订
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="eyebrow">Answer</div>
            <div className="detail-answer">{current?.answer ?? ''}</div>

            {current?.originNote ? (
              <p className="field-hint" style={{ marginTop: 8 }}>
                题目来源备注：{current.originNote}
              </p>
            ) : null}
          </>
        )}

        <div className="section-head" style={{ marginTop: 24 }}>
          <div className="eyebrow">Evidence</div>
          {detail.evidence ? (
            <button type="button" className="link" style={{ fontSize: 10 }} onClick={locateEvidence}>
              <BookOpen size={11} style={{ verticalAlign: -1, marginRight: 3 }} />
              定位原文
            </button>
          ) : null}
        </div>

        {detail.evidence ? (
          <div className="evidence-box" style={{ marginTop: 0 }}>
            <div className="evidence-excerpt">“{detail.evidence.quoteExact}”</div>
            <div className="evidence-meta">
              <span>{summary.sourceTitle ?? '来源未提供'}</span>
              <span>·</span>
              <span>{detail.evidence.locator ?? '原文'}</span>
              <span>·</span>
              <span>
                UTF-16 {detail.evidence.startUtf16}–{detail.evidence.endUtf16}
              </span>
              <span className="chip chip-jade">逐字锚定</span>
            </div>
          </div>
        ) : (
          <div className="ai-error-box" style={{ marginTop: 0 }}>
            <div className="ai-error-title">
              <FileWarning size={14} /> 没有可核对证据
            </div>
            <div className="ai-error-copy">
              缺证据的卡片不能得到 AI 评分。它可以继续作为自评卡存在，但不会被伪装成「已核实」。
            </div>
          </div>
        )}

        <div className="section-head" style={{ marginTop: 24 }}>
          <div className="eyebrow">Schedule</div>
          <span className="faint tiny">调度器 {concept.scheduler}</span>
        </div>
        <div className="stat-strip" style={{ marginTop: 0 }}>
          <div className="stat-box">
            <div className="stat-label">下次到期</div>
            <div className="stat-value" style={{ fontSize: 17 }}>
              {concept.dueOn ? relativeDue(concept.dueOn) : '未入队'}
            </div>
            <div className="faint tiny" style={{ marginTop: 4 }}>{concept.dueOn ?? '—'}</div>
          </div>
          <div className="stat-box">
            <div className="stat-label">当前间隔</div>
            <div className="stat-value">
              {concept.intervalDays}
              <small> 天</small>
            </div>
            <div className="faint tiny" style={{ marginTop: 4 }}>ease {concept.ease.toFixed(2)}</div>
          </div>
          <div className="stat-box">
            <div className="stat-label">提取记录</div>
            <div className="stat-value">
              {concept.reps}
              <small> 次</small>
            </div>
            <div className="faint tiny" style={{ marginTop: 4 }}>遗忘 {concept.lapses} 次</div>
          </div>
        </div>
        <p className="field-hint" style={{ marginTop: 9 }}>
          状态 {schedulerLabel(concept.state)} ·{' '}
          {concept.dueOn
            ? `最近复习 ${concept.lastReviewedAt ? formatDateCN(concept.lastReviewedAt) : '—'}`
            : '还没有确认过复习'}
          。到期日只来自已确认的复习。
        </p>

        <div className="section-head" style={{ marginTop: 24 }}>
          <div className="eyebrow">Revisions · {detail.revisions.length}</div>
          <span className="faint tiny">最新在前</span>
        </div>
        <div className="revision-list">
          {detail.revisions.map((revision, index) => (
            <div key={revision.id} className="revision-item">
              <div className="revision-no">R{detail.revisions.length - index}</div>
              <div>
                <div className="revision-question">{revision.question}</div>
                <div className="revision-meta">
                  {formatDateCN(revision.createdAt)} · {originLabel(revision.exerciseOrigin)}
                  {index === 0 ? ' · 当前' : ''}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="today-footnote" style={{ marginTop: 24 }}>
          <span>概念 {summary.conceptName}</span>
          <span>
            {summary.mode === 'self' ? '自评模式' : 'AI 反馈 · 人工确认'} ·{' '}
            {summary.status === 'active' && concept.dueOn ? relativeDue(concept.dueOn) : statusLabel(summary.status)}
          </span>
        </div>
      </div>

      <Modal
        open={archiveOpen}
        title="归档这张卡？"
        subtitle="不再进入复习队列。历史修订、作答记录与已有排期状态都保留在本地。"
        onClose={() => setArchiveOpen(false)}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setArchiveOpen(false)}>
              取消
            </button>
            <button type="button" className="btn btn-danger" disabled={busy === 'archive'} onClick={() => void archive()}>
              {busy === 'archive' ? <Spinner /> : null}
              归档
            </button>
          </>
        }
      >
        <div className="panel-card" style={{ padding: 14 }}>
          <div className="card-row-question">{current?.question}</div>
          <p className="field-hint" style={{ marginTop: 6 }}>
            如果只是想暂时停止，请用「暂停」。归档后再次启用需要重新建立排期决定。
          </p>
        </div>
      </Modal>

      <Modal
        open={resetOpen}
        title="重置这个概念？"
        subtitle="排期会回到「未开始」，下次作为新卡出现。旧的复习历史与首次答案不会被删除。"
        onClose={() => setResetOpen(false)}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setResetOpen(false)}>
              保留原排期
            </button>
            <button type="button" className="btn btn-danger" disabled={busy === 'reset'} onClick={() => void resolve('reset')}>
              {busy === 'reset' ? <Spinner /> : <RotateCcw size={14} />}
              重置并恢复
            </button>
          </>
        }
      >
        <div className="settings-note">
          只有你真的认为这张卡已经变成另一个概念时，才需要重置。仅仅改写措辞，请保留原排期。
        </div>
      </Modal>
    </div>
  );
}
