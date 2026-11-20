import { useEffect, useRef, useState } from 'react';
import { FileText, FileUp, Upload } from 'lucide-react';

import { Modal } from '@/components/Modal';
import { Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { normalizeError } from '@/lib/bridge';
import { readTextFile } from '@/lib/files';
import { useApp } from '@/store';
import type { SourceDetail, SourceSummary } from '@/types';

interface ImportModalProps {
  open: boolean;
  onClose: () => void;
  replaceSource?: SourceSummary | null;
  onImported?: (detail: SourceDetail) => void;
}

export function ImportModal({ open, onClose, replaceSource = null, onImported }: ImportModalProps) {
  const toast = useApp((state) => state.toast);
  const refreshLibrary = useApp((state) => state.refreshLibrary);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [kind, setKind] = useState('txt');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(replaceSource?.title ?? '');
    setText('');
    setLabel('');
    setNote('');
    setFileName(null);
    setKind(replaceSource?.kind ?? 'txt');
    setError(null);
    setBusy(false);
    window.setTimeout(() => bodyRef.current?.focus(), 80);
  }, [open, replaceSource]);

  async function takeFile(file: File | null | undefined) {
    if (!file) return;
    try {
      const content = await readTextFile(file);
      if (!content.trim()) {
        setError('这个文件是空的。');
        return;
      }
      setText(content);
      setFileName(file.name);
      const extension = file.name.split('.').pop()?.toLowerCase();
      setKind(extension === 'md' || extension === 'markdown' ? 'md' : 'txt');
      if (!title.trim()) {
        setTitle(file.name.replace(/\.(md|markdown|txt)$/i, ''));
      }
      setError(null);
    } catch (err) {
      setError(normalizeError(err).message);
    }
  }

  async function browse() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,.markdown,.txt,text/plain,text/markdown';
    const file = await new Promise<File | null>((resolve) => {
      input.onchange = () => resolve(input.files?.[0] ?? null);
      input.click();
    });
    await takeFile(file);
  }

  async function save() {
    if (busy) return;
    if (!title.trim()) {
      setError('请给这份材料一个标题。');
      return;
    }
    if (!text.trim()) {
      setError('正文还是空的。可以粘贴文字，或选择一个 .md / .txt 文件。');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const detail = await api.importSource({
        title: title.trim(),
        kind,
        text,
        label: label.trim() || (replaceSource ? '新修订' : '导入'),
        origin: replaceSource ? 'revision' : 'import',
        note: note.trim() || null,
        replaceSourceId: replaceSource?.id ?? null,
      });
      await refreshLibrary();
      onClose();
      if (replaceSource) {
        toast(
          'success',
          `已保存第 ${detail.revision.revisionNo} 版`,
          '旧卡片仍锁定在保存时的版本。请到卡片详情核对证据，避免悄悄改绑。',
        );
      } else {
        toast('success', '材料已放上书架', `${detail.chunks.length} 个可引用片段已建立。`);
      }
      onImported?.(detail);
    } catch (err) {
      setError(normalizeError(err).message);
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      wide
      title={replaceSource ? `为《${replaceSource.title}》导入新修订` : '把一段材料放上书架'}
      subtitle={
        replaceSource
          ? '新版本会独立保存。旧卡片不会被悄悄改绑；它们仍指向保存时的原文。'
          : '支持 Markdown 与纯文本。原文只在本机解析，不会因为导入而发送给模型。'
      }
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <span className="tiny faint" style={{ marginRight: 'auto' }}>
            {replaceSource ? '导入后可在阅读页切换版本' : '导入不会自动调用模型'}
          </span>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy}>
            {busy ? <Spinner /> : <Upload size={14} />}
            {replaceSource ? '保存新修订' : '放上书架'}
          </button>
        </>
      }
    >
      {replaceSource ? null : (
        <div
          className={`dropzone${dragging ? ' dragging' : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => void browse()}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') void browse();
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void takeFile(event.dataTransfer.files?.[0]);
          }}
        >
          <FileUp size={24} />
          <div className="dropzone-title">{fileName ? fileName : '拖入文件，或点这里选择'}</div>
          <div className="dropzone-copy">
            {fileName
              ? `${text.length.toLocaleString('zh-CN')} 字符 · 已读入本机内存`
              : '.md / .markdown / .txt · 只在本机读取'}
          </div>
        </div>
      )}

      <div className="form-row">
        <label className="field">
          <span className="field-label">标题</span>
          <input
            className="input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="输入材料标题"
          />
        </label>
        <label className="field">
          <span className="field-label">版本标签</span>
          <input
            className="input"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder={replaceSource ? `例如：修订 ${new Date().getFullYear()}` : '例如：初稿 / 讲义 v2'}
          />
        </label>
      </div>

      <label className="field">
        <span className="field-label">
          <span>正文</span>
          <span className="tiny faint">
            {text.length.toLocaleString('zh-CN')} 字符 · 空行分段会被识别为可引用片段
          </span>
        </span>
        <textarea
          ref={bodyRef}
          className="textarea"
          style={{ minHeight: 190 }}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setFileName(null);
          }}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              void save();
            }
          }}
          placeholder="把原文粘贴在这里。折页会保留逐字偏移量，选中的句子以后还能原样定位。"
        />
      </label>

      {replaceSource ? (
        <div className="settings-note">
          当前书架上是第 {replaceSource.currentRevisionNo} 版。新修订保存后，旧卡片仍使用旧版本的内容与偏移，
          不会自动换绑。你可以到卡片详情里逐张核对。
        </div>
      ) : null}

      <label className="field">
        <span className="field-label">备注（可选）</span>
        <input
          className="input"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="来源、作者、许可，或为什么保存它"
        />
      </label>

      {fileName ? (
        <div className="file-line">
          <FileText size={13} />
          <span>{fileName}</span>
          <span className="faint">已读入本机内存</span>
        </div>
      ) : null}

      {error ? <div className="form-error">{error}</div> : null}
    </Modal>
  );
}
