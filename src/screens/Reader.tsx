import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronDown,
  Copy,
  FilePlus2,
  Highlighter,
  MessageSquarePlus,
  Quote,
  ShieldCheck,
} from 'lucide-react';

import { ImportModal } from '@/components/ImportModal';
import { Modal } from '@/components/Modal';
import { EmptyState, ErrorState, Loading, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { normalizeError } from '@/lib/bridge';
import { formatDateCN, relativeTime, sourceKindLabel, trustLabel } from '@/lib/format';
import { contentHashShort, sourceKicker, splitSourceBlocks } from '@/lib/source';
import { highlightOffsets, readSelection, type SelectionInfo } from '@/lib/selection';
import { useApp } from '@/store';
import type { SourceAnnotation, SourceDetail } from '@/types';

interface ReaderProps {
  sourceId: string;
  revisionId: string | null;
}

export function ReaderScreen({ sourceId, revisionId }: ReaderProps) {
  const navigate = useApp((state) => state.navigate);
  const goBack = useApp((state) => state.goBack);
  const refreshLibrary = useApp((state) => state.refreshLibrary);
  const toast = useApp((state) => state.toast);
  const [activeRevisionId, setActiveRevisionId] = useState<string | null>(revisionId);
  const [detail, setDetail] = useState<SourceDetail | null>(null);
  const [annotations, setAnnotations] = useState<SourceAnnotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [forking, setForking] = useState(false);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [marked, setMarked] = useState<{ start: number; end: number } | null>(null);
  const articleRef = useRef<HTMLElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setActiveRevisionId(revisionId);
  }, [revisionId, sourceId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelection(null);
    setMarked(null);

    api
      .sourceDetail(sourceId, activeRevisionId)
      .then(async (next) => {
        if (cancelled) return;
        setDetail(next);
        setLoading(false);
        try {
          const rows = await api.annotations(next.source.id, next.revision.id);
          if (!cancelled) setAnnotations(rows);
        } catch {
          if (!cancelled) setAnnotations([]);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(normalizeError(err).message);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sourceId, activeRevisionId]);

  const blocks = useMemo(
    () => (detail ? splitSourceBlocks(detail.revision.content) : []),
    [detail],
  );

  useEffect(() => {
    if (!detail) return;
    const raw = sessionStorage.getItem('fold:focus');
    if (!raw) return;
    try {
      const target = JSON.parse(raw) as { sourceId?: string; start?: number; end?: number };
      sessionStorage.removeItem('fold:focus');
      if (target.sourceId !== detail.source.id || typeof target.start !== 'number' || typeof target.end !== 'number') {
        return;
      }
      setMarked({ start: target.start, end: target.end });
      window.setTimeout(() => {
        highlightOffsets(articleRef.current, target.start!, target.end!);
      }, 180);
    } catch {
      sessionStorage.removeItem('fold:focus');
    }
  }, [detail]);

  const onSelectionEnd = useCallback(() => {
    if (!detail) return;
    const active = window.getSelection();
    const anchor = active?.anchorNode;
    if (anchor && toolbarRef.current?.contains(anchor)) return;
    if (anchor && anchor.parentElement?.closest('.reader-margin')) return;
    const info = readSelection(detail.revision.content, articleRef.current);
    if (!info || info.exact.length < 1) {
      setSelection(null);
      return;
    }
    setSelection(info);
  }, [detail]);

  useEffect(() => {
    document.addEventListener('mouseup', onSelectionEnd);
    document.addEventListener('keyup', onSelectionEnd);
    return () => {
      document.removeEventListener('mouseup', onSelectionEnd);
      document.removeEventListener('keyup', onSelectionEnd);
    };
  }, [onSelectionEnd]);

  async function openFork() {
    if (!detail || !selection || forking) return;
    setForking(true);
    try {
      const chunk = await api.createChunk({
        sourceId: detail.source.id,
        revisionId: detail.revision.id,
        quoteExact: selection.exact,
        prefix: selection.prefix,
        suffix: selection.suffix,
        startUtf16: selection.startUtf16,
        endUtf16: selection.endUtf16,
        heading: selection.heading,
        locator: selection.locator,
      });
      const name = selection.exact.replace(/\s+/g, ' ').trim().slice(0, 42);
      const session = await api.createSession({
        chunkId: chunk.id,
        name,
        intent: 'learn',
      });
      await refreshLibrary();
      window.getSelection()?.removeAllRanges();
      setSelection(null);
      toast('success', '已开一个临时分叉', '原文没有被改写。这条线索保存了逐字引用与来源版本。');
      navigate({ name: 'session', sessionId: session.session.id });
    } catch (err) {
      toast('error', '没能开分叉', normalizeError(err).message);
      setForking(false);
    }
  }

  async function copyQuote() {
    if (!detail || !selection) return;
    const text = `“${selection.exact}”\n— ${detail.source.title} · ${selection.locator ?? selection.heading ?? '原文'}`;
    try {
      await navigator.clipboard.writeText(text);
      toast('success', '引用已复制', '包含来源与位置，粘贴到别处仍可追溯。');
    } catch {
      toast('error', '复制失败', '浏览器没有授予剪贴板权限。可以手动选中文字复制。');
    }
  }

  function markSelection() {
    if (!selection) return;
    highlightOffsets(articleRef.current, selection.startUtf16, selection.endUtf16);
    setMarked({ start: selection.startUtf16, end: selection.endUtf16 });
    setSelection(null);
  }

  function focusAnnotation(annotation: SourceAnnotation) {
    highlightOffsets(articleRef.current, annotation.startUtf16, annotation.endUtf16);
    setMarked({ start: annotation.startUtf16, end: annotation.endUtf16 });
  }

  if (loading && !detail) {
    return (
      <div className="reader-screen">
        <Loading label="正在铺开原文…" />
      </div>
    );
  }

  if (error && !detail) {
    return (
      <div className="reader-screen">
        <ErrorState message={error} onRetry={() => setActiveRevisionId((value) => value ?? revisionId)} />
      </div>
    );
  }

  if (!detail) return null;

  const revision = detail.revision;
  const source = detail.source;
  const marginRows = annotations;

  return (
    <div className="reader-screen">
      <div className="reader-toolbar">
        <button type="button" className="icon-btn" aria-label="返回" onClick={goBack}>
          <ArrowLeft size={16} />
        </button>
        <div className="reader-toolbar-main">
          <div className="reader-toolbar-title">{source.title}</div>
          <div className="reader-toolbar-meta">
            <span>{trustLabel(source.trustTier)}</span>
            <span>·</span>
            <span>{sourceKindLabel(source.kind)}</span>
            <span>·</span>
            <span>R{revision.revisionNo}</span>
            {loading ? <Spinner size={11} /> : null}
          </div>
        </div>
        <div className="reader-toolbar-actions">
          <button type="button" className="revision-pill" onClick={() => setRevisionOpen(true)}>
            第 {revision.revisionNo} 版
            <ChevronDown size={11} />
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => setImportOpen(true)}
            title="保存一个新修订"
          >
            <FilePlus2 size={13} />
            新修订
          </button>
        </div>
      </div>

      <div className="reader-layout">
        <main className="reader-main" onScroll={() => setSelection(null)}>
          <article className="reader-sheet" ref={articleRef}>
            <div className="reader-kicker">
              <span>{sourceKicker(source.origin)}</span>
              <span>
                {formatDateCN(source.createdAt)} · {revision.label ?? `版本 ${revision.revisionNo}`}
              </span>
            </div>
            <h1 className="reader-title">{source.title}</h1>
            <div className="reader-byline">
              <span>{trustLabel(source.trustTier)}</span>
              <span className="dot-sep" />
              <span>{source.chunkCount} 个片段</span>
              <span className="dot-sep" />
              <span>{revision.content.length.toLocaleString('zh-CN')} 字符</span>
              <span className="dot-sep" />
              <span>SHA {contentHashShort(revision.contentHash)}</span>
              <span className="dot-sep" />
              <span>{marginRows.length} 处折痕</span>
            </div>

            <div className="reader-body">
              {blocks.map((block) => {
                const annotated = marginRows.some(
                  (annotation) =>
                    block.start <= annotation.endUtf16 && block.end >= annotation.startUtf16,
                );
                const isMarked = Boolean(
                  marked && block.start <= marked.end && block.end >= marked.start,
                );
                return (
                  <div
                    key={`${block.start}-${block.ordinal}`}
                    className={`${block.isHeading ? 'reader-heading' : 'reader-block'}${
                      annotated ? ' is-annotated' : ''
                    }`}
                    data-start={block.start}
                    data-end={block.end}
                    data-heading={block.heading ?? ''}
                    data-locator={block.locator}
                    data-ordinal={block.isHeading ? undefined : String(block.ordinal).padStart(2, '0')}
                    data-marked={isMarked ? 'true' : 'false'}
                  >
                    {block.text}
                  </div>
                );
              })}
            </div>

            {source.note ? <div className="reader-source-note">{source.note}</div> : null}

            <div className="reader-foot">
              这份材料保存于 {formatDateCN(revision.createdAt)} · 当前版本 R{revision.revisionNo} ·{' '}
              {revision.content.length.toLocaleString('zh-CN')} 字符
              <br />
              选中任意一段原文，可以开一个临时分叉。折页只保存这段引用与它的逐字偏移，不改写原文。
            </div>
          </article>
        </main>

        <aside className="reader-margin">
          <div className="margin-head">
            <div>
              <div className="eyebrow">Marginalia</div>
              <div className="margin-count" style={{ marginTop: 3 }}>
                {marginRows.length} 处折痕
              </div>
            </div>
            <Highlighter size={14} className="faint" />
          </div>

          {marginRows.length === 0 ? (
            <div className="margin-empty">
              <Highlighter size={38} />
              <div>还没有折痕。</div>
              <div style={{ marginTop: 4 }}>在左侧选中一句话，开启第一个分叉。</div>
            </div>
          ) : (
            <div className="margin-list">
              {marginRows.map((annotation) => (
                <div
                  key={`${annotation.chunkId}-${annotation.kind}-${annotation.sessionId ?? 'none'}-${annotation.cardId ?? 'none'}`}
                  className="annotation-item"
                  role="button"
                  tabIndex={0}
                  onClick={() => focusAnnotation(annotation)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') focusAnnotation(annotation);
                  }}
                >
                  <div className="annotation-top">
                    <span className={`chip ${annotation.kind === 'card' ? 'chip-jade' : 'chip-accent'}`}>
                      {annotation.kind === 'card' ? '卡片' : '线索'}
                    </span>
                    <span className="annotation-loc ellipsis">{annotation.locator ?? '原文'}</span>
                  </div>
                  <div className="annotation-quote">“{annotation.quoteExact}”</div>
                  {annotation.cardQuestion ? (
                    <div className="annotation-question">{annotation.cardQuestion}</div>
                  ) : null}
                  <div className="annotation-link-row">
                    <span className="tiny faint ellipsis" style={{ flex: 1 }}>
                      {annotation.sessionName ?? '证据卡片'}
                    </span>
                    {annotation.sessionId ? (
                      <button
                        type="button"
                        className="link"
                        style={{ fontSize: 10 }}
                        onClick={(event) => {
                          event.stopPropagation();
                          navigate({ name: 'session', sessionId: annotation.sessionId! });
                        }}
                      >
                        进入线索
                      </button>
                    ) : null}
                    {annotation.cardId ? (
                      <button
                        type="button"
                        className="link"
                        style={{ fontSize: 10 }}
                        onClick={(event) => {
                          event.stopPropagation();
                          navigate({ name: 'card', cardId: annotation.cardId! });
                        }}
                      >
                        查看卡片
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="margin-source">
            <div className="margin-revision">
              <ShieldCheck size={12} />
              <span>当前证据锁定在 R{revision.revisionNo}</span>
            </div>
            <div>内容哈希 {revision.contentHash.slice(0, 18)}…</div>
            <div>最近阅读 {relativeTime(source.lastReadAt)}</div>
            <div style={{ marginTop: 6 }}>
              保存新修订不会改写已有卡片。旧卡片仍指向它们出生时的版本。
            </div>
          </div>
        </aside>
      </div>

      {selection ? (
        <div
          ref={toolbarRef}
          className="selection-toolbar"
          data-selection-toolbar
          style={{
            left: Math.max(
              12,
              Math.min(
                window.innerWidth - 236,
                (selection.rect?.left ?? 20) + (selection.rect?.width ?? 0) / 2 - 108,
              ),
            ),
            top: Math.max(
              58,
              (selection.rect?.top ?? 120) > 78
                ? (selection.rect?.top ?? 120) - 42
                : (selection.rect?.bottom ?? 140) + 10,
            ),
          }}
          onMouseDown={(event) => event.preventDefault()}
        >
          <button type="button" className="selection-action" onClick={() => void openFork()} disabled={forking}>
            {forking ? <Spinner size={11} /> : <MessageSquarePlus size={12} style={{ verticalAlign: -2 }} />}{' '}
            <strong>开分叉</strong>
          </button>
          <button type="button" className="selection-action" onClick={() => void copyQuote()}>
            <Copy size={11} style={{ verticalAlign: -2 }} /> 复制引用
          </button>
          <button type="button" className="selection-action" onClick={markSelection}>
            <Highlighter size={11} style={{ verticalAlign: -2 }} /> 标出
          </button>
          <span className="selection-action faint" style={{ pointerEvents: 'none' }}>
            {selection.exact.length} 字
          </span>
        </div>
      ) : null}

      <Modal
        open={revisionOpen}
        title="来源版本"
        subtitle="每个版本独立保存内容与偏移。卡片只认它出生时的那一版。"
        onClose={() => setRevisionOpen(false)}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setRevisionOpen(false)}>
              关闭
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setRevisionOpen(false);
                setImportOpen(true);
              }}
            >
              <FilePlus2 size={14} />
              保存新修订
            </button>
          </>
        }
      >
        <div className="revision-list">
          {detail.revisions.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`revision-item${item.id === revision.id ? ' active' : ''}`}
              style={{ width: '100%', border: 0, borderBottom: '1px solid var(--line)', background: 'transparent', textAlign: 'left', color: 'inherit' }}
              onClick={() => {
                setActiveRevisionId(item.id);
                setRevisionOpen(false);
              }}
            >
              <span className="revision-no">R{item.revisionNo}</span>
              <span>
                <span className="revision-question">{item.label ?? `版本 ${item.revisionNo}`}</span>
                <span className="revision-meta">
                  {formatDateCN(item.createdAt)} · {item.charCount.toLocaleString('zh-CN')} 字符 ·{' '}
                  {item.id === revision.id ? '正在阅读' : '切换到此版'}
                </span>
              </span>
            </button>
          ))}
        </div>
        <div className="settings-note">
          导入新修订后，旧卡片不会自动换绑。若证据在新版中仍能逐字定位，你可以逐张确认；否则请重新选句建卡。
        </div>
      </Modal>

      <ImportModal
        open={importOpen}
        replaceSource={source}
        onClose={() => setImportOpen(false)}
        onImported={(next) => {
          setActiveRevisionId(next.revision.id);
          setRevisionOpen(false);
        }}
      />
    </div>
  );
}
