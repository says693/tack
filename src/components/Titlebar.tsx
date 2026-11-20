import { BookOpen, EyeOff, Moon, Pin, PinOff, Settings, Sun, X } from 'lucide-react';

import { BrandMark } from '@/components/BrandMark';
import { api } from '@/lib/api';
import { isTauri, normalizeError } from '@/lib/bridge';
import { formatTodayCN } from '@/lib/format';
import { useApp } from '@/store';
import type { View } from '@/types';

function crumbFor(view: View, title: string | null): string {
  switch (view.name) {
    case 'onboarding':
      return '引导准备';
    case 'study':
      return '离线学习';
    case 'today':
      return `今日 · ${formatTodayCN()}`;
    case 'library':
      return '书架';
    case 'reader':
      return title ? `阅读 · ${title}` : '阅读';
    case 'session':
      return title ? `线索 · ${title}` : '线索';
    case 'cards':
      return '卡片';
    case 'card':
      return '卡片详情';
    case 'settings':
      return '设置';
    case 'review':
      return '复习';
    default:
      return '折页';
  }
}

export function Titlebar() {
  const view = useApp((state) => state.view);
  const bootstrap = useApp((state) => state.bootstrap);
  const sources = useApp((state) => state.sources);
  const sessions = useApp((state) => state.sessions);
  const pinned = useApp((state) => state.pinned);
  const theme = useApp((state) => state.theme);
  const setPinned = useApp((state) => state.setPinned);
  const setTheme = useApp((state) => state.setTheme);
  const navigate = useApp((state) => state.navigate);
  const enterCapsule = useApp((state) => state.enterCapsule);
  const toast = useApp((state) => state.toast);

  const title =
    view.name === 'reader'
      ? sources.find((source) => source.id === view.sourceId)?.title ?? null
      : view.name === 'session'
        ? sessions.find((session) => session.id === view.sessionId)?.seedName ?? null
        : null;

  function collapse() {
    if (!isTauri) {
      toast('info', '这是浏览器预览', '桌面应用里会收起为一个胶囊。');
      return;
    }
    enterCapsule();
  }

  async function quit() {
    if (!isTauri) {
      toast('info', '这是浏览器预览', '桌面应用里会退出折页。');
      return;
    }
    try {
      await api.quitApp();
    } catch (error) {
      toast('error', '退出失败', normalizeError(error).message);
    }
  }

  return (
    <header className="titlebar" data-drag="true" data-tauri-drag-region>
      <div className="brand" data-tauri-drag-region>
        <BrandMark />
        <span className="brand-name">折页</span>
        <span className="brand-en">FOLD</span>
      </div>
      <div className="titlebar-center" data-tauri-drag-region>
        <span className="titlebar-crumb">{crumbFor(view, title)}</span>
      </div>
      <div className="titlebar-actions">
        <button
          type="button"
          className="icon-btn"
          aria-label="引导学习"
          title="引导学习"
          onClick={() => navigate(bootstrap?.guidedReady ? { name: 'study' } : { name: 'onboarding' })}
        >
          <BookOpen size={14} />
        </button>
        <button
          type="button"
          className={`icon-btn${pinned ? ' active' : ''}`}
          aria-label={pinned ? '取消置顶' : '窗口置顶'}
          title={pinned ? '取消置顶' : '窗口置顶'}
          onClick={() => void setPinned(!pinned)}
        >
          {pinned ? <Pin size={14} /> : <PinOff size={14} />}
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label={theme === 'ink' ? '换成纸色' : '换成墨色'}
          title={theme === 'ink' ? '纸色主题' : '墨色主题'}
          onClick={() => void setTheme(theme === 'ink' ? 'paper' : 'ink')}
        >
          {theme === 'ink' ? <Sun size={14} /> : <Moon size={14} />}
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="设置"
          title="设置"
          onClick={() => navigate({ name: 'settings' })}
        >
          <Settings size={14} />
        </button>
        <button type="button" className="icon-btn" aria-label="收为胶囊" title="收为胶囊" onClick={collapse}>
          <EyeOff size={14} />
        </button>
        <button type="button" className="icon-btn close" aria-label="退出" title="退出" onClick={() => void quit()}>
          <X size={15} />
        </button>
      </div>
    </header>
  );
}
