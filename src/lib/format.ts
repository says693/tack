export function formatDateCN(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function formatDateTimeCN(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatTimeCN(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatTodayCN(dateKey?: string): string {
  const date = dateKey ? new Date(`${dateKey}T00:00:00`) : new Date();
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(date);
}

export function weekdayCN(dateKey?: string): string {
  const date = dateKey ? new Date(`${dateKey}T00:00:00`) : new Date();
  return new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(date);
}

export function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return '夜深了';
  if (hour < 11) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

export function relativeDue(dueOn: string | null): string {
  if (!dueOn) return '未开始';
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const due = new Date(`${dueOn}T00:00:00`);
  const days = Math.round((due.getTime() - start.getTime()) / 86400000);
  if (days === 0) return '今天到期';
  if (days === 1) return '明天到期';
  if (days === 2) return '后天到期';
  if (days > 0) return `${days} 天后到期`;
  if (days === -1) return '昨天到期';
  return `逾期 ${Math.abs(days)} 天`;
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const diff = Date.now() - date.getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} 天前`;
  return formatDateCN(iso);
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDuration(ms: number | null): string {
  if (!ms || ms < 0) return '—';
  const total = Math.round(ms / 1000);
  const mm = Math.floor(total / 60);
  const ss = String(total % 60).padStart(2, '0');
  return mm > 0 ? `${mm}:${ss}` : `0:${ss}`;
}

export function truncate(text: string, limit: number): string {
  if (!text) return '';
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}…`;
}

export function sourceKindLabel(kind: string): string {
  switch (kind) {
    case 'md':
      return 'Markdown';
    case 'txt':
      return '纯文本';
    case 'external':
      return '外部片段';
    default:
      return kind.toUpperCase();
  }
}

export function trustLabel(tier: number): string {
  switch (tier) {
    case 1:
      return 'T1 · 本人导入';
    case 2:
      return 'T2 · 个人笔记';
    case 0:
      return '示例 / 外部';
    default:
      return `T${tier}`;
  }
}

export function originLabel(origin: string): string {
  switch (origin) {
    case 'source_exact':
      return '原题';
    case 'adapted':
      return '改编';
    case 'generated':
      return '新编';
    default:
      return '待核';
  }
}

export function originDescription(origin: string): string {
  switch (origin) {
    case 'source_exact':
      return '题干能在原文中逐字找到';
    case 'adapted':
      return '改动了原题的条件、数字或问法';
    case 'generated':
      return '根据原文自行编写，答案仍需符合证据';
    default:
      return '历史来源不明，需要核对';
  }
}

export function statusLabel(status: string): string {
  switch (status) {
    case 'draft':
      return '草稿';
    case 'active':
      return '启用';
    case 'paused':
      return '暂停';
    case 'archived':
      return '归档';
    case 'awaiting':
      return '待作答';
    case 'grading':
      return '批改中';
    case 'awaiting_self':
      return '自评';
    case 'ai_failed':
      return 'AI 失败';
    case 'feedback':
      return '待确认';
    case 'insufficient':
      return '证据不足';
    case 'objected':
      return '有异议';
    case 'confirmed':
      return '已确认';
    case 'abandoned':
      return '已放弃';
    default:
      return status;
  }
}

export function intentLabel(intent: string): string {
  switch (intent) {
    case 'learn':
      return '初学';
    case 'review':
      return '复习';
    default:
      return '未指定';
  }
}

export function feedbackVerdictLabel(verdict: string): string {
  switch (verdict) {
    case 'correct':
      return '正确';
    case 'partial':
      return '部分正确';
    case 'wrong':
      return '未答对';
    case 'insufficient_evidence':
      return '证据不足';
    default:
      return verdict;
  }
}

export function gradeLabel(grade: number): string {
  switch (grade) {
    case 0:
      return '没想起';
    case 1:
      return '有提示才想起';
    case 2:
      return '独立想起';
    case 3:
      return '毫不费力';
    default:
      return '—';
  }
}

export function gradeHint(grade: number): string {
  switch (grade) {
    case 0:
      return '没有独立回忆出关键内容';
    case 1:
      return '看过提示或明显吃力后才想起';
    case 2:
      return '没有提示，自己完整想起';
    case 3:
      return '立即、轻松地想起';
    default:
      return '';
  }
}

export function schedulerLabel(state: string): string {
  switch (state) {
    case 'new':
      return '未开始';
    case 'learning':
      return '初学';
    case 'review':
      return '复习中';
    case 'relearning':
      return '重学';
    default:
      return state;
  }
}
