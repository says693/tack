use serde::{Deserialize, Serialize};
use serde_json::Value;

fn is_false(v: &bool) -> bool {
    !*v
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceSummary {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub origin: String,
    pub trust_tier: i64,
    pub revision_count: i64,
    pub current_revision_no: i64,
    pub chunk_count: i64,
    pub created_at: String,
    pub last_read_at: Option<String>,
    pub archived: bool,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionSummary {
    pub id: String,
    pub revision_no: i64,
    pub label: Option<String>,
    pub created_at: String,
    pub content_hash: String,
    pub char_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceRevision {
    pub id: String,
    pub source_id: String,
    pub revision_no: i64,
    pub content: String,
    pub content_hash: String,
    pub label: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceDetail {
    pub source: SourceSummary,
    pub revision: SourceRevision,
    pub revisions: Vec<RevisionSummary>,
    pub chunks: Vec<ChunkView>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkView {
    pub id: String,
    pub source_id: String,
    pub revision_id: String,
    pub ordinal: i64,
    pub heading: Option<String>,
    pub locator: Option<String>,
    pub quote_exact: String,
    pub prefix: String,
    pub suffix: String,
    pub start_utf16: i64,
    pub end_utf16: i64,
    pub session_count: i64,
    pub card_count: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkInput {
    pub source_id: String,
    pub revision_id: String,
    pub quote_exact: String,
    pub prefix: String,
    pub suffix: String,
    pub start_utf16: i64,
    pub end_utf16: i64,
    pub heading: Option<String>,
    pub locator: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    pub parent_id: Option<String>,
    pub seed_name: String,
    pub kind: String,
    pub intent: String,
    pub depth: i64,
    pub fork_chunk_id: Option<String>,
    pub fork_message_id: Option<String>,
    pub fork_exact: Option<String>,
    pub parent_anchor: Option<String>,
    pub concept_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub archived: bool,
    pub message_count: i64,
    pub last_message: Option<String>,
    pub fork_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageView {
    pub id: String,
    pub session_id: String,
    pub ordinal: i64,
    pub role: String,
    pub content: String,
    pub status: String,
    pub error: Option<String>,
    pub cites: Vec<String>,
    pub meta: Value,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDetail {
    pub session: SessionSummary,
    pub messages: Vec<MessageView>,
    pub parent: Option<SessionSummary>,
    pub chunk: Option<ChunkView>,
    pub source: Option<SourceSummary>,
    pub drafts: Vec<CardSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConceptView {
    pub id: String,
    pub name: String,
    pub source_id: Option<String>,
    pub chunk_id: Option<String>,
    pub origin: String,
    pub state: String,
    pub ease: f64,
    pub interval_days: i64,
    pub reps: i64,
    pub lapses: i64,
    pub due_on: Option<String>,
    pub last_reviewed_at: Option<String>,
    pub scheduler: String,
    pub created_at: String,
    pub archived: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardRevision {
    pub id: String,
    pub card_id: String,
    pub revision_no: i64,
    pub question: String,
    pub answer: String,
    pub evidence_chunk_id: Option<String>,
    pub evidence_excerpt: String,
    pub exercise_origin: String,
    pub origin_note: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardSummary {
    pub id: String,
    pub concept_id: String,
    pub concept_name: String,
    pub kind: String,
    pub status: String,
    pub mode: String,
    pub question: String,
    pub answer_preview: String,
    pub exercise_origin: String,
    pub evidence_excerpt: String,
    pub source_id: Option<String>,
    pub source_title: Option<String>,
    pub revision_id: Option<String>,
    pub updated_at: String,
    pub due_on: Option<String>,
    pub paused_reason: Option<String>,
    pub reps: i64,
    pub lapses: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardDetail {
    pub summary: CardSummary,
    pub concept: ConceptView,
    pub revisions: Vec<CardRevision>,
    pub evidence: Option<ChunkView>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceRef {
    pub chunk_id: String,
    pub excerpt: String,
    pub source_title: Option<String>,
    pub label: Option<String>,
    pub matched: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Feedback {
    pub verdict: String,
    pub hits: Vec<String>,
    pub observed_errors: Vec<String>,
    pub missing_points: Vec<String>,
    pub hint: Option<String>,
    pub evidence: Vec<EvidenceRef>,
    pub note: Option<String>,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PracticeAnswer {
    pub answer: String,
    pub hint_used: bool,
    pub at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttemptView {
    pub id: String,
    pub concept_id: String,
    pub card_id: String,
    pub revision_id: String,
    pub first_answer: String,
    pub hint_used: bool,
    pub hint_text: Option<String>,
    pub practice_answers: Vec<PracticeAnswer>,
    pub feedback: Option<Feedback>,
    pub verdict: Option<String>,
    pub suggested_grade: Option<i64>,
    pub feedback_mode: Option<String>,
    pub ai_error: Option<String>,
    pub status: String,
    pub is_demo: bool,
    pub started_at: String,
    pub answered_at: Option<String>,
    pub latency_ms: Option<i64>,
    pub card: CardSummary,
    pub revision: CardRevision,
    pub concept: ConceptView,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueStats {
    pub due_count: i64,
    pub new_available: i64,
    pub review_served_today: i64,
    pub new_served_today: i64,
    pub review_limit: i64,
    pub new_limit: i64,
    pub review_remaining: i64,
    pub new_remaining: i64,
    pub completed_today: i64,
    pub backlog: i64,
    pub blocked_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockedConcept {
    pub concept_id: String,
    pub name: String,
    pub reason: String,
    pub due_on: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub assignment_id: String,
    pub kind: String,
    pub due_on: Option<String>,
    pub attempt: AttemptView,
    pub stats: QueueStats,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskOutcome {
    pub task: Option<Task>,
    pub blocked: Vec<BlockedConcept>,
    pub stats: QueueStats,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DayCount {
    pub date: String,
    pub label: String,
    pub reviews: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    pub local_date: String,
    pub timezone: String,
    pub due_count: i64,
    pub new_available: i64,
    pub completed_today: i64,
    pub review_served_today: i64,
    pub new_served_today: i64,
    pub review_limit: i64,
    pub new_limit: i64,
    pub backlog: i64,
    pub blocked_count: i64,
    pub drafts: i64,
    pub active_cards: i64,
    pub total_concepts: i64,
    pub streak_days: i64,
    pub last7: Vec<DayCount>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    pub configured: bool,
    pub provider: String,
    pub model: String,
    pub base_url: String,
    pub has_api_key: bool,
    pub last_test_at: Option<String>,
    pub last_test_ok: Option<bool>,
    pub last_test_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudySettings {
    pub daily_new: i64,
    pub daily_review: i64,
    pub timezone: String,
    pub theme: String,
    pub capsule_metric: String,
    pub cloud_notice_seen: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bootstrap {
    pub app_version: String,
    pub platform: String,
    pub data_dir: String,
    pub is_first_run: bool,
    #[serde(default)]
    pub guided_ready: bool,
    pub model: ModelStatus,
    pub settings: StudySettings,
    pub overview: Overview,
    pub sources: Vec<SourceSummary>,
    pub sessions: Vec<SessionSummary>,
    pub sample_loaded: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewResult {
    pub review_id: String,
    pub attempt_id: String,
    pub concept_id: String,
    pub grade: i64,
    pub mode: String,
    pub interval_days: i64,
    pub due_on: String,
    pub state: String,
    pub next_due_label: String,
    pub already_existed: bool,
    pub overview: Overview,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub path: String,
    pub rows: i64,
    pub bytes: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardUpdateResult {
    pub card: CardDetail,
    pub semantic_change: bool,
    pub needs_schedule_decision: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardDraftInput {
    pub concept_name: String,
    pub question: String,
    pub answer: String,
    pub evidence_chunk_id: Option<String>,
    pub evidence_excerpt: String,
    pub exercise_origin: String,
    pub origin_note: Option<String>,
    pub mode: String,
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardRevisionInput {
    pub question: String,
    pub answer: String,
    pub evidence_chunk_id: Option<String>,
    pub evidence_excerpt: String,
    pub exercise_origin: String,
    pub origin_note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelConfigInput {
    pub provider: String,
    pub base_url: String,
    pub model: String,
    pub api_key: Option<String>,
    pub temperature: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudySettingsInput {
    pub daily_new: i64,
    pub daily_review: i64,
    pub timezone: String,
    pub capsule_metric: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestModelResult {
    pub ok: bool,
    pub latency_ms: i64,
    pub message: String,
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatStartResult {
    pub user_message: MessageView,
    pub assistant_message: MessageView,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmDeltaPayload {
    pub session_id: String,
    pub message_id: String,
    pub delta: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmDonePayload {
    pub session_id: String,
    pub message_id: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmErrorPayload {
    pub session_id: String,
    pub message_id: String,
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardGenerationInput {
    pub session_id: String,
    pub chunk_id: Option<String>,
    pub concept_name: Option<String>,
    pub cloud_ack: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitAnswerInput {
    pub attempt_id: String,
    pub answer: String,
    pub latency_ms: Option<i64>,
    pub cloud_ack: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmReviewInput {
    pub attempt_id: String,
    pub grade: i64,
    pub idempotency_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCreateInput {
    pub chunk_id: Option<String>,
    pub parent_id: Option<String>,
    pub fork_message_id: Option<String>,
    pub name: Option<String>,
    pub intent: Option<String>,
    pub kind: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSourceInput {
    pub title: String,
    pub kind: String,
    pub text: String,
    pub label: Option<String>,
    pub origin: Option<String>,
    pub note: Option<String>,
    pub replace_source_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceAnnotation {
    pub chunk_id: String,
    pub quote_exact: String,
    pub heading: Option<String>,
    pub locator: Option<String>,
    pub start_utf16: i64,
    pub end_utf16: i64,
    pub session_id: Option<String>,
    pub session_name: Option<String>,
    pub card_id: Option<String>,
    pub card_question: Option<String>,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    pub model: ModelStatus,
    pub study: StudySettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardGenerationResult {
    pub draft: CardDetail,
    pub evidence: EvidenceRef,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuePreview {
    pub stats: QueueStats,
    pub due: Vec<CardSummary>,
    pub new: Vec<CardSummary>,
    pub blocked: Vec<BlockedConcept>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BooleanResult {
    pub ok: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub changed: bool,
}
