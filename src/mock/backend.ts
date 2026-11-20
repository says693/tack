/**
 * Browser-only mock backend.
 *
 * This file is used when the UI runs in a normal browser (`npm run dev`).
 * It never ships inside the Tauri application. Its model responses are
 * explicitly labelled "演示模型" and its data lives in localStorage only.
 */
import type {
  AttemptView,
  Bootstrap,
  CardDetail,
  CardRevision,
  CardSummary,
  ChatStartResult,
  ChunkView,
  ConceptView,
  DayCount,
  EvidenceRef,
  Feedback,
  MessageView,
  ModelStatus,
  Overview,
  QueueStats,
  ReviewResult,
  SessionDetail,
  SessionSummary,
  SourceAnnotation,
  SourceDetail,
  SourceRevision,
  SourceSummary,
  StudySettings,
  Task,
  TaskOutcome,
} from '@/types';

type AnyRecord = Record<string, unknown>;

interface MockSource {
  id: string;
  title: string;
  kind: string;
  origin: string;
  trustTier: number;
  note: string | null;
  createdAt: string;
  lastReadAt: string | null;
  archivedAt: string | null;
}

interface MockRevision {
  id: string;
  sourceId: string;
  revisionNo: number;
  content: string;
  contentHash: string;
  label: string | null;
  createdAt: string;
}

interface MockChunk {
  id: string;
  sourceId: string;
  revisionId: string;
  ordinal: number;
  heading: string | null;
  locator: string | null;
  quoteExact: string;
  prefix: string;
  suffix: string;
  startUtf16: number;
  endUtf16: number;
  createdAt: string;
}

interface MockConcept {
  id: string;
  sourceId: string | null;
  chunkId: string | null;
  name: string;
  origin: string;
  state: string;
  ease: number;
  intervalDays: number;
  reps: number;
  lapses: number;
  dueOn: string | null;
  lastReviewedAt: string | null;
  scheduler: string;
  createdAt: string;
  archivedAt: string | null;
}

interface MockCard {
  id: string;
  conceptId: string;
  sessionId: string | null;
  kind: string;
  status: string;
  mode: 'ai' | 'self';
  currentRevisionId: string;
  pausedReason: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

interface MockCardRevision extends CardRevision {
  cardId: string;
}

interface MockSession {
  id: string;
  parentId: string | null;
  forkMessageId: string | null;
  forkChunkId: string | null;
  forkExact: string | null;
  seedName: string;
  conceptId: string | null;
  kind: string;
  intent: 'learn' | 'review' | 'unspecified';
  depth: number;
  parentAnchor: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MockMessage extends MessageView {}

interface MockAttempt {
  id: string;
  assignmentId: string | null;
  conceptId: string;
  cardId: string;
  revisionId: string;
  firstAnswer: string;
  hintUsed: boolean;
  hintText: string | null;
  practiceAnswers: { answer: string; hintUsed: boolean; at: string }[];
  feedback: Feedback | null;
  verdict: string | null;
  suggestedGrade: number | null;
  feedbackMode: 'ai' | 'self' | null;
  aiError: string | null;
  status: string;
  isDemo: boolean;
  localDate: string;
  startedAt: string;
  answeredAt: string | null;
  feedbackAt: string | null;
  confirmedAt: string | null;
  latencyMs: number | null;
}

interface MockAssignment {
  id: string;
  localDate: string;
  timezone: string;
  conceptId: string;
  kind: 'new' | 'review';
  cardId: string;
  cardRevisionId: string;
  attemptId: string | null;
  completedAt: string | null;
  createdAt: string;
}

interface MockReview {
  id: string;
  attemptId: string;
  conceptId: string;
  grade: number;
  mode: string;
  scheduler: string;
  stateBefore: string;
  stateAfter: string;
  intervalDays: number;
  dueOn: string;
  latencyMs: number | null;
  idempotencyKey: string;
  localDate: string;
  reviewedAt: string;
}

interface MockState {
  version: number;
  onboarded: boolean;
  settings: Record<string, string>;
  sources: MockSource[];
  revisions: MockRevision[];
  chunks: MockChunk[];
  concepts: MockConcept[];
  cards: MockCard[];
  cardRevisions: MockCardRevision[];
  sessions: MockSession[];
  messages: MockMessage[];
  attempts: MockAttempt[];
  assignments: MockAssignment[];
  reviews: MockReview[];
  idempotency: Record<string, { hash: string; response: string }>;
}

const VERSION = 3;
const STORAGE_KEY = 'fold:mock:v3';

let state: MockState;
const listeners = new Map<string, Set<(event: { payload: unknown }) => void>>();

function nowIso(): string {
  return new Date().toISOString();
}

function dateKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(base: Date, days: number): Date {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next;
}

function isoDay(offset: number): string {
  return dateKey(addDays(new Date(), offset));
}

function id(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 18)
      : Math.random().toString(36).slice(2, 20);
  return `${prefix}_${random}`;
}

function fail(code: string, message: string): never {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  throw error;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function emit(event: string, payload: unknown) {
  const set = listeners.get(event);
  if (!set) return;
  for (const handler of set) handler({ payload });
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // The browser preview still works when storage is unavailable.
  }
}

function hash(text: string): string {
  let value = 0;
  for (let i = 0; i < text.length; i += 1) {
    value = (value * 31 + text.charCodeAt(i)) | 0;
  }
  return String(value >>> 0);
}

function setting(key: string, fallback: string): string {
  return state.settings[key] ?? fallback;
}

function setSetting(key: string, value: string) {
  state.settings[key] = value;
}

function splitParagraphs(content: string): { text: string; start: number; end: number; heading: string | null }[] {
  const out: { text: string; start: number; end: number; heading: string | null }[] = [];
  let heading: string | null = null;
  const parts = content.split('\n\n');
  let cursor = 0;
  for (const part of parts) {
    const found = content.indexOf(part, cursor);
    cursor = found >= 0 ? found + part.length : cursor;
    const trimmed = part.trim();
    if (!trimmed) continue;
    const headingMatch = /^#{1,6}\s+(.+)$/m.exec(trimmed);
    if (headingMatch && trimmed.startsWith('#')) {
      heading = headingMatch[1].trim();
      const after = trimmed.slice(trimmed.indexOf('\n') + 1).trim();
      if (after) {
        const lead = part.indexOf(after);
        const start = found + Math.max(0, lead);
        out.push({ text: after, start, end: start + after.length, heading });
      }
      continue;
    }
    const lead = part.indexOf(trimmed);
    const start = found + Math.max(0, lead);
    out.push({ text: trimmed, start, end: start + trimmed.length, heading });
  }
  return out;
}

function makeChunks(sourceId: string, revisionId: string, content: string): MockChunk[] {
  return splitParagraphs(content).map((part, index) => {
    const prefix = content.slice(Math.max(0, part.start - 48), part.start);
    const suffix = content.slice(part.end, Math.min(content.length, part.end + 48));
    return {
      id: id('chk'),
      sourceId,
      revisionId,
      ordinal: index,
      heading: part.heading,
      locator: part.heading ? `§${part.heading} · 第 ${index + 1} 段` : `第 ${index + 1} 段`,
      quoteExact: part.text,
      prefix,
      suffix,
      startUtf16: part.start,
      endUtf16: part.end,
      createdAt: nowIso(),
    };
  });
}

function sourceSummary(source: MockSource): SourceSummary {
  const revisions = state.revisions.filter((r) => r.sourceId === source.id);
  const latest = revisions.reduce((max, r) => Math.max(max, r.revisionNo), 0);
  return {
    id: source.id,
    title: source.title,
    kind: source.kind,
    origin: source.origin,
    trustTier: source.trustTier,
    revisionCount: revisions.length,
    currentRevisionNo: latest,
    chunkCount: state.chunks.filter((c) => c.sourceId === source.id).length,
    createdAt: source.createdAt,
    lastReadAt: source.lastReadAt,
    archived: Boolean(source.archivedAt),
    note: source.note,
  };
}

function revisionView(revision: MockRevision): SourceRevision {
  return {
    id: revision.id,
    sourceId: revision.sourceId,
    revisionNo: revision.revisionNo,
    content: revision.content,
    contentHash: revision.contentHash,
    label: revision.label,
    createdAt: revision.createdAt,
  };
}

function chunkView(chunk: MockChunk): ChunkView {
  return {
    id: chunk.id,
    sourceId: chunk.sourceId,
    revisionId: chunk.revisionId,
    ordinal: chunk.ordinal,
    heading: chunk.heading,
    locator: chunk.locator,
    quoteExact: chunk.quoteExact,
    prefix: chunk.prefix,
    suffix: chunk.suffix,
    startUtf16: chunk.startUtf16,
    endUtf16: chunk.endUtf16,
    sessionCount: state.sessions.filter((s) => s.forkChunkId === chunk.id && !s.archivedAt).length,
    cardCount: state.cardRevisions.filter((r) => r.evidenceChunkId === chunk.id && !isCardArchived(r.cardId)).length,
    createdAt: chunk.createdAt,
  };
}

function isCardArchived(cardId: string): boolean {
  return Boolean(state.cards.find((c) => c.id === cardId)?.archivedAt);
}

function conceptView(concept: MockConcept): ConceptView {
  return {
    id: concept.id,
    name: concept.name,
    sourceId: concept.sourceId,
    chunkId: concept.chunkId,
    origin: concept.origin,
    state: concept.state,
    ease: concept.ease,
    intervalDays: concept.intervalDays,
    reps: concept.reps,
    lapses: concept.lapses,
    dueOn: concept.dueOn,
    lastReviewedAt: concept.lastReviewedAt,
    scheduler: concept.scheduler,
    createdAt: concept.createdAt,
    archived: Boolean(concept.archivedAt),
  };
}

function revisionForCard(card: MockCard): MockCardRevision | undefined {
  return state.cardRevisions.find((r) => r.id === card.currentRevisionId);
}

function sourceForRevision(revisionId: string | null): MockSource | undefined {
  if (!revisionId) return undefined;
  const revision = state.revisions.find((r) => r.id === revisionId);
  return revision ? state.sources.find((s) => s.id === revision.sourceId) : undefined;
}

function cardSummary(card: MockCard): CardSummary {
  const concept = state.concepts.find((c) => c.id === card.conceptId);
  const revision = revisionForCard(card);
  const chunk = revision?.evidenceChunkId
    ? state.chunks.find((c) => c.id === revision.evidenceChunkId)
    : undefined;
  const source = sourceForRevision(chunk?.revisionId ?? null);
  return {
    id: card.id,
    conceptId: card.conceptId,
    conceptName: concept?.name ?? '未命名概念',
    kind: card.kind,
    status: card.status as CardSummary['status'],
    mode: card.mode,
    question: revision?.question ?? '（内容不可用）',
    answerPreview: (revision?.answer ?? '').slice(0, 140),
    exerciseOrigin: (revision?.exerciseOrigin ?? 'unspecified') as CardSummary['exerciseOrigin'],
    evidenceExcerpt: revision?.evidenceExcerpt ?? '',
    sourceId: source?.id ?? null,
    sourceTitle: source?.title ?? null,
    revisionId: revision?.id ?? null,
    updatedAt: card.updatedAt,
    dueOn: concept?.dueOn ?? null,
    pausedReason: card.pausedReason,
    reps: concept?.reps ?? 0,
    lapses: concept?.lapses ?? 0,
  };
}

function cardDetail(cardId: string): CardDetail {
  const card = state.cards.find((c) => c.id === cardId) ?? fail('card_not_found', '卡片不存在。');
  const concept = state.concepts.find((c) => c.id === card.conceptId) ?? fail('concept_not_found', '概念不存在。');
  const revisions = state.cardRevisions
    .filter((r) => r.cardId === cardId)
    .sort((a, b) => b.revisionNo - a.revisionNo);
  const current = revisions.find((r) => r.id === card.currentRevisionId);
  const chunk = current?.evidenceChunkId
    ? state.chunks.find((c) => c.id === current.evidenceChunkId)
    : undefined;
  return {
    summary: cardSummary(card),
    concept: conceptView(concept),
    revisions,
    evidence: chunk ? chunkView(chunk) : null,
  };
}

function messageView(message: MockMessage): MessageView {
  return { ...message };
}

function sessionSummary(session: MockSession): SessionSummary {
  const messages = state.messages.filter((m) => m.sessionId === session.id);
  const last = messages[messages.length - 1];
  return {
    id: session.id,
    parentId: session.parentId,
    seedName: session.seedName,
    kind: session.kind,
    intent: session.intent,
    depth: session.depth,
    forkChunkId: session.forkChunkId,
    forkMessageId: session.forkMessageId,
    forkExact: session.forkExact,
    parentAnchor: session.parentAnchor,
    conceptId: session.conceptId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    archived: Boolean(session.archivedAt),
    messageCount: messages.length,
    lastMessage: last?.content ?? null,
    forkCount: state.sessions.filter((s) => s.parentId === session.id).length,
  };
}

function sessionDetail(sessionId: string): SessionDetail {
  const session = state.sessions.find((s) => s.id === sessionId) ?? fail('session_not_found', '会话不存在。');
  const messages = state.messages
    .filter((m) => m.sessionId === sessionId)
    .sort((a, b) => a.ordinal - b.ordinal)
    .map(messageView);
  const parent = session.parentId
    ? state.sessions.find((s) => s.id === session.parentId)
    : undefined;
  const chunk = session.forkChunkId
    ? state.chunks.find((c) => c.id === session.forkChunkId)
    : undefined;
  const source = chunk ? state.sources.find((s) => s.id === chunk.sourceId) : undefined;
  return {
    session: sessionSummary(session),
    messages,
    parent: parent ? sessionSummary(parent) : null,
    chunk: chunk ? chunkView(chunk) : null,
    source: source ? sourceSummary(source) : null,
    drafts: state.cards
      .filter((c) => c.sessionId === sessionId && !c.archivedAt)
      .map(cardSummary),
  };
}

function conceptFor(card: MockCard): MockConcept {
  return state.concepts.find((c) => c.id === card.conceptId) ?? fail('concept_not_found', '概念不存在。');
}

function attemptView(attempt: MockAttempt): AttemptView {
  const card = state.cards.find((c) => c.id === attempt.cardId) ?? fail('card_not_found', '卡片不存在。');
  const revision =
    state.cardRevisions.find((r) => r.id === attempt.revisionId) ??
    fail('revision_not_found', '卡片修订不存在。');
  const concept = state.concepts.find((c) => c.id === attempt.conceptId) ?? fail('concept_not_found', '概念不存在。');
  const answered = Boolean(attempt.firstAnswer.trim() || attempt.answeredAt);
  const summary = cardSummary(card);
  return {
    id: attempt.id,
    conceptId: attempt.conceptId,
    cardId: attempt.cardId,
    revisionId: attempt.revisionId,
    firstAnswer: attempt.firstAnswer,
    hintUsed: attempt.hintUsed,
    hintText: attempt.hintText,
    practiceAnswers: attempt.practiceAnswers,
    feedback: attempt.feedback,
    verdict: attempt.verdict,
    suggestedGrade: attempt.suggestedGrade,
    feedbackMode: attempt.feedbackMode,
    aiError: attempt.aiError,
    status: attempt.status,
    isDemo: attempt.isDemo,
    startedAt: attempt.startedAt,
    answeredAt: attempt.answeredAt,
    latencyMs: attempt.latencyMs,
    card: answered ? summary : { ...summary, answerPreview: '' },
    revision: answered ? revision : { ...revision, answer: '' },
    concept: conceptView(concept),
  };
}

function activeCardFor(conceptId: string): MockCard | undefined {
  return state.cards
    .filter((c) => c.conceptId === conceptId && c.status === 'active' && !c.archivedAt)
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))[0];
}

function hasAbandonedToday(conceptId: string, today: string): boolean {
  return state.attempts.some(
    (a) => a.conceptId === conceptId && a.localDate === today && a.status === 'abandoned',
  );
}

function isRelearningOrReview(concept: MockConcept): boolean {
  return concept.reps > 0 || concept.lapses > 0 || concept.state !== 'new';
}

function dueConcepts(today: string): MockConcept[] {
  return state.concepts
    .filter(
      (c) =>
        !c.archivedAt &&
        isRelearningOrReview(c) &&
        c.dueOn !== null &&
        c.dueOn <= today &&
        Boolean(activeCardFor(c.id)),
    )
    .sort((a, b) => {
      const ab = Number(hasAbandonedToday(a.id, today)) - Number(hasAbandonedToday(b.id, today));
      return ab !== 0 ? ab : (a.dueOn ?? '').localeCompare(b.dueOn ?? '');
    });
}

function newConcepts(today: string): MockConcept[] {
  return state.concepts
    .filter(
      (c) =>
        !c.archivedAt &&
        !isRelearningOrReview(c) &&
        Boolean(activeCardFor(c.id)) &&
        !state.assignments.some((a) => a.conceptId === c.id && a.localDate === today),
    )
    .sort((a, b) => {
      const ab = Number(hasAbandonedToday(a.id, today)) - Number(hasAbandonedToday(b.id, today));
      return ab !== 0 ? ab : a.createdAt.localeCompare(b.createdAt);
    });
}

function blockedConcepts(today: string) {
  return state.concepts
    .filter(
      (c) =>
        !c.archivedAt &&
        ((!isRelearningOrReview(c)) || (isRelearningOrReview(c) && c.dueOn !== null && c.dueOn <= today)) &&
        !activeCardFor(c.id),
    )
    .slice(0, 12)
    .map((c) => ({
      conceptId: c.id,
      name: c.name,
      reason: !isRelearningOrReview(c) ? '待补充卡片' : '卡片已暂停或来源缺失',
      dueOn: c.dueOn,
    }));
}

function queueStats(): QueueStats {
  const today = dateKey();
  const reviewLimit = Number(setting('study.daily_review', '50'));
  const newLimit = Number(setting('study.daily_new', '10'));
  const due = dueConcepts(today);
  const newAvailable = newConcepts(today);
  const assignments = state.assignments.filter((a) => a.localDate === today);
  const reviewServed = assignments.filter((a) => a.kind === 'review').length;
  const newServed = assignments.filter((a) => a.kind === 'new').length;
  const completed = state.reviews.filter((r) => r.localDate === today).length;
  const blocked = blockedConcepts(today);
  const reviewRemaining = Math.max(0, reviewLimit - reviewServed);
  const openReviewAssignments = assignments.filter((a) => a.kind === 'review' && !a.completedAt).length;
  return {
    dueCount: due.length,
    newAvailable: newAvailable.length,
    reviewServedToday: reviewServed,
    newServedToday: newServed,
    reviewLimit,
    newLimit,
    reviewRemaining,
    newRemaining: Math.max(0, newLimit - newServed),
    completedToday: completed,
    backlog: Math.max(0, due.length - openReviewAssignments - reviewRemaining),
    blockedCount: blocked.length,
  };
}

function overview(): Overview {
  const today = dateKey();
  const stats = queueStats();
  const reviewDates = new Set(state.reviews.map((r) => r.localDate));
  let cursor = reviewDates.has(today) ? new Date() : addDays(new Date(), -1);
  let streak = 0;
  while (reviewDates.has(dateKey(cursor))) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  const last7 = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(new Date(), index - 6);
    const key = dateKey(date);
    return {
      date: key,
      label: ['日', '一', '二', '三', '四', '五', '六'][date.getDay()],
      reviews: state.reviews.filter((r) => r.localDate === key).length,
    };
  });
  return {
    localDate: today,
    timezone: setting('study.timezone', 'Asia/Shanghai'),
    dueCount: stats.dueCount,
    newAvailable: stats.newAvailable,
    completedToday: stats.completedToday,
    reviewServedToday: stats.reviewServedToday,
    newServedToday: stats.newServedToday,
    reviewLimit: stats.reviewLimit,
    newLimit: stats.newLimit,
    backlog: stats.backlog,
    blockedCount: stats.blockedCount,
    drafts: state.cards.filter((c) => c.status === 'draft' && !c.archivedAt).length,
    activeCards: state.cards.filter((c) => c.status === 'active' && !c.archivedAt).length,
    totalConcepts: state.concepts.filter((c) => !c.archivedAt).length,
    streakDays: streak,
    last7,
  };
}

function modelStatus(): ModelStatus {
  const apiKey = setting('model.api_key', '');
  return {
    configured: Boolean(setting('model.base_url', '') && setting('model.model', '') && (apiKey || setting('model.provider', '') === 'ollama')),
    provider: setting('model.provider', 'deepseek'),
    model: setting('model.model', 'deepseek-chat'),
    baseUrl: setting('model.base_url', 'https://api.deepseek.com/v1'),
    hasApiKey: Boolean(apiKey),
    lastTestAt: state.settings['model.last_test_at'] || null,
    lastTestOk: state.settings['model.last_test_ok'] ? state.settings['model.last_test_ok'] === '1' : null,
    lastTestMessage: state.settings['model.last_test_message'] || null,
  };
}

function studySettings(): StudySettings {
  return {
    dailyNew: Number(setting('study.daily_new', '10')),
    dailyReview: Number(setting('study.daily_review', '50')),
    timezone: setting('study.timezone', 'Asia/Shanghai'),
    theme: (setting('ui.theme', 'ink') as StudySettings['theme']) ?? 'ink',
    capsuleMetric: (setting('ui.capsule_metric', 'due') as StudySettings['capsuleMetric']) ?? 'due',
    cloudNoticeSeen: setting('privacy.cloud_notice_seen', '0') === '1',
  };
}

function bootstrap(): Bootstrap {
  return {
    appVersion: '0.1.0-demo',
    platform: 'browser',
    dataDir: '浏览器 localStorage · 仅预览',
    isFirstRun: !state.onboarded,
    model: modelStatus(),
    settings: studySettings(),
    overview: overview(),
    sources: state.sources.filter((s) => !s.archivedAt).map(sourceSummary),
    sessions: state.sessions
      .filter((s) => !s.archivedAt)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 40)
      .map(sessionSummary),
    sampleLoaded: state.sources.some((s) => s.origin === 'sample'),
  };
}

function taskForAssignment(assignment: MockAssignment): Task {
  const attempt = state.attempts.find((a) => a.id === assignment.attemptId) ?? fail('attempt_not_found', '作答记录不存在。');
  return {
    assignmentId: assignment.id,
    kind: assignment.kind,
    dueOn: attemptView(attempt).concept.dueOn,
    attempt: attemptView(attempt),
    stats: queueStats(),
  };
}

function nextTask(): TaskOutcome {
  const today = dateKey();
  const open = state.assignments.find((a) => {
    if (a.localDate !== today || a.completedAt) return false;
    const attempt = state.attempts.find((x) => x.id === a.attemptId);
    return !attempt || !['abandoned', 'confirmed'].includes(attempt.status);
  });
  if (open) {
    return { task: taskForAssignment(open), blocked: blockedConcepts(today), stats: queueStats(), message: null };
  }
  const stats = queueStats();
  const due = dueConcepts(today);
  const fresh = newConcepts(today);
  const kind: 'review' | 'new' | null =
    due.length > 0 && stats.reviewRemaining > 0
      ? 'review'
      : fresh.length > 0 && stats.newRemaining > 0
        ? 'new'
        : null;
  if (!kind) {
    return {
      task: null,
      blocked: blockedConcepts(today),
      stats,
      message:
        stats.dueCount === 0 && stats.newAvailable === 0
          ? '今天没有到期任务。去读一段新材料，或补充一张卡片。'
          : stats.reviewRemaining === 0 && stats.newRemaining === 0
            ? '今天的预算已用完。积压仍保留真实到期日，明天继续。'
            : '没有可领取的任务。',
    };
  }
  const concept = kind === 'review' ? due[0] : fresh[0];
  const card = activeCardFor(concept.id) ?? fail('card_missing', '这个概念没有可用的启用卡片。');
  const revision = revisionForCard(card);
  if (!revision) fail('revision_missing', '卡片没有修订内容。');
  const assignment: MockAssignment = {
    id: id('asg'),
    localDate: today,
    timezone: setting('study.timezone', 'Asia/Shanghai'),
    conceptId: concept.id,
    kind,
    cardId: card.id,
    cardRevisionId: revision.id,
    attemptId: null,
    completedAt: null,
    createdAt: nowIso(),
  };
  const attempt: MockAttempt = {
    id: id('att'),
    assignmentId: assignment.id,
    conceptId: concept.id,
    cardId: card.id,
    revisionId: revision.id,
    firstAnswer: '',
    hintUsed: false,
    hintText: null,
    practiceAnswers: [],
    feedback: null,
    verdict: null,
    suggestedGrade: null,
    feedbackMode: null,
    aiError: null,
    status: 'awaiting',
    isDemo: false,
    localDate: today,
    startedAt: nowIso(),
    answeredAt: null,
    feedbackAt: null,
    confirmedAt: null,
    latencyMs: null,
  };
  assignment.attemptId = attempt.id;
  state.assignments.push(assignment);
  state.attempts.push(attempt);
  save();
  return { task: taskForAssignment(assignment), blocked: blockedConcepts(today), stats: queueStats(), message: null };
}

function resolveQuote(content: string, exact: string, front: string, back: string, hint: number): [number, number] | null {
  let best: { score: number; start: number } | null = null;
  let index = content.indexOf(exact);
  while (index >= 0) {
    let score = 0;
    if (front && content.slice(Math.max(0, index - front.length), index) === front) score += 60;
    if (back && content.slice(index + exact.length, index + exact.length + back.length) === back) score += 60;
    score += Math.max(0, 80 - Math.abs(index - hint));
    if (!best || score > best.score) best = { score, start: index };
    index = content.indexOf(exact, index + 1);
  }
  return best ? [best.start, best.start + exact.length] : null;
}

function createChunkFromSelection(args: AnyRecord): ChunkView {
  const sourceId = String(args.sourceId);
  const revisionId = String(args.revisionId);
  const revision = state.revisions.find((r) => r.id === revisionId && r.sourceId === sourceId) ?? fail('revision_not_found', '来源版本不存在。');
  const exact = String(args.quoteExact ?? '');
  if (!exact.trim()) fail('empty_selection', '选区为空。');
  const resolved = resolveQuote(
    revision.content,
    exact,
    String(args.prefix ?? ''),
    String(args.suffix ?? ''),
    Number(args.startUtf16 ?? 0),
  );
  if (!resolved) fail('quote_not_found', '这段原文在当前版本中无法定位。请重新选择，或切换到保存时的来源版本。');
  const existing = state.chunks.find((c) => c.revisionId === revisionId && c.startUtf16 === resolved[0] && c.endUtf16 === resolved[1]);
  if (existing) return chunkView(existing);
  const chunk: MockChunk = {
    id: id('chk'),
    sourceId,
    revisionId,
    ordinal: state.chunks.filter((c) => c.revisionId === revisionId).length,
    heading: (args.heading as string | null) ?? null,
    locator: (args.locator as string | null) ?? '自定义选区',
    quoteExact: exact,
    prefix: String(args.prefix ?? revision.content.slice(Math.max(0, resolved[0] - 48), resolved[0])),
    suffix: String(args.suffix ?? revision.content.slice(resolved[1], Math.min(revision.content.length, resolved[1] + 48))),
    startUtf16: resolved[0],
    endUtf16: resolved[1],
    createdAt: nowIso(),
  };
  state.chunks.push(chunk);
  save();
  return chunkView(chunk);
}

function importSource(args: AnyRecord): SourceDetail {
  const text = String(args.text ?? '');
  const title = String(args.title ?? '').trim();
  if (!title) fail('title_required', '请给材料一个标题。');
  if (!text.trim()) fail('text_required', '材料内容不能为空。');
  const kind = String(args.kind ?? 'txt');
  const origin = String(args.origin ?? 'import');
  const replaceSourceId = args.replaceSourceId ? String(args.replaceSourceId) : null;
  const now = nowIso();
  let source = replaceSourceId ? state.sources.find((s) => s.id === replaceSourceId) : undefined;
  if (replaceSourceId && !source) fail('source_not_found', '来源不存在。');
  if (!source) {
    source = {
      id: id('src'),
      title,
      kind,
      origin,
      trustTier: origin === 'sample' || origin === 'external' ? 0 : 1,
      note: (args.note as string | null) ?? null,
      createdAt: now,
      lastReadAt: null,
      archivedAt: null,
    };
    state.sources.push(source);
  } else {
    source.title = title;
    if (args.note) source.note = String(args.note);
  }
  const revisionNo = state.revisions.filter((r) => r.sourceId === source!.id).length + 1;
  const revision: MockRevision = {
    id: id('rev'),
    sourceId: source.id,
    revisionNo,
    content: text,
    contentHash: hash(text),
    label: (args.label as string | null) ?? `版本 ${revisionNo}`,
    createdAt: now,
  };
  const existing = state.revisions.find((r) => r.sourceId === source!.id && r.contentHash === revision.contentHash);
  if (existing) {
    return sourceDetail(source.id, existing.id);
  }
  state.revisions.push(revision);
  state.chunks.push(...makeChunks(source.id, revision.id, text));
  save();
  return sourceDetail(source.id, revision.id);
}

function sourceDetail(sourceId: string, revisionId?: string | null): SourceDetail {
  const source = state.sources.find((s) => s.id === sourceId) ?? fail('source_not_found', '来源不存在。');
  const revisions = state.revisions.filter((r) => r.sourceId === sourceId).sort((a, b) => b.revisionNo - a.revisionNo);
  const revision = revisionId
    ? revisions.find((r) => r.id === revisionId)
    : revisions[0];
  if (!revision) fail('revision_not_found', '来源版本不存在。');
  source.lastReadAt = nowIso();
  save();
  return {
    source: sourceSummary(source),
    revision: revisionView(revision),
    revisions: revisions.map((r) => ({
      id: r.id,
      revisionNo: r.revisionNo,
      label: r.label,
      createdAt: r.createdAt,
      contentHash: r.contentHash,
      charCount: r.content.length,
    })),
    chunks: state.chunks
      .filter((c) => c.revisionId === revision.id)
      .sort((a, b) => a.ordinal - b.ordinal)
      .map(chunkView),
  };
}

function annotations(sourceId: string, revisionId: string): SourceAnnotation[] {
  return state.chunks
    .filter((c) => c.sourceId === sourceId && c.revisionId === revisionId)
    .flatMap((chunk) => {
      const sessions = state.sessions.filter((s) => s.forkChunkId === chunk.id && !s.archivedAt);
      const cards = state.cardRevisions
        .filter((r) => r.evidenceChunkId === chunk.id && !isCardArchived(r.cardId))
        .map((r) => state.cards.find((c) => c.id === r.cardId))
        .filter((c): c is MockCard => Boolean(c));
      const rows: SourceAnnotation[] = [];
      for (const session of sessions) {
        rows.push({
          chunkId: chunk.id,
          quoteExact: chunk.quoteExact,
          heading: chunk.heading,
          locator: chunk.locator,
          startUtf16: chunk.startUtf16,
          endUtf16: chunk.endUtf16,
          sessionId: session.id,
          sessionName: session.seedName,
          cardId: null,
          cardQuestion: null,
          kind: 'session',
        });
      }
      for (const card of cards) {
        const rev = revisionForCard(card);
        rows.push({
          chunkId: chunk.id,
          quoteExact: chunk.quoteExact,
          heading: chunk.heading,
          locator: chunk.locator,
          startUtf16: chunk.startUtf16,
          endUtf16: chunk.endUtf16,
          sessionId: null,
          sessionName: null,
          cardId: card.id,
          cardQuestion: rev?.question ?? null,
          kind: 'card',
        });
      }
      return rows;
    });
}

function buildCardSummary(cardId: string): CardSummary {
  return cardSummary(state.cards.find((c) => c.id === cardId) ?? fail('card_not_found', '卡片不存在。'));
}

function createCardDraft(args: AnyRecord): CardDetail {
  const conceptName = String(args.conceptName ?? '').trim();
  const question = String(args.question ?? '').trim();
  const answer = String(args.answer ?? '').trim();
  if (!conceptName) fail('concept_required', '请给这张卡一个概念名。');
  if (!question || !answer) fail('card_incomplete', '问题与答案都不能为空。');
  const mode = args.mode === 'self' ? 'self' : 'ai';
  const chunkId = args.evidenceChunkId ? String(args.evidenceChunkId) : null;
  const chunk = chunkId ? state.chunks.find((c) => c.id === chunkId) : undefined;
  if (mode === 'ai' && !chunk) fail('evidence_required', '来源约束的 AI 考核必须绑定原文证据。');
  const origin = String(args.exerciseOrigin ?? 'generated');
  if (origin === 'source_exact' && chunk) {
    if (!chunk.quoteExact.replace(/\s+/g, '').includes(question.replace(/\s+/g, ''))) {
      fail('origin_not_exact', '题干并不在所选原文中，不能标为「原题」。');
    }
  }
  let concept = state.concepts.find(
    (c) => c.name === conceptName && (c.sourceId ?? null) === (chunk?.sourceId ?? null) && !c.archivedAt,
  );
  if (!concept) {
    concept = {
      id: id('con'),
      sourceId: chunk?.sourceId ?? null,
      chunkId: chunk?.id ?? null,
      name: conceptName,
      origin: 'user_selected',
      state: 'new',
      ease: 2.5,
      intervalDays: 0,
      reps: 0,
      lapses: 0,
      dueOn: null,
      lastReviewedAt: null,
      scheduler: 'fold-sm2e-1',
      createdAt: nowIso(),
      archivedAt: null,
    };
    state.concepts.push(concept);
  }
  const now = nowIso();
  const card: MockCard = {
    id: id('crd'),
    conceptId: concept.id,
    sessionId: args.sessionId ? String(args.sessionId) : null,
    kind: 'recall',
    status: 'draft',
    mode,
    currentRevisionId: '',
    pausedReason: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
  const revision: MockCardRevision = {
    id: id('crv'),
    cardId: card.id,
    revisionNo: 1,
    question,
    answer,
    evidenceChunkId: chunk?.id ?? null,
    evidenceExcerpt: String(args.evidenceExcerpt ?? '') || (chunk?.quoteExact.slice(0, 220) ?? ''),
    exerciseOrigin: origin as CardRevision['exerciseOrigin'],
    originNote: (args.originNote as string | null) ?? null,
    createdAt: now,
  };
  card.currentRevisionId = revision.id;
  state.cards.push(card);
  state.cardRevisions.push(revision);
  if (card.sessionId) {
    const session = state.sessions.find((s) => s.id === card.sessionId);
    if (session) {
      session.conceptId = concept.id;
      session.updatedAt = now;
    }
  }
  save();
  return cardDetail(card.id);
}

function updateCard(cardId: string, args: AnyRecord): { card: CardDetail; semanticChange: boolean; needsScheduleDecision: boolean } {
  const card = state.cards.find((c) => c.id === cardId) ?? fail('card_not_found', '卡片不存在。');
  if (card.archivedAt) fail('card_archived', '已归档的卡片不能编辑。');
  const old = state.cardRevisions.find((r) => r.id === card.currentRevisionId) ?? fail('revision_not_found', '卡片修订不存在。');
  const question = String(args.question ?? '').trim();
  const answer = String(args.answer ?? '').trim();
  if (!question || !answer) fail('card_incomplete', '问题与答案都不能为空。');
  const chunkId = args.evidenceChunkId ? String(args.evidenceChunkId) : null;
  const chunk = chunkId ? state.chunks.find((c) => c.id === chunkId) : undefined;
  const semanticChange = old.question !== question || old.answer !== answer;
  const payload = {
    question,
    answer,
    evidenceChunkId: chunk?.id ?? null,
    evidenceExcerpt: String(args.evidenceExcerpt ?? '') || (chunk?.quoteExact.slice(0, 220) ?? ''),
    exerciseOrigin: String(args.exerciseOrigin ?? 'generated'),
    originNote: (args.originNote as string | null) ?? null,
  };
  let needsScheduleDecision = false;
  if (card.status === 'draft') {
    Object.assign(old, payload);
  } else {
    const nextNo = Math.max(...state.cardRevisions.filter((r) => r.cardId === cardId).map((r) => r.revisionNo)) + 1;
    const revision: MockCardRevision = {
      id: id('crv'),
      cardId,
      revisionNo: nextNo,
      ...payload,
      exerciseOrigin: payload.exerciseOrigin as CardRevision['exerciseOrigin'],
      createdAt: nowIso(),
    };
    state.cardRevisions.push(revision);
    card.currentRevisionId = revision.id;
    if (semanticChange && card.status === 'active') {
      card.status = 'paused';
      card.pausedReason = '修订待确认：保留原排期，或重置该概念排期';
      needsScheduleDecision = true;
    }
  }
  card.updatedAt = nowIso();
  save();
  return { card: cardDetail(cardId), semanticChange, needsScheduleDecision };
}

function acceptCard(cardId: string): CardDetail {
  const card = state.cards.find((c) => c.id === cardId) ?? fail('card_not_found', '卡片不存在。');
  if (card.status !== 'draft') fail('card_not_draft', '只有草稿可以「收下」。');
  card.status = 'active';
  card.pausedReason = null;
  card.updatedAt = nowIso();
  save();
  return cardDetail(cardId);
}

function resolveRevision(cardId: string, decision: string): CardDetail {
  const card = state.cards.find((c) => c.id === cardId) ?? fail('card_not_found', '卡片不存在。');
  if (card.status !== 'paused') fail('card_not_paused', '这张卡当前不需要排期决定。');
  if (decision === 'reset') {
    const concept = conceptFor(card);
    concept.state = 'new';
    concept.ease = 2.5;
    concept.intervalDays = 0;
    concept.reps = 0;
    concept.lapses = 0;
    concept.dueOn = null;
    concept.lastReviewedAt = null;
  } else if (decision !== 'keep') {
    fail('bad_decision', '决定只能是 keep 或 reset。');
  }
  card.status = 'active';
  card.pausedReason = null;
  card.updatedAt = nowIso();
  save();
  return cardDetail(cardId);
}

function pauseCard(cardId: string, reason?: string): CardDetail {
  const card = state.cards.find((c) => c.id === cardId) ?? fail('card_not_found', '卡片不存在。');
  if (card.status !== 'active') fail('card_not_active', '只有启用中的卡片可以暂停。');
  card.status = 'paused';
  card.pausedReason = reason ?? '已暂停';
  card.updatedAt = nowIso();
  save();
  return cardDetail(cardId);
}

function archiveCard(cardId: string): CardDetail {
  const card = state.cards.find((c) => c.id === cardId) ?? fail('card_not_found', '卡片不存在。');
  card.status = 'archived';
  card.archivedAt = nowIso();
  save();
  return cardDetail(cardId);
}

function applySchedule(concept: MockConcept, grade: number) {
  const before = {
    ease: concept.ease,
    intervalDays: concept.intervalDays,
    reps: concept.reps,
    lapses: concept.lapses,
    state: concept.state,
    dueOn: concept.dueOn,
  };
  let ease = Math.min(3, Math.max(1.3, concept.ease));
  let reps = concept.reps;
  let lapses = concept.lapses;
  let interval = concept.intervalDays;
  if (grade === 0) {
    reps = 0;
    lapses += 1;
    interval = 1;
    ease = Math.max(1.3, ease - 0.2);
    concept.state = 'relearning';
  } else {
    reps += 1;
    interval = reps === 1 ? 1 : reps === 2 ? 3 : Math.round(Math.max(1, interval) * ease);
    if (grade === 1) interval = Math.max(1, Math.round(interval * 0.6));
    if (grade === 3) interval = Math.round(interval * 1.3);
    interval = Math.min(365, Math.max(1, interval));
    ease = Math.min(3, Math.max(1.3, ease + (grade === 3 ? 0.1 : grade === 2 ? 0 : -0.15)));
    concept.state = 'review';
  }
  const due = addDays(new Date(), interval);
  concept.ease = Math.round(ease * 100) / 100;
  concept.intervalDays = interval;
  concept.reps = reps;
  concept.lapses = lapses;
  concept.dueOn = dateKey(due);
  concept.lastReviewedAt = nowIso();
  const after = {
    ease: concept.ease,
    intervalDays: interval,
    reps,
    lapses,
    state: concept.state,
    dueOn: concept.dueOn,
  };
  return { before, after };
}

function nextDueLabel(dueOn: string): string {
  const today = new Date(`${dateKey()}T00:00:00`);
  const due = new Date(`${dueOn}T00:00:00`);
  const days = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (days === 0) return '今天';
  if (days === 1) return '明天';
  if (days === 2) return '后天';
  if (days > 0) return `${days} 天后（${dueOn.slice(5)}）`;
  return dueOn;
}

function confirmReview(args: AnyRecord): ReviewResult {
  const attemptId = String(args.attemptId);
  const grade = Number(args.grade);
  const key = String(args.idempotencyKey);
  if (!(grade >= 0 && grade <= 3)) fail('bad_grade', '评级必须是 0–3。');
  const payloadHash = hash(`${attemptId}:${grade}`);
  const existingKey = state.idempotency[key];
  if (existingKey) {
    if (existingKey.hash !== payloadHash) fail('idempotency_conflict', '同一个提交键对应了不同的答案或评级，已拒绝复用旧结果。');
    const result = JSON.parse(existingKey.response) as ReviewResult;
    return { ...result, alreadyExisted: true, overview: overview() };
  }
  const attempt = state.attempts.find((a) => a.id === attemptId) ?? fail('attempt_not_found', '作答记录不存在。');
  const existingReview = state.reviews.find((r) => r.attemptId === attemptId);
  if (existingReview) {
    return {
      reviewId: existingReview.id,
      attemptId,
      conceptId: existingReview.conceptId,
      grade: existingReview.grade,
      mode: existingReview.mode,
      intervalDays: existingReview.intervalDays,
      dueOn: existingReview.dueOn,
      state: 'review',
      nextDueLabel: nextDueLabel(existingReview.dueOn),
      alreadyExisted: true,
      overview: overview(),
    };
  }
  if (!attempt.firstAnswer.trim()) fail('answer_required', '还没有首次答案，不能提交复习。');
  if (attempt.status === 'abandoned') fail('attempt_abandoned', '这次尝试已放弃。');
  if (attempt.status === 'objected') fail('attempt_objected', '当前反馈处于异议状态，请先改为自评或重新批改后再确认。');
  if (attempt.status === 'insufficient') fail('insufficient_evidence', '这次反馈证据不足，不能提交调度。');
  if (attempt.status === 'ai_failed' && attempt.feedbackMode !== 'self') fail('ai_failed', 'AI 反馈失败，尚未产生有效评分。');
  const mode = attempt.feedbackMode ?? (state.cards.find((c) => c.id === attempt.cardId)?.mode ?? 'ai');
  if (mode === 'ai' && !attempt.feedback) fail('feedback_required', '还没有可核对的反馈，不能提交复习。');
  const concept = state.concepts.find((c) => c.id === attempt.conceptId) ?? fail('concept_not_found', '概念不存在。');
  const today = dateKey();
  const other = state.reviews.find((r) => r.conceptId === concept.id && r.localDate === today && r.attemptId !== attemptId);
  if (other) fail('concept_already_reviewed_today', '这个概念今天已经完成过一次复习。本次尝试保留为历史，不再重复排期。');
  const { before, after } = applySchedule(concept, grade);
  const review: MockReview = {
    id: id('rev'),
    attemptId,
    conceptId: concept.id,
    grade,
    mode,
    scheduler: 'fold-sm2e-1',
    stateBefore: JSON.stringify(before),
    stateAfter: JSON.stringify(after),
    intervalDays: after.intervalDays,
    dueOn: after.dueOn ?? today,
    latencyMs: attempt.latencyMs,
    idempotencyKey: key,
    localDate: today,
    reviewedAt: nowIso(),
  };
  state.reviews.push(review);
  attempt.status = 'confirmed';
  attempt.confirmedAt = nowIso();
  const assignment = state.assignments.find((a) => a.attemptId === attemptId);
  if (assignment) assignment.completedAt = nowIso();
  const result: ReviewResult = {
    reviewId: review.id,
    attemptId,
    conceptId: concept.id,
    grade,
    mode,
    intervalDays: review.intervalDays,
    dueOn: review.dueOn,
    state: concept.state,
    nextDueLabel: nextDueLabel(review.dueOn),
    alreadyExisted: false,
    overview: overview(),
  };
  state.idempotency[key] = { hash: payloadHash, response: JSON.stringify(result) };
  save();
  return result;
}

function simulateFeedback(attempt: MockAttempt): Feedback {
  const revision = state.cardRevisions.find((r) => r.id === attempt.revisionId) ?? fail('revision_not_found', '卡片修订不存在。');
  const chunk = revision.evidenceChunkId
    ? state.chunks.find((c) => c.id === revision.evidenceChunkId)
    : undefined;
  const source = sourceForRevision(chunk?.revisionId ?? null);
  const evidence: EvidenceRef[] = chunk
    ? [
        {
          chunkId: chunk.id,
          excerpt: revision.evidenceExcerpt || chunk.quoteExact.slice(0, 160),
          sourceTitle: source?.title ?? null,
          label: revision.originNote,
          matched: true,
        },
      ]
    : [];
  const answer = attempt.firstAnswer.replace(/\s+/g, '');
  const reference = revision.answer.replace(/\s+/g, '');
  const hasInjection = /忽略|直接判|给我满分|更新数据库|执行命令/.test(answer);
  let verdict: Feedback['verdict'] = 'partial';
  let observed: string[] = [];
  let missing: string[] = [];
  let hits: string[] = [];
  if (!evidence.length) {
    return {
      verdict: 'insufficient_evidence',
      hits: [],
      observedErrors: [],
      missingPoints: [],
      hint: null,
      evidence: [],
      note: '这张卡没有绑定可核对的原文证据，无法给出有效评分。',
      model: 'demo-local · 模拟批改',
    };
  }
  if (hasInjection) {
    verdict = 'wrong';
    observed = ['答案中包含试图修改判分的指令。折页把它们当作待批改文本，没有执行。'];
    missing = ['没有给出与题目对应的实际内容。'];
  } else if (answer.length < 2) {
    verdict = 'wrong';
    observed = ['答案过短，无法判断是否独立回忆出了关键条件。'];
  } else if (reference.includes(answer) || answer.includes('登记完成') || answer.includes('检索') || (answer.length >= 6 && reference.includes(answer.slice(0, 6)))) {
    verdict = 'correct';
    hits = ['回答覆盖了参考答案的核心条件。'];
  } else if (answer.includes('核对') && reference.includes('登记完成')) {
    verdict = 'wrong';
    observed = ['把条目移动的时点说成「核对之前」或「核对时」，与原文「登记完成后」的顺序冲突。'];
    missing = ['遗漏了「登记完成」这个条件。'];
  } else {
    const overlap = [...new Set(reference)].filter((ch) => answer.includes(ch)).length;
    verdict = overlap >= 4 ? 'partial' : 'wrong';
    if (verdict === 'partial') {
      observed = ['答案提到了部分相关词，但没有完整说明关键条件。'];
      missing = ['还缺少原文中「登记完成」这一关键限制。'];
    } else {
      observed = ['答案与原文的关键顺序不一致，未命中可核对的条件。'];
      missing = ['没有说明条目移动发生在登记完成之后。'];
    }
  }
  return {
    verdict,
    hits,
    observedErrors: observed,
    missingPoints: missing,
    hint: '回到原文：管理员先做什么，再做什么，最后在什么完成之后移动盒子？',
    evidence,
    note: '这是浏览器预览中的模拟批改，不代表真实模型结果。',
    model: 'demo-local · 模拟批改',
  };
}

function simulatedReply(userText: string, chunk?: MockChunk): string {
  const quote = chunk?.quoteExact ?? '';
  if (/考考我|出题|测我/.test(userText)) {
    return `好，先不看答案。\n\n根据你刚才选中的这段原文：\n\n> ${quote.slice(0, 140)}${quote.length > 140 ? '…' : ''}\n\n请用自己的话回答：这段文字里的关键顺序是什么？为什么不能把两个步骤对调？\n\n写完后告诉我，我再按你的实际答案反馈。`;
  }
  if (quote.includes('登记') && quote.includes('蓝色盒')) {
    return `先把这段原文拆成两个动作看。\n\n1. **核对编号**：确认条目身份，回答的是「它是不是这一条」。\n2. **登记**：让条目进入已登记状态，回答的是「它有没有完成入档」。\n\n原文把「移入绿色盒」绑定在「登记完成」之后，所以核对本身并不改变盒位。只核对、不登记时，条目仍然在蓝色盒里。\n\n> ${quote}\n\n你可以试着用自己的话说一遍：如果只核对了编号，条目的状态改变了吗？`;
  }
  if (quote.includes('检索练习')) {
    return `关键不在「看过了」，而在「能不能取出来」。\n\n重读会让熟悉感上升，但熟悉感和可提取性是两件事。合上书回答一个问题，会迫使大脑重建答案；每一次成功提取，都会让下一次提取更容易。\n\n这也解释了一个常见错觉：划线很多、读得很顺，不等于考试时能写出来。\n\n> ${quote}\n\n要不要把「检索练习」和「重读」的区别，用一句话说给我听？`;
  }
  if (quote.includes('间隔')) {
    return `间隔的作用不是拖延，而是让「提取」真正发生。\n\n如果复习太密，信息还在短时记忆里，回答起来很省力，留下的痕迹也浅。把同样的次数分散到几天，允许一点遗忘发生，再用提取把它拉回来，记忆路径会更结实。\n\n注意：这是常见趋势，不是对每个人都等量生效的保证。\n\n> ${quote}\n\n你可以想一想：如果明天就要考试，间隔还有意义吗？为什么？`;
  }
  return `我先把问题收窄到这段原文。\n\n> ${quote || '（这个会话没有绑定原文片段）'}\n\n从这段内容看，先要区分「事实描述」和「推论」。原文直接说了什么，我们可以核对；原文没有说的，不应该补写成确定事实。\n\n如果你愿意，可以告诉我你卡在哪一句，我就那一句再拆一层。`;
}

const DEMO_A_V1 = `# 青石镇档案室

青石镇档案室规定：蓝色盒存放待登记条目，绿色盒存放已登记条目。管理员先核对编号，再将条目登记，登记完成后从蓝色盒移入绿色盒。每日最多处理十个新条目。引用一段记录不等于核实了整份记录。

## 登记流程

管理员先核对编号，再将条目登记，登记完成后从蓝色盒移入绿色盒。

## 每日上限

每日最多处理十个新条目。

## 页边提醒

引用一段记录不等于核实了整份记录。`;

const DEMO_A_V2 = `# 青石镇档案室

青石镇档案室规定：蓝色盒存放待登记条目，绿色盒存放已登记条目。管理员先登记，再由第二位管理员核对编号。每日最多处理八个新条目。

## 规则变更

登记与核对的主语和顺序发生了变化：先登记，再由第二位管理员核对。`;

const DEMO_B_V1 = `# 白塔镇档案室

白塔镇档案室规定：绿色盒存放待登记条目，蓝色盒存放已登记条目。管理员先核对编号，再将条目登记。引用一段记录不等于核实了整份记录。`;

const DEMO_ESSAY = `# 夜读：为什么间隔复习有效

学习不是把信息放进脑子，而是让它在需要时能被取出来。被动重读会让熟悉感上升，却不等于能在空白纸上重建答案。

## 检索练习

合上书，用自己的话回答一个问题，比再读一遍更能留下痕迹。这个过程叫检索练习。它之所以有效，是因为每一次成功提取都会强化通向该记忆的路径。

## 间隔

把同样的复习次数分散到几天，通常比集中在一天更有效。间隔让一部分遗忘发生，再通过提取把它拉回来。太密的复习省力，但留下的痕迹也浅。

## 穿插

把不同类型的问题混在一起练习，会比连续做同一类题更吃力。这种吃力不是失败，而是大脑在选择方法。短期内正确率可能下降，长期迁移往往更好。

## 一条边界

这些结论描述的是常见趋势，不是对每个人都等量生效的保证。真正可靠的记录，来自你自己实际作答后的反馈，而不是一次讲解或一段模拟。`;

function seed(): MockState {
  const seeded: MockState = {
    version: VERSION,
    onboarded: true,
    settings: {
      'model.provider': 'deepseek',
      'model.base_url': 'https://api.deepseek.com/v1',
      'model.model': 'deepseek-chat',
      'model.api_key': 'demo-key',
      'model.temperature': '0.2',
      'study.daily_new': '10',
      'study.daily_review': '50',
      'study.timezone': 'Asia/Shanghai',
      'ui.theme': 'ink',
      'ui.capsule_metric': 'due',
      'privacy.cloud_notice_seen': '0',
      'model.last_test_at': nowIso(),
      'model.last_test_ok': '1',
      'model.last_test_message': '演示连接成功',
    },
    sources: [],
    revisions: [],
    chunks: [],
    concepts: [],
    cards: [],
    cardRevisions: [],
    sessions: [],
    messages: [],
    attempts: [],
    assignments: [],
    reviews: [],
    idempotency: {},
  };

  state = seeded;  const addSource = (title: string, content: string, origin = 'sample', note: string | null = null) => {
    const source: MockSource = {
      id: id('src'),
      title,
      kind: 'md',
      origin,
      trustTier: origin === 'import' ? 1 : 0,
      note,
      createdAt: nowIso(),
      lastReadAt: null,
      archivedAt: null,
    };
    const revision: MockRevision = {
      id: id('rev'),
      sourceId: source.id,
      revisionNo: 1,
      content,
      contentHash: hash(content),
      label: '版本 1',
      createdAt: nowIso(),
    };
    const chunks = makeChunks(source.id, revision.id, content);
    state.sources.push(source);
    state.revisions.push(revision);
    state.chunks.push(...chunks);
    return { source, revision, chunks };
  };

  const a = addSource('青石镇档案室', DEMO_A_V1, 'sample', '虚构示例材料，用于体验与验收，不是事实来源。');
  const a2: MockRevision = {
    id: id('rev'),
    sourceId: a.source.id,
    revisionNo: 2,
    content: DEMO_A_V2,
    contentHash: hash(DEMO_A_V2),
    label: '版本 2 · 规则变更',
    createdAt: nowIso(),
  };
  state.revisions.push(a2);
  state.chunks.push(...makeChunks(a.source.id, a2.id, DEMO_A_V2));
  const b = addSource('白塔镇档案室', DEMO_B_V1, 'sample', '虚构示例材料，用于区分同名条目与不同来源。');
  const essay = addSource('夜读：为什么间隔复习有效', DEMO_ESSAY, 'sample', '示例阅读材料，用于体验长文阅读与页边笔记。');

  const findChunk = (sourceTitle: string, needle: string, revisionId?: string) => {
    const source = state.sources.find((s) => s.title === sourceTitle);
    return state.chunks.find(
      (c) =>
        c.sourceId === source?.id &&
        (!revisionId || c.revisionId === revisionId) &&
        c.quoteExact.includes(needle),
    );
  };

  const makeConcept = (name: string, chunk: MockChunk | undefined, dueOn: string | null, reps: number, intervalDays: number) => {
    const concept: MockConcept = {
      id: id('con'),
      sourceId: chunk?.sourceId ?? null,
      chunkId: chunk?.id ?? null,
      name,
      origin: 'user_selected',
      state: reps > 0 ? 'review' : 'new',
      ease: 2.5,
      intervalDays,
      reps,
      lapses: 0,
      dueOn,
      lastReviewedAt: reps > 0 ? nowIso() : null,
      scheduler: 'fold-sm2e-1',
      createdAt: nowIso(),
      archivedAt: null,
    };
    state.concepts.push(concept);
    return concept;
  };

  const makeCard = (
    concept: MockConcept,
    chunk: MockChunk | undefined,
    question: string,
    answer: string,
    options: { status?: string; mode?: 'ai' | 'self'; origin?: CardRevision['exerciseOrigin']; excerpt?: string; pausedReason?: string | null } = {},
  ) => {
    const card: MockCard = {
      id: id('crd'),
      conceptId: concept.id,
      sessionId: null,
      kind: 'recall',
      status: options.status ?? 'active',
      mode: options.mode ?? 'ai',
      currentRevisionId: '',
      pausedReason: options.pausedReason ?? null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      archivedAt: null,
    };
    const revision: MockCardRevision = {
      id: id('crv'),
      cardId: card.id,
      revisionNo: 1,
      question,
      answer,
      evidenceChunkId: chunk?.id ?? null,
      evidenceExcerpt: options.excerpt ?? (chunk?.quoteExact.slice(0, 220) ?? ''),
      exerciseOrigin: options.origin ?? 'generated',
      originNote: '演示卡片',
      createdAt: nowIso(),
    };
    card.currentRevisionId = revision.id;
    state.cards.push(card);
    state.cardRevisions.push(revision);
    return card;
  };

  const c1 = makeConcept(
    '登记顺序',
    findChunk('青石镇档案室', '登记完成后从蓝色盒移入绿色盒', a.revision.id),
    isoDay(-1),
    2,
    3,
  );
  makeCard(
    c1,
    findChunk('青石镇档案室', '登记完成后从蓝色盒移入绿色盒', a.revision.id),
    '在材料 A 的版本 1 中，一个条目何时从蓝色盒移到绿色盒？',
    '登记完成后。',
    { excerpt: '登记完成后从蓝色盒移入绿色盒。' },
  );

  const c2 = makeConcept(
    '盒色对应',
    findChunk('青石镇档案室', '蓝色盒存放待登记条目', a.revision.id),
    dateKey(),
    1,
    1,
  );
  makeCard(
    c2,
    findChunk('青石镇档案室', '蓝色盒存放待登记条目', a.revision.id),
    '青石镇档案室中，蓝色盒和绿色盒分别存放什么？',
    '蓝色盒存放待登记条目，绿色盒存放已登记条目。',
    { mode: 'self', excerpt: '蓝色盒存放待登记条目，绿色盒存放已登记条目。' },
  );

  const c3 = makeConcept('检索练习', findChunk('夜读：为什么间隔复习有效', '检索练习'), dateKey(), 3, 5);
  makeCard(
    c3,
    findChunk('夜读：为什么间隔复习有效', '检索练习'),
    '为什么合上书回答一个问题，比再读一遍更有效？',
    '因为每一次成功提取都会强化通向该记忆的路径。',
    { excerpt: '它之所以有效，是因为每一次成功提取都会强化通向该记忆的路径。' },
  );

  const c4 = makeConcept('间隔效应', findChunk('夜读：为什么间隔复习有效', '间隔让一部分遗忘发生'), isoDay(2), 4, 8);
  makeCard(
    c4,
    findChunk('夜读：为什么间隔复习有效', '间隔让一部分遗忘发生'),
    '为什么把复习分散到几天通常比集中在一天更有效？',
    '间隔让一部分遗忘发生，再通过提取把它拉回来。',
    { excerpt: '间隔让一部分遗忘发生，再通过提取把它拉回来。' },
  );

  const c5 = makeConcept('引用与核实', findChunk('青石镇档案室', '引用一段记录不等于核实', a.revision.id), null, 0, 0);
  makeCard(
    c5,
    findChunk('青石镇档案室', '引用一段记录不等于核实', a.revision.id),
    '为什么引用一段记录不等于核实整份记录？',
    '引用只证明可追溯，不证明事实已经被独立核实。',
    { status: 'draft', excerpt: '引用一段记录不等于核实了整份记录。' },
  );

  const c6 = makeConcept('穿插练习', findChunk('夜读：为什么间隔复习有效', '把不同类型的问题混在一起'), null, 0, 0);
  makeCard(
    c6,
    findChunk('夜读：为什么间隔复习有效', '把不同类型的问题混在一起'),
    '穿插练习为什么会在短期内降低正确率？',
    '因为大脑需要在不同方法之间选择，这种吃力是选择成本，不是失败。',
    { status: 'draft', excerpt: '这种吃力不是失败，而是大脑在选择方法。' },
  );

  const c7 = makeConcept('白塔镇盒色', findChunk('白塔镇档案室', '绿色盒存放待登记条目'), dateKey(), 2, 4);
  makeCard(
    c7,
    findChunk('白塔镇档案室', '绿色盒存放待登记条目'),
    '白塔镇档案室的绿色盒存放什么？',
    '绿色盒存放待登记条目。',
    { status: 'paused', pausedReason: '修订待确认：保留原排期，或重置该概念排期', excerpt: '绿色盒存放待登记条目，蓝色盒存放已登记条目。' },
  );

  // A little real-looking history for the weekly chart. These are preview-only
  // rows and are never mixed with the desktop app's database.
  const history = [0, 2, 1, 4, 3, 2, 0];
  history.forEach((count, index) => {
    const date = isoDay(index - 6);
    for (let i = 0; i < count; i += 1) {
      state.reviews.push({
        id: id('rev'),
        attemptId: id('att'),
        conceptId: [c1.id, c3.id, c4.id][i % 3],
        grade: 2,
        mode: 'ai',
        scheduler: 'fold-sm2e-1',
        stateBefore: '{}',
        stateAfter: '{}',
        intervalDays: 3,
        dueOn: isoDay(3),
        latencyMs: 12000,
        idempotencyKey: id('idem'),
        localDate: date,
        reviewedAt: nowIso(),
      });
    }
  });

  const rootSession: MockSession = {
    id: id('ses'),
    parentId: null,
    forkMessageId: null,
    forkChunkId: c1.chunkId,
    forkExact: findChunk('青石镇档案室', '登记完成后从蓝色盒移入绿色盒', a.revision.id)?.quoteExact ?? null,
    seedName: '登记顺序',
    conceptId: c1.id,
    kind: 'explain',
    intent: 'learn',
    depth: 0,
    parentAnchor: null,
    archivedAt: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  const rootAssistant: MockMessage = {
    id: id('msg'),
    sessionId: rootSession.id,
    ordinal: 1,
    role: 'assistant',
    content:
      '先看原文里的两个动作。\n\n1. **核对编号**：确认条目身份，回答的是「它是不是这一条」。\n2. **登记**：让条目进入已登记状态，回答的是「它有没有完成入档」。\n\n原文把「移入绿色盒」绑定在「登记完成」之后，所以核对本身并不改变盒位。只核对、不登记时，条目仍然在蓝色盒里。\n\n> 管理员先核对编号，再将条目登记，登记完成后从蓝色盒移入绿色盒。\n\n你可以试着用自己的话说一遍：如果只核对了编号，条目的状态改变了吗？',
    status: 'complete',
    error: null,
    cites: [],
    meta: {},
    createdAt: nowIso(),
  };
  state.sessions.push(rootSession);
  state.messages.push(
    {
      id: id('msg'),
      sessionId: rootSession.id,
      ordinal: 0,
      role: 'user',
      content: '这里说登记完成后才移到绿色盒，为什么核对不算完成？',
      status: 'complete',
      error: null,
      cites: [],
      meta: {},
      createdAt: nowIso(),
    },
    rootAssistant,
  );

  const forkSession: MockSession = {
    id: id('ses'),
    parentId: rootSession.id,
    forkMessageId: rootAssistant.id,
    forkChunkId: c1.chunkId,
    forkExact: rootAssistant.content.slice(0, 80),
    seedName: '核对与登记',
    conceptId: c1.id,
    kind: 'fork',
    intent: 'review',
    depth: 1,
    parentAnchor: rootAssistant.id,
    archivedAt: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  state.sessions.push(forkSession);
  state.messages.push(
    {
      id: id('msg'),
      sessionId: forkSession.id,
      ordinal: 0,
      role: 'user',
      content: '那核对之后、登记之前，条目在哪个盒子里？',
      status: 'complete',
      error: null,
      cites: [],
      meta: {},
      createdAt: nowIso(),
    },
    {
      id: id('msg'),
      sessionId: forkSession.id,
      ordinal: 1,
      role: 'assistant',
      content:
        '仍在蓝色盒。原文把「移入绿色盒」绑定在「登记完成」之后，而不是核对之后。核对只是登记前的检查步骤。\n\n这也是为什么不能把顺序倒过来：如果先移动盒子，再登记，绿色盒里就会出现尚未完成入档的条目。',
      status: 'complete',
      error: null,
      cites: [],
      meta: {},
      createdAt: nowIso(),
    },
  );
  rootSession.updatedAt = nowIso();
  save();
  return state;
}

function load(): MockState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as MockState;
      if (parsed.version === VERSION) {
        state = parsed;
        return state;
      }
    }
  } catch {
    // fall through to a fresh preview
  }
  if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('fresh')) {
    state = { ...seed(), onboarded: false };
    save();
    return state;
  }
  return seed();
}

state = load();

export const isMockBackend = true;

function reseedIfEmpty() {
  if (!state.sources.length) state = seed();
}

export async function mockInvoke<T>(command: string, args: AnyRecord = {}): Promise<T> {
  await sleep(command.startsWith('send_message') ? 10 : 35);
  switch (command) {
    case 'app_bootstrap':
      return bootstrap() as T;
    case 'complete_onboarding':
      state.onboarded = true;
      save();
      return { ok: true, changed: true } as T;
    case 'get_overview':
      return overview() as T;
    case 'get_settings':
      return { model: modelStatus(), study: studySettings() } as T;
    case 'save_model_config': {
      const input = (args.input ?? {}) as AnyRecord;
      setSetting('model.provider', String(input.provider ?? 'deepseek'));
      setSetting('model.base_url', String(input.baseUrl ?? '').replace(/\/$/, ''));
      setSetting('model.model', String(input.model ?? ''));
      if (input.apiKey && String(input.apiKey).trim()) setSetting('model.api_key', String(input.apiKey).trim());
      setSetting('model.last_test_at', '');
      setSetting('model.last_test_ok', '');
      setSetting('model.last_test_message', '');
      save();
      return modelStatus() as T;
    }
    case 'clear_api_key':
      setSetting('model.api_key', '');
      save();
      return modelStatus() as T;
    case 'test_model_connection':
      await sleep(500);
      setSetting('model.last_test_at', nowIso());
      setSetting('model.last_test_ok', '1');
      setSetting('model.last_test_message', '演示连接成功');
      save();
      return {
        ok: true,
        latencyMs: 420,
        message: '演示模型连接成功（浏览器预览）',
        model: setting('model.model', 'deepseek-chat'),
      } as T;
    case 'save_study_settings': {
      const input = (args.input ?? {}) as AnyRecord;
      setSetting('study.daily_new', String(Math.min(200, Math.max(1, Number(input.dailyNew ?? 10)))));
      setSetting('study.daily_review', String(Math.min(500, Math.max(1, Number(input.dailyReview ?? 50)))));
      setSetting('study.timezone', String(input.timezone ?? 'Asia/Shanghai'));
      setSetting('ui.capsule_metric', input.capsuleMetric === 'new' ? 'new' : 'due');
      save();
      return studySettings() as T;
    }
    case 'save_ui_prefs':
      setSetting('ui.theme', args.theme === 'paper' ? 'paper' : 'ink');
      save();
      return undefined as T;
    case 'mark_cloud_notice_seen':
      setSetting('privacy.cloud_notice_seen', '1');
      save();
      return { ok: true, changed: true } as T;
    case 'list_sources':
      return state.sources.filter((s) => !s.archivedAt).map(sourceSummary) as T;
    case 'get_source_detail':
      return sourceDetail(String(args.sourceId), (args.revisionId as string | null) ?? null) as T;
    case 'import_source':
      return importSource((args.input ?? {}) as AnyRecord) as T;
    case 'create_chunk':
      return createChunkFromSelection((args.input ?? {}) as AnyRecord) as T;
    case 'list_annotations':
      return annotations(String(args.sourceId), String(args.revisionId)) as T;
    case 'delete_source': {
      const source = state.sources.find((s) => s.id === String(args.sourceId)) ?? fail('source_not_found', '来源不存在。');
      source.archivedAt = nowIso();
      for (const card of state.cards) {
        if (card.status === 'active' && state.chunks.some((c) => c.sourceId === source.id && c.id === revisionForCard(card)?.evidenceChunkId)) {
          card.status = 'paused';
          card.pausedReason = '来源已删除，等待重新定位';
        }
      }
      save();
      return { ok: true, changed: true } as T;
    }
    case 'load_demo': {
      reseedIfEmpty();
      state.onboarded = true;
      save();
      return state.sources.filter((s) => !s.archivedAt).map(sourceSummary) as T;
    }
    case 'create_external_fragment':
      return importSource({
        title: `外部片段 · ${new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`,
        kind: 'external',
        text: String(args.content ?? ''),
        origin: 'external',
        note: String(args.note ?? '外部片段 / 来源未提供。'),
        label: '粘贴内容',
      }) as T;
    case 'list_sessions':
      return state.sessions
        .filter((s) => !s.archivedAt)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 40)
        .map(sessionSummary) as T;
    case 'get_session':
      return sessionDetail(String(args.sessionId)) as T;
    case 'create_session': {
      const input = (args.input ?? {}) as AnyRecord;
      const parent = input.parentId ? state.sessions.find((s) => s.id === String(input.parentId)) : undefined;
      if (parent && parent.depth >= 3) fail('fork_depth_limit', '分叉深度最多三层。请另起一个主题。');
      const chunk = input.chunkId ? state.chunks.find((c) => c.id === String(input.chunkId)) : undefined;
      const session: MockSession = {
        id: id('ses'),
        parentId: parent?.id ?? null,
        forkMessageId: input.forkMessageId ? String(input.forkMessageId) : null,
        forkChunkId: chunk?.id ?? null,
        forkExact: chunk?.quoteExact ?? null,
        seedName: String(input.name ?? chunk?.quoteExact.slice(0, 28) ?? (parent ? '未命名分叉' : '新的会话')),
        conceptId: chunk ? state.concepts.find((c) => c.chunkId === chunk.id)?.id ?? null : null,
        kind: parent ? 'fork' : 'explain',
        intent: (input.intent as MockSession['intent']) ?? 'unspecified',
        depth: parent ? parent.depth + 1 : 0,
        parentAnchor: input.forkMessageId ? String(input.forkMessageId) : null,
        archivedAt: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      state.sessions.push(session);
      save();
      return sessionDetail(session.id) as T;
    }
    case 'set_session_intent': {
      const session = state.sessions.find((s) => s.id === String(args.sessionId)) ?? fail('session_not_found', '会话不存在。');
      session.intent = String(args.intent) as MockSession['intent'];
      session.updatedAt = nowIso();
      save();
      return sessionSummary(session) as T;
    }
    case 'archive_session': {
      const session = state.sessions.find((s) => s.id === String(args.sessionId)) ?? fail('session_not_found', '会话不存在。');
      session.archivedAt = nowIso();
      save();
      return sessionSummary(session) as T;
    }
    case 'save_parent_anchor': {
      const session = state.sessions.find((s) => s.id === String(args.sessionId));
      if (session && args.anchor) session.parentAnchor = String(args.anchor);
      save();
      return { ok: true, changed: true } as T;
    }
    case 'list_cards':
      return state.cards
        .filter((c) => !c.archivedAt && (!args.status || c.status === args.status))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map(cardSummary) as T;
    case 'get_card':
      return cardDetail(String(args.cardId)) as T;
    case 'create_card_draft':
      return createCardDraft((args.input ?? {}) as AnyRecord) as T;
    case 'update_card':
      return updateCard(String(args.cardId), (args.input ?? {}) as AnyRecord) as T;
    case 'accept_card':
      return acceptCard(String(args.cardId)) as T;
    case 'resolve_card_revision':
      return resolveRevision(String(args.cardId), String(args.decision)) as T;
    case 'pause_card':
      return pauseCard(String(args.cardId), args.reason as string | undefined) as T;
    case 'archive_card':
      return archiveCard(String(args.cardId)) as T;
    case 'next_task':
      return nextTask() as T;
    case 'queue_preview': {
      const stats = queueStats();
      const due = dueConcepts(dateKey()).slice(0, 8).map((c) => cardSummary(activeCardFor(c.id)!));
      const fresh = newConcepts(dateKey()).slice(0, 8).map((c) => cardSummary(activeCardFor(c.id)!));
      return { stats, due, new: fresh, blocked: blockedConcepts(dateKey()) } as T;
    }
    case 'get_task': {
      const attempt = state.attempts.find((a) => a.id === String(args.attemptId));
      if (!attempt) return null as T;
      const assignment = state.assignments.find((a) => a.id === attempt.assignmentId);
      if (assignment) return taskForAssignment(assignment) as T;
      return null as T;
    }
    case 'abandon_attempt': {
      const attempt = state.attempts.find((a) => a.id === String(args.attemptId)) ?? fail('attempt_not_found', '作答记录不存在。');
      if (attempt.status === 'confirmed') fail('already_confirmed', '这次复习已经确认，不能放弃。');
      attempt.status = 'abandoned';
      if (!attempt.firstAnswer.trim()) {
        attempt.assignmentId = null;
        state.assignments = state.assignments.filter((a) => a.attemptId !== attempt.id);
      }
      save();
      return { ok: true, changed: true } as T;
    }
    case 'submit_answer': {
      const input = (args.input ?? {}) as AnyRecord;
      const attempt = state.attempts.find((a) => a.id === String(input.attemptId)) ?? fail('attempt_not_found', '作答记录不存在。');
      if (attempt.status === 'confirmed') fail('already_confirmed', '这次复习已经确认。');
      if (attempt.firstAnswer.trim()) fail('already_answered', '首次答案已经保存。');
      const answer = String(input.answer ?? '').trim();
      if (!answer) fail('empty_answer', '先写下你的答案，再提交。');
      const forgot = answer === '【想不起来】' || answer === '[想不起来]';
      attempt.firstAnswer = answer;
      attempt.answeredAt = nowIso();
      attempt.latencyMs = input.latencyMs ? Number(input.latencyMs) : null;
      const card = state.cards.find((c) => c.id === attempt.cardId);
      if (card?.mode === 'self' || attempt.feedbackMode === 'self' || forgot) {
        attempt.status = 'awaiting_self';
        attempt.feedbackMode = 'self';
        if (forgot) attempt.suggestedGrade = 0;
        save();
        return attemptView(attempt) as T;
      }
      attempt.status = 'grading';
      await sleep(850);
      const feedback = simulateFeedback(attempt);
      attempt.feedback = feedback;
      attempt.verdict = feedback.verdict;
      attempt.suggestedGrade = feedback.verdict === 'correct' ? 2 : feedback.verdict === 'insufficient_evidence' ? null : 0;
      attempt.feedbackMode = 'ai';
      attempt.status = feedback.verdict === 'insufficient_evidence' ? 'insufficient' : 'feedback';
      attempt.feedbackAt = nowIso();
      save();
      return attemptView(attempt) as T;
    }
    case 'retry_grade': {
      const attempt = state.attempts.find((a) => a.id === String(args.attemptId)) ?? fail('attempt_not_found', '作答记录不存在。');
      if (attempt.status === 'feedback' || attempt.status === 'insufficient') return attemptView(attempt) as T;
      await sleep(650);
      const feedback = simulateFeedback(attempt);
      attempt.feedback = feedback;
      attempt.verdict = feedback.verdict;
      attempt.suggestedGrade = feedback.verdict === 'correct' ? 2 : feedback.verdict === 'insufficient_evidence' ? null : 0;
      attempt.feedbackMode = 'ai';
      attempt.status = feedback.verdict === 'insufficient_evidence' ? 'insufficient' : 'feedback';
      attempt.feedbackAt = nowIso();
      attempt.aiError = null;
      save();
      return attemptView(attempt) as T;
    }
    case 'switch_to_self': {
      const attempt = state.attempts.find((a) => a.id === String(args.attemptId)) ?? fail('attempt_not_found', '作答记录不存在。');
      if (!['awaiting', 'answered', 'feedback', 'ai_failed', 'awaiting_self', 'objected'].includes(attempt.status)) {
        fail('not_switchable', '当前状态不能切换为自评。');
      }
      attempt.feedbackMode = 'self';
      attempt.status = attempt.firstAnswer.trim() ? 'awaiting_self' : 'awaiting';
      save();
      return attemptView(attempt) as T;
    }
    case 'request_hint': {
      const attempt = state.attempts.find((a) => a.id === String(args.attemptId)) ?? fail('attempt_not_found', '作答记录不存在。');
      const hint = attempt.feedback?.hint ?? null;
      if (hint) {
        attempt.hintUsed = true;
        attempt.hintText = hint;
        save();
      }
      return hint as T;
    }
    case 'practice_answer': {
      const attempt = state.attempts.find((a) => a.id === String(args.attemptId)) ?? fail('attempt_not_found', '作答记录不存在。');
      if (attempt.status === 'confirmed') fail('already_confirmed', '这次复习已经确认。');
      if (!String(args.answer ?? '').trim()) fail('empty_answer', '练习答案不能为空。');
      attempt.practiceAnswers.push({ answer: String(args.answer).trim(), hintUsed: attempt.hintUsed, at: nowIso() });
      save();
      return attemptView(attempt) as T;
    }
    case 'raise_objection': {
      const attempt = state.attempts.find((a) => a.id === String(args.attemptId)) ?? fail('attempt_not_found', '作答记录不存在。');
      if (!String(args.reason ?? '').trim()) fail('reason_required', '请写下异议理由。');
      if (!state.reviews.some((r) => r.attemptId === attempt.id)) attempt.status = 'objected';
      save();
      return { ok: true, changed: true } as T;
    }
    case 'confirm_review':
      return confirmReview((args.input ?? {}) as AnyRecord) as T;
    case 'review_history':
      return Array.from({ length: Number(args.days ?? 30) }, (_, index) => {
        const date = addDays(new Date(), index - Number(args.days ?? 30) + 1);
        const key = dateKey(date);
        return { date: key, label: key.slice(5), reviews: state.reviews.filter((r) => r.localDate === key).length };
      }) as T;
    case 'generate_card_draft': {
      const input = (args.input ?? {}) as AnyRecord;
      const session = state.sessions.find((s) => s.id === String(input.sessionId)) ?? fail('session_not_found', '会话不存在。');
      const chunk = state.chunks.find((c) => c.id === (input.chunkId ?? session.forkChunkId));
      if (!chunk) fail('chunk_required', '这个会话没有绑定原文片段。');
      await sleep(700);
      const quote = chunk!.quoteExact;
      let question = '这段原文的核心规则是什么？';
      let answer = quote;
      if (quote.includes('登记完成')) {
        question = '在青石镇档案室，一个条目何时从蓝色盒移到绿色盒？';
        answer = '登记完成后。';
      } else if (quote.includes('引用一段记录')) {
        question = '引用一段记录是否等于核实整份记录？';
        answer = '不等于。引用只证明可追溯，不证明事实已经核实。';
      } else if (quote.includes('检索练习')) {
        question = '为什么检索练习比重复阅读更有效？';
        answer = '因为每一次成功提取都会强化通向该记忆的路径。';
      } else if (quote.includes('间隔')) {
        question = '为什么间隔复习通常比集中复习更有效？';
        answer = '间隔让一部分遗忘发生，再通过提取把它拉回来。';
      }
      const source = state.sources.find((s) => s.id === chunk!.sourceId);
      const draft = createCardDraft({
        conceptName: String(input.conceptName ?? session.seedName),
        question,
        answer,
        evidenceChunkId: chunk!.id,
        evidenceExcerpt: quote.slice(0, 220),
        exerciseOrigin: 'generated',
        originNote: '由演示模型根据本次原文新编',
        mode: 'ai',
        sessionId: session.id,
      });
      state.cards.find((c) => c.id === draft.summary.id)!.sessionId = session.id;
      save();
      return {
        draft,
        evidence: {
          chunkId: chunk!.id,
          excerpt: quote.slice(0, 220),
          sourceTitle: source?.title ?? null,
          label: null,
          matched: true,
        },
      } as T;
    }
    case 'send_message': {
      const sessionId = String(args.sessionId);
      const session = state.sessions.find((s) => s.id === sessionId) ?? fail('session_not_found', '会话不存在。');
      const text = String(args.text ?? '').trim();
      if (!text) fail('empty_message', '消息不能为空。');
      const chunk = session.forkChunkId ? state.chunks.find((c) => c.id === session.forkChunkId) : undefined;
      const userMessage: MockMessage = {
        id: id('msg'),
        sessionId,
        ordinal: state.messages.filter((m) => m.sessionId === sessionId).length,
        role: 'user',
        content: text,
        status: 'complete',
        error: null,
        cites: [],
        meta: {},
        createdAt: nowIso(),
      };
      const assistantMessage: MockMessage = {
        id: id('msg'),
        sessionId,
        ordinal: userMessage.ordinal + 1,
        role: 'assistant',
        content: '',
        status: 'streaming',
        error: null,
        cites: [],
        meta: {},
        createdAt: nowIso(),
      };
      state.messages.push(userMessage, assistantMessage);
      session.updatedAt = nowIso();
      save();
      const reply = simulatedReply(text, chunk);
      const chunks = reply.match(/[\s\S]{1,12}/g) ?? [reply];
      let index = 0;
      const timer = setInterval(() => {
        index += 1;
        assistantMessage.content = chunks.slice(0, index).join('');
        if (index >= chunks.length) {
          clearInterval(timer);
          assistantMessage.status = 'complete';
          session.updatedAt = nowIso();
          save();
          emit('llm:done', {
            sessionId,
            messageId: assistantMessage.id,
            content: assistantMessage.content,
          });
        } else {
          emit('llm:delta', {
            sessionId,
            messageId: assistantMessage.id,
            delta: chunks[index - 1],
          });
        }
      }, 38);
      return { userMessage, assistantMessage } as T;
    }
    case 'export_tsv': {
      const rows = state.cards.filter((c) => !c.archivedAt).map((card) => {
        const detail = cardDetail(card.id);
        const rev = detail.revisions.find((r) => r.id === card.currentRevisionId);
        return [
          (rev?.question ?? '').replace(/\n/g, '<br>').replace(/\t/g, '    '),
          (rev?.answer ?? '').replace(/\n/g, '<br>').replace(/\t/g, '    '),
          `${detail.summary.sourceTitle ?? '外部片段 / 来源未提供'} · ${rev?.evidenceExcerpt ?? ''}`.replace(/\n/g, '<br>').replace(/\t/g, '    '),
          rev?.exerciseOrigin ?? 'generated',
          card.status,
          detail.summary.conceptName,
        ].join('\t');
      });
      const content = `#separator:tab\n#html:true\n${rows.join('\n')}\n`;
      return { path: '浏览器下载/fold-cards.tsv', rows: rows.length, bytes: content.length, content } as T;
    }
    case 'export_json': {
      const content = JSON.stringify(
        {
          format: 'fold-export/1',
          exportedAt: nowIso(),
          note: '浏览器预览导出的演示数据；桌面应用会导出完整快照。',
          data: state,
        },
        null,
        2,
      );
      return { path: '浏览器下载/fold-export.json', rows: state.cards.length, bytes: content.length, content } as T;
    }
    case 'backup_database':
      fail('not_supported', '浏览器预览不支持数据库备份。请使用桌面应用。');
      break;
    case 'reveal_data_dir':
      fail('not_supported', '浏览器预览没有本地数据目录。');
      break;
    case 'open_deepseek_page': {
      const page = String(args.page ?? '');
      const url = page === 'docs'
        ? 'https://api-docs.deepseek.com/zh-cn/'
        : page === 'keys'
          ? 'https://platform.deepseek.com/api_keys'
          : page === 'topup'
            ? 'https://platform.deepseek.com/top_up'
            : null;
      if (url && typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer');
      return undefined as T;
    }
    case 'set_window_mode':
    case 'hide_window':
    case 'ui_ready':
    case 'quit_app':
    case 'set_pinned':
      return undefined as T;
    default:
      fail('mock_missing', `浏览器预览尚未实现命令：${command}`);
  }
}

export function mockListen<T>(
  event: string,
  handler: (event: { payload: T }) => void,
): () => void {
  const set = listeners.get(event) ?? new Set();
  const wrapped = handler as (event: { payload: unknown }) => void;
  set.add(wrapped);
  listeners.set(event, set);
  return () => {
    set.delete(wrapped);
  };
}
