import { Copy, CornerDownRight } from 'lucide-react';

import { formatTimeCN } from '@/lib/format';
import { renderMarkdown } from '@/lib/markdown';
import { useApp } from '@/store';
import type { MessageView } from '@/types';

function modelOf(message: MessageView): string | null {
  if (!message.meta || typeof message.meta !== 'object') return null;
  const meta = message.meta as { model?: unknown };
  return typeof meta.model === 'string' ? meta.model : null;
}

interface MessageBubbleProps {
  message: MessageView;
  showFork?: boolean;
  onFork?: (message: MessageView) => void;
}

export function MessageBubble({ message, showFork = false, onFork }: MessageBubbleProps) {
  const toast = useApp((state) => state.toast);

  if (message.role === 'user') {
    return (
      <div className="message message-user" data-message-id={message.id}>
        {message.content}
      </div>
    );
  }

  if (message.role === 'system') {
    return (
      <div className="message">
        <div className="message-error" style={{ background: 'transparent' }}>
          {message.content}
        </div>
      </div>
    );
  }

  const streaming = message.status === 'streaming';
  const failed = message.status === 'failed';
  const model = modelOf(message);

  return (
    <div
      className={`message message-assistant${failed ? ' message-failed' : ''}${streaming ? ' streaming' : ''}`}
      data-message-id={message.id}
    >
      <div className="message-head">
        <span className="message-model">{model ?? '模型回复'}</span>
        <span>·</span>
        <span>{formatTimeCN(message.createdAt)}</span>
        {message.cites.length > 0 ? (
          <>
            <span>·</span>
            <span>{message.cites.length} 处引用</span>
          </>
        ) : null}
        {streaming ? (
          <span className="typing-dots" aria-label="正在生成">
            <span />
            <span />
            <span />
          </span>
        ) : null}
      </div>

      {message.content ? (
        <div
          className="message-body"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
        />
      ) : streaming ? (
        <div className="typing-dots" aria-label="正在生成">
          <span />
          <span />
          <span />
        </div>
      ) : null}

      {failed ? (
        <div className="message-error">
          {message.error || '这条回复没有完成。'}
          <div className="tiny faint" style={{ marginTop: 4 }}>
            你的消息与已生成的部分都保留在本地。可以重新发送，或先手动整理一张卡片。
          </div>
        </div>
      ) : null}

      {!streaming && message.content ? (
        <div className="message-actions">
          <button
            type="button"
            className="message-action"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(message.content);
                toast('success', '已复制这段回复');
              } catch {
                toast('error', '复制失败', '浏览器没有授予剪贴板权限。');
              }
            }}
          >
            <Copy size={10} style={{ verticalAlign: -1, marginRight: 3 }} />
            复制
          </button>
          {showFork && onFork ? (
            <button type="button" className="message-action" onClick={() => onFork(message)}>
              <CornerDownRight size={11} style={{ verticalAlign: -1, marginRight: 3 }} />
              从这条回复分叉
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
