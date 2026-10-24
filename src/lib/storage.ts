import { generateRequestId } from './url';

/**
 * Local persistence for in-progress answering.
 *
 * IMPORTANT: localStorage can never be used to bypass the quota — the server
 * owns credit accounting. Anything stored here is a convenience only and is
 * re-validated by the Edge Function before any result is produced.
 */

const DRAFT_KEY = 'lcs.draft.v1';
const ADMIN_KEY = 'lcs.admin.v1';

export interface StoredSession {
  sessionId: string;
  accessToken: string;
  usedCount: number;
  maxUses: number;
  remaining: number;
  startedAt: string;
}

export interface DraftAnswers {
  [questionId: string]: string;
}

interface DraftRecord {
  sessionId: string;
  accessToken: string;
  remaining: number;
  usedCount: number;
  maxUses: number;
  startedAt: string;
  answers: DraftAnswers;
  index: number;
  updatedAt: number;
}

function safeLocal(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function safeSession(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function loadDraft(): DraftRecord | null {
  const store = safeLocal();
  if (!store) return null;
  try {
    const raw = store.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DraftRecord;
    if (!parsed?.sessionId || !parsed?.accessToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveDraft(record: Omit<DraftRecord, 'updatedAt'>): void {
  const store = safeLocal();
  if (!store) return;
  try {
    store.setItem(DRAFT_KEY, JSON.stringify({ ...record, updatedAt: Date.now() }));
  } catch {
    /* quota exceeded — ignore, the quiz still works in memory */
  }
}

export function clearDraft(): void {
  const store = safeLocal();
  store?.removeItem(DRAFT_KEY);
}

/** Access token for the current session, survives a refresh within the tab. */
export function loadSession(): StoredSession | null {
  const store = safeSession() ?? safeLocal();
  if (!store) return null;
  try {
    const raw = store.getItem('lcs.session.v1');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed?.sessionId || !parsed?.accessToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSession(session: StoredSession): void {
  const store = safeSession() ?? safeLocal();
  try {
    store?.setItem('lcs.session.v1', JSON.stringify(session));
  } catch {
    /* ignore */
  }
}

export function clearSession(): void {
  safeSession()?.removeItem('lcs.session.v1');
  safeLocal()?.removeItem('lcs.session.v1');
}

export interface AdminSession {
  token: string;
  username: string;
  expiresAt: string;
}

export function loadAdminSession(): AdminSession | null {
  const store = safeSession();
  if (!store) return null;
  try {
    const raw = store.getItem(ADMIN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AdminSession;
    if (!parsed?.token || new Date(parsed.expiresAt).getTime() <= Date.now()) {
      store.removeItem(ADMIN_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveAdminSession(session: AdminSession): void {
  safeSession()?.setItem(ADMIN_KEY, JSON.stringify(session));
}

export function clearAdminSession(): void {
  safeSession()?.removeItem(ADMIN_KEY);
}

export { generateRequestId };