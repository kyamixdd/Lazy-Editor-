/**
 * Safe browser Blob / DataURL download helper.
 * Defers URL.revokeObjectURL so WebKit/Safari/iOS downloads are never aborted mid-stream.
 */
export function triggerBlobDownload(
  blob: Blob,
  filename: string,
  revokeDelayMs = 1500
): string {
  const url = URL.createObjectURL(blob);
  if (typeof document !== 'undefined') {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
  window.setTimeout(() => {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // ignore if already revoked
    }
  }, revokeDelayMs);
  return url;
}

export function triggerBytesDownload(
  bytes: Uint8Array,
  filename: string,
  mimeType = 'application/pdf'
): string {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return triggerBlobDownload(new Blob([copy], { type: mimeType }), filename);
}
