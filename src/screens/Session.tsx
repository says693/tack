import { useEffect, useRef, useState } from 'react';
import {
  Archive,
  ArrowLeft,
  BookOpen,
  CornerDownRight,
  Maximize2,
  MessageSquare,
  Quote,
  Sparkles,
} from 'lucide-react';

import { Composer } from '@/components/Composer';
import { MessageBubble } from '@/components/MessageBubble';
import { Modal } from '@/components/Modal';
import { ErrorState, Loading, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { normalizeError } from '@/lib/bridge';
import { intentLabel, relativeTime } from '@/lib/format';
import { useSessionThread } from '@/hooks/useSessionThread';
import { useApp } from '@/store';
import type { MessageView } from '@/types';

const PROMPTS = [
  '这段原文在说什么？用我自己的话拆开。',
  '考考我，先别给答案。',
  '给我一个反例，看看这个规则在哪里不成立。',
];

export function SessionScreen({ sessionId }: { sessionId: string }) {
  const navigate = useApp((state) => state.navigate);
  const goBack = useApp((state) => state.goBack);
  const model = useApp((state) => state.model);
  const refreshLibrary = useApp((state) => state.refreshLibrary);
  const refreshOverview = useApp((state) => state.refreshOverview);
  const setWindowMode = useApp((state) => state.setWindowMode);
  const toast = useApp((state) => state.toast);
  const thread = useSessionThread(sessionId);
  const { detail, loading, error, send, sending, patchSession } = thread;
  const [composer, setComposer] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [intentBusy, setIntentBusy] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);

  const messages = detail?.messages ?? [];
  const last = messages[messages.length - 1];
  const streaming = messages.some((message) => message.status === 'streaming');

  useEffect(() => {
    const element = bodyRef.current;
    if (!element || messages.length === 0) return;
    if (last?.status === 'streaming' && !stickRef.current) return;
    element.scrollTop = element.scrollHeight;
  }, [messages.length, last?.content, last?.status]);

  async function setIntent(intent: 'learn' | 'review' | 'unspecified') {
    if (!detail || intentBusy || detail.session.intent === intent) return;
    setIntentBusy(true);
    try {
      const session = await api.setSessionIntent(detail.session.id, intent);
      patchSession(session);
    } catch (err) {
      toast('error', '没有改成功', normalizeError(err).message);
    } finally {
      setIntentBusy(false);
    }
  }

  async function forkMessage(message: MessageView) {
    if (!detail) return;
    try {
      const created = await api.createSession({
        parentId: detail.session.id,
        forkMessageId: message.id,
        chunkId: detail.chunk?.id ?? null,
        name: `分叉 · ${message.content.replace(/[#>*_`\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 30)}`,
        intent: detail.session.intent,
      });
      await refreshLibrary();
      toast('success', '已从这条回复分叉', '父会话与原文引用都保留，分叉不会改写上游。');
      navigate({ name: 'session', sessionId: created.session.id });
    } catch (err) {
      toast('error', '分叉失败', normalizeError(err).message);
    }
  }

  async function generate() {
    if (!detail || generating) return;
    if (!detail.chunk) {
      toast('info', '这条线索没有原文片段', '先在阅读页选中一句话，再开分叉，才能自动生成带证据的卡片。');
      return;
    }
    setGenerating(true);
    setGenerateError(null);
    try {
      const result = await useApp
        .getState()
        .withCloud((ack) => api.generateCardDraft(detail.session.id, ack, detail.chunk?.id ?? null));
      await refreshOverview();
      toast('success', '草稿已生成，等你检查', '它还没有进入队列。确认题目、答案和证据后才会生效。');
      navigate({ name: 'card', cardId: result.draft.summary.id });
    } catch (err) {
      const normalized = normalizeError(err);
      setGenerateError(normalized.message);
      toast('error', '没有生成草稿', normalized.message);
    } finally {
      setGenerating(false);
    }
  }

  async function archive() {
    if (!detail) return;
    try {
      await api.archiveSession(detail.session.id);
      await refreshLibrary();
      toast('success', '线索已归档', '卡片与原文不受影响。');
      navigate({ name: 'today' });
    } catch (err) {
      toast('error', '归档失败', normalizeError(err).message);
    }
  }

  if (loading && !detail) {
    return (
      <div className="session-screen">
        <Loading label="正在接上这条线索…" />
      </div>
    );
  }

  if (error && !detail) {
    return (
      <div className="session-screen">
        <ErrorState message={error} onRetry={() => void thread.refresh()} />
      </div>
    );
  }

  if (!detail) return null;

  const session = detail.session;
  const chunk = detail.chunk;
  const source = detail.source;
  const hasAssistant = messages.some((message) => message.role === 'assistant' && message.status === 'complete');

  return (
    <div className="session-screen">
      <header className="session-header">
        <button type="button" className="icon-btn" aria-label="返回" onClick={goBack}>
          <ArrowLeft size={16} />
        </button>
        <div className="session-head-main">
          <div className="session-title">{session.seedName}</div>
          <div className="session-sub">
            <div className="intent-pills" onClick={(event) => event.stopPropagation()}>
              {(['learn', 'review', 'unspecified'] as const).map((intent) => (
                <button
                  key={intent}
                  type="button"
                  className={session.intent === intent ? 'active' : ''}
                  disabled={intentBusy}
                  onClick={() => void setIntent(intent)}
                >
                  {intentLabel(intent)}
                </button>
              ))}
            </div>
            <span>·</span>
            <span>{messages.length} 条</span>
            {session.depth > 0 ? (
              <>
                <span>·</span>
                <span>第 {session.depth + 1} 层</span>
              </>
            ) : null}
            {session.parentId ? (
              <>
                <span>·</span>
                <button
                  type="button"
                  className="parent-link"
                  title="回到上游线索"
                  onClick={() => navigate({ name: 'session', sessionId: session.parentId! })}
                >
                  <CornerDownRight size={10} />
                  上游
                </button>
              </>
            ) : null}
          </div>
        </div>
        <div className="session-actions">
          <button
            type="button"
            className="icon-btn"
            title="全景视图"
            aria-label="全景视图"
            onClick={() => setWindowMode('panorama')}
          >
            <Maximize2 size={14} />
          </button>
          <button
            type="button"
            className="icon-btn"
            title="归档线索"
            aria-label="归档线索"
            onClick={() => setArchiveOpen(true)}
          >
            <Archive size={14} />
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!chunk || generating}
            onClick={() => void generate()}
          >
            {generating ? <Spinner size={12} /> : <Sparkles size={12} />}
            收成卡片
          </button>
        </div>
      </header>

      <div
        className="session-body"
        ref={bodyRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          stickRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 120;
        }}
      >
        {chunk ? (
          <div className="session-source-strip" style={{ width: '100%', maxWidth: 720, margin: '0 auto' }}>
            <div className="session-source-top">
              <span className="source-quote-label">Forked from source</span>
              {source ? (
                <button
                  type="button"
                  className="link"
                  style={{ fontSize: 9 }}
                  onClick={() => navigate({ name: 'reader', sourceId: source.id, revisionId: chunk.revisionId })}
                >
                  打开原文
                </button>
              ) : null}
            </div>
            <div className="session-source-quote">“{chunk.quoteExact}”</div>
            <div className="session-source-meta">
              {source?.title ?? '来源未提供'} · {chunk.locator ?? '原文'}
            </div>
          </div>
        ) : null}

        {messages.length === 0 ? (
          <div className="session-empty">
            <Quote size={42} className="faint" style={{ opacity: 0.4 }} />
            <h3>从这句话开始</h3>
            <p>
              {chunk
                ? '先问自己：它到底在说什么？再让模型解释。解释只属于这次线索，不会改写原文。'
                : '这条线索还没有绑定原文。你可以直接对话，但自动出卡需要一段选中的原文作为证据。'}
            </p>
            <div className="empty-actions" style={{ flexWrap: 'wrap', justifyContent: 'center' }}>
              {PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  className="btn btn-sm btn-ghost"
                  disabled={sending}
                  onClick={async () => {
                    const ok = await send(prompt);
                    if (ok) stickRef.current = true;
                  }}
                >
                  <MessageSquare size={11} />
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="session-thread">
            {messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                showFork={
                  message.role === 'assistant' &&
                  message.status === 'complete' &&
                  session.depth < 3
                }
                onFork={(target) => void forkMessage(target)}
              />
            ))}
          </div>
        )}

        {hasAssistant && chunk && !streaming ? (
          <div className="insight-card" style={{ width: '100%', maxWidth: 720, margin: '4px auto 0' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="eyebrow">Fold this understanding</div>
              <div className="step-title" style={{ marginTop: 4 }}>
                把这次解释收成一张卡
              </div>
              <p className="step-copy">
                模型只会写草稿。题目、答案与证据由你逐项确认；收下后才进入队列。
              </p>
              {generateError ? (
                <div className="form-error" style={{ marginTop: 8 }}>
                  {generateError}
                  <button type="button" className="link" style={{ marginLeft: 8 }} onClick={() => navigate({ name: 'settings', section: 'model' })}>
                    检查模型设置
                  </button>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={generating}
              onClick={() => void generate()}
            >
              {generating ? <Spinner size={12} /> : <Sparkles size={12} />}
              生成草稿
            </button>
          </div>
        ) : null}

        {detail.drafts.length > 0 ? (
          <div className="pane-section" style={{ width: '100%', maxWidth: 720, margin: '8px auto 0' }}>
            <div className="section-label">这次线索里的卡片草稿</div>
            {detail.drafts.map((draft) => (
              <button
                key={draft.id}
                type="button"
                className="draft-mini"
                style={{ textAlign: 'left', color: 'inherit' }}
                onClick={() => navigate({ name: 'card', cardId: draft.id })}
              >
                <span className="draft-mini-question">{draft.question}</span>
                <span className="draft-mini-meta">
                  <span className={`chip ${draft.status === 'draft' ? 'chip-amber' : 'chip-jade'}`}>
                    {draft.status === 'draft' ? '待确认草稿' : '已启用'}
                  </span>
                  <span className="truncate faint tiny">{draft.evidenceExcerpt}</span>
                </span>
              </button>
            ))}
          </div>
        ) : null}

        <div className="today-footnote" style={{ marginTop: 8 }}>
          <span>创建于 {relativeTime(session.createdAt)}</span>
          <span>
            {chunk ? '证据已绑定' : '无原文绑定'} · {intentLabel(session.intent)}
          </span>
        </div>
      </div>

      <Composer
        value={composer}
        onChange={setComposer}
        onSend={async (text) => {
          const ok = await send(text);
          if (ok) stickRef.current = true;
          return ok;
        }}
        onSettings={() => navigate({ name: 'settings', section: 'model' })}
        model={model}
        busy={sending}
        placeholder={chunk ? '追问、复述，或让模型考考你…' : '直接提问。自动出卡需要先绑定原文。'}
      />

      <Modal
        open={archiveOpen}
        title="归档这条线索？"
        subtitle="归档只影响线索列表，不删除卡片、原文或复习记录。"
        onClose={() => setArchiveOpen(false)}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setArchiveOpen(false)}>
              留着
            </button>
            <button type="button" className="btn btn-danger" onClick={() => void archive()}>
              <Archive size={14} />
              归档线索
            </button>
          </>
        }
      >
        <div className="panel-card" style={{ padding: 14 }}>
          <div className="source-title">{session.seedName}</div>
          <p className="field-hint" style={{ marginTop: 6 }}>
            {messages.length} 条消息 · 创建于 {relativeTime(session.createdAt)}。没有删除选项来伪装「从未发生」；
            已有复习记录会原样保留。
          </p>
        </div>
        {session.forkCount > 0 ? (
          <div className="settings-note">这条线索下还有 {session.forkCount} 个分叉。归档上游不会连带归档它们。</div>
        ) : null}
      </Modal>

    </div>
  );
}
