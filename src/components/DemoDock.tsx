import { isBrowserPreview } from '@/lib/bridge';
import { useApp } from '@/store';

const STORAGE_KEY = 'fold:mock:v3';

export function DemoDock() {
  const view = useApp((state) => state.view);
  const windowMode = useApp((state) => state.windowMode);
  const sources = useApp((state) => state.sources);
  const sessions = useApp((state) => state.sessions);
  const theme = useApp((state) => state.theme);
  const navigate = useApp((state) => state.navigate);
  const setWindowMode = useApp((state) => state.setWindowMode);
  const setTheme = useApp((state) => state.setTheme);

  if (!isBrowserPreview) return null;

  const firstSource = sources[0];
  const firstSession = sessions[0];
  const current = windowMode === 'capsule' ? 'capsule' : view.name === 'reader' ? 'reader' : view.name;

  function openSession(panorama: boolean) {
    if (!firstSession) return;
    navigate({ name: 'session', sessionId: firstSession.id });
    setWindowMode(panorama ? 'panorama' : 'panel');
  }

  return (
    <>
      <div className="demo-badge">
        <span>浏览器预览</span>
        <span>·</span>
        <span>模拟模型</span>
      </div>
      <div className="demo-dock" aria-label="演示导航">
        <button
          type="button"
          className={current === 'today' ? 'active' : ''}
          onClick={() => navigate({ name: 'today' })}
        >
          今日
        </button>
        <button
          type="button"
          className={current === 'library' ? 'active' : ''}
          onClick={() => navigate({ name: 'library' })}
        >
          书架
        </button>
        <button
          type="button"
          className={current === 'reader' ? 'active' : ''}
          disabled={!firstSource}
          onClick={() => firstSource && navigate({ name: 'reader', sourceId: firstSource.id }, { mode: 'panorama' })}
        >
          阅读
        </button>
        <button
          type="button"
          className={current === 'session' && windowMode === 'panel' ? 'active' : ''}
          disabled={!firstSession}
          onClick={() => openSession(false)}
        >
          线索
        </button>
        <button
          type="button"
          className={windowMode === 'panorama' ? 'active' : ''}
          disabled={!firstSession}
          onClick={() => openSession(true)}
        >
          全景
        </button>
        <button
          type="button"
          className={current === 'review' ? 'active' : ''}
          onClick={() => navigate({ name: 'review' }, { mode: 'review' })}
        >
          复习
        </button>
        <button
          type="button"
          className={current === 'cards' || current === 'card' ? 'active' : ''}
          onClick={() => navigate({ name: 'cards' })}
        >
          卡片
        </button>
        <button
          type="button"
          className={current === 'settings' ? 'active' : ''}
          onClick={() => navigate({ name: 'settings' })}
        >
          设置
        </button>
        <span className="demo-dock-sep" />
        <button
          type="button"
          onClick={() => navigate({ name: 'capsule' }, { mode: 'capsule' })}
          title="胶囊态"
        >
          胶囊
        </button>
        <button
          type="button"
          onClick={() => void setTheme(theme === 'ink' ? 'paper' : 'ink')}
          title="切换墨色 / 纸色"
        >
          {theme === 'ink' ? '纸色' : '墨色'}
        </button>
        <button
          type="button"
          onClick={() => {
            localStorage.removeItem(STORAGE_KEY);
            window.location.href = `${window.location.pathname}?fresh=1`;
          }}
          title="重置本地演示数据"
        >
          重置
        </button>
      </div>
    </>
  );
}
