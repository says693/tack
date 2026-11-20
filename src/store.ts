import { create } from 'zustand';

import { api } from '@/lib/api';
import { isBrowserPreview, normalizeError } from '@/lib/bridge';
import { guidedStudy } from '@/lib/guided-study';
import type {
  Bootstrap,
  ModelStatus,
  Overview,
  SessionSummary,
  SourceSummary,
  StudySettings,
  StudySettingsInput,
  Theme,
  ToastMessage,
  View,
  WindowMode,
} from '@/types';

let cloudResolver: ((ok: boolean) => void) | null = null;
let preferenceWrites = Promise.resolve();
let themeRevision = 0;

interface NavigationEntry {
  view: View;
  windowMode: WindowMode;
}

interface AppStore {
  ready: boolean;
  fatalError: string | null;
  bootstrap: Bootstrap | null;
  overview: Overview | null;
  sources: SourceSummary[];
  sessions: SessionSummary[];
  settings: StudySettings | null;
  model: ModelStatus | null;
  view: View;
  history: NavigationEntry[];
  capsuleReturn: NavigationEntry | null;
  windowMode: WindowMode;
  pinned: boolean;
  theme: Theme;
  toasts: ToastMessage[];
  cloudOpen: boolean;
  init: () => Promise<void>;
  markOnboarded: () => Promise<void>;
  refreshAll: () => Promise<void>;
  refreshOverview: () => Promise<void>;
  refreshLibrary: () => Promise<void>;
  navigate: (view: View, options?: { mode?: WindowMode; replace?: boolean; returnTo?: View }) => void;
  goBack: () => void;
  setWindowMode: (mode: WindowMode) => void;
  enterCapsule: () => void;
  exitCapsule: () => void;
  setTheme: (theme: Theme) => Promise<void>;
  saveStudySettings: (input: StudySettingsInput) => Promise<StudySettings>;
  setPinned: (pinned: boolean) => Promise<void>;
  toast: (tone: ToastMessage['tone'], title: string, detail?: string) => void;
  dismissToast: (id: string) => void;
  withCloud: <T>(fn: (ack: boolean) => Promise<T>) => Promise<T>;
  requireCloud: () => Promise<boolean>;
  resolveCloud: (ok: boolean) => void;
  applyOverview: (overview: Overview) => void;
  handleAppEvent: (event: string, payload?: unknown) => void;
}

function modeForView(view: View): WindowMode {
  switch (view.name) {
    case 'onboarding':
    case 'study':
      return 'guided';
    case 'capsule':
      return 'capsule';
    case 'review':
      return 'review';
    case 'settings':
      return 'settings';
    case 'reader':
      return 'panorama';
    default:
      return 'panel';
  }
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme === 'paper' ? 'light' : 'dark';
}

function queuePreferenceWrite<T>(write: () => Promise<T>): Promise<T> {
  const result = preferenceWrites.then(write);
  preferenceWrites = result.then(() => undefined, () => undefined);
  return result;
}

function patchPreferences(state: AppStore, patch: Partial<StudySettings>) {
  if (!state.settings) return {};
  const settings = { ...state.settings, ...patch };
  return {
    settings,
    bootstrap: state.bootstrap ? { ...state.bootstrap, settings } : state.bootstrap,
  };
}

export const useApp = create<AppStore>((set, get) => ({
  ready: false,
  fatalError: null,
  bootstrap: null,
  overview: null,
  sources: [],
  sessions: [],
  settings: null,
  model: null,
  view: { name: 'today' },
  history: [],
  capsuleReturn: null,
  windowMode: 'panel',
  pinned: false,
  theme: 'ink',
  toasts: [],
  cloudOpen: false,

  init: async () => {
    try {
      const stored = await api.bootstrap();
      const theme = stored.settings.theme === 'paper' ? 'paper' : 'ink';
      const bootstrap: Bootstrap = { ...stored, settings: { ...stored.settings, theme } };
      applyTheme(theme);
      const legacyPreview = isBrowserPreview && import.meta.env.DEV
        && new URLSearchParams(window.location.search).has('legacy');
      const guidedReady = bootstrap.guidedReady
        || (isBrowserPreview && import.meta.env.DEV && !legacyPreview && Boolean(await guidedStudy.getRun()));
      const firstView: View = guidedReady
        ? { name: 'study' }
        : legacyPreview || (!isBrowserPreview && !bootstrap.isFirstRun)
          ? { name: 'today' }
          : { name: 'onboarding' };
      const mode = modeForView(firstView);
      set({
        ready: true,
        fatalError: null,
        bootstrap,
        overview: bootstrap.overview,
        sources: bootstrap.sources,
        sessions: bootstrap.sessions,
        settings: bootstrap.settings,
        model: bootstrap.model,
        theme,
        view: firstView,
        windowMode: mode,
        pinned: false,
      });
      if (!isBrowserPreview) {
        await api.uiReady(mode).catch(() => undefined);
      }
    } catch (error) {
      const normalized = normalizeError(error);
      set({ ready: true, fatalError: normalized.message });
    }
  },

  markOnboarded: async () => {
    set((state) => ({
      bootstrap: state.bootstrap ? { ...state.bootstrap, isFirstRun: false } : state.bootstrap,
    }));
    await api.completeOnboarding?.().catch(() => undefined);
  },

  refreshAll: async () => {
    try {
      const bootstrap = await api.bootstrap();
      set((state) => {
        // Once initialized, local preference actions own this snapshot.
        const settings = state.settings ?? bootstrap.settings;
        return {
          bootstrap: { ...bootstrap, settings },
          overview: bootstrap.overview,
          sources: bootstrap.sources,
          sessions: bootstrap.sessions,
          settings,
          model: bootstrap.model,
        };
      });
    } catch (error) {
      get().toast('error', '刷新失败', normalizeError(error).message);
    }
  },

  refreshOverview: async () => {
    try {
      const overview = await api.overview();
      set({ overview });
      const bootstrap = get().bootstrap;
      if (bootstrap) set({ bootstrap: { ...bootstrap, overview } });
    } catch {
      // A transient refresh failure should not interrupt study.
    }
  },

  refreshLibrary: async () => {
    try {
      const [sources, sessions] = await Promise.all([api.listSources(), api.listSessions()]);
      set({ sources, sessions });
    } catch (error) {
      get().toast('error', '书架刷新失败', normalizeError(error).message);
    }
  },

  navigate: (view, options) => {
    const { view: current, windowMode, history } = get();
    const same =
      current.name === view.name &&
      ((current.name === 'reader' && view.name === 'reader' && current.sourceId === view.sourceId) ||
        (current.name === 'session' && view.name === 'session' && current.sessionId === view.sessionId) ||
        (current.name === 'card' && view.name === 'card' && current.cardId === view.cardId) ||
        current.name === view.name);
    const nextHistory = same || options?.replace ? history : [...history, { view: options?.returnTo ?? current, windowMode }];
    const mode = options?.mode ?? modeForView(view);
    set({ view, history: nextHistory.slice(-30), windowMode: mode });
    const staysInWindow = windowMode === mode
      && (mode === 'guided' || (current.name === 'settings' && view.name === 'settings'));
    if (!isBrowserPreview && !staysInWindow) {
      api.setWindowMode(mode).catch(() => undefined);
    }
  },

  goBack: () => {
    const history = [...get().history];
    const previous = history.pop();
    const view = previous?.view ?? { name: 'today' as const };
    const mode = previous?.windowMode ?? modeForView(view);
    set({ view, history, windowMode: mode });
    if (!isBrowserPreview) {
      api.setWindowMode(mode).catch(() => undefined);
    }
  },

  setWindowMode: (mode) => {
    set({ windowMode: mode });
    if (!isBrowserPreview) {
      api.setWindowMode(mode).catch(() => undefined);
    }
  },

  enterCapsule: () => {
    const { view: current, windowMode } = get();
    const capsuleReturn = current.name === 'capsule' ? get().capsuleReturn : { view: current, windowMode };
    const view: View = { name: 'capsule' };
    set({ view, windowMode: 'capsule', capsuleReturn });
    if (!isBrowserPreview) {
      api.setWindowMode('capsule').catch(() => undefined);
    }
  },

  exitCapsule: () => {
    const target = get().capsuleReturn;
    const view: View = target?.view ?? { name: 'today' };
    const mode: WindowMode = target?.windowMode ?? modeForView(view);
    set({ view, windowMode: mode, capsuleReturn: null });
    if (!isBrowserPreview) {
      api.setWindowMode(mode).catch(() => undefined);
    }
  },

  setTheme: async (theme) => {
    const revision = ++themeRevision;
    applyTheme(theme);
    const write = queuePreferenceWrite(() => api.saveUiPrefs(theme));
    set((state) => ({ theme, ...patchPreferences(state, { theme }) }));
    try {
      await write;
    } catch (error) {
      if (revision === themeRevision) {
        get().toast('error', '主题未保存', normalizeError(error).message);
      }
    }
  },

  saveStudySettings: (input) =>
    queuePreferenceWrite(async () => {
      const saved = await api.saveStudySettings(input);
      const { dailyNew, dailyReview, timezone, capsuleMetric } = saved;
      set((state) => patchPreferences(state, { dailyNew, dailyReview, timezone, capsuleMetric }));
      return get().settings ?? saved;
    }),

  setPinned: async (pinned) => {
    set({ pinned });
    try {
      await api.setPinned(pinned);
    } catch (error) {
      get().toast('error', '置顶设置失败', normalizeError(error).message);
    }
  },

  toast: (tone, title, detail) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const toast: ToastMessage = { id, tone, title, detail };
    set((state) => ({ toasts: [...state.toasts.slice(-3), toast] }));
    window.setTimeout(() => {
      get().dismissToast(id);
    }, 4600);
  },

  dismissToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
  },

  withCloud: async <T,>(fn: (ack: boolean) => Promise<T>): Promise<T> => {
    try {
      return await fn(false);
    } catch (error) {
      const normalized = normalizeError(error);
      if (normalized.code !== 'cloud_notice_required') throw error;
      const ok = await get().requireCloud();
      if (!ok) throw error;
      return await fn(true);
    }
  },

  requireCloud: () =>
    new Promise<boolean>((resolve) => {
      cloudResolver = resolve;
      set({ cloudOpen: true });
    }),

  resolveCloud: (ok) => {
    set({ cloudOpen: false });
    if (ok) {
      api.markCloudNoticeSeen().catch(() => undefined);
      set((state) => patchPreferences(state, { cloudNoticeSeen: true }));
    }
    cloudResolver?.(ok);
    cloudResolver = null;
  },

  applyOverview: (overview) => {
    set((state) => ({
      overview,
      bootstrap: state.bootstrap ? { ...state.bootstrap, overview } : state.bootstrap,
    }));
  },

  handleAppEvent: (event, payload) => {
    const currentView = get().view;
    const currentMode = get().windowMode;
    if (event === 'fold:shortcut') {
      if (currentMode === 'capsule') {
        get().exitCapsule();
      } else if (currentView.name !== 'onboarding' && currentView.name !== 'study') {
        get().navigate({ name: 'today' }, { mode: 'panel' });
      }
      return;
    }
    if (event === 'fold:navigate') {
      if (payload === 'review') {
        if (currentView.name === 'study' || currentView.name === 'onboarding') {
          get().navigate({ name: 'study' });
        } else {
          get().navigate({ name: 'review' }, { mode: 'review' });
        }
      } else {
        if (currentMode === 'capsule') get().exitCapsule();
        else if (currentView.name !== 'onboarding' && currentView.name !== 'study') {
          get().navigate({ name: 'today' }, { mode: 'panel' });
        }
      }
      return;
    }
    if (event === 'fold:ready') {
      get().refreshOverview();
    }
  },
}));
