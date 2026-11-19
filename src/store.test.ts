import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';
import { useApp } from '@/store';
import type { Bootstrap, StudySettings } from '@/types';

vi.mock('@/lib/api', () => ({
  api: {
    bootstrap: vi.fn(),
    uiReady: vi.fn(),
    saveUiPrefs: vi.fn(),
    saveStudySettings: vi.fn(),
    setWindowMode: vi.fn(),
  },
}));

vi.mock('@/lib/bridge', () => ({
  isBrowserPreview: false,
  normalizeError: (error: Error) => ({ code: 'error', message: error.message }),
}));

const defaults: StudySettings = {
  dailyNew: 10,
  dailyReview: 50,
  timezone: 'Asia/Shanghai',
  theme: 'ink',
  capsuleMetric: 'due',
  cloudNoticeSeen: false,
};

const bootstrap: Bootstrap = {
  appVersion: '0.1.0',
  platform: 'windows',
  dataDir: 'test',
  isFirstRun: false,
  model: {
    configured: false,
    provider: '',
    model: '',
    baseUrl: '',
    hasApiKey: false,
    lastTestAt: null,
    lastTestOk: null,
    lastTestMessage: null,
  },
  settings: defaults,
  overview: {
    localDate: '2026-11-18',
    timezone: defaults.timezone,
    dueCount: 0,
    newAvailable: 0,
    completedToday: 0,
    reviewServedToday: 0,
    newServedToday: 0,
    reviewLimit: 50,
    newLimit: 10,
    backlog: 0,
    blockedCount: 0,
    drafts: 0,
    activeCards: 0,
    totalConcepts: 0,
    streakDays: 0,
    last7: [],
  },
  sources: [],
  sessions: [],
  sampleLoaded: false,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

const initial = useApp.getInitialState();

beforeEach(async () => {
  vi.resetAllMocks();
  vi.stubGlobal('document', { documentElement: { dataset: {}, style: {} } });
  vi.stubGlobal('window', { setTimeout: vi.fn() });
  vi.mocked(api.bootstrap).mockResolvedValue(bootstrap);
  vi.mocked(api.uiReady).mockResolvedValue(undefined);
  vi.mocked(api.setWindowMode).mockResolvedValue(undefined);
  vi.mocked(api.saveUiPrefs).mockResolvedValue(undefined);
  useApp.setState(initial, true);
  await useApp.getState().init();
});

afterEach(() => vi.unstubAllGlobals());

describe('preference ownership', () => {
  it('serializes rapid theme writes and ignores a superseded save failure', async () => {
    const first = deferred<void>();
    vi.mocked(api.saveUiPrefs).mockReturnValueOnce(first.promise);
    const { setTheme } = useApp.getState();
    const paper = setTheme('paper');
    const ink = setTheme('ink');
    await Promise.resolve();
    expect(vi.mocked(api.saveUiPrefs).mock.calls).toEqual([['paper']]);
    expect(document.documentElement.dataset.theme).toBe('ink');

    first.reject(new Error('older write failed'));
    await Promise.all([paper, ink]);
    expect(vi.mocked(api.saveUiPrefs).mock.calls).toEqual([['paper'], ['ink']]);
    expect(useApp.getState().settings?.theme).toBe('ink');
    expect(useApp.getState().toasts).toEqual([]);
  });

  it('preserves a chosen theme and saved study fields when an older refresh returns', async () => {
    const stale = deferred<Bootstrap>();
    vi.mocked(api.bootstrap).mockReturnValueOnce(stale.promise);
    const { refreshAll, saveStudySettings, setTheme } = useApp.getState();
    const refresh = refreshAll();
    const input = { dailyNew: 22, dailyReview: 700, timezone: 'Asia/Tokyo', capsuleMetric: 'new' as const };
    vi.mocked(api.saveStudySettings).mockResolvedValue({ ...defaults, ...input, dailyReview: 500 });
    const study = saveStudySettings(input);
    await setTheme('paper');
    expect(await study).toMatchObject({ ...input, dailyReview: 500, theme: 'paper' });
    stale.resolve(bootstrap);
    await refresh;

    expect(api.saveStudySettings).toHaveBeenCalledWith(input);
    expect(api.saveUiPrefs).toHaveBeenCalledWith('paper');
    expect(document.documentElement.dataset.theme).toBe('paper');
    expect(useApp.getState().theme).toBe('paper');
    expect(useApp.getState().settings).toMatchObject({ ...input, dailyReview: 500, theme: 'paper' });
    expect(useApp.getState().bootstrap?.settings).toBe(useApp.getState().settings);
  });
});

it('returns from settings to the originating window mode without resizing on category changes', () => {
  const { navigate, goBack } = useApp.getState();
  const session = { name: 'session' as const, sessionId: 'session-test' };
  navigate(session, { mode: 'panorama' });
  navigate({ name: 'settings', section: 'model' });
  navigate({ name: 'settings', section: 'theme' });
  goBack();

  expect(useApp.getState().view).toEqual(session);
  expect(useApp.getState().windowMode).toBe('panorama');
  expect(vi.mocked(api.setWindowMode).mock.calls).toEqual([['panorama'], ['settings'], ['panorama']]);
  navigate(session, { mode: 'panorama' });
  expect(api.setWindowMode).toHaveBeenCalledTimes(4);
});
