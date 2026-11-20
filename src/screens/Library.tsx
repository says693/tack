import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownToLine,
  BookOpen,
  FilePlus2,
  FileText,
  Library,
  Plus,
  Quote,
  Search,
  Trash2,
} from 'lucide-react';

import { ImportModal } from '@/components/ImportModal';
import { Modal } from '@/components/Modal';
import { EmptyState, Field, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { isBrowserPreview, normalizeError } from '@/lib/bridge';
import {
  intentLabel,
  relativeTime,
  sourceKindLabel,
  trustLabel,
} from '@/lib/format';
import { useApp } from '@/store';
import type { SourceDetail, SourceSummary } from '@/types';

export function LibraryScreen() {
  const sources = useApp((state) => state.sources);
  const sessions = useApp((state) => state.sessions);
  const navigate = useApp((state) => state.navigate);
  const refreshLibrary = useApp((state) => state.refreshLibrary);
  const refreshOverview = useApp((state) => state.refreshOverview);
  const markOnboarded = useApp((state) => state.markOnboarded);
  const toast = useApp((state) => state.toast);
  const [query, setQuery] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [replaceSource, setReplaceSource] = useState<SourceSummary | null>(null);
  const [revisionPickerOpen, setRevisionPickerOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<SourceSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [externalOpen, setExternalOpen] = useState(false);
  const [externalText, setExternalText] = useState('');
  const [externalNote, setExternalNote] = useState('');
  const [externalBusy, setExternalBusy] = useState(false);

  useEffect(() => {
    void refreshLibrary();
    if (sessionStorage.getItem('fold:open-import') === '1') {
      sessionStorage.removeItem('fold:open-import');
      setImportOpen(true);
    }
  }, [refreshLibrary]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return sources;
    return sources.filter((source) =>
      `${source.title} ${source.note ?? ''} ${source.kind}`.toLowerCase().includes(keyword),
    );
  }, [query, sources]);

  function openImport(source: SourceSummary | null) {
    setReplaceSource(source);
    setImportOpen(true);
  }

  function onImported(detail: SourceDetail) {
    void markOnboarded();
    navigate({ name: 'reader', sourceId: detail.source.id, revisionId: detail.revision.id });
  }

  async function saveExternal() {
    if (externalBusy) return;
    if (!externalText.trim()) {
      toast('info', '片段还是空的', '先粘贴一段文字，再保存。');
      return;
    }
    setExternalBusy(true);
    try {
      const detail = await api.createExternalFragment(externalText, externalNote.trim() || null);
      await Promise.all([refreshLibrary(), refreshOverview(), markOnboarded()]);
      setExternalOpen(false);
      setExternalText('');
      setExternalNote('');
      toast('success', '外部片段已保存', '来源标记为「外部片段 / 来源未提供」，不会冒充正式材料。');
      navigate({ name: 'reader', sourceId: detail.source.id, revisionId: detail.revision.id });
    } catch (error) {
      toast('error', '没有保存', normalizeError(error).message);
    } finally {
      setExternalBusy(false);
    }
  }

  async function removeSource() {
    if (!pendingDelete || busy) return;
    setBusy(true);
    try {
      const result = await api.deleteSource(pendingDelete.id);
      await Promise.all([refreshLibrary(), refreshOverview()]);
      toast(
        'success',
        '已从书架移除',
        result.changed ? '相关卡片已暂停，不会被悄悄删除或重新绑定。' : '材料已归档。',
      );
      setPendingDelete(null);
    } catch (error) {
      toast('error', '移除失败', normalizeError(error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="library-screen">
      <div className="library-head">
        <div className="library-title-row">
          <div>
            <div className="eyebrow">Library · {sources.length} 份材料</div>
            <h1 className="library-title" style={{ marginTop: 6 }}>
              书架
            </h1>
            <p className="library-sub">所有卡片都应能回到一句话。这里保存那些话的完整上下文。</p>
          </div>
          <div className="library-actions">
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setExternalOpen(true)}>
              <Quote size={13} />
              外部片段
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => openImport(null)}>
              <Plus size={13} />
              导入
            </button>
          </div>
        </div>
        <div className="library-tools">
          <div className="search-box">
            <Search size={13} />
            <input
              className="input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索标题、备注或格式"
              aria-label="搜索书架"
            />
          </div>
          <button
            type="button"
            className="btn btn-sm btn-subtle"
            onClick={() => {
              if (sources.length === 1) openImport(sources[0]);
              else if (sources.length > 1) setRevisionPickerOpen(true);
            }}
            disabled={!sources.length}
            title="选择材料并保存新修订"
          >
            <ArrowDownToLine size={13} />
            新修订
          </button>
        </div>
      </div>

      <div className="scroll library-scroll">
        {sources.length === 0 ? (
          <div className="library-empty">
            <EmptyState
              icon={Library}
              title="书架还是空的"
              copy="导入一段你真正想学懂的材料。折页会按空行切分片段，但只有你选中的句子才会成为证据。"
            >
              <button type="button" className="btn btn-primary" onClick={() => openImport(null)}>
                <FilePlus2 size={14} />
                导入第一份材料
              </button>
              {import.meta.env.DEV && isBrowserPreview ? <button
                type="button"
                className="btn btn-ghost"
                onClick={async () => {
                  try {
                    await api.loadDemo();
                    await refreshLibrary();
                    toast('success', '示例材料已放上书架', '包含 Markdown 讲义、外部片段与一份修订版。');
                  } catch (error) {
                    toast('error', '载入失败', normalizeError(error).message);
                  }
                }}
              >
                载入示例材料
              </button> : null}
            </EmptyState>
          </div>
        ) : (
          <>
            <button type="button" className="dropzone slim" style={{ width: '100%' }} onClick={() => openImport(null)}>
              <FilePlus2 size={17} />
              <span className="dropzone-title">拖入 Markdown 或纯文本</span>
              <span className="dropzone-copy">只在本机解析 · 不会因导入而调用模型</span>
            </button>

            <div className="library-section-label">
              <span className="section-label">Materials</span>
            </div>

            {filtered.length === 0 ? (
              <EmptyState icon={Search} title="没有匹配的材料" copy="换一个关键词，或清空搜索框。" />
            ) : (
              <div className="source-list" style={{ marginTop: 4 }}>
                {filtered.map((source) => (
                  <div key={source.id} className="source-row">
                    <span className={`source-spine t${source.trustTier}`} />
                    <button
                      type="button"
                      className="source-main"
                      onClick={() => navigate({ name: 'reader', sourceId: source.id })}
                    >
                      <span className="source-title">{source.title}</span>
                      <span className="source-meta">
                        <span>{trustLabel(source.trustTier)}</span>
                        <span>·</span>
                        <span>{sourceKindLabel(source.kind)}</span>
                        <span>·</span>
                        <span>{source.chunkCount} 片段</span>
                        {source.revisionCount > 1 ? (
                          <>
                            <span>·</span>
                            <span className="accent">第 {source.currentRevisionNo} 版</span>
                          </>
                        ) : null}
                        {source.lastReadAt ? (
                          <>
                            <span>·</span>
                            <span>上次阅读 {relativeTime(source.lastReadAt)}</span>
                          </>
                        ) : null}
                      </span>
                      {source.note ? <span className="source-note">{source.note}</span> : null}
                    </button>
                    <div className="source-row-actions">
                      <button
                        type="button"
                        className="icon-btn"
                        title="阅读"
                        aria-label="阅读"
                        onClick={() => navigate({ name: 'reader', sourceId: source.id })}
                      >
                        <BookOpen size={14} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        title="导入新修订"
                        aria-label="导入新修订"
                        onClick={() => openImport(source)}
                      >
                        <ArrowDownToLine size={14} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn close"
                        title="从书架移除"
                        aria-label="从书架移除"
                        onClick={() => setPendingDelete(source)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {sessions.length > 0 ? (
              <section className="today-section">
                <div className="section-head">
                  <div className="eyebrow">最近的线索</div>
                  <span className="faint tiny">{sessions.length} 条</span>
                </div>
                <div className="recent-list">
                  {sessions.slice(0, 5).map((session) => (
                    <button
                      key={session.id}
                      type="button"
                      className="recent-row"
                      onClick={() => navigate({ name: 'session', sessionId: session.id })}
                    >
                      <span className="recent-spine" />
                      <span className="recent-main">
                        <span className="recent-title">{session.seedName}</span>
                        <span className="recent-meta">
                          <span>{intentLabel(session.intent)}</span>
                          <span>·</span>
                          <span>{session.messageCount} 条消息</span>
                          {session.forkCount > 0 ? (
                            <>
                              <span>·</span>
                              <span>{session.forkCount} 个分叉</span>
                            </>
                          ) : null}
                          <span>·</span>
                          <span>{relativeTime(session.updatedAt)}</span>
                        </span>
                      </span>
                      <span className="recent-arrow">↗</span>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            <div className="library-section-label" style={{ marginTop: 26 }}>
              <span className="section-label">A note on revisions</span>
            </div>
            <p className="field-hint">
              保存新修订不会改写旧卡片。卡片始终指向它出生时的来源版本；需要换证据时，请在卡片详情里显式编辑并核对。
            </p>
          </>
        )}
      </div>

      <ImportModal
        open={importOpen}
        replaceSource={replaceSource}
        onClose={() => setImportOpen(false)}
        onImported={onImported}
      />

      <Modal
        open={revisionPickerOpen}
        title="为哪份材料保存新修订？"
        subtitle="选择要更新的材料。保存新修订后，旧卡片仍绑定各自出生时的来源版本。"
        onClose={() => setRevisionPickerOpen(false)}
        footer={
          <button type="button" className="btn btn-ghost" onClick={() => setRevisionPickerOpen(false)}>
            取消
          </button>
        }
      >
        <div className="revision-list">
          {sources.map((source) => (
            <button
              key={source.id}
              type="button"
              className="revision-item"
              style={{ width: '100%', border: 0, borderBottom: '1px solid var(--line)', background: 'transparent', textAlign: 'left', color: 'inherit' }}
              onClick={() => {
                setRevisionPickerOpen(false);
                openImport(source);
              }}
            >
              <span className="revision-no">R{source.currentRevisionNo}</span>
              <span>
                <span className="revision-question">{source.title}</span>
                <span className="revision-meta">{source.chunkCount} 个片段 · {sourceKindLabel(source.kind)}</span>
              </span>
            </button>
          ))}
        </div>
      </Modal>

      <Modal
        open={externalOpen}
        title="粘贴一个外部片段"
        subtitle="没有来源链接也可以保存。它会明确标为「外部片段 / 来源未提供」，不会冒充正式材料。"
        onClose={() => (externalBusy ? undefined : setExternalOpen(false))}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setExternalOpen(false)} disabled={externalBusy}>
              取消
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void saveExternal()} disabled={externalBusy}>
              {externalBusy ? <Spinner /> : <Quote size={14} />}
              保存片段
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="片段正文" hint="空行分段会被识别为可引用片段；原文只在本机保存。">
            <textarea
              className="textarea"
              rows={7}
              value={externalText}
              onChange={(event) => setExternalText(event.target.value)}
              placeholder="粘贴一段没有正式出处的文字…"
            />
          </Field>
          <Field label="来源备注（可选）" hint="例如：网页摘录、聊天记录、未提供的出处。">
            <input
              className="input"
              value={externalNote}
              onChange={(event) => setExternalNote(event.target.value)}
              placeholder="来源未提供"
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={Boolean(pendingDelete)}
        title="从书架移除这份材料？"
        subtitle="原文会归档，不再出现在书架。已有卡片不会被删除，但会因为失去来源而暂停，等待你重新定位。"
        onClose={() => (busy ? undefined : setPendingDelete(null))}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setPendingDelete(null)} disabled={busy}>
              取消
            </button>
            <button type="button" className="btn btn-danger" onClick={() => void removeSource()} disabled={busy}>
              {busy ? <Spinner /> : <Trash2 size={14} />}
              移除并暂停相关卡片
            </button>
          </>
        }
      >
        <div className="panel-card" style={{ padding: 14 }}>
          <div className="source-title">{pendingDelete?.title}</div>
          <div className="source-meta">
            <span>{pendingDelete ? trustLabel(pendingDelete.trustTier) : ''}</span>
            <span>·</span>
            <span>{pendingDelete?.chunkCount ?? 0} 个片段</span>
          </div>
          <p className="field-hint" style={{ marginTop: 8 }}>
            这个动作可以在数据库里保留归档记录，但界面不会提供「假装删除干净」的假象。原始导入文件不会被修改。
          </p>
        </div>
        <div className="settings-note">
          如果你只是想保存新版本，请选择「取消」，然后用「新修订」导入，而不是移除材料。
        </div>
      </Modal>
    </div>
  );
}
