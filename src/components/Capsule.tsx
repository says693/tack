import { ChevronRight } from 'lucide-react';

import { BrandMark } from '@/components/BrandMark';
import { useApp } from '@/store';

export function Capsule() {
  const overview = useApp((state) => state.overview);
  const settings = useApp((state) => state.settings);
  const exitCapsule = useApp((state) => state.exitCapsule);
  const metric = settings?.capsuleMetric ?? 'due';
  const count = metric === 'due' ? overview?.dueCount ?? 0 : overview?.newAvailable ?? 0;
  const label = metric === 'due' ? '今日到期' : '新卡可用';

  return (
    <div className="capsule-root">
      <button
        type="button"
        className="capsule-pill"
        onClick={exitCapsule}
        title="展开折页"
      >
        <BrandMark className="capsule-mark" />
        <span className="capsule-copy">
          <span className={`capsule-count${count === 0 ? ' zero' : ''}`}>{String(count).padStart(2, '0')}</span>
          <span className="capsule-label">{label}</span>
        </span>
        <span className="capsule-right">
          <span className={`capsule-status${count === 0 ? ' clear' : ''}`} />
          <span className="capsule-fork">{count === 0 ? '清' : '展开'}</span>
          <ChevronRight size={12} style={{ color: 'var(--text-3)' }} />
        </span>
      </button>
    </div>
  );
}
