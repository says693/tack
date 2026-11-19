import { CalendarCheck, Layers, Library, ListChecks } from 'lucide-react';

import { useApp } from '@/store';
import type { View } from '@/types';

type TabName = 'today' | 'library' | 'cards' | 'review';

function activeTab(view: View): TabName | null {
  switch (view.name) {
    case 'today':
      return 'today';
    case 'library':
    case 'reader':
      return 'library';
    case 'cards':
    case 'card':
      return 'cards';
    case 'review':
      return 'review';
    default:
      return null;
  }
}

export function NavTabs() {
  const view = useApp((state) => state.view);
  const overview = useApp((state) => state.overview);
  const navigate = useApp((state) => state.navigate);
  const active = activeTab(view);
  const due = overview?.dueCount ?? 0;
  const drafts = overview?.drafts ?? 0;

  const tabs: { key: TabName; label: string; icon: typeof CalendarCheck; count?: number }[] = [
    { key: 'today', label: '今日', icon: CalendarCheck },
    { key: 'library', label: '书架', icon: Library },
    { key: 'cards', label: '卡片', icon: Layers, count: drafts || undefined },
    { key: 'review', label: '复习', icon: ListChecks, count: due || undefined },
  ];

  return (
    <nav className="nav-tabs" aria-label="主导航">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        return (
          <button
            key={tab.key}
            type="button"
            className={`nav-tab${active === tab.key ? ' active' : ''}`}
            onClick={() => {
              if (tab.key === 'today') navigate({ name: 'today' });
              if (tab.key === 'library') navigate({ name: 'library' });
              if (tab.key === 'cards') navigate({ name: 'cards' });
              if (tab.key === 'review') navigate({ name: 'review' }, { mode: 'review' });
            }}
          >
            <Icon size={14} />
            <span>{tab.label}</span>
            {tab.count ? <span className="nav-count">{tab.count}</span> : null}
          </button>
        );
      })}
    </nav>
  );
}
