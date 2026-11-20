import { useEffect } from 'react';

import { BrandMark } from '@/components/BrandMark';
import { Capsule } from '@/components/Capsule';
import { CloudConsent } from '@/components/CloudConsent';
import { DemoDock } from '@/components/DemoDock';
import { NavTabs } from '@/components/NavTabs';
import { Titlebar } from '@/components/Titlebar';
import { ToastStack } from '@/components/ToastStack';
import { isTauri, listen } from '@/lib/bridge';
import { useApp } from '@/store';
import { OnboardingScreen } from '@/screens/Onboarding';
import { TodayScreen } from '@/screens/Today';
import { LibraryScreen } from '@/screens/Library';
import { ReaderScreen } from '@/screens/Reader';
import { SessionScreen } from '@/screens/Session';
import { PanoramaScreen } from '@/screens/Panorama';
import { ReviewScreen } from '@/screens/Review';
import { CardsScreen } from '@/screens/Cards';
import { CardDetailScreen } from '@/screens/CardDetail';
import { SettingsScreen } from '@/screens/Settings';
import { StudyScreen } from '@/screens/Study';

export default function App() {
  const ready = useApp((state) => state.ready);
  const fatalError = useApp((state) => state.fatalError);
  const view = useApp((state) => state.view);
  const windowMode = useApp((state) => state.windowMode);
  const init = useApp((state) => state.init);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    const disposers: Array<() => void> = [];
    let cancelled = false;

    async function subscribe() {
      const shortcut = await listen<null>('fold:shortcut', () => {
        useApp.getState().handleAppEvent('fold:shortcut');
      });
      const navigate = await listen<string>('fold:navigate', (event) => {
        useApp.getState().handleAppEvent('fold:navigate', event.payload);
      });
      const readyEvent = await listen<null>('fold:ready', () => {
        useApp.getState().handleAppEvent('fold:ready');
      });
      if (cancelled) {
        shortcut();
        navigate();
        readyEvent();
        return;
      }
      disposers.push(shortcut, navigate, readyEvent);
    }

    void subscribe();
    return () => {
      cancelled = true;
      for (const dispose of disposers) dispose();
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const store = useApp.getState();
      if (store.view.name === 'onboarding' || store.view.name === 'study') return;
      if (event.key === '1') {
        event.preventDefault();
        store.navigate({ name: 'today' });
      } else if (event.key === '2') {
        event.preventDefault();
        store.navigate({ name: 'library' });
      } else if (event.key === '3') {
        event.preventDefault();
        store.navigate({ name: 'cards' });
      } else if (event.key === '4') {
        event.preventDefault();
        store.navigate({ name: 'review' }, { mode: 'review' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!ready) {
    return (
      <div className="app-root">
        <div className="hud-shell" data-mode="panel">
          <div className="boot-screen">
            <BrandMark size={54} className="boot-mark" title="折页" />
            <div className="boot-title">折页</div>
            <p className="boot-copy">正在打开本机学习库。</p>
          </div>
        </div>
      </div>
    );
  }

  if (fatalError) {
    return (
      <div className="app-root">
        <div className="hud-shell" data-mode="panel">
          <div className="boot-screen">
            <BrandMark size={54} className="boot-mark" title="折页" />
            <div className="boot-title">没有打开</div>
            <p className="boot-copy">本地数据库或界面资源没有加载完成。你的原始文件没有被修改。</p>
            <div className="boot-error">{fatalError}</div>
            <button type="button" className="btn btn-primary" onClick={() => void init()}>
              重新打开
            </button>
          </div>
        </div>
      </div>
    );
  }

  const guided = view.name === 'onboarding' || view.name === 'study';
  const immersive = guided || view.name === 'capsule';
  const showTitlebar = !immersive && view.name !== 'review';
  const showNav = view.name === 'today' || view.name === 'library' || view.name === 'cards' || view.name === 'card';

  function renderView() {
    switch (view.name) {
      case 'capsule':
        return <Capsule />;
      case 'onboarding':
        return <OnboardingScreen />;
      case 'study':
        return <StudyScreen />;
      case 'today':
        return <TodayScreen />;
      case 'library':
        return <LibraryScreen />;
      case 'reader':
        return <ReaderScreen sourceId={view.sourceId} revisionId={view.revisionId ?? null} />;
      case 'session':
        return windowMode === 'panorama' ? (
          <PanoramaScreen sessionId={view.sessionId} />
        ) : (
          <SessionScreen sessionId={view.sessionId} />
        );
      case 'review':
        return <ReviewScreen attemptId={view.attemptId ?? null} />;
      case 'cards':
        return <CardsScreen initialStatus={view.status} />;
      case 'card':
        return <CardDetailScreen cardId={view.cardId} />;
      case 'settings':
        return <SettingsScreen section={view.section} />;
      default:
        return <TodayScreen />;
    }
  }

  return (
    <div className="app-root" data-view={view.name}>
      <div className="hud-shell" data-mode={windowMode}>
        {showTitlebar ? <Titlebar /> : null}
        {showNav ? <NavTabs /> : null}
        <div className="content">{renderView()}</div>
      </div>
      <CloudConsent />
      <ToastStack />
      {import.meta.env.DEV && !guided ? <DemoDock /> : null}
    </div>
  );
}
