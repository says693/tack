import { useCallback, useEffect, useState } from 'react';
import {
  Archive,
  CheckCircle2,
  FileSearch,
  Layers,
  Pause,
  PenLine,
  Play,
  Sparkles,
} from 'lucide-react';

import { Modal } from '@/components/Modal';
import { EmptyState, ErrorState, Field, Loading, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { normalizeError } from '@/lib/bridge';
import {
  originLabel,
  relativeDue,
  statusLabel,
} from '@/lib/format';
import { useApp } from '@/store';
import type { CardSummary } from '@/types';

const FILTERS: { key: string; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'draft', label: '草稿' },
  { key: 'active', label: '启用' },
  { key: 'paused', label: '暂停' },
  { key: 'archived', label: '归档' },
];

function statusTone(status: string): string {
  if (status === 'draft') return 'chip-amber';
  if (status === 'active') return 'chip-jade';
  if (status === 'paused') return 'chip-danger';
  return 'chip-plain';
}

export function CardsScreen({ initialStatus }: { initialStatus?: string }) {
  const overview = useApp((state) => state.overview);
  const navigate = useApp((state) => state.navigate);
  const refreshOverview = useApp((state) => state.refreshOverview);
  const toast = useApp((state) => state.toast);
  const [filter, setFilter] = useState(initialStatus ?? 'all');
  const [cards, setCards] = useState<CardSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingArchive, setPendingArchive] = useState<CardSummary | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualBusy, setManualBusy] = useState(false);
  const [manualConcept, setManualConcept] = useState('');
  const [manualQuestion, setManualQuestion] = useState('');
  const [manualAnswer, setManualAnswer] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await api.listCards(filter === 'all' ? undefined : filter);
      setCards(rows);
    } catch (err) {
      setError(normalizeError(err).message);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
    void refreshOverview();
  }, [load, refreshOverview]);

  async function pause(card: CardSummary) {
    setBusyId(card.id);
    try {
      await api.pauseCard(card.id, '手动暂停');
      await Promise.all([load(), refreshOverview()]);
      toast('success', '卡片已暂停', '排期保留；恢复后按原来的到期日继续。');
    } catch (err) {
      toast('error', '暂停失败', normalizeError(err).message);
    } finally {
      setBusyId(null);
    }
  }

  async function resume(card: CardSummary) {
    setBusyId(card.id);
    try {
      await api.resolveCardRevision(card.id, 'keep');
      await Promise.all([load(), refreshOverview()]);
      toast('success', '卡片已恢复', '保留了原来的概念排期。');
    } catch (err) {
      toast('error', '恢复失败', normalizeError(err).message);
    } finally {
      setBusyId(null);
    }
  }

  function openManual() {
    setManualConcept('');
    setManualQuestion('');
    setManualAnswer('');
    setManualOpen(true);
  }

  async function createManual() {
    if (manualBusy) return;
    if (!manualConcept.trim() || !manualQuestion.trim() || !manualAnswer.trim()) {
      toast('info', '还差一点', '概念名、题目与参考答案都需要填写。');
      return;
    }
    setManualBusy(true);
    try {
      const detail = await api.createCardDraft({
        conceptName: manualConcept.trim(),
        question: manualQuestion.trim(),
        answer: manualAnswer.trim(),
        evidenceChunkId: null,
        evidenceExcerpt: '',
        exerciseOrigin: 'unspecified',
        originNote: '用户手写 · 个人自评',
        mode: 'self',
        sessionId: null,
      });
      setManualOpen(false);
      await Promise.all([load(), refreshOverview()]);
      toast('success', '已保存为自评草稿', '还没有进入队列。检查题目与答案后，再点「收下」。');
      navigate({ name: 'card', cardId: detail.summary.id });
    } catch (err) {
      toast('error', '没有保存', normalizeError(err).message);
    } finally {
      setManualBusy(false);
    }
  }

  async function archive() {
    if (!pendingArchive || busyId) return;
    setBusyId(pendingArchive.id);
    try {
      await api.archiveCard(pendingArchive.id);
      setPendingArchive(null);
      await Promise.all([load(), refreshOverview()]);
      toast('success', '卡片已归档', '历史修订与复习记录保留，不再进入队列。');
    } catch (err) {
      toast('error', '归档失败', normalizeError(err).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="cards-screen">
      <div className="cards-head">
        <div className="library-title-row">
          <div>
            <div className="eyebrow">Cards · {overview?.activeCards ?? 0} 张启用</div>
            <h1 className="cards-title" style={{ marginTop: 6 }}>
              卡片
            </h1>
            <p className="cards-sub">
              每一张都保留来源、引用与修订历史。草稿只有被你收下，才会进入队列。
            </p>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-sm btn-ghost" onClick={openManual}>
              <PenLine size={12} />
              手写卡片
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => navigate({ name: 'library' })}>
              <Sparkles size={12} />
              从原文出卡
            </button>
          </div>
        </div>
        <div className="card-filters">
          {FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`card-filter${filter === item.key ? ' active' : ''}`}
              onClick={() => setFilter(item.key)}
            >
              {item.label}
              {item.key === 'draft' && overview?.drafts ? (
                <span className="nav-count" style={{ marginLeft: 4 }}>
                  {overview.drafts}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      <div className="scroll cards-scroll">
        {loading ? (
          <Loading label="正在整理卡片…" />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : cards.length === 0 ? (
          <EmptyState
            icon={filter === 'draft' ? FileSearch : Layers}
            title={
              filter === 'all'
                ? '还没有卡片'
                : filter === 'draft'
                  ? '没有待确认的草稿'
                  : `没有${FILTERS.find((item) => item.key === filter)?.label ?? ''}的卡片`
            }
            copy={
              filter === 'all'
                ? '先读一段原文，选中一句话，在分叉里把解释收成草稿。你也可以在卡片编辑页手写一张带证据的卡。'
                : '换一个筛选，或从原文开始生成一张新卡。'
            }
          >
            <button type="button" className="btn btn-primary" onClick={() => navigate({ name: 'library' })}>
              去书架
            </button>
            {filter !== 'all' ? (
              <button type="button" className="btn btn-ghost" onClick={() => setFilter('all')}>
                看全部
              </button>
            ) : null}
          </EmptyState>
        ) : (
          <div>
            {cards.map((card) => (
              <div key={card.id} className="card-row">
                <button
                  type="button"
                  className="card-row-main"
                  onClick={() => navigate({ name: 'card', cardId: card.id })}
                >
                  <span className="card-row-question">{card.question}</span>
                  <span className="card-row-excerpt">{card.evidenceExcerpt}</span>
                  <span className="card-row-meta">
                    <span className={`chip ${statusTone(card.status)}`}>{statusLabel(card.status)}</span>
                    <span className="chip chip-plain">{card.mode === 'self' ? '自评' : 'AI 参考'}</span>
                    <span className="chip chip-plain">{originLabel(card.exerciseOrigin)}</span>
                    {card.sourceTitle ? <span className="chip">{card.sourceTitle}</span> : null}
                    <span className="faint tiny">
                      {card.status === 'draft'
                        ? '未入队'
                        : card.status === 'archived'
                          ? '已归档'
                          : relativeDue(card.dueOn)}
                    </span>
                  </span>
                </button>
                <div className="card-row-side">
                  <span className="faint tiny mono">
                    {card.reps > 0 ? `${card.reps} 次 · ${card.lapses} 次遗忘` : '未复习'}
                  </span>
                  <div className="card-row-actions">
                    <button
                      type="button"
                      className="icon-btn"
                      title="打开卡片"
                      aria-label="打开卡片"
                      onClick={() => navigate({ name: 'card', cardId: card.id })}
                    >
                      <PenLine size={13} />
                    </button>
                    {card.status === 'active' ? (
                      <button
                        type="button"
                        className="icon-btn"
                        title="暂停"
                        aria-label="暂停"
                        disabled={busyId === card.id}
                        onClick={() => void pause(card)}
                      >
                        {busyId === card.id ? <Spinner size={13} /> : <Pause size={13} />}
                      </button>
                    ) : null}
                    {card.status === 'paused' ? (
                      <button
                        type="button"
                        className="icon-btn"
                        title="恢复"
                        aria-label="恢复"
                        disabled={busyId === card.id}
                        onClick={() => void resume(card)}
                      >
                        {busyId === card.id ? <Spinner size={13} /> : <Play size={13} />}
                      </button>
                    ) : null}
                    {card.status !== 'archived' ? (
                      <button
                        type="button"
                        className="icon-btn close"
                        title="归档"
                        aria-label="归档"
                        onClick={() => setPendingArchive(card)}
                      >
                        <Archive size={13} />
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}

            <div className="today-footnote" style={{ marginTop: 20 }}>
              <span>{cards.length} 张 · 调度器 FOLD-SM2E-1</span>
              <span>草稿不计入到期</span>
            </div>
          </div>
        )}
      </div>

      <Modal
        open={manualOpen}
        title="手写一张自评卡"
        subtitle="不调用模型，也不会被标成教材原题。先保存为草稿，检查后再收下。"
        onClose={() => (manualBusy ? undefined : setManualOpen(false))}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setManualOpen(false)} disabled={manualBusy}>
              取消
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void createManual()} disabled={manualBusy}>
              {manualBusy ? <Spinner /> : <PenLine size={14} />}
              保存草稿
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="概念名" hint="会复用同名概念；之后可以继续补充卡片。">
            <input
              className="input"
              value={manualConcept}
              onChange={(event) => setManualConcept(event.target.value)}
              placeholder="例如：登记顺序"
              autoFocus
            />
          </Field>
          <Field label="题目" hint="问一个能靠独立回忆回答的问题，不把答案写进题干。">
            <textarea
              className="textarea"
              rows={3}
              value={manualQuestion}
              onChange={(event) => setManualQuestion(event.target.value)}
              placeholder="例如：在材料 A 的版本 1 中，条目何时从蓝色盒移到绿色盒？"
            />
          </Field>
          <Field label="参考答案">
            <textarea
              className="textarea"
              rows={3}
              value={manualAnswer}
              onChange={(event) => setManualAnswer(event.target.value)}
              placeholder="例如：登记完成后。"
            />
          </Field>
          <div className="settings-note">
            这张卡没有绑定原文证据，因此只能作为个人自评使用；AI 不会替它评分，也不会伪装成已核实的事实。
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(pendingArchive)}
        title="归档这张卡？"
        subtitle="归档后不再进入复习队列。卡片的历史修订、首次答案与复习记录都会保留。"
        onClose={() => (busyId ? undefined : setPendingArchive(null))}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setPendingArchive(null)} disabled={Boolean(busyId)}>
              留着
            </button>
            <button type="button" className="btn btn-danger" onClick={() => void archive()} disabled={Boolean(busyId)}>
              {busyId ? <Spinner /> : <Archive size={14} />}
              归档卡片
            </button>
          </>
        }
      >
        <div className="panel-card" style={{ padding: 14 }}>
          <div className="card-row-question">{pendingArchive?.question}</div>
          <div className="card-row-meta" style={{ marginTop: 6 }}>
            <span className="chip">{pendingArchive?.conceptName}</span>
            <span className="chip chip-plain">{pendingArchive ? originLabel(pendingArchive.exerciseOrigin) : ''}</span>
            <span className="chip chip-plain">{pendingArchive?.reps ?? 0} 次复习</span>
          </div>
        </div>
        <div className="settings-note">
          如果只是想暂时停止，请用「暂停」而不是归档。暂停会完整保留真实到期日。
        </div>
      </Modal>
    </div>
  );
}
