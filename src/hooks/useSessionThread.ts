import { useCallback, useEffect, useState } from 'react';

import { api } from '@/lib/api';
import { listen } from '@/lib/bridge';
import { useApp } from '@/store';
import type { MessageView, SessionDetail } from '@/types';

interface DeltaPayload {
  sessionId: string;
  messageId: string;
  delta: string;
}
interface DonePayload {
  sessionId: string;
  messageId: string;
  content: string;
}
interface ErrorPayload {
  sessionId: string;
  messageId: string;
  code: string;
  message: string;
}

function appendUnique(messages: MessageView[], next: MessageView[]): MessageView[] {
  const known = new Set(messages.map((message) => message.id));
  return [...messages, ...next.filter((message) => !known.has(message.id))];
}

export function useSessionThread(sessionId: string) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await api.session(sessionId);
      setDetail(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : '会话没有打开。');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let disposed = false;
    const disposers: Array<() => void> = [];

    async function subscribe() {
      const offDelta = await listen<DeltaPayload>('llm:delta', (event) => {
        const payload = event.payload;
        if (payload.sessionId !== sessionId) return;
        setDetail((previous) => {
          if (!previous) return previous;
          return {
            ...previous,
            messages: previous.messages.map((message) =>
              message.id === payload.messageId
                ? { ...message, content: message.content + payload.delta, status: 'streaming' }
                : message,
            ),
          };
        });
      });

      const offDone = await listen<DonePayload>('llm:done', (event) => {
        const payload = event.payload;
        if (payload.sessionId !== sessionId) return;
        setDetail((previous) => {
          if (!previous) return previous;
          return {
            ...previous,
            messages: previous.messages.map((message) =>
              message.id === payload.messageId
                ? { ...message, content: payload.content, status: 'complete' }
                : message,
            ),
          };
        });
      });

      const offError = await listen<ErrorPayload>('llm:error', (event) => {
        const payload = event.payload;
        if (payload.sessionId !== sessionId) return;
        setDetail((previous) => {
          if (!previous) return previous;
          return {
            ...previous,
            messages: previous.messages.map((message) =>
              message.id === payload.messageId
                ? { ...message, status: 'failed', error: payload.message }
                : message,
            ),
          };
        });
        useApp.getState().toast('error', '回复中断', payload.message);
      });

      if (disposed) {
        offDelta();
        offDone();
        offError();
        return;
      }
      disposers.push(offDelta, offDone, offError);
    }

    void subscribe();
    return () => {
      disposed = true;
      for (const dispose of disposers) dispose();
    };
  }, [sessionId]);

  const send = useCallback(
    async (text: string): Promise<boolean> => {
      const trimmed = text.trim();
      if (!trimmed || sending) return false;
      setSending(true);
      try {
        const result = await useApp.getState().withCloud((ack) => api.sendMessage(sessionId, trimmed, ack));
        setDetail((previous) => {
          if (!previous) return previous;
          return {
            ...previous,
            session: {
              ...previous.session,
              messageCount: previous.session.messageCount + 2,
              updatedAt: new Date().toISOString(),
            },
            messages: appendUnique(previous.messages, [result.userMessage, result.assistantMessage]),
          };
        });
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : '消息没有发出去。';
        useApp.getState().toast('error', '消息没有发出去', message);
        return false;
      } finally {
        setSending(false);
      }
    },
    [sending, sessionId],
  );

  const patchSession = useCallback((patch: Partial<SessionDetail['session']>) => {
    setDetail((previous) =>
      previous ? { ...previous, session: { ...previous.session, ...patch } } : previous,
    );
  }, []);

  return { detail, setDetail, loading, error, refresh, send, sending, patchSession };
}
