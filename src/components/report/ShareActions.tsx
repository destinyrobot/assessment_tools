import { useCallback, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { COPY_LINKS, SHARE_TEXT } from '@/config/campaign';
import { copyText, isMobileShare, shareImageOrUrl } from '@/lib/clipboard';
import { buildShareUrl } from '@/lib/url';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { toast } from '@/components/ui/toast';
import { BRAND } from '@/config/brand';
import type { Report } from '@shared/types.ts';

interface ShareActionsProps {
  sessionId: string;
  accessToken: string;
  report: Report;
  onShareUrl?: (url: string) => void;
  /** Rendered inside the same two-column grid, after the share buttons. */
  extra?: ReactNode;
}

export function ShareActions({ sessionId, accessToken, report, onShareUrl, extra }: ShareActionsProps) {
  const [busy, setBusy] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [manual, setManual] = useState(false);

  const ensureUrl = useCallback(async (): Promise<string | null> => {
    if (shareUrl) return shareUrl;
    const response = await api.createShare({ sessionId, accessToken });
    const url = buildShareUrl(response.token);
    setShareUrl(url);
    onShareUrl?.(url);
    return url;
  }, [accessToken, onShareUrl, sessionId, shareUrl]);

  const onCopy = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const url = await ensureUrl();
      if (!url) return;
      const ok = await copyText(url);
      if (ok) {
        toast(COPY_LINKS.copied, 'success');
      } else {
        setManual(true);
        toast(COPY_LINKS.copiedFallback, 'info');
      }
    } catch {
      toast('分享链接生成失败，请稍后重试', 'error');
    } finally {
      setBusy(false);
    }
  }, [busy, ensureUrl]);

  const onShare = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const url = await ensureUrl();
      if (!url) return;
      if (typeof navigator !== 'undefined' && isMobileShare()) {
        const outcome = await shareImageOrUrl(null, url, `${SHARE_TEXT.title}｜${report.archetypeName}`);
        if (outcome === 'cancelled') return;
        if (outcome === 'shared' || outcome === 'shared-url') {
          toast('已调起系统分享面板', 'success');
          return;
        }
      }
      const ok = await copyText(url);
      if (ok) toast(COPY_LINKS.copied, 'success');
      else {
        setManual(true);
        toast(COPY_LINKS.copiedFallback, 'info');
      }
    } catch {
      toast('分享失败，请稍后重试', 'error');
    } finally {
      setBusy(false);
    }
  }, [busy, ensureUrl, report.archetypeName]);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Button
          variant="secondary"
          size="lg"
          loading={busy}
          onClick={onCopy}
          data-testid="copy-share-link"
          icon={
            <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.7">
              <rect x="7" y="7" width="9" height="9" rx="2" />
              <path d="M13 5.5H5.5A1.5 1.5 0 0 0 4 7v7.5" strokeLinecap="round" />
            </svg>
          }
        >
          {COPY_LINKS.copy}
        </Button>
        {typeof navigator !== 'undefined' && 'share' in navigator && isMobileShare() ? (
          <Button variant="secondary" size="lg" loading={busy} onClick={onShare} data-testid="native-share">
            分享给朋友
          </Button>
        ) : null}
        {extra}
      </div>

      {shareUrl ? (
        <p className="mt-3 break-all rounded-2xl border border-line bg-cream/60 px-4 py-3 font-mono text-[11.5px] leading-relaxed text-brown-muted">
          {BRAND.shortName}公开链接：{shareUrl}
        </p>
      ) : null}

      <Dialog
        open={manual}
        onClose={() => setManual(false)}
        title={COPY_LINKS.manualTitle}
        description={COPY_LINKS.manualHint}
      >
        <p className="select-all break-all rounded-2xl border border-line bg-cream px-4 py-3 font-mono text-[13px] leading-relaxed text-ink">
          {shareUrl ?? ''}
        </p>
      </Dialog>
    </>
  );
}