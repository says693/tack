import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Database,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  HardDrive,
  KeyRound,
  Layers,
  Moon,
  Palette,
  Repeat2,
  Save,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { DeepSeekGuide } from '@/components/DeepSeekGuide';
import { Modal } from '@/components/Modal';
import { ErrorState, Field, Loading, NumberControl, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { isTauri, normalizeError } from '@/lib/bridge';
import { downloadText } from '@/lib/files';
import { formatBytes, formatDateTimeCN } from '@/lib/format';
import { useApp } from '@/store';
import type { ModelConfigInput, SettingsView, TestModelResult, Theme } from '@/types';

import '@/styles/settings.css';

const CATEGORIES = [
  { id: 'model', label: '模型', icon: Sparkles },
  { id: 'study', label: '学习', icon: BookOpen },
  { id: 'theme', label: '外观', icon: Palette },
  { id: 'data', label: '数据', icon: Database },
  { id: 'privacy', label: '隐私', icon: ShieldCheck },
] as const;

type Category = (typeof CATEGORIES)[number]['id'];

const COMPACT_NAV = '(max-width: 680px), (max-height: 360px)';

function categoryFor(section?: string): Category {
  return CATEGORIES.find((item) => item.id === section)?.id ?? 'study';
}

function SettingsTabs({
  active,
  summaries,
  onChange,
}: {
  active: Category;
  summaries: Record<Category, string>;
  onChange: (category: Category) => void;
}) {
  const [compact, setCompact] = useState(() => window.matchMedia(COMPACT_NAV).matches);
  const tabRefs = useRef<Partial<Record<Category, HTMLButtonElement | null>>>({});

  useEffect(() => {
    const media = window.matchMedia(COMPACT_NAV);
    const sync = () => setCompact(media.matches);
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  function move(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = CATEGORIES.length - 1;
    let next: number;
    switch (event.key) {
      case 'Home': next = 0; break;
      case 'End': next = last; break;
      case 'ArrowUp': if (compact) return; next = index === 0 ? last : index - 1; break;
      case 'ArrowDown': if (compact) return; next = index === last ? 0 : index + 1; break;
      case 'ArrowLeft': next = index === 0 ? last : index - 1; break;
      case 'ArrowRight': next = index === last ? 0 : index + 1; break;
      default: return;
    }
    event.preventDefault();
    const id = CATEGORIES[next].id;
    onChange(id);
    tabRefs.current[id]?.focus({ preventScroll: true });
  }

  return (
    <div className="settings-tabs" role="tablist" aria-label="设置分类" aria-orientation={compact ? 'horizontal' : 'vertical'}>
      {CATEGORIES.map(({ id, label, icon: Icon }, index) => (
        <button
          key={id}
          type="button"
          id={`settings-tab-${id}`}
          ref={(button) => { tabRefs.current[id] = button; }}
          className="settings-tab"
          role="tab"
          aria-controls={`settings-${id}`}
          aria-selected={active === id}
          tabIndex={active === id ? 0 : -1}
          onClick={() => onChange(id)}
          onKeyDown={(event) => move(event, index)}
        >
          <Icon size={17} aria-hidden />
          <span>{label}</span>
          <span className="settings-tab-summary" aria-hidden>{summaries[id]}</span>
        </button>
      ))}
    </div>
  );
}

function PanelHeading({ title, detail, children }: { title: string; detail?: string; children?: ReactNode }) {
  return (
    <header className="settings-panel-head">
      <div>
        <h2>{title}</h2>
        {detail ? <p>{detail}</p> : null}
      </div>
      {children}
    </header>
  );
}

function SettingsRow({ icon: Icon, label, detail, children }: {
  icon: LucideIcon;
  label: string;
  detail?: string;
  children?: ReactNode;
}) {
  return (
    <div className="settings-row">
      <Icon size={17} className="settings-row-icon" aria-hidden />
      <div className="settings-row-copy">
        <div className="settings-row-label">{label}</div>
        {detail ? <p>{detail}</p> : null}
      </div>
      {children ? <div className="settings-row-control">{children}</div> : null}
    </div>
  );
}

function ThemeOptions({ theme, onChange }: { theme: Theme; onChange: (theme: Theme) => void }) {
  return (
    <fieldset className="settings-fieldset">
      <legend className="settings-label">主题</legend>
      <div className="settings-theme-grid">
        {([
          { id: 'paper', label: '纸色', icon: Sun },
          { id: 'ink', label: '墨色', icon: Moon },
        ] as const).map(({ id, label, icon: Icon }) => (
          <label key={id} className="settings-theme-option">
            <input
              className="settings-theme-radio"
              type="radio"
              name="settings-theme"
              aria-label={label}
              checked={theme === id}
              onChange={() => onChange(id)}
            />
            <span className="settings-theme-preview" data-preview-theme={id} aria-hidden>
              <span className="settings-preview-bar">
                <span /><span /><span />
              </span>
              <span className="settings-preview-columns">
                <span className="settings-preview-nav"><span /><span /><span /></span>
                <span className="settings-preview-page"><span /><span /><span /></span>
              </span>
            </span>
            <span className="settings-theme-label">
              <Icon size={15} aria-hidden />
              {label}
              <span className="settings-theme-check" aria-hidden><Check size={12} strokeWidth={2.8} /></span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const PROVIDERS = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    desc: 'api.deepseek.com',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    desc: 'api.openai.com',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    desc: 'openrouter.ai',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'deepseek/deepseek-chat-v3.1',
  },
  {
    id: 'ollama',
    name: 'Ollama',
    desc: '本机 11434',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen3:8b',
  },
];

function providerFor(url: string) {
  return PROVIDERS.find((item) => item.baseUrl === url ||
    (item.id === 'deepseek' && url === `${item.baseUrl}/v1`));
}

function normalizeEndpoint(url: string) {
  return url.trim().replace(/\/+$/, '');
}

const TIMEZONES = [
  ['Asia/Shanghai', '中国标准时间 · 上海'],
  ['Asia/Hong_Kong', '香港时间'],
  ['Asia/Tokyo', '日本标准时间 · 东京'],
  ['Asia/Singapore', '新加坡时间'],
  ['Europe/London', '英国时间 · 伦敦'],
  ['America/New_York', '美国东部时间 · 纽约'],
  ['UTC', '协调世界时 · UTC'],
];

function todayFileStamp(): string {
  const date = new Date();
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}

export function SettingsScreen({ section }: { section?: string }) {
  const bootstrap = useApp((state) => state.bootstrap);
  const settingsStore = useApp((state) => state.settings);
  const theme = useApp((state) => state.theme);
  const setTheme = useApp((state) => state.setTheme);
  const saveStudySettings = useApp((state) => state.saveStudySettings);
  const refreshAll = useApp((state) => state.refreshAll);
  const refreshLibrary = useApp((state) => state.refreshLibrary);
  const refreshOverview = useApp((state) => state.refreshOverview);
  const goBack = useApp((state) => state.goBack);
  const toast = useApp((state) => state.toast);

  const [active, setActive] = useState(() => categoryFor(section));
  const scrollRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<SettingsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [provider, setProvider] = useState('deepseek');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestModelResult | null>(null);
  const [clearKeyOpen, setClearKeyOpen] = useState(false);
  const [modelDetailsOpen, setModelDetailsOpen] = useState(false);
  const [deepSeekGuideOpen, setDeepSeekGuideOpen] = useState(false);
  const keyInput = useRef<HTMLInputElement>(null);
  const [dailyNew, setDailyNew] = useState(10);
  const [dailyReview, setDailyReview] = useState(50);
  const [timezone, setTimezone] = useState('Asia/Shanghai');
  const [capsuleMetric, setCapsuleMetric] = useState<'due' | 'new'>('due');
  const [savingStudy, setSavingStudy] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);

  const applyView = useCallback((next: SettingsView) => {
    setView(next);
    const baseUrl = normalizeEndpoint(next.model.baseUrl);
    const preset = providerFor(baseUrl);
    setProvider(preset?.id ?? (baseUrl ? 'custom' : next.model.provider || 'deepseek'));
    setBaseUrl(baseUrl);
    setModel(preset?.id === 'deepseek' && !next.model.hasApiKey ? preset.model : next.model.model || '');
    setModelDetailsOpen(preset?.id !== 'deepseek');
    setApiKey('');
    setDailyNew(next.study.dailyNew);
    setDailyReview(next.study.dailyReview);
    setTimezone(next.study.timezone);
    setCapsuleMetric(next.study.capsuleMetric);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const next = await api.settings();
      applyView(next);
    } catch (err) {
      setLoadError(normalizeError(err).message);
    } finally {
      setLoading(false);
    }
  }, [applyView]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setActive(categoryFor(section));
  }, [section]);

  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    if (active !== 'model') setShowKey(false);
  }, [active]);

  function selectProvider(item: (typeof PROVIDERS)[number]) {
    setProvider(item.id);
    setBaseUrl(item.baseUrl);
    setModel(item.model);
    setApiKey('');
    setShowKey(false);
    setModelDetailsOpen(item.id !== 'deepseek');
    setTestResult(null);
  }

  async function saveModel(silent = false): Promise<boolean> {
    if (!isTauri) return false;
    if (!baseUrl.trim() || !model.trim()) {
      toast('error', '还差两项', 'Base URL 与模型名都需要填写。');
      return false;
    }
    setSavingModel(true);
    try {
      const input: ModelConfigInput = {
        provider,
        baseUrl: normalizeEndpoint(baseUrl),
        model: model.trim(),
        apiKey: apiKey.trim() || undefined,
      };
      const next = await api.saveModelConfig(input);
      setView((current) => (current ? { ...current, model: next } : current));
      setApiKey('');
      setShowKey(false);
      setTestResult(null);
      if (!silent) {
        await refreshAll();
        toast('success', '模型配置已保存', '保存在本机数据库，本次未测试连接。');
      }
      return true;
    } catch (err) {
      toast('error', '保存失败', normalizeError(err).message);
      return false;
    } finally {
      setSavingModel(false);
    }
  }

  async function testConnection() {
    if (testing || savingModel) return;
    setTesting(true);
    try {
      if (!await saveModel(true)) return;
      const result = await api.testModel();
      setTestResult(result);
      const next = await api.settings();
      setView((current) => (current ? { ...current, model: next.model } : current));
      await refreshAll();
      toast(result.ok ? 'success' : 'error', result.ok ? '连接成功' : '连接失败', result.message);
    } catch (err) {
      const message = normalizeError(err).message;
      setTestResult({ ok: false, latencyMs: 0, message, model });
      await refreshAll();
      toast('error', '连接失败', message);
    } finally {
      setTesting(false);
    }
  }

  async function clearKey() {
    try {
      const next = await api.clearApiKey();
      setView((current) => (current ? { ...current, model: next } : current));
      setApiKey('');
      setShowKey(false);
      setClearKeyOpen(false);
      setTestResult(null);
      await refreshAll();
      toast('success', '密钥已清除', '对话和自动批改会保持不可用，直到重新配置。');
    } catch (err) {
      toast('error', '清除失败', normalizeError(err).message);
    }
  }

  async function saveStudy() {
    if (savingStudy) return;
    setSavingStudy(true);
    try {
      const next = await saveStudySettings({ dailyNew, dailyReview, timezone, capsuleMetric });
      setDailyNew(next.dailyNew);
      setDailyReview(next.dailyReview);
      setTimezone(next.timezone);
      setCapsuleMetric(next.capsuleMetric);
      await refreshOverview();
      toast('success', '学习设置已保存', '从下一次取任务开始使用新的每日预算。');
    } catch (err) {
      toast('error', '保存失败', normalizeError(err).message);
    } finally {
      setSavingStudy(false);
    }
  }

  async function exportData(kind: 'tsv' | 'json') {
    if (exporting) return;
    setExporting(kind);
    try {
      const filename = `fold-cards-${todayFileStamp()}.${kind}`;
      if (isTauri) {
        const { save } = await import('@tauri-apps/plugin-dialog');
        const path = await save({
          defaultPath: filename,
          filters:
            kind === 'tsv'
              ? [{ name: 'TSV', extensions: ['tsv'] }]
              : [{ name: 'JSON', extensions: ['json'] }],
        });
        if (!path) {
          setExporting(null);
          return;
        }
        const result = kind === 'tsv' ? await api.exportTsv(path) : await api.exportJson(path);
        toast('success', '已导出', `${result.rows} 行 · ${formatBytes(result.bytes)}`);
      } else {
        const result = kind === 'tsv' ? await api.exportTsv('browser') : await api.exportJson('browser');
        downloadText(filename, result.content ?? '', kind === 'tsv' ? 'text/tab-separated-values;charset=utf-8' : 'application/json;charset=utf-8');
        toast('success', '已生成演示导出', `浏览器里直接下载 · ${result.rows} 行`);
      }
    } catch (err) {
      toast('error', '导出失败', normalizeError(err).message);
    } finally {
      setExporting(null);
    }
  }

  async function backup() {
    if (!isTauri) {
      toast('info', '浏览器预览不备份数据库', '桌面应用会把 SQLite 数据库复制到你选择的位置。');
      return;
    }
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const path = await save({
        defaultPath: `fold-backup-${todayFileStamp()}.db`,
        filters: [{ name: 'SQLite', extensions: ['db'] }],
      });
      if (!path) return;
      const result = await api.backupDatabase(path);
      toast('success', '数据库已备份', `${formatBytes(result.bytes)} · ${result.path}`);
    } catch (err) {
      toast('error', '备份失败', normalizeError(err).message);
    }
  }

  async function reveal() {
    if (!isTauri) {
      toast('info', '浏览器预览没有数据目录', '桌面应用的数据保存在本机 SQLite 文件里。');
      return;
    }
    try {
      await api.revealDataDir();
    } catch (err) {
      toast('error', '无法打开目录', normalizeError(err).message);
    }
  }

  async function resendPrivacy() {
    const ok = await useApp.getState().requireCloud();
    if (ok) toast('success', '发送范围已重新确认', '只在你主动调用模型时发送，不会后台自动同步。');
  }

  const activeModel = view?.model;
  const endpoint = normalizeEndpoint(baseUrl);
  const savedEndpoint = normalizeEndpoint(activeModel?.baseUrl ?? '');
  const preset = providerFor(endpoint);
  const sameEndpoint = endpoint === savedEndpoint ||
    (preset?.id === 'deepseek' && providerFor(savedEndpoint)?.id === 'deepseek');
  const needsNewKey = Boolean(activeModel?.hasApiKey && !sameEndpoint && !apiKey.trim());
  const canSave = isTauri && Boolean(endpoint && model.trim()) && !needsNewKey;
  const canTest = canSave && Boolean(apiKey.trim() || (sameEndpoint && activeModel?.hasApiKey) || preset?.id === 'ollama');
  const busyModel = testing || savingModel;
  const study = settingsStore ?? view?.study;
  const modelSummary = !isTauri ? '预览' : activeModel?.configured ? '已配置' : '未配置';
  const summaries = {
    study: study ? `${study.dailyNew} / ${study.dailyReview}` : '',
    theme: theme === 'paper' ? '纸色' : '墨色',
    model: modelSummary,
    data: isTauri ? '本机' : '预览',
    privacy: study?.cloudNoticeSeen ? '已确认' : '未确认',
  };
  const panel = (id: Category) => ({
    id: `settings-${id}`,
    role: 'tabpanel' as const,
    'aria-labelledby': `settings-tab-${id}`,
    tabIndex: 0,
    hidden: active !== id,
    className: 'settings-panel',
  });

  return (
    <div className="settings-screen">
      <aside className="settings-rail">
        <div className="settings-rail-head">
          <button
            type="button"
            className={`settings-back${bootstrap?.isFirstRun ? ' settings-back-onboarding' : ''}`}
            title={bootstrap?.isFirstRun ? '返回引导' : '返回上一步'}
            aria-label={bootstrap?.isFirstRun ? '返回引导' : '返回上一步'}
            onClick={goBack}
          >
            <ArrowLeft size={16} aria-hidden />
            {bootstrap?.isFirstRun ? <span>返回引导</span> : null}
          </button>
          <h1>设置</h1>
          {!isTauri ? <span className="settings-compact-preview">浏览器预览</span> : null}
        </div>
        <SettingsTabs active={active} summaries={summaries} onChange={setActive} />
        <div className="settings-rail-footer">
          <HardDrive size={14} aria-hidden />
          {isTauri ? '本机配置' : '浏览器预览'}
        </div>
      </aside>

      <div className="scroll settings-scroll" ref={scrollRef}>
        {!activeModel ? (
          loading
            ? <Loading label="正在读取本机配置…" />
            : <ErrorState message={loadError} onRetry={() => void load()} />
        ) : <>
          <section {...panel('model')}>
            <PanelHeading title="模型连接" detail="可选 · 离线阅读和自评不需要连接模型。">
              <span className="settings-status" data-status={isTauri && activeModel.configured ? 'ready' : 'idle'}>
                <span className="settings-status-dot" aria-hidden />
                {isTauri ? modelSummary : '浏览器预览'}
              </span>
            </PanelHeading>

            <fieldset className="settings-fieldset" disabled={busyModel}>
              <legend className="settings-label">服务商</legend>
              <div className="settings-provider-grid">
                {PROVIDERS.map((item) => {
                  const selected = provider === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className="settings-provider"
                      aria-pressed={selected}
                      onClick={() => selectProvider(item)}
                    >
                      <span className="settings-provider-name">
                        {item.name}
                        <Check size={13} aria-hidden />
                      </span>
                      <span className="settings-provider-domain">{item.desc}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <div className="settings-model-tools">
              <button type="button" className="btn btn-ghost" onClick={() => setDeepSeekGuideOpen(true)}>
                <KeyRound size={15} aria-hidden /> 获取 DeepSeek API Key
              </button>
              <button
                type="button"
                className="btn btn-ghost settings-disclosure"
                aria-expanded={modelDetailsOpen}
                aria-controls="model-connection-details"
                onClick={() => setModelDetailsOpen((current) => !current)}
              >
                <ChevronRight size={15} aria-hidden /> {modelDetailsOpen ? '收起高级设置' : '高级设置'}
              </button>
            </div>

            <div
              className="settings-details"
              id="model-connection-details"
              data-open={modelDetailsOpen}
              inert={!modelDetailsOpen}
            >
              <div className="settings-details-inner">
                <div className="settings-details-fields">
                  <Field label="Base URL" hint="OpenAI 兼容接口，末尾不带 /。">
                    <input
                      className="input"
                      value={baseUrl}
                      disabled={busyModel}
                      onChange={(event) => {
                        const next = event.target.value;
                        setBaseUrl(next);
                        setProvider(providerFor(normalizeEndpoint(next))?.id ?? 'custom');
                        setApiKey('');
                        setShowKey(false);
                        setTestResult(null);
                      }}
                      placeholder="https://api.deepseek.com"
                      spellCheck={false}
                    />
                  </Field>
                  <Field label="模型名" hint={preset ? `预设：${preset.name}` : '自定义端点的模型 ID'}>
                    <input
                      className="input"
                      value={model}
                      disabled={busyModel}
                      onChange={(event) => { setModel(event.target.value); setTestResult(null); }}
                      placeholder="deepseek-flash"
                      spellCheck={false}
                    />
                  </Field>
                </div>
              </div>
            </div>

            <div className="settings-key">
              <label className="settings-label" htmlFor="model-api-key">API Key</label>
              <div className="settings-key-field">
                <input
                  id="model-api-key"
                  ref={keyInput}
                  className="input"
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  disabled={!isTauri || busyModel}
                  onChange={(event) => { setApiKey(event.target.value); setTestResult(null); }}
                  placeholder={sameEndpoint && activeModel.hasApiKey && isTauri ? '已保存 · 留空不修改' : '粘贴 API Key'}
                  autoComplete="off"
                  aria-describedby="model-api-key-hint"
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="settings-key-toggle"
                  disabled={!isTauri || busyModel}
                  title={showKey ? '隐藏密钥' : '显示密钥'}
                  aria-label={showKey ? '隐藏密钥' : '显示密钥'}
                  onClick={() => setShowKey((value) => !value)}
                >
                  {showKey ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
                </button>
              </div>
              <p id="model-api-key-hint" className="settings-hint">
                {!isTauri ? '预览不接收密钥，请在桌面客户端配置。'
                  : needsNewKey ? '服务地址已变更，需填写新密钥或先清除旧密钥。'
                  : sameEndpoint && activeModel.hasApiKey ? '已保存密钥。留空保留原值。'
                  : 'API Key 明文保存在本机，请勿分享数据库备份。'}
              </p>
            </div>

            <div className="settings-actions">
              <button type="button" className="btn btn-primary" disabled={!canTest || busyModel} onClick={() => void testConnection()}>
                {testing ? <Spinner size={15} /> : <Sparkles size={15} aria-hidden />}
                保存并测试
              </button>
              <button type="button" className="btn btn-subtle" disabled={!canSave || busyModel} onClick={() => void saveModel()}>
                {savingModel && !testing ? <Spinner size={15} /> : <Save size={15} aria-hidden />}
                只保存
              </button>
              {isTauri && activeModel.hasApiKey ? (
                <button type="button" className="btn btn-ghost danger" disabled={busyModel} onClick={() => setClearKeyOpen(true)}>
                  <Trash2 size={15} aria-hidden /> 清除密钥
                </button>
              ) : null}
            </div>

            {testResult ? (
              <div className="settings-test-result" role="status" data-result={testResult.ok ? 'ok' : 'bad'}>
                <strong>{testResult.ok ? '连接成功' : '连接失败'}</strong>
                <span>{testResult.message}</span>
                {testResult.ok ? <small>{testResult.latencyMs} ms · {testResult.model}</small> : null}
              </div>
            ) : isTauri && sameEndpoint && !apiKey && model.trim() === activeModel.model &&
              (activeModel.hasApiKey || preset?.id === 'ollama') && activeModel.lastTestAt ? (
              <div className="settings-test-result" data-result={activeModel.lastTestOk ? 'ok' : 'bad'}>
                <strong>{activeModel.lastTestOk ? '上次连接成功' : '上次连接失败'}</strong>
                <span>{activeModel.lastTestMessage}</span>
                <small>{formatDateTimeCN(activeModel.lastTestAt)}</small>
              </div>
            ) : null}

            <div className="settings-actions settings-model-privacy">
              <button type="button" className="btn btn-ghost" onClick={() => void resendPrivacy()}>
                <ShieldCheck size={15} aria-hidden /> 查看发送范围
              </button>
            </div>
          </section>

          <section {...panel('study')}>
            <PanelHeading title="学习节奏" detail="每日预算、到期时区与胶囊显示" />
            <fieldset className="settings-fieldset settings-list" aria-label="学习设置" disabled={savingStudy}>
              <SettingsRow icon={Layers} label="每日新卡上限" detail="只限制每天领取的新卡">
                <div role="group" aria-label="每日新卡上限">
                  <NumberControl value={dailyNew} onChange={setDailyNew} min={1} max={200} />
                </div>
              </SettingsRow>
              <SettingsRow icon={Repeat2} label="每日复习上限" detail="积压保留原到期日">
                <div role="group" aria-label="每日复习上限">
                  <NumberControl value={dailyReview} onChange={setDailyReview} min={1} max={500} />
                </div>
              </SettingsRow>
              <SettingsRow icon={Clock3} label="本地时区" detail="用于计算复习到期日">
                <div className="settings-timezone">
                  <select className="select" aria-label="本地时区" value={timezone} onChange={(event) => setTimezone(event.target.value)}>
                    {!TIMEZONES.some(([value]) => value === timezone) ? <option value={timezone}>{timezone}</option> : null}
                    {TIMEZONES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  <ChevronDown size={14} aria-hidden />
                </div>
              </SettingsRow>
              <SettingsRow icon={HardDrive} label="胶囊显示">
                <div className="settings-segmented" role="group" aria-label="胶囊显示">
                  <button type="button" aria-pressed={capsuleMetric === 'due'} onClick={() => setCapsuleMetric('due')}>到期复习</button>
                  <button type="button" aria-pressed={capsuleMetric === 'new'} onClick={() => setCapsuleMetric('new')}>新卡可用</button>
                </div>
              </SettingsRow>
            </fieldset>
            <div className="settings-actions">
              <button type="button" className="btn btn-primary" disabled={savingStudy} onClick={() => void saveStudy()}>
                {savingStudy ? <Spinner size={15} /> : <Save size={15} aria-hidden />}
                保存学习设置
              </button>
            </div>
          </section>

          <section {...panel('theme')}>
            <PanelHeading title="外观" />
            <ThemeOptions theme={theme} onChange={(next) => void setTheme(next)} />
          </section>

          <section {...panel('data')}>
            <PanelHeading title="本机数据" detail={isTauri ? '桌面 SQLite' : '浏览器演示数据'} />
            <div className="settings-list">
              <SettingsRow icon={FolderOpen} label="数据目录" detail={bootstrap?.dataDir ?? '—'}>
                <button type="button" className="btn btn-subtle" onClick={() => void reveal()}>
                  <FolderOpen size={15} aria-hidden /> 打开数据目录
                </button>
              </SettingsRow>
              <SettingsRow icon={HardDrive} label="应用版本" detail={`${bootstrap?.appVersion ?? '0.1.0'} · ${bootstrap?.platform ?? '—'}`} />
              <SettingsRow icon={Repeat2} label="调度器" detail="fold-sm2e-1 · 简化 SM-2" />
              <SettingsRow icon={Sparkles} label="模型连接" detail={
                activeModel.configured ? `${activeModel.provider} · ${activeModel.model}` : '未配置'
              } />
            </div>
            <div className="settings-list">
              <SettingsRow icon={Download} label="导出学习记录" detail="TSV 可导入 Anki；JSON 包含卡片、修订与复习记录。">
                <div className="settings-actions">
                  <button type="button" className="btn btn-subtle" disabled={Boolean(exporting)} onClick={() => void exportData('tsv')}>
                    {exporting === 'tsv' ? <Spinner size={14} /> : <Download size={14} aria-hidden />} 导出 TSV
                  </button>
                  <button type="button" className="btn btn-subtle" disabled={Boolean(exporting)} onClick={() => void exportData('json')}>
                    {exporting === 'json' ? <Spinner size={14} /> : <Download size={14} aria-hidden />} 导出 JSON
                  </button>
                </div>
              </SettingsRow>
              <SettingsRow icon={Database} label="数据库备份" detail="备份包含明文 API Key（若已保存），请勿分享。">
                <button type="button" className="btn btn-subtle" onClick={() => void backup()}>
                  <Database size={15} aria-hidden /> 备份数据库
                </button>
              </SettingsRow>
            </div>
            {import.meta.env.DEV && !isTauri && !bootstrap?.sampleLoaded ? (
              <div className="settings-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={async () => {
                    try {
                      await api.loadDemo();
                      await Promise.all([refreshAll(), refreshLibrary()]);
                      toast('success', '示例材料已载入', '可以随时在书架里移除。');
                    } catch (err) {
                      toast('error', '载入失败', normalizeError(err).message);
                    }
                  }}
                >
                  <Sparkles size={15} aria-hidden />
                  载入示例材料
                </button>
              </div>
            ) : null}
          </section>

          <section {...panel('privacy')}>
            <PanelHeading title="模型数据与隐私" detail="学习内容只在你主动调用并确认发送范围后发送。" />
            <div className="settings-list">
              <SettingsRow icon={Sparkles} label="对话" detail="当前消息、必要的相邻上下文、选中原文与来源标题。" />
              <SettingsRow icon={Layers} label="出卡" detail="当前会话最新的一条完整回复与选中原文；模型只返回草稿。" />
              <SettingsRow icon={Check} label="批改" detail="问题、参考答案、证据摘录、首次答案与会话意图。" />
              <SettingsRow icon={ShieldCheck} label="不发送" detail="整个书架、其他线索和复习历史。密钥不会写入提示词或日志。" />
            </div>
            <div className="settings-actions">
              <button type="button" className="btn btn-subtle" onClick={() => void resendPrivacy()}>
                <ShieldCheck size={15} aria-hidden /> 重新查看发送范围
              </button>
            </div>
          </section>
        </>}
      </div>

      <DeepSeekGuide
        open={deepSeekGuideOpen}
        onClose={() => setDeepSeekGuideOpen(false)}
        onConfigure={() => {
          selectProvider(PROVIDERS[0]);
          setActive('model');
          requestAnimationFrame(() => keyInput.current?.focus());
        }}
      />
      <Modal
        open={clearKeyOpen}
        title="清除已保存的 API Key？"
        subtitle="清除后，对话、自动出卡与 AI 批改会明确失败；阅读、手写卡片与自评仍然可用。"
        onClose={() => setClearKeyOpen(false)}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setClearKeyOpen(false)}>
              取消
            </button>
            <button type="button" className="btn btn-danger" onClick={() => void clearKey()}>
              <KeyRound size={14} />
              清除密钥
            </button>
          </>
        }
      >
        <p className="settings-hint">重新填写密钥前，折页不会自动换模型。</p>
      </Modal>
    </div>
  );
}
