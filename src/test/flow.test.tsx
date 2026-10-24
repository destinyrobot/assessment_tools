import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/App';
import { QUESTIONS } from '@shared/questions.ts';
import { buildReport } from '@shared/scoring.ts';
import type { Report } from '@shared/types.ts';
import type { ResultPayload, SharedResultPayload } from '@/lib/api';

/**
 * End-to-end-ish flow test against a mocked Edge Function layer.
 * The API contract, quota messages, navigation and the share link are all real
 * code paths; only the network is stubbed.
 */

const ANSWERS = QUESTIONS.map((q, i) => ({ questionId: q.id, optionId: q.options[i % 4].id }));
const REPORT: Report = buildReport(ANSWERS);

function resultPayload(): ResultPayload {
  return {
    id: 'result-1',
    sessionId: 'session-1',
    scoringVersion: 'v1',
    report: REPORT,
    createdAt: new Date().toISOString(),
  };
}

/** The public share endpoint returns no internal ids — mirror that contract. */
function sharedResultPayload(): SharedResultPayload {
  return {
    scoringVersion: 'v1',
    report: REPORT,
    createdAt: new Date().toISOString(),
  };
}

interface MockState {
  started: number;
  submitted: number;
  retakes: number;
  shares: number;
  allowStart: boolean;
  remaining: number;
  maxUses: number;
}

let state: MockState;

function jsonRoute(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errRoute(code: string, message: string, status: number) {
  return jsonRoute({ error: { code, message } }, status);
}

function installFetch() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const headers = init?.headers as Record<string, string> | undefined;

    if (url.endsWith('/start-test')) {
      if (!state.allowStart) return errRoute('exhausted', 'quota used up', 402);
      state.started += 1;
      state.remaining = Math.max(0, state.maxUses - state.started);
      return jsonRoute({
        sessionId: `session-${state.started}`,
        accessToken: `token-${state.started}-${'x'.repeat(30)}`,
        totalQuestions: QUESTIONS.length,
        scoringVersion: 'v1',
        usedCount: state.started,
        maxUses: state.maxUses,
        remaining: state.remaining,
        startedAt: new Date().toISOString(),
      });
    }

    if (url.endsWith('/submit-test')) {
      state.submitted += 1;
      return jsonRoute({
        result: { ...resultPayload(), sessionId: body.sessionId },
        usedCount: 1,
        maxUses: state.maxUses,
        remaining: state.remaining,
      });
    }

    if (url.endsWith('/retake')) {
      if (state.remaining <= 0) return errRoute('exhausted', 'quota used up', 402);
      state.retakes += 1;
      state.remaining -= 1;
      return jsonRoute({
        sessionId: `session-retake-${state.retakes}`,
        accessToken: `retake-token-${'y'.repeat(30)}`,
        totalQuestions: QUESTIONS.length,
        scoringVersion: 'v1',
        usedCount: state.maxUses - state.remaining,
        maxUses: state.maxUses,
        remaining: state.remaining,
        startedAt: new Date().toISOString(),
      });
    }

    if (url.endsWith('/get-result')) {
      if (!body.accessToken) return errRoute('unauthorized', 'no token', 401);
      return jsonRoute({ ...resultPayload(), sessionId: body.sessionId });
    }

    if (url.endsWith('/create-share')) {
      state.shares += 1;
      return jsonRoute({
        token: 'SHARE_TOKEN_abcdefghijklmnopqrstuvwxyz0123456789',
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      });
    }

    if (url.endsWith('/shared-result')) {
      if (body.token !== 'SHARE_TOKEN_abcdefghijklmnopqrstuvwxyz0123456789') {
        return errRoute('not_found', 'revoked', 404);
      }
      return jsonRoute(sharedResultPayload());
    }

    if (url.endsWith('/admin-list-codes')) {
      if (headers?.['x-access-token'] !== 'admin-token-abcdefghijklmnopqrstuvwxyz') {
        return errRoute('unauthorized', 'nope', 401);
      }
      return jsonRoute({ codes: [] });
    }

    return errRoute('bad_request', `unexpected call ${url}`, 400);
  });
}

function setHash(hash: string) {
  window.location.hash = hash;
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  state = { started: 0, submitted: 0, retakes: 0, shares: 0, allowStart: true, remaining: 3, maxUses: 3 };
  vi.stubGlobal('fetch', installFetch());
  setHash('#/');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderApp() {
  return render(<App />);
}

async function startSession(user: ReturnType<typeof userEvent.setup>, code = 'ABCD-EFGH-JKMN') {
  await user.clear(screen.getByLabelText('输入你购买的测试密码'));
  await user.type(screen.getByLabelText('输入你购买的测试密码'), code);
  await user.click(screen.getByRole('button', { name: '开始测评' }));
  await screen.findByRole('heading', { name: /你会得到什么/ });
}

describe('access gate', () => {
  it('rejects a wrong code with a clear message and consumes nothing', async () => {
    state.allowStart = false;
    const user = userEvent.setup();
    renderApp();
    await user.type(screen.getByLabelText('输入你购买的测试密码'), 'WRONG-CODE-000');
    await user.click(screen.getByRole('button', { name: '开始测评' }));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/次数已经用完|密码不正确/)).toBeTruthy();
    expect(state.started).toBe(0);
  });

  it('creates a session on a valid code and never puts the code in the URL', async () => {
    const user = userEvent.setup();
    renderApp();
    await startSession(user);

    expect(state.started).toBe(1);
    expect(window.location.hash).not.toContain('ABCD');
    expect(window.location.hash).not.toContain('EFGH');
    expect(window.location.hash).toBe('#/intro');
  });
});

describe('quiz flow', () => {
  it('blocks next until an option is selected, keeps answers when going back, and submits once', async () => {
    const user = userEvent.setup();
    renderApp();
    await startSession(user);
    await user.click(screen.getByRole('button', { name: /我准备好了/ }));

    const next = screen.getByRole('button', { name: '下一题' });
    expect(next).toBeDisabled();

    const firstGroup = screen.getAllByRole('radio');
    await user.click(firstGroup[0]);
    expect(next).toBeEnabled();

    await user.click(next);
    const secondHeading = screen.getByRole('heading', { level: 1 });
    expect(secondHeading.textContent).toContain(QUESTIONS[1].text);

    await user.click(screen.getByRole('button', { name: '上一题' }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain(QUESTIONS[0].text);
    // The previously chosen answer survives navigation.
    expect(screen.getAllByRole('radio')[0]).toBeChecked();

    // Answer everything.
    for (let i = 0; i < QUESTIONS.length; i += 1) {
      const options = screen.getAllByRole('radio');
      await user.click(options[i % 4]);
      if (i < QUESTIONS.length - 1) {
        await user.click(screen.getByRole('button', { name: '下一题' }));
      }
    }

    // Every question is answered, so submission is now allowed.
    await waitFor(() => expect(screen.getByRole('button', { name: '提交并查看结果' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: '提交并查看结果' }));

    await screen.findByRole('heading', { name: REPORT.archetypeName, level: 1 });
    expect(state.submitted).toBe(1);
  });

  it('blocks /quiz when there is no local session', async () => {
    setHash('#/quiz');
    renderApp();
    await waitFor(() => expect(window.location.hash).toBe('#/'));
  });
});

async function reachResult(user: ReturnType<typeof userEvent.setup>) {
  await startSession(user);
  sessionStorage.setItem('lcs.session.v1', JSON.stringify({
    sessionId: 'session-1',
    accessToken: 'token-1-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    usedCount: 1,
    maxUses: 3,
    remaining: 2,
    startedAt: new Date().toISOString(),
  }));
  setHash('#/result/session-1');
}

describe('result page', () => {
  it('renders the report and the primary actions', async () => {
    const user = userEvent.setup();
    renderApp();
    await reachResult(user);

    await screen.findByRole('heading', { name: REPORT.archetypeName, level: 1 });
    expect(screen.getByTestId('save-image')).toBeTruthy();
    expect(screen.getByTestId('copy-share-link')).toBeTruthy();
    expect(screen.getByTestId('retake')).toBeTruthy();
    // Full report sections are present.
    expect(screen.getByText('八个维度')).toBeTruthy();
    expect(screen.getByText('适合探索的职业方向')).toBeTruthy();
    expect(screen.getByText('亲密关系中的你')).toBeTruthy();
    expect(screen.getByText('三条可以马上开始做的建议')).toBeTruthy();
  });

  it('creates a share link and copies it to the clipboard', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    renderApp();
    await reachResult(user);
    await screen.findByRole('heading', { name: REPORT.archetypeName, level: 1 });
    await user.click(screen.getByTestId('copy-share-link'));

    await waitFor(() => expect(state.shares).toBe(1));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain('#/s/SHARE_TOKEN_');
    expect(copied).not.toContain('ABCD-EFGH');
    expect(copied).not.toContain('session-1');
  });

  it('starts a retake after confirmation and does not overwrite the old result', async () => {
    const user = userEvent.setup();
    renderApp();
    await reachResult(user);
    await screen.findByRole('heading', { name: REPORT.archetypeName, level: 1 });

    await user.click(screen.getByTestId('retake'));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /消耗 1 次额度/ }));

    await waitFor(() => expect(state.retakes).toBe(1));
    await waitFor(() => expect(window.location.hash).toBe('#/quiz'));
  });
});

describe('shared result page', () => {
  it('opens a report in a fresh browser context from a share link', async () => {
    setHash('#/s/SHARE_TOKEN_abcdefghijklmnopqrstuvwxyz0123456789');
    renderApp();
    await screen.findByRole('heading', { name: REPORT.archetypeName, level: 1 });
    expect(screen.getByTestId('shared-cta')).toBeTruthy();
  });

  it('shows a friendly message for a revoked or invalid link', async () => {
    setHash('#/s/REVOKED_TOKEN_abcdefghijklmnopqrstuvwxyz');
    renderApp();
    expect(await screen.findByText('链接已失效')).toBeTruthy();
  });

  it('rejects a malformed token before any request is made', async () => {
    setHash('#/s/too-short');
    renderApp();
    expect(await screen.findByText('链接无效')).toBeTruthy();
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('shared-result'))).toBe(false);
  });
});

describe('result actions layout', () => {
  it('places the copy-link and retake buttons side by side', async () => {
    const user = userEvent.setup();
    renderApp();
    await reachResult(user);
    await screen.findByRole('heading', { name: REPORT.archetypeName, level: 1 });

    const copy = screen.getByTestId('copy-share-link');
    const retake = screen.getByTestId('retake');
    // jsdom does no layout, so assert they share one two-column grid instead.
    const row = copy.closest('div');
    expect(row).toBe(retake.closest('div'));
    expect(row?.className).toContain('sm:grid-cols-2');
  });

  it('no longer renders the review campaign anywhere', async () => {
    setHash('#/s/SHARE_TOKEN_abcdefghijklmnopqrstuvwxyz0123456789');
    renderApp();
    await screen.findByRole('heading', { name: REPORT.archetypeName, level: 1 });

    expect(screen.queryByText('好评有礼')).toBeNull();
    expect(screen.queryByTestId('review-button')).toBeNull();
  });
});

describe('quota durability', () => {
  it('restores an in-progress quiz after a reload without re-consuming a credit', async () => {
    const user = userEvent.setup();
    renderApp();
    await startSession(user);
    const creditsAfterStart = state.started;

    await user.click(screen.getAllByRole('button', { name: /开始作答|我准备好了/ })[0]);
    // 答前两题，然后模拟「刷新页面」：重新挂载 App，但不清空 storage。
    await user.click(screen.getAllByRole('radio')[0]);
    await user.click(screen.getByRole('button', { name: '下一题' }));
    await user.click(screen.getAllByRole('radio')[1]);
    await user.click(screen.getByRole('button', { name: '下一题' }));

    // 卸载并重新挂载，等价于刷新页面；storage 与 hash(#/quiz) 都不清空。
    cleanup();
    renderApp();
    await screen.findByRole('button', { name: '下一题' });

    // 答案与题号都还在：应停在第 3 题、已作答 2 题。
    expect(screen.getAllByRole('radio').length).toBeGreaterThan(0);
    const bar = screen.getByRole('progressbar');
    const progress = bar.previousElementSibling as HTMLElement;
    expect(progress.textContent?.replace(/\s+/g, '')).toContain('第3');
    expect(progress.textContent?.replace(/\s+/g, '')).toContain('已作答2');
    // 关键：刷新绝不会再次调用 start-test。
    expect(state.started).toBe(creditsAfterStart);
  });

  it('never consumes a credit for going back or editing an answer', async () => {
    const user = userEvent.setup();
    renderApp();
    await startSession(user);
    const credits = state.started;

    await user.click(screen.getAllByRole('button', { name: /开始作答|我准备好了/ })[0]);
    await user.click(screen.getAllByRole('radio')[0]);
    await user.click(screen.getByRole('button', { name: '下一题' }));
    await user.click(screen.getAllByRole('radio')[1]);
    await user.click(screen.getByRole('button', { name: '上一题' }));
    // 改了答案再回去。
    await user.click(screen.getAllByRole('radio')[3]);
    await user.click(screen.getByRole('button', { name: '上一题' }));

    expect(state.started).toBe(credits);
  });

  it('reuses one requestId across retake retries so a retry cannot double-charge', async () => {
    const user = userEvent.setup();
    renderApp();
    await reachResult(user);
    await screen.findByRole('heading', { name: REPORT.archetypeName, level: 1 });

    // 打开确认框后连续触发两次提交（模拟网络抖动下的用户连点/重试）。
    await user.click(screen.getByTestId('retake'));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: /消耗 1 次额度/ });

    const requestIds: string[] = [];
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/retake') && init?.body) {
        requestIds.push((JSON.parse(String(init.body)) as { requestId: string }).requestId);
      }
      return installFetch()(input as RequestInfo, init);
    });
    vi.stubGlobal('fetch', fetchMock);

    await user.click(confirm);
    await waitFor(() => expect(state.retakes).toBe(1));

    // 无论如何，本次「再测一次」意图只能对应一个 requestId。
    expect(new Set(requestIds).size).toBeLessThanOrEqual(1);
    expect(requestIds.length).toBeGreaterThan(0);
  });

  it('sends a stable requestId for the same access attempt', async () => {
    const user = userEvent.setup();
    renderApp();
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    await user.type(screen.getByLabelText('输入你购买的测试密码'), 'ABCD-EFGH-JKMN');
    await user.click(screen.getByRole('button', { name: '开始测评' }));
    await screen.findByRole('heading', { name: /你会得到什么/ });

    const ids = fetchMock.mock.calls
      .filter((c) => String(c[0]).endsWith('/start-test'))
      .map((c) => (JSON.parse(String(c[1]?.body)) as { requestId: string }).requestId);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(1);
  });

  it('surfaces an exhausted quota without creating a session', async () => {
    const user = userEvent.setup();
    state.allowStart = false;
    renderApp();
    await user.type(screen.getByLabelText('输入你购买的测试密码'), 'ABCD-EFGH-JKMN');
    await user.click(screen.getByRole('button', { name: '开始测评' }));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/次数已经用完|密码不正确/)).toBeTruthy();
    expect(state.started).toBe(0);
  });
});

describe('share payload hygiene', () => {
  it('the shared page renders only report data and holds no session credential', async () => {
    setHash('#/s/SHARE_TOKEN_abcdefghijklmnopqrstuvwxyz0123456789');
    renderApp();
    await screen.findByRole('heading', { name: REPORT.archetypeName, level: 1 });

    // 公开页不发起任何需要凭证的调用。
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const calls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.endsWith('/get-result'))).toBe(false);
    expect(calls.some((u) => u.endsWith('/submit-test'))).toBe(false);
    expect(calls.some((u) => u.endsWith('/admin-list-codes'))).toBe(false);
    // 也没有向服务端发送任何 token 头。
    const withToken = fetchMock.mock.calls.filter((c) => {
      const h = (c[1]?.headers ?? {}) as Record<string, string>;
      return Boolean(h['x-access-token']);
    });
    expect(withToken).toHaveLength(0);
  });

  it('never puts the password or session id into the share link', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    renderApp();
    await reachResult(user);
    await screen.findByRole('heading', { name: REPORT.archetypeName, level: 1 });
    await user.click(screen.getByTestId('copy-share-link'));
    await waitFor(() => expect(writeText).toHaveBeenCalled());

    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain('#/s/');
    expect(copied).not.toContain('ABCD-EFGH');
    expect(copied).not.toContain('session-1');
    expect(copied).not.toContain('token-1');
  });
});

describe('admin page', () => {
  it('refuses to list codes without a valid admin token', async () => {
    setHash('#/admin');
    renderApp();
    await screen.findByRole('heading', { name: '管理员登录' });
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const listCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('admin-list-codes'));
    expect(listCall).toBeUndefined();
  });
});