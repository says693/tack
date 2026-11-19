import { invoke, isTauri } from '@/lib/bridge';

export interface GuidedSource {
  id: string;
  title: string;
  publisher: string;
  url: string;
  license: string;
  scope: string;
  text: string;
}

export interface GuidedSourceProof {
  label: string;
  excerpt: string;
  url?: string;
  material?: string;
}

interface GuidedProgress {
  lesson: { id: string; title: string; topic: string; overview?: string };
  current: number;
  total: number;
}

export type GuidedRun = GuidedProgress & (
  | { stage: 'read'; cardId: string; explanation: string; example: string; source?: GuidedSourceProof }
  | { stage: 'question'; attemptId: string; prompt: string; draft?: string }
  | { stage: 'compare'; attemptId: string; prompt: string; answer: string | null; referenceAnswer: string; correction?: string; source?: GuidedSourceProof }
  | { stage: 'done'; completed: number; nextDueLabel?: string; reviewAvailable: boolean }
);

export interface GuidedStatus {
  modelConfigured: boolean;
  run: GuidedRun | null;
}

export interface GuidedGenerateInput {
  topic: string;
  sourceIds: string[];
  cloudAck: true;
}

export interface GuidedStudyApi {
  status(): Promise<GuidedStatus>;
  saveKey(apiKey: string): Promise<{ balanceAvailable: boolean }>;
  findSources(topic: string): Promise<GuidedSource[]>;
  generate(input: GuidedGenerateInput): Promise<GuidedRun>;
  getRun(): Promise<GuidedRun | null>;
  startQuestion(lessonId: string, cardId: string): Promise<GuidedRun>;
  saveDraft(input: { attemptId: string; draft: string }): Promise<void>;
  submitAnswer(input: { attemptId: string; answer: string | null }): Promise<GuidedRun>;
  confirmAnswer(input: { attemptId: string; grade: 0 | 2 }): Promise<GuidedRun>;
  beginReview(lessonId: string): Promise<GuidedRun>;
}

async function mock() {
  if (import.meta.env.DEV) return (await import('@/mock/guided-study')).guidedMock;
  throw new Error('请在 Windows 客户端创建并学习课程。');
}

export const guidedStudy: GuidedStudyApi = {
  status: async () => isTauri ? invoke('guided_status') : (await mock()).status(),
  saveKey: async (apiKey) => isTauri ? invoke('guided_save_key', { apiKey }) : (await mock()).saveKey(apiKey),
  findSources: async (topic) => isTauri ? invoke('guided_find_sources', { topic }) : (await mock()).findSources(topic),
  generate: async (input) => isTauri ? invoke('guided_generate', { input }) : (await mock()).generate(input),
  getRun: async () => isTauri ? invoke('guided_get_run') : (await mock()).getRun(),
  startQuestion: async (lessonId, cardId) => isTauri ? invoke('guided_start_question', { lessonId, cardId }) : (await mock()).startQuestion(lessonId, cardId),
  saveDraft: async (input) => isTauri ? invoke('guided_save_draft', input) : (await mock()).saveDraft(input),
  submitAnswer: async (input) => isTauri ? invoke('guided_submit_answer', input) : (await mock()).submitAnswer(input),
  confirmAnswer: async (input) => isTauri ? invoke('guided_confirm_answer', input) : (await mock()).confirmAnswer(input),
  beginReview: async (lessonId) => isTauri ? invoke('guided_begin_review', { lessonId }) : (await mock()).beginReview(lessonId),
};
