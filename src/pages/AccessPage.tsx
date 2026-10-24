import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BRAND } from '@/config/brand';
import { QUOTA } from '@/config/campaign';
import { ApiError, api } from '@/lib/api';
import { generateRequestId } from '@/lib/url';
import { clearDraft, clearSession, saveDraft, saveSession } from '@/lib/storage';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ArcDecor, LogoMark } from '@/components/Brand';
import { isSupabaseConfigured } from '@/lib/env';

type FormState =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'error'; title: string; body: string; retryable: boolean };

const ERROR_MAP: Record<string, { title: string; body: string }> = {
  invalid_code: { title: QUOTA.invalidTitle, body: QUOTA.invalidBody },
  inactive_code: { title: QUOTA.inactiveTitle, body: QUOTA.inactiveBody },
  exhausted: { title: QUOTA.exhaustedTitle, body: QUOTA.exhaustedBody },
  rate_limited: { title: QUOTA.rateLimitedTitle, body: QUOTA.rateLimitedBody },
  network: { title: QUOTA.networkTitle, body: QUOTA.networkBody },
  timeout: { title: QUOTA.networkTitle, body: QUOTA.networkBody },
  not_configured: { title: '后端尚未配置', body: QUOTA.fallbackBody },
};

export function AccessPage() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [state, setState] = useState<FormState>({ kind: 'idle' });
  const [requestId] = useState(() => generateRequestId());
  const inputRef = useRef<HTMLInputElement>(null);
  const configured = isSupabaseConfigured();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (state.kind === 'busy') return;
    const trimmed = code.trim();
    if (!trimmed) {
      setState({ kind: 'error', title: '请输入密码', body: '密码不能为空。', retryable: false });
      inputRef.current?.focus();
      return;
    }

    setState({ kind: 'busy' });
    // The password only ever travels over TLS to our own Edge Function.
    clearSession();
    clearDraft();

    try {
      const result = await api.startTest({ code: trimmed, requestId });
      saveSession({
        sessionId: result.sessionId,
        accessToken: result.accessToken,
        usedCount: result.usedCount,
        maxUses: result.maxUses,
        remaining: result.remaining,
        startedAt: result.startedAt,
      });
      saveDraft({
        sessionId: result.sessionId,
        accessToken: result.accessToken,
        remaining: result.remaining,
        usedCount: result.usedCount,
        maxUses: result.maxUses,
        startedAt: result.startedAt,
        answers: {},
        index: 0,
      });
      navigate('/intro', { replace: true });
    } catch (error) {
      const apiError = error instanceof ApiError ? error : null;
      const code_ = apiError?.code ?? 'server_error';
      const mapped = ERROR_MAP[code_] ?? { title: '验证失败', body: QUOTA.fallbackBody };
      setState({
        kind: 'error',
        title: mapped.title,
        body: mapped.body,
        retryable: code_ !== 'exhausted' && code_ !== 'inactive_code',
      });
      inputRef.current?.select();
    }
  }

  return (
    <div className="relative flex min-h-[100dvh] flex-col items-center justify-center px-5 py-10">
      <ArcDecor className="pointer-events-none absolute -right-24 -top-24 size-[380px] text-orange/20" />
      <ArcDecor className="pointer-events-none absolute -bottom-32 -left-24 size-[320px] rotate-[30deg] text-brown/15" />

      <div className="animate-rise w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <LogoMark size={54} />
          <h1 className="mt-5 font-serif text-[28px] font-semibold tracking-[0.12em] text-ink">
            {BRAND.name}
          </h1>
          <p className="mt-2 text-[13px] tracking-[0.32em] text-brown-muted">{BRAND.englishName}</p>
          <p className="mt-5 text-balance font-serif text-[15px] leading-relaxed text-brown-soft">
            {BRAND.theme}
          </p>
        </div>

        <Card className="p-5 sm:p-6">
          <form onSubmit={onSubmit} noValidate className="space-y-4">
            <div>
              <label htmlFor="code" className="mb-2 block text-[13px] font-medium tracking-wide text-brown-soft">
                输入你购买的测试密码
              </label>
              <input
                ref={inputRef}
                id="code"
                name="code"
                type="password"
                autoComplete="one-time-code"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="go"
                inputMode="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                aria-invalid={state.kind === 'error'}
                aria-describedby={state.kind === 'error' ? 'access-error' : 'access-hint'}
                placeholder="请输入密码"
                className="w-full rounded-2xl border border-line bg-cream/70 px-4 py-3.5 text-base tracking-[0.18em] text-ink outline-none transition-colors placeholder:tracking-normal placeholder:text-brown-muted/70 focus:border-orange focus:bg-card"
              />
            </div>

            <p id="access-hint" className="text-[12px] leading-relaxed text-brown-muted">
              {BRAND.paymentNotice}
            </p>

            {state.kind === 'error' ? (
              <div
                id="access-error"
                role="alert"
                className="animate-fade rounded-2xl border border-[#B5565A]/25 bg-[#fbeeed] px-4 py-3"
              >
                <p className="text-[14px] font-medium text-[#8f4347]">{state.title}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-[#a05a5e]">{state.body}</p>
              </div>
            ) : null}

            <Button
              type="submit"
              size="lg"
              block
              loading={state.kind === 'busy'}
              disabled={!configured || state.kind === 'busy'}
            >
              {state.kind === 'busy' ? '正在验证…' : '开始测评'}
            </Button>
          </form>
        </Card>

        {!configured ? (
          <p className="mt-4 rounded-2xl border border-line bg-orange-wash/60 px-4 py-3 text-center text-[12px] leading-relaxed text-[#9a5a24]">
            前端环境变量尚未配置（VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY），
            请先按 README 完成 Supabase 与部署配置。
          </p>
        ) : (
          <p className="mt-4 text-center text-[12px] text-brown-muted">
            每次输入密码会消耗 1 次测评额度（共 3 次）。
          </p>
        )}

        <p className="mt-6 text-center text-[11px] leading-relaxed text-brown-muted/80">
          {BRAND.disclaimer}
        </p>
      </div>
    </div>
  );
}