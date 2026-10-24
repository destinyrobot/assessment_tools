import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError, api } from '@/lib/api';
import { Layout } from '@/components/Layout';
import { ReportView } from '@/components/report/ReportView';
import { SaveImageButton } from '@/components/report/SaveImage';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ErrorState, FullPageLoader } from '@/components/ui/States';
import { BRAND } from '@/config/brand';
import type { SharedResultPayload } from '@/lib/api';

/**
 * Public, token-addressed report page.
 * Reachable from any device/browser; needs no local session, no password and no
 * cookies. Only the fields required to render the report are returned by the
 * Edge Function — answers, password and admin data never leave the server.
 */
export function SharedResultPage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const [result, setResult] = useState<SharedResultPayload | null>(null);
  const [error, setError] = useState<{ title: string; body: string } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    if (!/^[A-Za-z0-9_-]{20,200}$/.test(token)) {
      setError({ title: '链接无效', body: '这个分享链接不完整，可能在复制时被截断了。让朋友重新复制一次即可。' });
      return;
    }
    try {
      const payload = await api.sharedResult(token);
      setResult(payload);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'not_found') {
        setError({ title: '链接已失效', body: '这个分享链接可能已被撤销，或者已经超过有效期。' });
      } else {
        setError({
          title: '加载失败',
          body: e instanceof ApiError ? e.message : '网络不太稳定，请稍后再试。',
        });
      }
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <Layout>
        <Card className="mt-10">
          <ErrorState title={error.title} body={error.body} onRetry={() => void load()}>
            <Button variant="secondary" onClick={() => navigate('/')}>
              我也要测一次
            </Button>
          </ErrorState>
        </Card>
      </Layout>
    );
  }

  if (!result) {
    return (
      <Layout>
        <FullPageLoader label="正在打开朋友的结果…" />
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="animate-rise py-5 sm:py-8">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-orange-wash/50 px-4 py-3">
          <p className="text-[13px] leading-relaxed text-[#9a5a24]">
            你正在查看一份分享报告，内容由答题者本人生成。
          </p>
          <Button size="sm" onClick={() => navigate('/')} data-testid="shared-cta">
            我也要测一次
          </Button>
        </div>

        <ReportView report={result.report} />

        <Card className="mt-6 p-5 sm:p-7">
          <div className="space-y-3">
            <SaveImageButton report={result.report} />
          </div>
          <p className="mt-3 text-center text-[12px] leading-relaxed text-brown-muted">
            {BRAND.disclaimer}
          </p>
        </Card>
      </div>
    </Layout>
  );
}