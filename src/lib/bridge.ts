import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen as tauriListen, type UnlistenFn } from '@tauri-apps/api/event';

export const isTauri =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const isBrowserPreview = !isTauri;

export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri) {
    return tauriInvoke<T>(command, args);
  }
  if (!import.meta.env.DEV) throw new Error('请在折页 Windows 客户端打开。');
  const { mockInvoke } = await import('@/mock/backend');
  return mockInvoke<T>(command, args);
}

export async function listen<T>(
  event: string,
  handler: (event: { payload: T }) => void,
): Promise<UnlistenFn> {
  if (isTauri) {
    return tauriListen<T>(event, handler);
  }
  if (!import.meta.env.DEV) throw new Error('请在折页 Windows 客户端打开。');
  const { mockListen } = await import('@/mock/backend');
  return mockListen<T>(event, handler);
}

export interface NormalizedError {
  code: string;
  message: string;
}

export function normalizeError(error: unknown): NormalizedError {
  if (typeof error === 'string') {
    return { code: 'error', message: error };
  }
  if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    if (typeof obj.message === 'string') {
      return {
        code: typeof obj.code === 'string' ? obj.code : 'error',
        message: obj.message,
      };
    }
    if (typeof obj.error === 'string') {
      return { code: 'error', message: obj.error };
    }
  }
  return { code: 'unknown', message: '发生了一个未预期的错误。' };
}
