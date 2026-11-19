import { ShieldCheck } from 'lucide-react';

import { Modal } from '@/components/Modal';
import { useApp } from '@/store';

export function CloudConsent() {
  const open = useApp((state) => state.cloudOpen);
  const resolve = useApp((state) => state.resolveCloud);
  const model = useApp((state) => state.model);

  return (
    <Modal
      open={open}
      title="这次会把哪些内容发出去？"
      subtitle="折页不会在后台偷偷调用模型。第一次发送前，先让你看清范围。"
      onClose={() => resolve(false)}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={() => resolve(false)}>
            先不用模型
          </button>
          <button type="button" className="btn btn-primary" onClick={() => resolve(true)}>
            <ShieldCheck size={14} />
            我已知晓，继续
          </button>
        </>
      }
    >
      <div className="settings-note">
        目标服务：{model?.provider || '未配置'} · {model?.model || '未选择模型'}
        {model?.baseUrl ? ` · ${model.baseUrl}` : ''}
      </div>
      <div className="privacy-section">
        <div className="eyebrow">会发送到模型服务</div>
        <ul className="privacy-list">
          <li>你当前输入的消息，以及本次线索里必要的相邻对话。</li>
          <li>你选中的那段原文、片段位置，以及来源标题，用于约束回答和引用。</li>
          <li>生成卡片时：本次对话与你选中的原文片段。</li>
          <li>批改时：卡片问题、参考答案、证据摘录、你的首次答案与本次会话意图。</li>
        </ul>
      </div>
      <div className="privacy-section">
        <div className="eyebrow">不会发送</div>
        <ul className="privacy-list">
          <li>整个书架、其他线索、复习历史与到期数据。</li>
          <li>API 密钥不会被写入提示词或日志。它只随请求头发往你配置的 Base URL。</li>
          <li>任何在你没有确认的情况下自动生成的内容。</li>
        </ul>
      </div>
      <p className="field-hint">
        模型返回可能出错。折页只接受能逐字定位到当前原文版本的引用；定位失败会明确标记，而不会把猜测当成证据。
      </p>
    </Modal>
  );
}
