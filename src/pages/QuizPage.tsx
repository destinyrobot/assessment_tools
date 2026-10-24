import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { QUESTIONS } from '@shared/questions.ts';
import { SCORING_VERSION } from '@shared/dimensions.ts';
import { ApiError, api } from '@/lib/api';
import { clearDraft, loadDraft, saveDraft, type DraftAnswers } from '@/lib/storage';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { toast } from '@/components/ui/toast';
import { ErrorState, FullPageLoader } from '@/components/ui/States';
import { BRAND } from '@/config/brand';
import type { Answer } from '@shared/types.ts';

type Status = 'loading' | 'ready' | 'submitting' | 'error';

export function QuizPage() {
  const navigate = useNavigate();
  const draft = useMemo(() => loadDraft(), []);

  const [status, setStatus] = useState<Status>('loading');
  const [index, setIndex] = useState(draft?.index ?? 0);
  const [answers, setAnswers] = useState<DraftAnswers>(draft?.answers ?? {});
  const [submitError, setSubmitError] = useState<ApiError | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const lockRef = useRef(false);

  useEffect(() => {
    if (!draft) {
      setStatus('error');
      return;
    }
    setStatus('ready');
  }, [draft]);

  const question = QUESTIONS[index];
  const total = QUESTIONS.length;
  const answeredCount = Object.keys(answers).length;
  const selected = question ? answers[question.id] : undefined;

  const persist = useCallback(
    (nextIndex: number, nextAnswers: DraftAnswers) => {
      if (!draft) return;
      saveDraft({
        sessionId: draft.sessionId,
        accessToken: draft.accessToken,
        remaining: draft.remaining,
        usedCount: draft.usedCount,
        maxUses: draft.maxUses,
        startedAt: draft.startedAt,
        answers: nextAnswers,
        index: nextIndex,
      });
    },
    [draft],
  );

  function choose(optionId: string) {
    if (!question || lockRef.current) return;
    const next = { ...answers, [question.id]: optionId };
    setAnswers(next);
    persist(index, next);
  }

  function goTo(next: number) {
    const clamped = Math.min(Math.max(next, 0), total - 1);
    setIndex(clamped);
    persist(clamped, answers);
    // Move focus to the new heading for screen readers and keyboard users.
    window.requestAnimationFrame(() => headingRef.current?.focus());
  }

  async function submit() {
    if (!draft || lockRef.current) return;
    if (answeredCount < total) {
      toast(`还有 ${total - answeredCount} 道题没有作答`, 'error');
      return;
    }
    lockRef.current = true;
    setStatus('submitting');
    setSubmitError(null);

    const payload: Answer[] = QUESTIONS.map((q) => ({
      questionId: q.id,
      optionId: answers[q.id],
    }));

    try {
      const response = await api.submitTest({
        sessionId: draft.sessionId,
        accessToken: draft.accessToken,
        answers: payload,
        scoringVersion: SCORING_VERSION,
      });
      clearDraft();
      sessionStorage.setItem(
        'lcs.lastResult',
        JSON.stringify({ sessionId: draft.sessionId, resultId: response.result.id }),
      );
      navigate(`/result/${draft.sessionId}`, { replace: true });
    } catch (error) {
      lockRef.current = false;
      setStatus('ready');
      const apiError =
        error instanceof ApiError
          ? error
          : new ApiError('server_error', '提交失败，请稍后再试', 500);
      setSubmitError(apiError);
      if (apiError.code === 'invalid_answers') {
        toast('答案校验未通过，请检查是否有题目没有作答', 'error');
      }
    }
  }

  if (status === 'loading') return <FullPageLoader label="正在准备题目…" />;

  if (status === 'error' || !draft) {
    return (
      <Card className="mt-10">
        <ErrorState
          title="没有找到进行中的测评"
          body="这一轮测评的会话不存在或已经结束。请重新输入密码开始新一轮。"
          onRetry={() => navigate('/')}
          retryLabel="重新输入密码"
        />
      </Card>
    );
  }

  const percent = Math.round((answeredCount / total) * 100);

  return (
    <div className="animate-rise py-5 sm:py-8">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between text-[12px] text-brown-muted">
            <span>
              第 <span className="font-mono text-orange">{index + 1}</span> / {total} 题
            </span>
            <span>
              已作答 <span className="font-mono text-brown">{answeredCount}</span>
            </span>
          </div>
          <div
            className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-cream-deep"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={answeredCount}
            aria-label="答题进度"
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-orange-soft to-orange transition-[width] duration-300 motion-reduce:transition-none"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      </div>

      <p className="mb-2 text-[11px] font-mono tracking-[0.22em] text-orange">{question.section}</p>

      <Card className="p-5 sm:p-7">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="text-pretty font-serif text-[19px] font-semibold leading-[1.7] tracking-wide text-ink outline-none sm:text-[22px]"
        >
          {question.text}
        </h1>

        <fieldset className="mt-5">
          <legend className="sr-only">请选择一个最符合你第一反应的选项</legend>
          <div className="space-y-2.5">
            {question.options.map((option, i) => {
              const isSelected = selected === option.id;
              return (
                <label
                  key={option.id}
                  className={[
                    'flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3.5 transition-colors duration-150',
                    'touch-manipulation select-none',
                    isSelected
                      ? 'border-orange bg-orange-wash/70 shadow-soft'
                      : 'border-line bg-cream/50 hover:border-orange-soft hover:bg-orange-wash/30',
                  ].join(' ')}
                >
                  <input
                    type="radio"
                    name={question.id}
                    value={option.id}
                    checked={isSelected}
                    onChange={() => choose(option.id)}
                    className="sr-only"
                  />
                  <span
                    aria-hidden
                    className={[
                      'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border transition-colors',
                      isSelected ? 'border-orange bg-orange' : 'border-brown-muted/50 bg-card',
                    ].join(' ')}
                  >
                    {isSelected ? <span className="size-1.5 rounded-full bg-white" /> : null}
                  </span>
                  <span className="flex min-w-0 flex-1 items-start gap-2.5">
                    <span
                      className={[
                        'font-mono text-[12px] leading-[1.75]',
                        isSelected ? 'text-orange' : 'text-brown-muted',
                      ].join(' ')}
                    >
                      {String.fromCharCode(65 + i)}
                    </span>
                    <span
                      className={[
                        'text-[15px] leading-[1.75]',
                        isSelected ? 'font-medium text-ink' : 'text-brown-soft',
                      ].join(' ')}
                    >
                      {option.label}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {submitError ? (
          <div
            role="alert"
            className="animate-fade mt-5 rounded-2xl border border-[#B5565A]/25 bg-[#fbeeed] px-4 py-3 text-[13.5px] leading-relaxed text-[#8f4347]"
          >
            {submitError.code === 'unauthorized'
              ? '这一轮测评的凭证已失效，请重新输入密码开始新一轮。'
              : `${submitError.message}`}
          </div>
        ) : null}

        <div className="mt-6 flex items-center gap-3">
          <Button
            variant="secondary"
            size="lg"
            onClick={() => goTo(index - 1)}
            disabled={index === 0 || status === 'submitting'}
            className="shrink-0"
          >
            上一题
          </Button>
          {index < total - 1 ? (
            <Button
              size="lg"
              className="flex-1"
              onClick={() => goTo(index + 1)}
              disabled={!selected}
            >
              下一题
            </Button>
          ) : (
            <Button
              size="lg"
              className="flex-1"
              loading={status === 'submitting'}
              disabled={answeredCount < total}
              onClick={submit}
            >
              {status === 'submitting' ? '正在生成报告…' : '提交并查看结果'}
            </Button>
          )}
        </div>

        {answeredCount < total && index === total - 1 ? (
          <p className="mt-3 text-center text-[12.5px] text-brown-muted">
            还有 {total - answeredCount} 道题没有作答，可以点击进度条上方的题目序号回看。
          </p>
        ) : null}

        <p className="mt-5 text-center text-[11.5px] leading-relaxed text-brown-muted/85">
          离开页面不会丢失答案，{BRAND.shortName}会在本机暂存。同一轮测评不会重复扣除次数。
        </p>
      </Card>

      <div className="mt-5 flex justify-center">
        <Button variant="ghost" size="sm" onClick={() => navigate('/intro')}>
          返回介绍页
        </Button>
      </div>
    </div>
  );
}