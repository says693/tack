import { invoke } from '@/lib/bridge';
import type {
  Bootstrap,
  BlockedConcept,
  BooleanResult,
  CardDetail,
  CardDraftInput,
  CardGenerationResult,
  CardRevisionInput,
  CardSummary,
  CardUpdateResult,
  ChatStartResult,
  ChunkInput,
  ChunkView,
  ConfirmReviewInput,
  DayCount,
  ExportResult,
  ImportSourceInput,
  ModelConfigInput,
  ModelStatus,
  Overview,
  QueuePreview,
  ReviewResult,
  SessionCreateInput,
  SessionDetail,
  SessionSummary,
  SettingsView,
  SourceAnnotation,
  SourceDetail,
  SourceSummary,
  StudySettings,
  StudySettingsInput,
  Task,
  TaskOutcome,
  TestModelResult,
  Theme,
  AttemptView,
} from '@/types';

export const api = {
  bootstrap: () => invoke<Bootstrap>('app_bootstrap'),
  completeOnboarding: () => invoke<BooleanResult>('complete_onboarding'),
  overview: () => invoke<Overview>('get_overview'),
  settings: () => invoke<SettingsView>('get_settings'),
  saveModelConfig: (input: ModelConfigInput) =>
    invoke<ModelStatus>('save_model_config', { input }),
  clearApiKey: () => invoke<ModelStatus>('clear_api_key'),
  testModel: () => invoke<TestModelResult>('test_model_connection'),
  openDeepSeekPage: (page: 'docs' | 'keys' | 'topup') => invoke<void>('open_deepseek_page', { page }),
  saveStudySettings: (input: StudySettingsInput) =>
    invoke<StudySettings>('save_study_settings', { input }),
  saveUiPrefs: (theme: Theme) => invoke<void>('save_ui_prefs', { theme }),
  markCloudNoticeSeen: () => invoke<BooleanResult>('mark_cloud_notice_seen'),

  listSources: () => invoke<SourceSummary[]>('list_sources'),
  sourceDetail: (sourceId: string, revisionId?: string | null) =>
    invoke<SourceDetail>('get_source_detail', { sourceId, revisionId }),
  importSource: (input: ImportSourceInput) =>
    invoke<SourceDetail>('import_source', { input }),
  createChunk: (input: ChunkInput) => invoke<ChunkView>('create_chunk', { input }),
  annotations: (sourceId: string, revisionId: string) =>
    invoke<SourceAnnotation[]>('list_annotations', { sourceId, revisionId }),
  deleteSource: (sourceId: string) =>
    invoke<BooleanResult>('delete_source', { sourceId }),
  loadDemo: () => invoke<SourceSummary[]>('load_demo'),
  createExternalFragment: (content: string, note?: string | null) =>
    invoke<SourceDetail>('create_external_fragment', { content, note: note ?? null }),
  externalFragment: (content: string, note?: string) =>
    invoke<SourceDetail>('create_external_fragment', { content, note }),

  listSessions: () => invoke<SessionSummary[]>('list_sessions'),
  session: (sessionId: string) => invoke<SessionDetail>('get_session', { sessionId }),
  createSession: (input: SessionCreateInput) =>
    invoke<SessionDetail>('create_session', { input }),
  setSessionIntent: (sessionId: string, intent: string) =>
    invoke<SessionSummary>('set_session_intent', { sessionId, intent }),
  archiveSession: (sessionId: string) =>
    invoke<SessionSummary>('archive_session', { sessionId }),
  saveParentAnchor: (sessionId: string, anchor: string | null) =>
    invoke<BooleanResult>('save_parent_anchor', { sessionId, anchor }),

  listCards: (status?: string) =>
    invoke<CardSummary[]>('list_cards', status ? { status } : {}),
  card: (cardId: string) => invoke<CardDetail>('get_card', { cardId }),
  createCardDraft: (input: CardDraftInput) =>
    invoke<CardDetail>('create_card_draft', { input }),
  updateCard: (cardId: string, input: CardRevisionInput) =>
    invoke<CardUpdateResult>('update_card', { cardId, input }),
  acceptCard: (cardId: string) => invoke<CardDetail>('accept_card', { cardId }),
  resolveCardRevision: (cardId: string, decision: 'keep' | 'reset') =>
    invoke<CardDetail>('resolve_card_revision', { cardId, decision }),
  pauseCard: (cardId: string, reason?: string) =>
    invoke<CardDetail>('pause_card', { cardId, reason }),
  archiveCard: (cardId: string) => invoke<CardDetail>('archive_card', { cardId }),

  queuePreview: () => invoke<QueuePreview>('queue_preview'),
  nextTask: () => invoke<TaskOutcome>('next_task'),
  getTask: (attemptId: string) => invoke<Task | null>('get_task', { attemptId }),
  abandonAttempt: (attemptId: string) =>
    invoke<BooleanResult>('abandon_attempt', { attemptId }),

  submitAnswer: (attemptId: string, answer: string, latencyMs: number | null, cloudAck: boolean) =>
    invoke<AttemptView>('submit_answer', {
      input: { attemptId, answer, latencyMs, cloudAck },
    }),
  retryGrade: (attemptId: string, cloudAck: boolean) =>
    invoke<AttemptView>('retry_grade', { attemptId, cloudAck }),
  switchToSelf: (attemptId: string) =>
    invoke<AttemptView>('switch_to_self', { attemptId }),
  requestHint: (attemptId: string) =>
    invoke<string | null>('request_hint', { attemptId }),
  practiceAnswer: (attemptId: string, answer: string) =>
    invoke<AttemptView>('practice_answer', { attemptId, answer }),
  raiseObjection: (attemptId: string, reason: string) =>
    invoke<BooleanResult>('raise_objection', { attemptId, reason }),
  confirmReview: (input: ConfirmReviewInput) =>
    invoke<ReviewResult>('confirm_review', { input }),
  reviewHistory: (days = 30) => invoke<DayCount[]>('review_history', { days }),

  generateCardDraft: (sessionId: string, cloudAck: boolean, chunkId?: string | null, conceptName?: string | null) =>
    invoke<CardGenerationResult>('generate_card_draft', {
      input: { sessionId, chunkId, conceptName, cloudAck },
    }),
  sendMessage: (sessionId: string, text: string, cloudAck: boolean) =>
    invoke<ChatStartResult>('send_message', { sessionId, text, cloudAck }),

  exportTsv: (path: string) => invoke<ExportResult>('export_tsv', { path }),
  exportJson: (path: string) => invoke<ExportResult>('export_json', { path }),
  backupDatabase: (path: string) =>
    invoke<ExportResult>('backup_database', { path }),
  revealDataDir: () => invoke<BooleanResult>('reveal_data_dir'),

  setWindowMode: (mode: string) => invoke<void>('set_window_mode', { mode }),
  hideWindow: () => invoke<void>('hide_window'),
  quitApp: () => invoke<void>('quit_app'),
  setPinned: (pinned: boolean) => invoke<BooleanResult>('set_pinned', { pinned }),
  uiReady: (mode: string) => invoke<void>('ui_ready', { mode }),
};

export type { ConfirmReviewInput };
export type { BlockedConcept, ChunkInput, DayCount, ExportResult, TaskOutcome };
