import type { ComponentType, ReactNode } from 'react';
import { CircleAlert, LoaderCircle } from 'lucide-react';

export function Spinner({ size = 15 }: { size?: number }) {
  return <LoaderCircle size={size} className="spin" aria-hidden />;
}

export function Loading({ label = '正在展开这一页…' }: { label?: string }) {
  return (
    <div className="empty-state" style={{ minHeight: 200 }}>
      <Spinner size={18} />
      <div className="empty-copy">{label}</div>
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
  retryLabel = '再试一次',
}: {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="empty-state" style={{ minHeight: 200 }}>
      <CircleAlert size={28} style={{ color: 'var(--danger)', opacity: 0.8 }} />
      <div className="empty-title">这一页没有展开</div>
      <div className="empty-copy">{message}</div>
      {onRetry ? (
        <button type="button" className="btn btn-sm" onClick={onRetry}>
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}

type IconType = ComponentType<{ size?: number | string; strokeWidth?: number | string; className?: string }>;

export function EmptyState({
  icon: Icon,
  title,
  copy,
  children,
}: {
  icon: IconType;
  title: string;
  copy?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Icon size={52} strokeWidth={1} />
      <div className="empty-title">{title}</div>
      {copy ? <div className="empty-copy">{copy}</div> : null}
      {children ? <div className="empty-actions">{children}</div> : null}
    </div>
  );
}

export function NumberControl({
  value,
  onChange,
  min = 1,
  max = 999,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div className="number-control">
      <button
        type="button"
        aria-label="减少"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
      >
        −
      </button>
      <span>{value}</span>
      <button
        type="button"
        aria-label="增加"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
      >
        +
      </button>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
  aside,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">
        <span>{label}</span>
        {aside}
      </span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}
