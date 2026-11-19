import { useEffect, useRef, useState } from 'react';
import { Send, Sparkles } from 'lucide-react';

import { Spinner } from '@/components/ui';
import { isTauri } from '@/lib/bridge';
import type { ModelStatus } from '@/types';

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: (text: string) => Promise<boolean>;
  onSettings?: () => void;
  model: ModelStatus | null;
  placeholder?: string;
  busy?: boolean;
  compact?: boolean;
}

export function Composer({
  value,
  onChange,
  onSend,
  onSettings,
  model,
  placeholder = '追问、复述，或让模型考考你…',
  busy = false,
  compact = false,
}: ComposerProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const disabled = submitting || busy;

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(160, Math.max(compact ? 46 : 54, element.scrollHeight))}px`;
  }, [value, compact]);

  async function submit() {
    if (disabled || !value.trim()) return;
    setSubmitting(true);
    try {
      const ok = await onSend(value);
      if (ok) onChange('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="composer">
      {isTauri && model && !model.configured ? (
        <div className="model-banner">
          <Sparkles size={13} />
          <span>模型未配置。消息不会假装已发送；你可以先手写卡片，或在设置里连接一个模型。</span>
          {onSettings ? (
            <button type="button" className="link" onClick={onSettings}>
              去设置
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="composer-box">
        <textarea
          ref={ref}
          value={value}
          rows={compact ? 2 : 3}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <div className="composer-bottom">
          <span className="composer-hint">
            {busy || submitting ? '正在等待回复…' : 'Enter 发送 · Shift+Enter 换行'}
          </span>
          <div className="composer-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={disabled || !value.trim()}
              onClick={() => void submit()}
            >
              {submitting ? <Spinner size={12} /> : <Send size={12} />}
              发送
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
