export type Theme = 'ink' | 'paper';
export type WindowMode = 'capsule' | 'panel' | 'panorama' | 'review' | 'settings' | 'guided';
export type LearningIntent = 'learn' | 'review' | 'unspecified';
export type ExerciseOrigin = 'source_exact' | 'adapted' | 'generated' | 'unspecified';
export type CardMode = 'ai' | 'self';

export interface SourceSummary {
  id: string;
  title: string;
  kind: string;
  origin: string;
  trustTier: number;
  revisionCount: number;
  currentRevisionNo: number;
  chunkCount: number;
  createdAt: string;
  lastReadAt: string | null;
  archived: boolean;
  note: string | null;
}

export interface RevisionSummary {
  id: string;
  revisionNo: number;
  label: string | null;
  createdAt: string;
  contentHash: string;
  charCount: number;
}

export interface SourceRevision {
  id: string;
  sourceId: string;
  revisionNo: number;
  content: string;
  contentHash: string;
  label: string | null;
  createdAt: string;
}

export interface SourceDetail {
  source: SourceSummary;
  revision: SourceRevision;
  revisions: RevisionSummary[];
  chunks: ChunkView[];
}

export interface ChunkView {
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
  sessionCount: number;
  cardCount: number;
  createdAt: string;
}

export interface ChunkInput {
  sourceId: string;
  revisionId: string;
  quoteExact: string;
  prefix: string;
  suffix: string;
  startUtf16: number;
  endUtf16: number;
  heading?: string | null;
  locator?: string | null;
}

export interface SessionSummary {
  id: string;
  parentId: string | null;
  seedName: string;
  kind: string;
  intent: LearningIntent;
  depth: number;
  forkChunkId: string | null;
  forkMessageId: string | null;
  forkExact: string | null;
  parentAnchor: string | null;
  conceptId: string | null;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  messageCount: number;
  lastMessage: string | null;
  forkCount: number;
}

export interface MessageView {
  id: string;
  sessionId: string;
  ordinal: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  status: 'streaming' | 'complete' | 'failed' | 'aborted';
  error: string | null;
  cites: string[];
  meta: unknown;
  createdAt: string;
}

export interface SessionDetail {
  session: SessionSummary;
  messages: MessageView[];
  parent: SessionSummary | null;
  chunk: ChunkView | null;
  source: SourceSummary | null;
  drafts: CardSummary[];
}

export interface ConceptView {
  id: string;
  name: string;
  sourceId: string | null;
  chunkId: string | null;
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
  archived: boolean;
}

export interface CardRevision {
  id: string;
  cardId: string;
  revisionNo: number;
  question: string;
  answer: string;
  evidenceChunkId: string | null;
  evidenceExcerpt: string;
  exerciseOrigin: ExerciseOrigin;
  originNote: string | null;
  createdAt: string;
}

export interface CardSummary {
  id: string;
  conceptId: string;
  conceptName: string;
  kind: string;
  status: 'draft' | 'active' | 'paused' | 'archived';
  mode: CardMode;
  question: string;
  answerPreview: string;
  exerciseOrigin: ExerciseOrigin;
  evidenceExcerpt: string;
  sourceId: string | null;
  sourceTitle: string | null;
  revisionId: string | null;
  updatedAt: string;
  dueOn: string | null;
  pausedReason: string | null;
  reps: number;
  lapses: number;
}

export interface CardDetail {
  summary: CardSummary;
  concept: ConceptView;
  revisions: CardRevision[];
  evidence: ChunkView | null;
}

export interface EvidenceRef {
  chunkId: string;
  excerpt: string;
  sourceTitle: string | null;
  label: string | null;
  matched: boolean;
}

export interface Feedback {
  verdict: 'correct' | 'partial' | 'wrong' | 'insufficient_evidence';
  hits: string[];
  observedErrors: string[];
  missingPoints: string[];
  hint: string | null;
  evidence: EvidenceRef[];
  note: string | null;
  model: string | null;
}

export interface PracticeAnswer {
  answer: string;
  hintUsed: boolean;
  at: string;
}

export interface AttemptView {
  id: string;
  conceptId: string;
  cardId: string;
  revisionId: string;
  firstAnswer: string;
  hintUsed: boolean;
  hintText: string | null;
  practiceAnswers: PracticeAnswer[];
  feedback: Feedback | null;
  verdict: string | null;
  suggestedGrade: number | null;
  feedbackMode: 'ai' | 'self' | null;
  aiError: string | null;
  status: string;
  isDemo: boolean;
  startedAt: string;
  answeredAt: string | null;
  latencyMs: number | null;
  card: CardSummary;
  revision: CardRevision;
  concept: ConceptView;
}

export interface QueueStats {
  dueCount: number;
  newAvailable: number;
  reviewServedToday: number;
  newServedToday: number;
  reviewLimit: number;
  newLimit: number;
  reviewRemaining: number;
  newRemaining: number;
  completedToday: number;
  backlog: number;
  blockedCount: number;
}

export interface BlockedConcept {
  conceptId: string;
  name: string;
  reason: string;
  dueOn: string | null;
}

export interface Task {
  assignmentId: string;
  kind: 'new' | 'review';
  dueOn: string | null;
  attempt: AttemptView;
  stats: QueueStats;
}

export interface TaskOutcome {
  task: Task | null;
  blocked: BlockedConcept[];
  stats: QueueStats;
  message: string | null;
}

export interface DayCount {
  date: string;
  label: string;
  reviews: number;
}

export interface Overview {
  localDate: string;
  timezone: string;
  dueCount: number;
  newAvailable: number;
  completedToday: number;
  reviewServedToday: number;
  newServedToday: number;
  reviewLimit: number;
  newLimit: number;
  backlog: number;
  blockedCount: number;
  drafts: number;
  activeCards: number;
  totalConcepts: number;
  streakDays: number;
  last7: DayCount[];
}

export interface ModelStatus {
  configured: boolean;
  provider: string;
  model: string;
  baseUrl: string;
  hasApiKey: boolean;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestMessage: string | null;
}

export interface StudySettings {
  dailyNew: number;
  dailyReview: number;
  timezone: string;
  theme: Theme;
  capsuleMetric: 'due' | 'new';
  cloudNoticeSeen: boolean;
}

export interface Bootstrap {
  appVersion: string;
  platform: string;
  dataDir: string;
  isFirstRun: boolean;
  guidedReady?: boolean;
  model: ModelStatus;
  settings: StudySettings;
  overview: Overview;
  sources: SourceSummary[];
  sessions: SessionSummary[];
  sampleLoaded: boolean;
}

export interface ReviewResult {
  reviewId: string;
  attemptId: string;
  conceptId: string;
  grade: number;
  mode: string;
  intervalDays: number;
  dueOn: string;
  state: string;
  nextDueLabel: string;
  alreadyExisted: boolean;
  overview: Overview;
}

export interface ExportResult {
  path: string;
  rows: number;
  bytes: number;
  /** Browser preview returns the file body so it can be downloaded. */
  content?: string;
}

export interface BooleanResult {
  ok: boolean;
  changed: boolean;
}

export interface ConfirmReviewInput {
  attemptId: string;
  grade: number;
  idempotencyKey: string;
}

export interface CardUpdateResult {
  card: CardDetail;
  semanticChange: boolean;
  needsScheduleDecision: boolean;
}

export interface CardDraftInput {
  conceptName: string;
  question: string;
  answer: string;
  evidenceChunkId: string | null;
  evidenceExcerpt: string;
  exerciseOrigin: ExerciseOrigin;
  originNote: string | null;
  mode: CardMode;
  sessionId: string | null;
}

export interface CardRevisionInput {
  question: string;
  answer: string;
  evidenceChunkId: string | null;
  evidenceExcerpt: string;
  exerciseOrigin: ExerciseOrigin;
  originNote: string | null;
}

export interface ModelConfigInput {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
  temperature?: number;
}

export interface StudySettingsInput {
  dailyNew: number;
  dailyReview: number;
  timezone: string;
  capsuleMetric: 'due' | 'new';
}

export interface TestModelResult {
  ok: boolean;
  latencyMs: number;
  message: string;
  model: string;
}

export interface ChatStartResult {
  userMessage: MessageView;
  assistantMessage: MessageView;
}

export interface CardGenerationResult {
  draft: CardDetail;
  evidence: EvidenceRef;
}

export interface QueuePreview {
  stats: QueueStats;
  due: CardSummary[];
  new: CardSummary[];
  blocked: BlockedConcept[];
}

export interface SourceAnnotation {
  chunkId: string;
  quoteExact: string;
  heading: string | null;
  locator: string | null;
  startUtf16: number;
  endUtf16: number;
  sessionId: string | null;
  sessionName: string | null;
  cardId: string | null;
  cardQuestion: string | null;
  kind: string;
}

export interface SettingsView {
  model: ModelStatus;
  study: StudySettings;
}

export interface SessionCreateInput {
  chunkId?: string | null;
  parentId?: string | null;
  forkMessageId?: string | null;
  name?: string | null;
  intent?: LearningIntent;
  kind?: string | null;
}

export interface ImportSourceInput {
  title: string;
  kind: string;
  text: string;
  label?: string | null;
  origin?: string | null;
  note?: string | null;
  replaceSourceId?: string | null;
}

export type View =
  | { name: 'capsule' }
  | { name: 'onboarding' }
  | { name: 'study' }
  | { name: 'today' }
  | { name: 'library' }
  | { name: 'reader'; sourceId: string; revisionId?: string | null }
  | { name: 'session'; sessionId: string }
  | { name: 'cards'; status?: string }
  | { name: 'card'; cardId: string }
  | { name: 'review'; attemptId?: string | null }
  | { name: 'settings'; section?: string };

export interface ApiError {
  code: string;
  message: string;
}

export interface ToastMessage {
  id: string;
  tone: 'info' | 'success' | 'error';
  title: string;
  detail?: string;
}
