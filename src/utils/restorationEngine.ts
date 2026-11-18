import { createWorker } from 'tesseract.js';
import { DocumentElement, PageRestorationConfig } from '../types/pdfStudio';
import { processRgbaBuffer } from '../workers/documentWorker';

export const DEFAULT_RESTORATION_CONFIG: PageRestorationConfig = {
  enabled: false,
  deskewDeg: 0,
  brightness: 0,
  contrast: 0,
  denoise: 0,
  backgroundCleanup: 0,
  whiteNormalize: false,
};

let sharedWorker: Worker | null = null;
const pendingCallbacks = new Map<
  string,
  (result: { buffer: ArrayBuffer; width: number; height: number }) => void
>();

function getDocumentWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (!sharedWorker) {
    try {
      sharedWorker = new Worker(
        new URL('../workers/documentWorker.ts', import.meta.url),
        { type: 'module' }
      );
      sharedWorker.onmessage = (ev: MessageEvent) => {
        const { id, buffer, width, height } = ev.data as {
          id: string;
          buffer: ArrayBuffer;
          width: number;
          height: number;
        };
        const cb = pendingCallbacks.get(id);
        if (cb) {
          pendingCallbacks.delete(id);
          cb({ buffer, width, height });
        }
      };
      sharedWorker.onerror = () => {
        sharedWorker = null;
      };
    } catch {
      sharedWorker = null;
    }
  }
  return sharedWorker;
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = src;
  });
}

export async function applyRestorationToDataUrl(
  sourceDataUrl: string,
  config: PageRestorationConfig
): Promise<string> {
  if (!config.enabled) return sourceDataUrl;

  const img = await loadImageElement(sourceDataUrl);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (w < 2 || h < 2) return sourceDataUrl;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return sourceDataUrl;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, w, h);

  if (Math.abs(config.deskewDeg) > 0.05) {
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate((config.deskewDeg * Math.PI) / 180);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  } else {
    ctx.drawImage(img, 0, 0, w, h);
  }

  const needsPixelPass =
    config.brightness !== 0 ||
    config.contrast !== 0 ||
    config.denoise > 0 ||
    config.backgroundCleanup > 0 ||
    config.whiteNormalize;

  if (needsPixelPass) {
    const imgData = ctx.getImageData(0, 0, w, h);
    const worker = getDocumentWorker();
    const params = {
      brightness: config.brightness,
      contrast: config.contrast,
      denoise: config.denoise,
      backgroundCleanup: config.backgroundCleanup,
      whiteNormalize: config.whiteNormalize,
    };

    let processedBytes: Uint8ClampedArray;
    if (worker) {
      const id = `rest-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const copyBuf = new Uint8ClampedArray(imgData.data).buffer;
      processedBytes = await new Promise<Uint8ClampedArray>((resolve) => {
        const timeout = setTimeout(() => {
          pendingCallbacks.delete(id);
          resolve(processRgbaBuffer(imgData.data, w, h, params));
        }, 4000);
        pendingCallbacks.set(id, (res) => {
          clearTimeout(timeout);
          resolve(new Uint8ClampedArray(res.buffer));
        });
        worker.postMessage({ id, width: w, height: h, buffer: copyBuf, params }, [
          copyBuf,
        ]);
      });
    } else {
      processedBytes = processRgbaBuffer(imgData.data, w, h, params);
    }

    const outData = ctx.createImageData(w, h);
    outData.data.set(processedBytes);
    ctx.putImageData(outData, 0, 0);
  }

  const dataUrl = canvas.toDataURL('image/png');
  canvas.width = 0;
  canvas.height = 0;
  return dataUrl;
}

export async function runLocalOcrOnPageDataUrl(
  imageDataUrl: string,
  pageNumber: number,
  pageWidthPt: number,
  pageHeightPt: number,
  ocrLanguage = 'eng'
): Promise<DocumentElement[]> {
  const img = await loadImageElement(imageDataUrl);
  const pxW = img.naturalWidth || img.width || pageWidthPt;
  const pxH = img.naturalHeight || img.height || pageHeightPt;
  const scaleX = pageWidthPt / pxW;
  const scaleY = pageHeightPt / pxH;

  const worker = await createWorker(ocrLanguage || 'eng');
  try {
    const result = await worker.recognize(imageDataUrl);
    const blocks =
      (
        result.data as unknown as {
          blocks?: Array<{
            paragraphs?: Array<{
              lines?: Array<{
                text: string;
                confidence?: number;
                bbox: { x0: number; y0: number; x1: number; y1: number };
              }>;
            }>;
          }>;
        }
      ).blocks || [];
    const lines = blocks.flatMap((b) =>
      (b.paragraphs || []).flatMap((p) => p.lines || [])
    );
    const elements: DocumentElement[] = [];

    lines.forEach((line, idx) => {
      const text = (line.text || '').trim();
      if (!text) return;
      const bbox = line.bbox;
      const x = Number((bbox.x0 * scaleX).toFixed(2));
      const y = Number((bbox.y0 * scaleY).toFixed(2));
      const width = Number(Math.max(12, (bbox.x1 - bbox.x0) * scaleX).toFixed(2));
      const height = Number(Math.max(10, (bbox.y1 - bbox.y0) * scaleY).toFixed(2));
      const fontSize = Number(Math.max(7, Math.min(42, height * 0.78)).toFixed(1));
      const confidence =
        typeof line.confidence === 'number' ? Number((line.confidence / 100).toFixed(2)) : 0.76;

      elements.push({
        id: `ocr-p${pageNumber}-${Date.now().toString(36)}-${idx}`,
        type: fontSize >= 15 ? 'heading' : 'text',
        pageNumber,
        x,
        y,
        width,
        height,
        rotation: 0,
        text,
        fontFamily: 'Helvetica',
        fontSize,
        fontWeight: fontSize >= 15 ? 'bold' : 'normal',
        fontStyle: 'normal',
        color: '#111827',
        backgroundColor: 'transparent',
        align: 'left',
        opacity: 1,
        editable: true,
        locked: false,
        visible: true,
        confidence,
        needsReview: confidence < 0.78,
        reviewReason:
          confidence < 0.78
            ? `Scanned OCR recognition (${Math.round(confidence * 100)}%) — verify spelling`
            : undefined,
        sourceOrigin: 'scanned_ocr',
        isUserAdded: false,
        eraseOriginal: false,
        sourceOriginalRect: { x, y, width, height },
      });
    });

    return elements;
  } finally {
    await worker.terminate();
  }
}
