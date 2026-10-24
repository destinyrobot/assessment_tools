/** Clipboard with graceful fallbacks (iOS Safari, insecure contexts, HTTP). */

export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* fall through to the legacy path */
    }
  }
  if (typeof document === 'undefined') return false;
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, area.value.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

export type FileShareSupport = 'file' | 'url' | 'none';

/**
 * Desktop Chrome exposes `navigator.canShare({files})` but its `navigator.share`
 * either rejects with `InvalidStateError` or never settles, which would strand
 * the user on a spinner instead of downloading. Only mobile Safari / Chrome are
 * allowed to take the share-sheet path.
 */
function isMobileShareCapable(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export function detectFileShare(): FileShareSupport {
  if (typeof navigator === 'undefined' || typeof File === 'undefined') return 'none';
  if (!isMobileShareCapable()) return 'none';
  if (!navigator.canShare) return 'none';
  try {
    const probe = new File([new Blob(['x'], { type: 'image/png' })], 'probe.png', {
      type: 'image/png',
    });
    if (navigator.canShare({ files: [probe] })) return 'file';
  } catch {
    /* ignore */
  }
  return 'none';
}

export function isMobileShare(): boolean {
  return isMobileShareCapable();
}

export type ShareOutcome = 'shared' | 'shared-url' | 'cancelled' | 'failed' | 'unsupported';

export async function shareImageOrUrl(file: File | null, url: string, title: string): Promise<ShareOutcome> {
  if (typeof navigator === 'undefined' || !navigator.share) return 'unsupported';
  // Desktop Chrome can leave `share()` pending forever; never await it there.
  if (!isMobileShareCapable()) return 'unsupported';
  const data =
    file && detectFileShare() === 'file'
      ? { files: [file], title }
      : { title, url };
  const settled = navigator
    .share(data)
    .then(() => (data.files ? 'shared' : 'shared-url') as ShareOutcome)
    .catch((error: unknown) =>
      error instanceof DOMException && error.name === 'AbortError'
        ? ('cancelled' as ShareOutcome)
        : ('failed' as ShareOutcome),
    );
  try {
    // A share sheet that never settles must not strand the caller on a spinner.
    return await Promise.race([
      settled,
      new Promise<ShareOutcome>((resolve) => setTimeout(() => resolve('failed'), 60_000)),
    ]);
  } catch {
    return 'failed';
  }
}