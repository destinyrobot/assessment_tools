import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError, api } from '@/lib/api';
import { clearDraft, loadSession, saveDraft, saveSession } from '@/lib/storage';
import { generateRequestId } from '@/lib/url';
import { Layout } from '@/components/Layout';
import { ReportView } from '@/components/report/ReportView';
import { SaveImageButton } from '@/components/report/SaveImage';
import { ShareActions } from '@/components/report/ShareActions';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { toast } from '@/components/ui/toast';
import { ErrorState, FullPageLoader } from '@/components/ui/States';
import { RETAKE, QUOTA } from '@/config/campaign';
import type { ResultPayload } from '@/lib/api';

export function ResultPage() {
  const { sessionId = '' } = useParams();
  const navigate = useNavigate();
  const [result, setResult] = useState<ResultPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retakeOpen, setRetakeOpen] = useState(false);
  const [retaking, setRetaking] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  // 每次「再测一次」意图只生成一次 requestId：网络超时后重试会复用同一个
  // requestId，服务端据此幂等，不会重复扣额度。
  const retakeRequestIdRef = useRef<string | null>(null);

  const openRetake = useCallback(() => {
    retakeRequestIdRef.current = generateRequestId();
    setRetakeOpen(true);
  }, []);

  const load = useCallback(async () => {
    setError(null);
    const session = loadSession();
    if (!session || session.sessionId !== sessionId) {
      setError('没有找到这一轮测评的本地凭证。结果数据只保存在服务端，需要在本设备上重新进入。');
      return;
    }
    try {
      const payload = await api.getResult({ sessionId, accessToken: session.accessToken });
      setResult(payload);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '结果加载失败');
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRetake = useCallback(async () => {
    const session = loadSession();
    if (!session) {
      toast('本轮会话已失效，请重新输入密码', 'error');
      navigate('/');
      return;
    }
    setRetaking(true);
    const requestId = (retakeRequestIdRef.current ??= generateRequestId());
    try {
      const next = await api.retake({
        sessionId: session.sessionId,
        accessToken: session.accessToken,
        requestId,
      });
      saveSession({
        sessionId: next.sessionId,
        accessToken: next.accessToken,
        usedCount: next.usedCount,
        maxUses: next.maxUses,
        remaining: next.remaining,
        startedAt: next.startedAt,
      });
      saveDraft({
        sessionId: next.sessionId,
        accessToken: next.accessToken,
        remaining: next.remaining,
        usedCount: next.usedCount,
        maxUses: next.maxUses,
        startedAt: next.startedAt,
        answers: {},
        index: 0,
      });
      setRetakeOpen(false);
      retakeRequestIdRef.current = null;
      toast(RETAKE.newQuota, 'success');
      navigate('/quiz', { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'exhausted') {
        setRetakeOpen(false);
        // 额度已耗尽，重试也没用，重置意图以便用户重新发起。
        retakeRequestIdRef.current = null;
        toast(QUOTA.exhaustedBody, 'error');
      } else {
        // 保留 requestId：超时/网络错误后重试必须是同一次意图，否则会重复扣次。
        toast(e instanceof ApiError ? e.message : '开始新一轮失败', 'error');
      }
    } finally {
      setRetaking(false);
    }
  }, [navigate]);

  const onStartOver = useCallback(() => {
    clearDraft();
    navigate('/');
  }, [navigate]);

  if (error) {
    return (
      <Layout>
        <Card className="mt-10">
          <ErrorState
            title="无法显示这份结果"
            body={error}
            onRetry={() => void load()}
            retryLabel="重新加载"
          >
            <Button variant="secondary" onClick={onStartOver}>
              重新输入密码
            </Button>
          </ErrorState>
        </Card>
      </Layout>
    );
  }

  if (!result) {
    return (
      <Layout>
        <FullPageLoader label="正在生成你的报告…" />
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="animate-rise py-5 sm:py-8">
        <ReportView report={result.report} />

        <Card className="mt-6 p-5 sm:p-7">
          <div className="space-y-3">
            <SaveImageButton report={result.report} shareUrl={shareUrl} />
            <ShareActions
              sessionId={result.sessionId}
              accessToken={loadSession()?.accessToken ?? ''}
              report={result.report}
              onShareUrl={setShareUrl}
              extra={
                <Button
                  variant="secondary"
                  size="lg"
                  onClick={openRetake}
                  data-testid="retake"
                >
                  {RETAKE.button}
                </Button>
              }
            />
          </div>
          <p className="mt-3 text-center text-[12px] leading-relaxed text-brown-muted">
            再测一次会消耗 1 次额度，本次结果与分享链接会完整保留。
          </p>
        </Card>
      </div>

      <Dialog
        open={retakeOpen}
        onClose={() => setRetakeOpen(false)}
        title={RETAKE.confirmTitle}
        description={RETAKE.confirmBody}
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => setRetakeOpen(false)}>
              {RETAKE.cancel}
            </Button>
            <Button className="flex-1" loading={retaking} onClick={onRetake}>
              {RETAKE.confirmAction}
            </Button>
          </div>
        }
      >
        <p className="text-[14px] leading-[1.9] text-brown-soft">
          每一轮测评都会生成全新的结果记录，不会覆盖历史结果，已经分享出去的链接也仍然有效。
        </p>
      </Dialog>
    </Layout>
  );
}