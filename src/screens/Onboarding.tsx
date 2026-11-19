import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Check, ExternalLink, KeyRound, LockKeyhole, Search } from 'lucide-react';

import { BrandMark } from '@/components/BrandMark';
import { DeepSeekGuide } from '@/components/DeepSeekGuide';
import { Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { isTauri, normalizeError, type NormalizedError } from '@/lib/bridge';
import { guidedStudy, type GuidedRun, type GuidedSource } from '@/lib/guided-study';
import { useApp } from '@/store';

import '@/styles/guided-study.css';

type Step = 'loading' | 'connect' | 'topic' | 'sources' | 'generate' | 'ready';
const TOPIC_LIMIT = 80;
const KEY_LIMIT = 256;

function normalizeTopic(value: string) {
  return value.replace(/[\n\r\t]+/g, ' ').trim();
}

function readPendingTopic(key: string | null) {
  if (!key) return '';
  try {
    return window.localStorage.getItem(key)?.slice(0, TOPIC_LIMIT) ?? '';
  } catch {
    return '';
  }
}

function writePendingTopic(key: string | null, value: string) {
  if (!key) return;
  try {
    if (value.trim()) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // The wizard still works when the WebView cannot write to local storage.
  }
}

function clearGeneratedTopic(key: string | null, topic: string) {
  if (normalizeTopic(readPendingTopic(key)) === topic) writePendingTopic(key, '');
}

export function OnboardingScreen() {
  const navigate = useApp((state) => state.navigate);
  const dataDir = useApp((state) => state.bootstrap?.dataDir);
  const pendingTopicKey = dataDir ? `fold:guided:pending-topic:${dataDir}` : null;
  const [step, setStep] = useState<Step>('loading');
  const [reload, setReload] = useState(0);
  const [keyValue, setKeyValue] = useState('');
  const [connected, setConnected] = useState(false);
  const [balanceAvailable, setBalanceAvailable] = useState<boolean | null>(null);
  const [connectTarget, setConnectTarget] = useState<'topic' | 'sources'>('topic');
  const [topic, setTopic] = useState(() => readPendingTopic(pendingTopicKey));
  const [sources, setSources] = useState<GuidedSource[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [run, setRun] = useState<GuidedRun | null>(null);
  const [resuming, setResuming] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<NormalizedError | null>(null);
  const [retryGeneration, setRetryGeneration] = useState(false);
  const request = useRef(false);
  const title = useRef<HTMLHeadingElement>(null);
  const keyInput = useRef<HTMLInputElement>(null);
  const connectButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let active = true;
    void guidedStudy.status().then(
      (status) => {
        if (!active) return;
        setConnected(status.modelConfigured);
        if (status.run) {
          clearGeneratedTopic(pendingTopicKey, status.run.lesson.topic);
          setRun(status.run);
          setResuming(true);
          setStep('ready');
        } else {
          setStep(status.modelConfigured ? 'topic' : 'connect');
        }
      },
      (reason) => {
        if (active) setError(normalizeError(reason));
      },
    );
    return () => { active = false; };
  }, [pendingTopicKey, reload]);

  useEffect(() => {
    title.current?.focus();
  }, [step]);

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const key = isTauri ? keyValue.trim() : '';
    if (request.current || (isTauri && !key)) return;
    request.current = true;
    setBusy(true);
    setError(null);
    try {
      const connection = await guidedStudy.saveKey(key);
      setKeyValue('');
      setConnected(true);
      setBalanceAvailable(connection.balanceAvailable);
      setStep(connectTarget);
    } catch (reason) {
      const failure = normalizeError(reason);
      setError({ ...failure, message: key ? failure.message.replaceAll(key, '[密钥已隐藏]') : failure.message });
    } finally {
      request.current = false;
      setBusy(false);
    }
  }

  async function findSources(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = normalizeTopic(topic);
    if (request.current || !value) return;
    request.current = true;
    setBusy(true);
    setError(null);
    setRetryGeneration(false);
    try {
      const found = await guidedStudy.findSources(value);
      if (!found.length) {
        setError({
          code: 'guided_no_sources',
          message: '暂未找到能核对的资料。目前只收录光的反射、一元一次方程、Python 控制流（条件与循环）。',
        });
        return;
      }
      setTopic(value);
      writePendingTopic(pendingTopicKey, value);
      setSources(found);
      setSelected(found.map((source) => source.id));
      setStep('sources');
    } catch (reason) {
      setError(normalizeError(reason));
    } finally {
      request.current = false;
      setBusy(false);
    }
  }

  async function generate() {
    if (request.current || !selected.length) return;
    request.current = true;
    setError(null);
    setStep('generate');
    try {
      const generated = await guidedStudy.generate({ topic, sourceIds: selected, cloudAck: true });
      clearGeneratedTopic(pendingTopicKey, generated.lesson.topic);
      setRun(generated);
      setStep('ready');
    } catch (reason) {
      const persisted = await guidedStudy.status().catch(() => null);
      if (persisted?.run?.lesson.topic === topic) {
        clearGeneratedTopic(pendingTopicKey, topic);
        setRun(persisted.run);
        setStep('ready');
        return;
      }
      setError(normalizeError(reason));
      setRetryGeneration(true);
      setStep('sources');
    } finally {
      request.current = false;
    }
  }

  const stageIndex = step === 'connect' ? 0 : step === 'topic' ? 1 : step === 'sources' ? 2 : 3;

  return (
    <main className="guided-flow guided-wizard">
      <div className="guided-layout">
        <header className="guided-brand">
          <BrandMark size={27} />
          <span>折页</span>
          <span className="guided-brand-wordmark">FOLD</span>
        </header>

        {step !== 'loading' && step !== 'ready' ? (
          <ol className="guided-steps" aria-label="课程准备进度">
            {['连接', '主题', '资料', '生成'].map((label, index) => (
              <li
                key={label}
                aria-current={stageIndex === index ? 'step' : undefined}
                className={stageIndex > index ? 'is-past' : undefined}
              >
                <span className="guided-step-marker" aria-hidden="true">
                  {stageIndex > index ? <Check size={11} /> : index + 1}
                </span>
                {label}
              </li>
            ))}
          </ol>
        ) : null}

        <section className="guided-step" aria-labelledby="guided-wizard-title">
          {step === 'loading' ? (
            <>
              <h1 id="guided-wizard-title" ref={title} tabIndex={-1}>打开学习</h1>
              {error ? (
                <>
                  <p className="guided-error" role="alert">{error.message}</p>
                  <button type="button" className="btn btn-primary" onClick={() => { setError(null); setReload((value) => value + 1); }}>
                    重新读取
                  </button>
                </>
              ) : <p className="guided-status" role="status"><Spinner /> 正在读取本机学习进度</p>}
            </>
          ) : step === 'connect' ? (
            <form className="guided-form" onSubmit={(event) => void connect(event)} aria-busy={busy}>
              <h1 id="guided-wizard-title" ref={title} tabIndex={-1}>连接 AI</h1>
              <div className="guided-provider">
                <span className="guided-provider-icon"><KeyRound size={17} aria-hidden="true" /></span>
                <div><strong>DeepSeek</strong><span>api.deepseek.com</span></div>
              </div>
              {isTauri ? (
                <label className="guided-field" htmlFor="guided-api-key">
                  DeepSeek API Key
                  <input
                    id="guided-api-key"
                    ref={keyInput}
                    className="input"
                    type="password"
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    maxLength={KEY_LIMIT}
                    value={keyValue}
                    disabled={busy}
                    onChange={(event) => setKeyValue(event.target.value)}
                    placeholder="粘贴 API Key"
                    aria-describedby="guided-key-note"
                  />
                </label>
              ) : null}
              <p className="guided-muted guided-note" id="guided-key-note">
                <LockKeyhole size={14} aria-hidden="true" />
                {isTauri
                  ? '只向 DeepSeek 查询账户状态，不生成内容。密钥验证后存入 Windows 凭据管理器。'
                  : '浏览器预览不接收真实密钥，也不会连接 DeepSeek。'}
              </p>
              {error ? <p className="guided-error" role="alert">{error.message}</p> : null}
              {error?.code === 'guided_balance' ? <BalanceHelp /> : null}
              <div className="guided-actions">
                <button ref={connectButton} className={`btn ${isTauri && !keyValue.trim() ? 'btn-subtle' : 'btn-primary'}`} type="submit" disabled={busy || (isTauri && !keyValue.trim())}>
                  {busy ? <Spinner /> : <ArrowRight size={15} aria-hidden="true" />}
                  {isTauri ? '连接并测试' : '在浏览器模拟连接'}
                </button>
                <button className={`btn ${isTauri && !keyValue.trim() ? 'btn-primary' : 'btn-ghost'}`} type="button" onClick={() => setGuideOpen(true)} disabled={busy}>
                  <KeyRound size={15} aria-hidden="true" />
                  获取 DeepSeek API Key
                </button>
                {connected ? (
                  <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => {
                    setError(null);
                    setKeyValue('');
                    setStep(connectTarget);
                  }}>{connectTarget === 'sources' ? '返回确认资料' : '使用已连接的 DeepSeek'}</button>
                ) : null}
              </div>
            </form>
          ) : step === 'topic' ? (
            <form className="guided-form" onSubmit={(event) => void findSources(event)} aria-busy={busy}>
              <h1 id="guided-wizard-title" ref={title} tabIndex={-1}>你想学什么？</h1>
              <label className="guided-field" htmlFor="guided-topic">
                想学的内容
                <textarea
                  id="guided-topic"
                  className="textarea"
                  rows={3}
                  maxLength={TOPIC_LIMIT}
                  disabled={busy}
                  value={topic}
                  onChange={(event) => {
                    setTopic(event.target.value);
                    writePendingTopic(pendingTopicKey, event.target.value);
                  }}
                  placeholder="例如：我刚开始学 Python，想弄懂循环。"
                />
              </label>
              {balanceAvailable === false ? <BalanceHelp beforeGeneration /> : null}
              {error ? <p className="guided-error" role="alert">{error.message}</p> : null}
              <div className="guided-actions">
                <button className="btn btn-primary" type="submit" disabled={busy || !topic.trim()}>
                  {busy ? <Spinner /> : <Search size={15} aria-hidden="true" />} 查找资料
                </button>
                <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => {
                  setError(null);
                  setConnectTarget('topic');
                  setStep('connect');
                }}>
                  <ArrowLeft size={14} aria-hidden="true" /> 更换连接
                </button>
              </div>
            </form>
          ) : step === 'sources' ? (
            <div className="guided-form">
              <h1 id="guided-wizard-title" ref={title} tabIndex={-1}>确认资料与发送范围</h1>
              <div className="guided-topic-summary"><span>学习主题</span><strong>{topic}</strong></div>
              <fieldset className="guided-sources">
                <legend>选用资料</legend>
                {sources.map((source) => (
                  <div className="guided-source" key={source.id}>
                    <label className="guided-source-select">
                      <input
                        type="checkbox"
                        checked={selected.includes(source.id)}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          setSelected((current) => checked
                            ? [...current, source.id]
                            : current.filter((id) => id !== source.id));
                        }}
                        aria-label={source.title}
                      />
                      <span>
                        <strong>{source.title}</strong>
                        <small>{source.publisher} · {source.license}</small>
                        {source.scope ? <small>{source.scope}</small> : null}
                      </span>
                    </label>
                    <details className="guided-details">
                      <summary>预览资料</summary>
                      <p className="guided-source-url">{source.url}</p>
                      <p className="guided-muted">折页整理的资料笔记，并非原站引文。</p>
                      <pre>{source.text}</pre>
                    </details>
                  </div>
                ))}
              </fieldset>
              <p className="guided-muted guided-note">
                <LockKeyhole size={14} aria-hidden="true" />
                {isTauri
                  ? '仅将上方主题和勾选的资料发送至 api.deepseek.com，可能产生 API 用量。生成后可离线学习。'
                  : '桌面端只发送上方主题和勾选的资料。浏览器演示不出网，不能生成真实课程。'}
              </p>
              {error ? <p className="guided-error" role="alert">{error.message}</p> : null}
              {error?.code === 'guided_balance' ? <BalanceHelp /> : null}
              <div className="guided-actions">
                <button className="btn btn-primary" type="button" disabled={!selected.length} onClick={() => void generate()}>
                  <ArrowRight size={15} aria-hidden="true" /> {retryGeneration ? '同意并重新生成' : '同意并生成首节'}
                </button>
                {error?.code === 'guided_key_rejected' ? (
                  <button className="btn btn-ghost" type="button" onClick={() => {
                    setError(null);
                    setConnectTarget('sources');
                    setStep('connect');
                  }}>
                    <KeyRound size={14} aria-hidden="true" /> 更换连接
                  </button>
                ) : null}
                <button className="btn btn-ghost" type="button" onClick={() => { setError(null); setStep('topic'); }}>
                  <ArrowLeft size={14} aria-hidden="true" /> 返回修改主题
                </button>
              </div>
            </div>
          ) : step === 'generate' ? (
            <div className="guided-form" aria-busy="true">
              <h1 id="guided-wizard-title" ref={title} tabIndex={-1}>正在生成首节</h1>
              <p className="guided-status" role="status"><Spinner /> 正在根据选中的资料准备「{topic}」</p>
            </div>
          ) : (
            <div className="guided-form">
              <h1 id="guided-wizard-title" ref={title} tabIndex={-1}>{resuming ? '继续学习' : '首节已准备好'}</h1>
              <p className="guided-ready-title"><BookOpen size={19} aria-hidden="true" />{run?.lesson.title}</p>
              <p className="guided-muted">{isTauri ? '已保存在本机，可以离线学习。' : '浏览器预览未连接 DeepSeek。'}</p>
              <div className="guided-actions">
                <button className="btn btn-primary" type="button" onClick={() => navigate({ name: 'study' }, { replace: true })}>
                  {resuming ? '继续学习' : '开始学习'} <ArrowRight size={15} aria-hidden="true" />
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
      <DeepSeekGuide
        open={guideOpen}
        mode="guided"
        onClose={() => setGuideOpen(false)}
        onConfigure={() => {
          window.requestAnimationFrame(() => (keyInput.current ?? connectButton.current)?.focus());
        }}
      />
    </main>
  );
}

function BalanceHelp({ beforeGeneration = false }: { beforeGeneration?: boolean }) {
  const [error, setError] = useState('');

  async function openTopup() {
    setError('');
    try {
      await api.openDeepSeekPage('topup');
    } catch (reason) {
      setError(normalizeError(reason).message);
    }
  }

  return (
    <div className="guided-balance">
      {beforeGeneration ? (
        <p className="guided-muted" role="status">已连接。账户暂无可用余额，可先选科目；生成课程时需要 DeepSeek API 额度。</p>
      ) : null}
      <button type="button" className="btn btn-subtle btn-sm" onClick={() => void openTopup()}>
        <ExternalLink size={14} aria-hidden="true" /> 前往 DeepSeek 开放平台充值
      </button>
      {error ? <p className="guided-error" role="alert">{error}</p> : null}
    </div>
  );
}
