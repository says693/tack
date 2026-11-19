import { useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ExternalLink, Settings2 } from 'lucide-react';

import { Modal } from '@/components/Modal';
import { api } from '@/lib/api';
import { isTauri, normalizeError } from '@/lib/bridge';

const DOCS_URL = 'https://api-docs.deepseek.com/zh-cn/';
const KEYS_URL = 'https://platform.deepseek.com/api_keys';

export function DeepSeekGuide({
  open,
  onClose,
  onConfigure,
  mode = 'settings',
}: {
  open: boolean;
  onClose: () => void;
  onConfigure: () => void;
  mode?: 'settings' | 'guided';
}) {
  const guided = mode === 'guided';
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const nextHeading = useRef<HTMLHeadingElement>(null);

  function close() {
    setStep(0);
    setError('');
    onClose();
  }

  function go(next: number) {
    setStep(next);
    setError('');
    requestAnimationFrame(() => nextHeading.current?.focus());
  }

  const clientImage = guided
    ? { name: 'deepseek-fold-connect.webp', alt: '折页 Windows 首次向导实拍：连接 AI、空的 API Key 输入框与连接并测试按钮', width: 740, height: 410 }
    : { name: 'deepseek-fold-settings.webp', alt: '折页 Windows 客户端实拍：模型分类、DeepSeek 预设、API Key 输入框和保存并测试按钮', width: 1075, height: 690 };

  async function openPage(page: 'docs' | 'keys') {
    setError('');
    try {
      if (isTauri) await api.openDeepSeekPage(page);
      else window.open(page === 'docs' ? DOCS_URL : KEYS_URL, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(normalizeError(err).message);
    }
  }

  return (
    <Modal
      open={open}
      title="获取 DeepSeek API Key"
      subtitle={`第 ${step + 1} 步，共 3 步`}
      onClose={close}
      footer={
        <div className="guide-actions">
          <button type="button" className="btn btn-ghost" autoFocus onClick={() => step ? go(step - 1) : close()}>
            {step ? <><ArrowLeft size={14} /> 上一步</> : guided ? '返回连接' : '暂不配置'}
          </button>
          {step < 2 ? (
            <button type="button" className="btn btn-primary" onClick={() => go(step + 1)}>
              下一步 <ArrowRight size={14} />
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => { close(); onConfigure(); }}>
              <Settings2 size={14} /> {guided ? '返回连接 AI' : isTauri ? '前往模型设置' : '查看设置预览'}
            </button>
          )}
        </div>
      }
    >
      <div className="guide-step">
        <h3 tabIndex={-1} ref={nextHeading}>
          {['打开 DeepSeek 官方入口', '登录并创建密钥', '在折页配置并测试'][step]}
        </h3>
        {step === 0 ? (
          <>
            <p>在浏览器打开 DeepSeek 开放平台。用自己的账号登录；没有账号，按网页提示注册。开放平台和 DeepSeek 聊天网页不是同一个入口。</p>
            <button type="button" className="btn btn-subtle" onClick={() => void openPage('keys')}>
              <ExternalLink size={14} /> 打开官方 API Keys 页面
            </button>
            <figure>
              <img src="/guides/deepseek-official.webp" alt="DeepSeek 中文官方文档实拍：首次调用 API 表格中的 API Key 申请入口" width="912" height="482" />
              <figcaption>DeepSeek 中文官方文档中的同一入口</figcaption>
            </figure>
            <button type="button" className="btn btn-ghost" onClick={() => void openPage('docs')}>
              <ExternalLink size={14} /> 打开官方文档
            </button>
          </>
        ) : step === 1 ? (
          <>
            <p>登录后回到 API Keys 页面，创建一个新的 API Key。名称可填写「折页」。页面显示密钥后，立即复制完整内容，只粘贴到折页的密钥框。</p>
            <p className="field-hint">登录后没看到密钥页面，重新点下方按钮。找不到刚创建的密钥，可撤销它再创建一个。不要截图或分享密钥。</p>
            <button type="button" className="btn btn-subtle" onClick={() => void openPage('keys')}>
              <ExternalLink size={14} /> 打开官方 API Keys 页面
            </button>
          </>
        ) : (
          <>
            <p>{guided
              ? '回到折页的「连接 AI」，粘贴刚复制的密钥，再点「连接并测试」。'
              : '在折页的「模型连接」选择 DeepSeek，粘贴 Key，再点「保存并测试」。测试会联网，但不发送学习材料。'}</p>
            <figure>
              <img src={`/guides/${clientImage.name}`} alt={clientImage.alt} width={clientImage.width} height={clientImage.height} />
              <figcaption>折页 Windows 客户端实拍 · 未填入任何密钥</figcaption>
            </figure>
            <p className="field-hint">{isTauri
              ? guided
                ? '测试只查账户状态。成功后，密钥存入 Windows 凭据管理器，不写进学习数据库。'
                : '旧版设置把密钥明文保存在本机数据库；请勿在共享电脑中保存，或分享数据库备份。'
              : '浏览器预览不会保存真实密钥或测试连接。请在桌面客户端配置。'}</p>
          </>
        )}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </div>
    </Modal>
  );
}
