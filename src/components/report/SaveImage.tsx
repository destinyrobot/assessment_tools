import { useCallback, useRef, useState } from 'react';
import { BRAND } from '@/config/brand';
import { SAVE_IMAGE } from '@/config/campaign';
import { detectFileShare, shareImageOrUrl } from '@/lib/clipboard';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { toast } from '@/components/ui/toast';
import { ExportCard } from './ReportView';
import type { Report } from '@shared/types.ts';

const TIMEOUT_MS = 25_000;
/** iOS/Safari refuse canvases beyond roughly 16.7 megapixels. */
const MAX_CANVAS_PIXELS = 12_000_000;
const EXPORT_WIDTH = 750;

function fileNameFor(report: Report): string {
  const safe = (s: string) => s.replace(/[\\/:*?"<>|\s]+/g, '-');
  // Deliberately contains no password, share token or session id.
  return `${safe(BRAND.name)}-${safe(report.archetypeName)}.png`;
}

function pickPixelRatio(width: number, height: number): number {
  if (width * height * 4 <= MAX_CANVAS_PIXELS) return 2;
  if (width * height * 2.25 <= MAX_CANVAS_PIXELS) return 1.5;
  return 1;
}

export interface SaveImageProps {
  report: Report;
  shareUrl?: string | null;
}

export function SaveImageButton({ report, shareUrl }: SaveImageProps) {
  const holderRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const generate = useCallback(async (): Promise<{ blob: Blob; dataUrl: string }> => {
    const node = holderRef.current?.firstElementChild as HTMLElement | undefined;
    if (!node) throw new Error('export node missing');

    // Fonts must be ready before html-to-image snapshots the DOM.
    if (document.fonts?.ready) await document.fonts.ready;

    const width = node.scrollWidth || EXPORT_WIDTH;
    const height = node.scrollHeight || 2000;

    // Loaded on demand: html-to-image is only needed when a user saves the image,
    // and keeping it out of the initial bundle saves ~100 kB gzip.
    const { toPng } = await import('html-to-image');

    const dataUrl = await Promise.race([
      toPng(node, {
        cacheBust: true,
        pixelRatio: pickPixelRatio(width, height),
        backgroundColor: '#FBF6EE',
        width,
        height,
        style: { transform: 'none', transformOrigin: 'top left', margin: '0' },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS),
      ),
    ]);

    const blob = await (await fetch(dataUrl)).blob();
    return { blob, dataUrl };
  }, []);

  const onClick = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { blob } = await generate();
      const filename = fileNameFor(report);

      if (detectFileShare() === 'file') {
        const file = new File([blob], filename, { type: 'image/png' });
        const outcome = await shareImageOrUrl(file, shareUrl ?? '', BRAND.name);
        if (outcome === 'shared' || outcome === 'shared-url') {
          toast('已调起系统分享面板', 'success');
          return;
        }
        if (outcome === 'cancelled') return;
      }

      // Desktop + browsers without Web Share file support: download directly
      // and always show a preview so mobile users can long-press to save.
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      setPreviewOpen(true);
      try {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        toast('长图已生成，正在下载', 'success');
      } catch {
        toast('浏览器阻止了自动下载，请长按图片保存', 'info');
      }
    } catch (e) {
      console.error('[export] failed', e);
      setError(SAVE_IMAGE.failed);
      toast(`${SAVE_IMAGE.failed}，可以重试或直接截图保存`, 'error');
    } finally {
      setBusy(false);
    }
  }, [busy, generate, report, shareUrl]);

  return (
    <>
      {/* Off-screen render target, excluded from layout and from the export. */}
      <div
        ref={holderRef}
        aria-hidden
        data-export-root
        style={{
          position: 'fixed',
          left: '-20000px',
          top: 0,
          width: EXPORT_WIDTH,
          pointerEvents: 'none',
        }}
      >
        <ExportCard report={report} />
      </div>

      <div className="w-full">
        <Button
          size="lg"
          block
          loading={busy}
          onClick={onClick}
          data-testid="save-image"
          icon={
            <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path
                d="M10 3v9m0 0 3.2-3.2M10 12 6.8 8.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M3.5 13.5v1.8A1.7 1.7 0 0 0 5.2 17h9.6a1.7 1.7 0 0 0 1.7-1.7v-1.8"
                strokeLinecap="round"
              />
            </svg>
          }
        >
          {busy ? SAVE_IMAGE.generating : SAVE_IMAGE.button}
        </Button>
        {error ? (
          <div
            role="alert"
            className="animate-fade mt-3 rounded-2xl border border-[#B5565A]/25 bg-[#fbeeed] px-4 py-3"
          >
            <p className="text-[13.5px] text-[#8f4347]">{error}</p>
            <button
              type="button"
              onClick={() => {
                setError(null);
                void onClick();
              }}
              className="mt-2 text-[13.5px] font-medium text-[#8f4347] underline underline-offset-4"
            >
              {SAVE_IMAGE.retry}
            </button>
          </div>
        ) : null}
      </div>

      <Dialog
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title={SAVE_IMAGE.previewTitle}
        description={SAVE_IMAGE.previewHint}
        footer={
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => setPreviewOpen(false)}>
              {SAVE_IMAGE.closePreview}
            </Button>
            {previewUrl ? (
              <a
                href={previewUrl}
                download={fileNameFor(report)}
                className="flex-1 rounded-2xl bg-orange px-5 py-3 text-center text-[15px] font-medium text-white transition-colors hover:bg-[#bd6a29]"
              >
                {SAVE_IMAGE.download}
              </a>
            ) : null}
          </div>
        }
      >
        {previewUrl ? (
          <img
            src={previewUrl}
            alt={`${BRAND.name} · ${report.archetypeName} 结果长图预览`}
            className="mx-auto max-h-[52dvh] w-auto rounded-2xl border border-line shadow-soft"
          />
        ) : null}
      </Dialog>
    </>
  );
}