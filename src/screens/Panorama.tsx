import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Copy,
  Minimize2,
  Quote,
  Sparkles,
} from 'lucide-react';

import { Composer } from '@/components/Composer';
import { MessageBubble } from '@/components/MessageBubble';
import { ErrorState, Loading, Spinner } from '@/components/ui';
import { useSessionThread } from '@/hooks/useSessionThread';
import { api } from '@/lib/api';
import { normalizeError } from '@/lib/bridge';
import { intentLabel, relativeTime, sourceKindLabel, trustLabel } from '@/lib/format';
import { highlightOffsets } from '@/lib/selection';
import { useApp } from '@/store';
import type { MessageView, SessionDetail } from '@/types';

export function PanoramaScreen({ sessionId }: { sessionId: string }) {
  const navigate = useApp((state) => state.navigate);
  const goBack = useApp((state) => state.goBack);
  const model = useApp((state) => state.model);
  const toast = useApp((state) => state.toast);
  const setWindowMode = useApp((state) => state.setWindowMode);
  const refreshLibrary = useApp((state) => state.refreshLibrary);
  const refreshOverview = useApp((state) => state.refreshOverview);
  const thread = useSessionThread(sessionId);
  const { detail, loading, error, send, sending, patchSession } = thread;
  const [composer, setComposer] = useState('');
  const [parentDetail, setParentDetail] = useState<SessionDetail | null>(null);
  const [generating, setGenerating] = useState(false);
  const [intentBusy, setIntentBusy] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);

  const parentId = detail?.session.parentId ?? null;

  useEffect(() => {
    let cancelled = false;
    setParentDetail(null);
    if (!parentId) return;
    api
      .session(parentId)
      .then((next) => {
        if (!cancelled) setParentDetail(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [parentId]);

  const messages = detail?.messages ?? [];
  const last = messages[messages.length - 1];

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

  async function generate() {
    if (!detail || generating) return;
    if (!detail.chunk) {
      toast('info', '没有原文片段', '先从阅读页选中一句话，再开分叉。');
      return;
    }
    setGenerating(true);
    try {
      const result = await useApp
        .getState()
        .withCloud((ack) => api.generateCardDraft(detail.session.id, ack, detail.chunk?.id ?? null));
      await refreshOverview();
      toast('success', '草稿已生成', '尚未进入队列。');
      navigate({ name: 'card', cardId: result.draft.summary.id });
    } catch (err) {
      toast('error', '没有生成草稿', normalizeError(err).message);
    } finally {
      setGenerating(false);
    }
  }

  async function fork(message: MessageView) {
    if (!detail) return;
    try {
      const created = await api.createSession({
        parentId: detail.session.id,
        forkMessageId: message.id,
        chunkId: detail.chunk?.id ?? null,
        name: `分叉 · ${message.content.replace(/[#>*_`\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 28)}`,
        intent: detail.session.intent,
      });
      await refreshLibrary();
      toast('success', '已再分叉一层');
      navigate({ name: 'session', sessionId: created.session.id }, { mode: 'panorama' });
    } catch (err) {
      toast('error', '分叉失败', normalizeError(err).message);
    }
  }

  async function copyQuote() {
    if (!detail?.chunk) return;
    const text = `“${detail.chunk.quoteExact}”\n— ${detail.source?.title ?? '来源未提供'} · ${
      detail.chunk.locator ?? '原文'
    }`;
    try {
      await navigator.clipboard.writeText(text);
      toast('success', '引用已复制');
    } catch {
      toast('error', '复制失败');
    }
  }

  if (loading && !detail) {
    return (
      <div className="panorama-screen">
        <Loading label="正在铺开全景…" />
      </div>
    );
  }

  if (error && !detail) {
    return (
      <div className="panorama-screen">
        <ErrorState message={error} onRetry={() => void thread.refresh()} />
      </div>
    );
  }

  if (!detail) return null;

  const session = detail.session;
  const chunk = detail.chunk;
  const source = detail.source;

  return (
    <div className="panorama-screen">
      <header className="session-header">
        <button type="button" className="icon-btn" aria-label="返回" onClick={goBack}>
          <ArrowLeft size={16} />
        </button>
        <div className="session-head-main">
          <div className="session-title">{session.seedName}</div>
          <div className="session-sub">
            <span>全景</span>
            <span>·</span>
            <span>{messages.length} 条消息</span>
            <span>·</span>
            <span>第 {session.depth + 1} 层</span>
            {session.parentId ? (
              <>
                <span>·</span>
                <span>上游已保留</span>
              </>
            ) : null}
          </div>
        </div>
        <div className="session-actions">
          <div className="intent-pills">
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
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => setWindowMode('panel')}
            title="收为单栏"
          >
            <Minimize2 size={13} />
            折叠
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

      <div className="panorama-grid">
        <section className="panorama-pane parent-pane">
          <div className="pane-head">
            <span>上游语境 · 只读</span>
            {parentId ? (
              <button
                type="button"
                className="link"
                style={{ fontSize: 9 }}
                onClick={() => navigate({ name: 'session', sessionId: parentId }, { mode: 'panorama' })}
              >
                打开上游
              </button>
            ) : (
              <span>ROOT</span>
            )}
          </div>
          <div className="pane-body">
            {!parentId ? (
              <div className="parent-empty">
                这是一条起始线索。
                <br />
                它没有上游，也不会假装有更早的上下文。
              </div>
            ) : parentDetail ? (
              <div className="parent-thread">
                {parentDetail.messages.map((message) => (
                  <div
                    key={message.id}
                    className={`parent-message${message.role === 'user' ? ' user' : ''}${
                      message.id === session.forkMessageId ? ' anchor' : ''
                    }`}
                  >
                    <span className="pm-role">
                      {message.role === 'user' ? '你' : '模型'}
                      {message.id === session.forkMessageId ? ' · 在这里分叉' : ''}
                    </span>
                    {message.content.slice(0, 420)}
                    {message.content.length > 420 ? '…' : ''}
                  </div>
                ))}
              </div>
            ) : (
              <div className="parent-empty">正在读取上游线索…</div>
            )}
            <div className="today-footnote" style={{ marginTop: 18 }}>
              <span>只读</span>
              <span>父会话不会被本次对话改写</span>
            </div>
          </div>
        </section>

        <section className="panorama-pane fork-pane">
          <div className="pane-head">
            <span>分叉会话</span>
            <span>{relativeTime(session.updatedAt)}</span>
          </div>
          <div
            className="session-body"
            ref={bodyRef}
            onScroll={(event) => {
              const element = event.currentTarget;
              stickRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 120;
            }}
          >
            {messages.length === 0 ? (
              <div className="session-empty">
                <Quote size={40} className="faint" style={{ opacity: 0.4 }} />
                <h3>把问题写在分叉里</h3>
                <p>中间这一栏只属于当前分叉。左侧是上游语境，右侧是逐字证据。</p>
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
                    onFork={(target) => void fork(target)}
                  />
                ))}
              </div>
            )}
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
            placeholder="在这个分叉里追问…"
            compact
          />
        </section>

        <section className="panorama-pane source-pane">
          <div className="pane-head">
            <span>原文证据</span>
            {source ? <span>{trustLabel(source.trustTier)}</span> : <span>UNBOUND</span>}
          </div>
          <div className="source-pane-body">
            {chunk && source ? (
              <>
                <div>
                  <div className="panorama-source-title">{source.title}</div>
                  <div className="panorama-source-meta">
                    <span className="chip">{sourceKindLabel(source.kind)}</span>
                    <span className="chip">当前引用</span>
                    <span className="chip chip-plain">{chunk.locator ?? '原文'}</span>
                  </div>
                </div>
                <div className="source-quote-card">
                  <div className="source-quote-label">Exact quote</div>
                  <div className="source-quote-text">“{chunk.quoteExact}”</div>
                  <div className="source-quote-meta">
                    {chunk.quoteExact.length} 字符 · UTF-16 {chunk.startUtf16}–{chunk.endUtf16}
                    <br />
                    来源版本 {chunk.revisionId.slice(0, 12)}…
                  </div>
                </div>
                <div className="panorama-actions">
                  <button
                    type="button"
                    className="btn btn-sm btn-subtle"
                    onClick={() =>
                      navigate({ name: 'reader', sourceId: source.id, revisionId: chunk.revisionId })
                    }
                  >
                    <BookOpen size={12} />
                    打开原文
                  </button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => void copyQuote()}>
                    <Copy size={12} />
                    复制引用
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => {
                      sessionStorage.setItem(
                        'fold:focus',
                        JSON.stringify({
                          sourceId: source.id,
                          start: chunk.startUtf16,
                          end: chunk.endUtf16,
                        }),
                      );
                      navigate({ name: 'reader', sourceId: source.id, revisionId: chunk.revisionId });
                    }}
                  >
                    <Quote size={12} />
                    标出证据
                  </button>
                </div>
                {detail.drafts.length > 0 ? (
                  <div className="pane-section">
                    <div className="section-label">这次线索的卡片</div>
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
                            {draft.status === 'draft' ? '待确认' : '已启用'}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="panorama-empty">
                这条线索没有绑定原文。
                <br />
                回到阅读页选中一句话，开一个带证据的分叉，右侧才会出现可核对的原文。
              </div>
            )}

            <div className="today-footnote" style={{ marginTop: 'auto' }}>
              <span>证据不可由模型替换</span>
              <span>FOLD</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
