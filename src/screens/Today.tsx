import { useEffect, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  CircleAlert,
  FileText,
  ListChecks,
  Sparkles,
  TrendingUp,
} from 'lucide-react';

import { api } from '@/lib/api';
import { isTauri } from '@/lib/bridge';
import {
  formatTodayCN,
  greeting,
  intentLabel,
  relativeTime,
  sourceKindLabel,
  trustLabel,
  weekdayCN,
} from '@/lib/format';
import { useApp } from '@/store';
import type { BlockedConcept, QueuePreview } from '@/types';

function Seal({ due, served }: { due: number; served: number }) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const total = due + served;
  const fraction = total > 0 ? due / total : 0;
  const dash = circumference * fraction;

  return (
    <div className="seal" title={`今天剩余 ${due} 个到期概念`}>
      <svg className="seal-svg" viewBox="0 0 124 124" aria-hidden>
        <circle className="seal-ticks" cx="62" cy="62" r="48" strokeDasharray="1 7.6" />
        <circle className="seal-track" cx="62" cy="62" r={radius} />
        <circle
          className="seal-fill"
          cx="62"
          cy="62"
          r={radius}
          strokeDasharray={`${dash} ${circumference}`}
        />
      </svg>
      <div className="seal-center">
        <span className={`seal-number${due === 0 ? ' zero' : ''}`}>{String(due).padStart(2, '0')}</span>
        <span className="seal-label">{due === 0 ? 'CLEAR' : 'DUE TODAY'}</span>
      </div>
    </div>
  );
}

export function TodayScreen() {
  const overview = useApp((state) => state.overview);
  const sources = useApp((state) => state.sources);
  const sessions = useApp((state) => state.sessions);
  const model = useApp((state) => state.model);
  const navigate = useApp((state) => state.navigate);
  const refreshOverview = useApp((state) => state.refreshOverview);
  const refreshLibrary = useApp((state) => state.refreshLibrary);
  const [preview, setPreview] = useState<QueuePreview | null>(null);

  useEffect(() => {
    void refreshOverview();
    void refreshLibrary();
    let cancelled = false;
    api
      .queuePreview()
      .then((data) => {
        if (!cancelled) setPreview(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [refreshOverview, refreshLibrary]);

  const due = overview?.dueCount ?? 0;
  const fresh = overview?.newAvailable ?? 0;
  const completed = overview?.completedToday ?? 0;
  const served = overview?.reviewServedToday ?? 0;
  const newServed = overview?.newServedToday ?? 0;
  const newLimit = overview?.newLimit ?? 10;
  const reviewLimit = overview?.reviewLimit ?? 50;
  const reviewRemaining = Math.max(0, reviewLimit - served);
  const newRemaining = Math.max(0, newLimit - newServed);
  const freshToday = Math.min(fresh, newRemaining);
  const totalDayTarget = Math.max(1, completed + Math.min(due, reviewRemaining) + freshToday);
  const week = overview?.last7 ?? [];
  const weekMax = Math.max(1, ...week.map((day) => day.reviews));
  const weekTotal = week.reduce((sum, day) => sum + day.reviews, 0);
  const blocked: BlockedConcept[] = preview?.blocked ?? [];
  const date = overview?.localDate;

  let heroTitle;
  let heroSub;
  let primaryLabel: string;
  let primaryTarget: 'review' | 'library';
  let eyebrow: string;
  if (due > 0 && reviewRemaining > 0) {
    eyebrow = "Today's review";
    heroTitle = (
      <>
        有 <em>{due}</em> 个概念，等你先想起来。
      </>
    );
    heroSub = '合上书作答。批改只提示可核对之处，最终评级由你决定。';
    primaryLabel = '开始复习';
    primaryTarget = 'review';
  } else if (freshToday > 0) {
    eyebrow = 'New leaves';
    heroTitle = (
      <>
        今天可领 <em>{freshToday}</em> 张新卡。
      </>
    );
    heroSub = `新卡每日上限 ${newLimit} 张${fresh > freshToday ? `（书库共 ${fresh} 张待学）` : ''}。收下草稿后，才会真正进入队列。`;
    primaryLabel = '开始今日新卡';
    primaryTarget = 'review';
  } else if (due > 0 || fresh > 0) {
    eyebrow = 'Quota reached';
    heroTitle = <>今天的额度已经用完。</>;
    heroSub = `今日配额已完成；剩余 ${due} 个到期概念保留原到期日，明天继续。`;
    primaryLabel = '浏览书架';
    primaryTarget = 'library';
  } else {
    eyebrow = 'All clear';
    heroTitle = <>今天的页，已经合上。</>;
    heroSub = '没有到期复习，也没有新卡。去读一段新材料，或整理一张卡片。';
    primaryLabel = '去读一段';
    primaryTarget = 'library';
  }

  return (
    <div className="today-screen">
      <div className="scroll today-scroll">
        <div className="today-head">
          <div>
            <div className="date-line">{formatTodayCN(date)}</div>
            <h1 className="greeting-title">
              {greeting()}，
              <br />
              今天读哪一页？
            </h1>
            <p className="greeting-sub">
              {due > 0
                ? '先处理到期复习，再决定要不要加新卡。积压会保留真实到期日。'
                : '从原文开始，而不是从空白卡片开始。每张卡都留着它出生时的那句话。'}
            </p>
          </div>
          <div className="today-head-side">
            <div className="streak">
              <span className="streak-number">{String(overview?.streakDays ?? 0).padStart(2, '0')}</span>
              <span className="streak-label">连续天数</span>
            </div>
          </div>
        </div>

        <section className="review-hero">
          <div>
            <div className="hero-eyebrow">{eyebrow}</div>
            <h2 className="hero-title">{heroTitle}</h2>
            <p className="hero-sub">{heroSub}</p>
            <div className="hero-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() =>
                  primaryTarget === 'review'
                    ? navigate({ name: 'review' }, { mode: 'review' })
                    : navigate({ name: 'library' })
                }
              >
                {primaryTarget === 'review' ? <ListChecks size={14} /> : <BookOpen size={14} />}
                {primaryLabel}
                <ArrowRight size={13} />
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => navigate({ name: 'library' })}>
                浏览书架
              </button>
            </div>
          </div>
          <div className="hero-side">
            <Seal due={due} served={served} />
            <div className="seal-foot">
              已复习 {served} / {reviewLimit}
              <br />
              新卡 {overview?.newServedToday ?? 0} / {newLimit}
            </div>
          </div>
        </section>

        <div className="stat-strip">
          <div className="stat-box">
            <div className="stat-label">到期复习</div>
            <div className="stat-value">
              {due}
              <small> 个概念</small>
            </div>
            <div className="progress-track stat-bar">
              <div
                className="progress-fill"
                style={{ width: `${reviewLimit > 0 ? Math.min(100, (served / reviewLimit) * 100) : 0}%` }}
              />
            </div>
          </div>
          <div className="stat-box">
            <div className="stat-label">今日完成</div>
            <div className="stat-value">
              {completed}
              <small> 次确认</small>
            </div>
            <div className="progress-track stat-bar">
              <div
                className="progress-fill"
                style={{ width: `${Math.min(100, (completed / totalDayTarget) * 100)}%` }}
              />
            </div>
          </div>
          <div className="stat-box">
            <div className="stat-label">今日新卡</div>
            <div className="stat-value">
              {freshToday}
              <small> 张{fresh > freshToday ? ` / ${fresh}` : ''}</small>
            </div>
            <div className="progress-track stat-bar">
              <div
                className="progress-fill"
                style={{ width: `${newLimit > 0 ? Math.min(100, (newServed / newLimit) * 100) : 0}%` }}
              />
            </div>
          </div>
        </div>

        {blocked.length > 0 ? (
          <div className="blocked-strip">
            <CircleAlert size={15} />
            <div className="blocked-copy">
              <strong>{overview?.blockedCount ?? blocked.length} 个概念被暂停。</strong>{' '}
              {blocked[0].name}：{blocked[0].reason}
              {blocked.length > 1 ? `，另有 ${blocked.length - 1} 个。` : ''}
              <button
                type="button"
                className="link"
                style={{ marginLeft: 6 }}
                onClick={() => navigate({ name: 'cards', status: 'paused' })}
              >
                去处理
              </button>
            </div>
          </div>
        ) : null}

        {isTauri && model && !model.configured ? (
          <div className="model-banner" style={{ marginTop: 12 }}>
            <Sparkles size={13} />
            <span>模型尚未配置。你仍可阅读、手写卡片与自评；对话和自动出卡会保持静默，不会伪造结果。</span>
            <button type="button" className="link" onClick={() => navigate({ name: 'settings', section: 'model' })}>
              去配置
            </button>
          </div>
        ) : null}

        <section className="today-section">
          <div className="section-head">
            <div className="eyebrow">
              <TrendingUp size={12} style={{ verticalAlign: -2, marginRight: 6 }} />
              过去七天
            </div>
            <div className="section-head-actions">
              <span className="faint tiny">{weekTotal} 次复习</span>
            </div>
          </div>
          <div className="week-panel">
            <div className="week-head">
              <div>
                <div className="week-total">
                  {weekTotal}
                  <small>次</small>
                </div>
                <div className="faint tiny">只统计已确认的复习，不使用预测值。</div>
              </div>
              <CalendarDays size={15} className="faint" />
            </div>
            <div className="week-bars">
              {week.map((day) => (
                <div key={day.date} className={`week-col${day.date === date ? ' today' : ''}`}>
                  <div className="week-track">
                    <div
                      className="week-fill"
                      style={{ height: `${day.reviews > 0 ? Math.max(8, (day.reviews / weekMax) * 100) : 0}%` }}
                      title={`${day.date} · ${day.reviews} 次`}
                    />
                  </div>
                  <span className="week-day">{weekdayCN(day.date).slice(-1)}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {sessions.length > 0 ? (
          <section className="today-section">
            <div className="section-head">
              <div className="eyebrow">最近的线索</div>
              <button type="button" className="link" style={{ fontSize: 10 }} onClick={() => navigate({ name: 'library' })}>
                全部
              </button>
            </div>
            <div className="recent-list">
              {sessions.slice(0, 4).map((session) => (
                <button
                  key={session.id}
                  type="button"
                  className="recent-row"
                  onClick={() => navigate({ name: 'session', sessionId: session.id })}
                >
                  <span className="recent-spine" />
                  <span className="recent-main">
                    <span className="recent-title">{session.seedName}</span>
                    <span className="recent-meta">
                      <span>{intentLabel(session.intent)}</span>
                      <span>·</span>
                      <span>{session.messageCount} 条消息</span>
                      <span>·</span>
                      <span>{relativeTime(session.updatedAt)}</span>
                    </span>
                  </span>
                  <span className="recent-arrow">↗</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {sources.length > 0 ? (
          <section className="today-section">
            <div className="section-head">
              <div className="eyebrow">正在读</div>
              <button type="button" className="link" style={{ fontSize: 10 }} onClick={() => navigate({ name: 'library' })}>
                书架
              </button>
            </div>
            <div>
              {sources.slice(0, 3).map((source) => (
                <button
                  key={source.id}
                  type="button"
                  className="source-mini-row"
                  onClick={() => navigate({ name: 'reader', sourceId: source.id })}
                >
                  <span className="source-mini-badge">{source.title.slice(0, 1)}</span>
                  <span className="recent-main">
                    <span className="recent-title">{source.title}</span>
                    <span className="recent-meta">
                      <span>{trustLabel(source.trustTier)}</span>
                      <span>·</span>
                      <span>{sourceKindLabel(source.kind)}</span>
                      <span>·</span>
                      <span>{source.chunkCount} 个片段</span>
                    </span>
                  </span>
                  <FileText size={13} className="faint" />
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <div className="today-footnote">
          <span>调度器 FOLD-SM2E-1 · {overview?.timezone ?? 'Asia/Shanghai'}</span>
          <span>不会伪造到期日</span>
        </div>
      </div>
    </div>
  );
}
