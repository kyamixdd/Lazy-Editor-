import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { createWorker } from 'tesseract.js';
import {
  DetectedPageBounds,
  OriginalPageMeta,
  RectPt,
} from '../types/pdfStudio';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// Lightweight LRU cache of rendered page previews & thumbnails keyed by pdfSignature + pageNumber + scale
const previewCache = new Map<string, string>();
const MAX_PREVIEW_CACHE = 48;

function cacheSet(key: string, val: string) {
  if (previewCache.size >= MAX_PREVIEW_CACHE) {
    const oldest = previewCache.keys().next().value;
    if (oldest) previewCache.delete(oldest);
  }
  previewCache.set(key, val);
}

function getPdfSignature(base64: string): string {
  return `${base64.length}:${base64.slice(0, 32)}:${base64.slice(-24)}`;
}

function releaseCanvas(canvas: HTMLCanvasElement) {
  canvas.width = 0;
  canvas.height = 0;
}

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export interface ExtractedTextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontName: string;
}

export interface RenderedPdfPageData {
  pageNumber: number;
  widthPt: number;
  heightPt: number;
  orientation: 'portrait' | 'landscape';
  imageBase64: string;
  extractedTextItems: ExtractedTextItem[];
  usedOcr: boolean;
  detectedBounds: DetectedPageBounds;
}

export function base64ToUint8Array(base64: string): Uint8Array {
  const clean = base64.replace(/^data:application\/pdf;base64,/, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function unionRects(rects: RectPt[]): RectPt | undefined {
  if (rects.length === 0) return undefined;
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.width));
  const maxY = Math.max(...rects.map((r) => r.y + r.height));
  return {
    x: Number(minX.toFixed(2)),
    y: Number(minY.toFixed(2)),
    width: Number(Math.max(1, maxX - minX).toFixed(2)),
    height: Number(Math.max(1, maxY - minY).toFixed(2)),
  };
}

function clampBox(rect: RectPt, maxW: number, maxH: number): RectPt {
  const x = Math.max(0, Math.min(rect.x, maxW - 1));
  const y = Math.max(0, Math.min(rect.y, maxH - 1));
  const w = Math.max(1, Math.min(rect.width, maxW - x));
  const h = Math.max(1, Math.min(rect.height, maxH - y));
  return {
    x: Number(x.toFixed(2)),
    y: Number(y.toFixed(2)),
    width: Number(w.toFixed(2)),
    height: Number(h.toFixed(2)),
  };
}

function mulMatrix(m1: number[], m2: number[]): number[] {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function applyPoint(m: number[], px: number, py: number): [number, number] {
  return [m[0] * px + m[2] * py + m[4], m[1] * px + m[3] * py + m[5]];
}

async function analyzeOperatorListBounds(
  page: pdfjsLib.PDFPageProxy,
  baseTransform: number[],
  pageW: number,
  pageH: number
): Promise<{ vectorBBox?: RectPt; imageBBox?: RectPt }> {
  const vectorRects: RectPt[] = [];
  const imageRects: RectPt[] = [];

  try {
    const opList = await page.getOperatorList();
    const { OPS } = pdfjsLib;
    const stack: number[][] = [];
    let ctm = [...baseTransform];
    const pageArea = pageW * pageH;

    for (let i = 0; i < opList.fnArray.length; i++) {
      const fn = opList.fnArray[i];
      const args = opList.argsArray[i];

      if (fn === OPS.save) {
        stack.push([...ctm]);
      } else if (fn === OPS.restore) {
        ctm = stack.pop() || [...baseTransform];
      } else if (fn === OPS.transform && Array.isArray(args) && args.length >= 6) {
        ctm = mulMatrix(ctm, args as number[]);
      } else if (
        fn === OPS.paintImageXObject ||
        fn === OPS.paintInlineImageXObject ||
        fn === OPS.paintImageMaskXObject
      ) {
        // Unit square [0..1, 0..1] in image space
        const corners = [
          applyPoint(ctm, 0, 0),
          applyPoint(ctm, 1, 0),
          applyPoint(ctm, 0, 1),
          applyPoint(ctm, 1, 1),
        ];
        const xs = corners.map((c) => c[0]);
        const ys = corners.map((c) => c[1]);
        const rect = clampBox(
          {
            x: Math.min(...xs),
            y: Math.min(...ys),
            width: Math.max(...xs) - Math.min(...xs),
            height: Math.max(...ys) - Math.min(...ys),
          },
          pageW,
          pageH
        );
        if (rect.width * rect.height < pageArea * 0.97) {
          imageRects.push(rect);
        }
      } else if (fn === OPS.constructPath && Array.isArray(args) && args.length >= 2) {
        const subOps = args[0] as number[];
        const coords = args[1] as number[];
        if (Array.isArray(subOps) && Array.isArray(coords)) {
          const pts: Array<[number, number]> = [];
          let ci = 0;
          for (const sop of subOps) {
            if ((sop === OPS.moveTo || sop === OPS.lineTo) && ci + 1 < coords.length) {
              pts.push(applyPoint(ctm, coords[ci], coords[ci + 1]));
              ci += 2;
            } else if (sop === OPS.curveTo && ci + 5 < coords.length) {
              pts.push(applyPoint(ctm, coords[ci], coords[ci + 1]));
              pts.push(applyPoint(ctm, coords[ci + 2], coords[ci + 3]));
              pts.push(applyPoint(ctm, coords[ci + 4], coords[ci + 5]));
              ci += 6;
            } else if (sop === OPS.rectangle && ci + 3 < coords.length) {
              const rx = coords[ci];
              const ry = coords[ci + 1];
              const rw = coords[ci + 2];
              const rh = coords[ci + 3];
              pts.push(applyPoint(ctm, rx, ry));
              pts.push(applyPoint(ctm, rx + rw, ry));
              pts.push(applyPoint(ctm, rx, ry + rh));
              pts.push(applyPoint(ctm, rx + rw, ry + rh));
              ci += 4;
            }
          }
          if (pts.length >= 2) {
            const xs = pts.map((p) => p[0]);
            const ys = pts.map((p) => p[1]);
            const w = Math.max(...xs) - Math.min(...xs);
            const h = Math.max(...ys) - Math.min(...ys);
            const rect = clampBox(
              { x: Math.min(...xs), y: Math.min(...ys), width: w, height: h },
              pageW,
              pageH
            );
            // Ignore full-page white background/clip rectangles (>96% area)
            if (rect.width * rect.height < pageArea * 0.96 && (rect.width > 1 || rect.height > 1)) {
              vectorRects.push(rect);
            }
          }
        }
      }
    }
  } catch {
    // Non-fatal fallback to pixel + text scan
  }

  return {
    vectorBBox: unionRects(vectorRects),
    imageBBox: unionRects(imageRects),
  };
}

function scanCanvasContentBounds(
  canvas: HTMLCanvasElement,
  renderScale: number,
  pageW: number,
  pageH: number
): RectPt | undefined {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return undefined;
  const { width, height } = canvas;
  if (width <= 0 || height <= 0) return undefined;

  const imgData = ctx.getImageData(0, 0, width, height).data;

  // Sample outer corners to determine page background RGB cleanly
  const sampleOffsets = [
    0,
    (width - 1) * 4,
    (height - 1) * width * 4,
    ((height - 1) * width + (width - 1)) * 4,
  ];
  let bgR = 255;
  let bgG = 255;
  let bgB = 255;
  let validCorner = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  for (const off of sampleOffsets) {
    if (imgData[off + 3] > 20) {
      sumR += imgData[off];
      sumG += imgData[off + 1];
      sumB += imgData[off + 2];
      validCorner++;
    }
  }
  if (validCorner > 0) {
    bgR = Math.round(sumR / validCorner);
    bgG = Math.round(sumG / validCorner);
    bgB = Math.round(sumB / validCorner);
  }

  const tol = 14;
  const step = width > 1000 ? 2 : 1;
  let minPx = width;
  let minPy = height;
  let maxPx = -1;
  let maxPy = -1;

  for (let py = 0; py < height; py += step) {
    const rowOff = py * width * 4;
    for (let px = 0; px < width; px += step) {
      const idx = rowOff + px * 4;
      const a = imgData[idx + 3];
      if (a < 15) continue;
      const dr = Math.abs(imgData[idx] - bgR);
      const dg = Math.abs(imgData[idx + 1] - bgG);
      const db = Math.abs(imgData[idx + 2] - bgB);
      if (dr > tol || dg > tol || db > tol) {
        if (px < minPx) minPx = px;
        if (px > maxPx) maxPx = px;
        if (py < minPy) minPy = py;
        if (py > maxPy) maxPy = py;
      }
    }
  }

  if (maxPx < minPx || maxPy < minPy) return undefined;

  return clampBox(
    {
      x: minPx / renderScale,
      y: minPy / renderScale,
      width: (maxPx - minPx + step) / renderScale,
      height: (maxPy - minPy + step) / renderScale,
    },
    pageW,
    pageH
  );
}

function clusterDocumentBlocks(
  textItems: ExtractedTextItem[],
  pageW: number,
  pageH: number
): Array<{ blockId: string; rect: RectPt }> {
  if (textItems.length === 0) return [];
  const sorted = [...textItems].sort((a, b) => a.y - b.y);
  const gapThreshold = Math.max(24, pageH * 0.045);
  const groups: ExtractedTextItem[][] = [[sorted[0]]];

  for (let i = 1; i < sorted.length; i++) {
    const prevGroup = groups[groups.length - 1];
    const prevMaxY = Math.max(...prevGroup.map((t) => t.y + t.height));
    if (sorted[i].y - prevMaxY > gapThreshold) {
      groups.push([sorted[i]]);
    } else {
      prevGroup.push(sorted[i]);
    }
  }

  return groups
    .map((grp, idx) => {
      const r = unionRects(
        grp.map((t) => ({
          x: t.x,
          y: t.y,
          width: t.width,
          height: t.height,
        }))
      );
      if (!r) return null;
      return {
        blockId: `block-${String.fromCharCode(65 + (idx % 26))}`,
        rect: clampBox(r, pageW, pageH),
      };
    })
    .filter((b): b is { blockId: string; rect: RectPt } => Boolean(b));
}

function buildDetectedBounds(
  pageW: number,
  pageH: number,
  textItems: ExtractedTextItem[],
  vectorBBox?: RectPt,
  imageBBox?: RectPt,
  pixelBBox?: RectPt
): DetectedPageBounds {
  const textBBox = unionRects(
    textItems.map((t) => ({ x: t.x, y: t.y, width: t.width, height: t.height }))
  );

  // Combine pixel outer ink bbox with text bbox; also include vector/image if pixel bbox unavailable
  const candidates: RectPt[] = [];
  if (pixelBBox) candidates.push(pixelBBox);
  if (textBBox) candidates.push(textBBox);
  if (!pixelBBox && vectorBBox) candidates.push(vectorBBox);
  if (!pixelBBox && imageBBox) candidates.push(imageBBox);

  const rawUnion = unionRects(candidates) || {
    x: 0,
    y: 0,
    width: pageW,
    height: pageH,
  };
  const contentBBox = clampBox(rawUnion, pageW, pageH);

  return {
    textBBox: textBBox ? clampBox(textBBox, pageW, pageH) : undefined,
    vectorBBox: vectorBBox || pixelBBox,
    imageBBox,
    contentBBox,
    whitespaceInsetsPt: {
      top: Number(contentBBox.y.toFixed(2)),
      left: Number(contentBBox.x.toFixed(2)),
      right: Number(Math.max(0, pageW - (contentBBox.x + contentBBox.width)).toFixed(2)),
      bottom: Number(Math.max(0, pageH - (contentBBox.y + contentBBox.height)).toFixed(2)),
    },
    blockBoxes: clusterDocumentBlocks(textItems, pageW, pageH),
  };
}

export async function renderPdfPagesForStudio(
  pdfBytes: Uint8Array,
  options: {
    renderScale?: number;
    enableOcrFallback?: boolean;
    ocrLanguage?: string;
    maxPagesForAi?: number;
    onProgress?: (stage: string, current: number, total: number) => void;
  } = {}
): Promise<{
  pageCount: number;
  pages: RenderedPdfPageData[];
  originalPages: OriginalPageMeta[];
}> {
  const {
    renderScale = 1.8,
    enableOcrFallback = true,
    ocrLanguage = 'eng',
    maxPagesForAi = 25,
    onProgress,
  } = options;

  const loadingTask = pdfjsLib.getDocument({ data: pdfBytes.slice() });
  const pdf = await loadingTask.promise;
  const pageCount = pdf.numPages;
  const pagesToProcess = Math.min(pageCount, maxPagesForAi);

  const pages: RenderedPdfPageData[] = [];
  const originalPages: OriginalPageMeta[] = [];
  let ocrWorker: Awaited<ReturnType<typeof createWorker>> | null = null;

  try {
    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      onProgress?.('Rendering PDF page & detecting content bounds', pageNum, pageCount);
      const page = await pdf.getPage(pageNum);
      const baseViewport = page.getViewport({ scale: 1 });
      const widthPt = baseViewport.width;
      const heightPt = baseViewport.height;
      const orientation: 'portrait' | 'landscape' =
        widthPt > heightPt ? 'landscape' : 'portrait';

      // Adapt render scale on smaller viewports or multi-page documents to conserve device memory
      const isNarrowViewport =
        typeof window !== 'undefined' && window.innerWidth < 768;
      const effectiveScale =
        pageCount > 4 && pageNum > 2
          ? Math.min(renderScale, 0.9)
          : isNarrowViewport
          ? Math.min(renderScale, 1.35)
          : renderScale;

      const viewport = page.getViewport({ scale: effectiveScale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Failed to create 2D canvas context for PDF rendering');
      }

      await page.render({
        canvasContext: ctx,
        viewport,
        canvas,
      }).promise;

      // Use compressed JPEG previews on non-primary or mobile multi-page pages to save IndexedDB RAM
      const useCompactPreview = pageNum > 2 || (isNarrowViewport && pageCount > 1);
      const imageBase64 = useCompactPreview
        ? canvas.toDataURL('image/jpeg', 0.82)
        : canvas.toDataURL('image/png');
      const pixelBBox = scanCanvasContentBounds(
        canvas,
        effectiveScale,
        widthPt,
        heightPt
      );
      releaseCanvas(canvas);
      await yieldToMainThread();
      const { vectorBBox, imageBBox } = await analyzeOperatorListBounds(
        page,
        baseViewport.transform,
        widthPt,
        heightPt
      );

      // Extract exact PDF.js text coordinates
      const textContent = await page.getTextContent();
      const extractedTextItems: ExtractedTextItem[] = [];

      for (const item of textContent.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        const tx = pdfjsLib.Util.transform(
          baseViewport.transform,
          item.transform
        );
        const fontHeight = Math.hypot(tx[2], tx[3]) || Math.abs(item.height) || 11;
        const x = tx[4];
        const yBaseline = tx[5];
        const y = Math.max(0, yBaseline - fontHeight * 0.85);
        const width = Math.max(4, item.width);
        const height = Math.max(fontHeight * 1.15, item.height || fontHeight);

        extractedTextItems.push({
          text: item.str,
          x: Number(x.toFixed(2)),
          y: Number(y.toFixed(2)),
          width: Number(width.toFixed(2)),
          height: Number(height.toFixed(2)),
          fontSize: Number(fontHeight.toFixed(2)),
          fontName: item.fontName || 'Helvetica',
        });
      }

      let usedOcr = false;
      // If scanned / image-based PDF (very few text items) and OCR enabled
      if (
        enableOcrFallback &&
        extractedTextItems.length < 3 &&
        pageNum <= pagesToProcess
      ) {
        onProgress?.('Running Tesseract OCR on scanned page', pageNum, pageCount);
        if (!ocrWorker) {
          ocrWorker = await createWorker(ocrLanguage);
        }
        const ocrResult = await ocrWorker.recognize(imageBase64);
        const words = (ocrResult.data as unknown as {
          blocks?: Array<{
            paragraphs?: Array<{
              lines?: Array<{
                text: string;
                bbox: { x0: number; y0: number; x1: number; y1: number };
              }>;
            }>;
          }>;
        }).blocks;

        if (words) {
          for (const block of words) {
            for (const para of block.paragraphs || []) {
              for (const line of para.lines || []) {
                const txt = (line.text || '').trim();
                if (!txt) continue;
                const xPt = line.bbox.x0 / renderScale;
                const yPt = line.bbox.y0 / renderScale;
                const wPt = (line.bbox.x1 - line.bbox.x0) / renderScale;
                const hPt = (line.bbox.y1 - line.bbox.y0) / renderScale;
                extractedTextItems.push({
                  text: txt,
                  x: Number(xPt.toFixed(2)),
                  y: Number(yPt.toFixed(2)),
                  width: Number(Math.max(8, wPt).toFixed(2)),
                  height: Number(Math.max(10, hPt).toFixed(2)),
                  fontSize: Number(Math.max(8, hPt * 0.78).toFixed(1)),
                  fontName: 'Helvetica',
                });
              }
            }
          }
          usedOcr = true;
        }
      }

      const detectedBounds = buildDetectedBounds(
        widthPt,
        heightPt,
        extractedTextItems,
        vectorBBox,
        imageBBox,
        pixelBBox
      );

      originalPages.push({
        pageNumber: pageNum,
        sourcePdfPageNumber: pageNum,
        widthPt,
        heightPt,
        orientation,
        previewImageDataUrl: imageBase64,
        contentBBox: detectedBounds.contentBBox,
        detectedBounds,
      });

      if (pageNum <= pagesToProcess) {
        pages.push({
          pageNumber: pageNum,
          widthPt,
          heightPt,
          orientation,
          imageBase64,
          extractedTextItems,
          usedOcr,
          detectedBounds,
        });
      }
    }
  } finally {
    if (ocrWorker) {
      await ocrWorker.terminate();
    }
  }

  return { pageCount, pages, originalPages };
}

export async function detectPageContentBoundsFromBase64(
  pdfBase64: string,
  pageNumber = 1
): Promise<DetectedPageBounds | null> {
  try {
    const bytes = base64ToUint8Array(pdfBase64);
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const clampedPage = Math.max(1, Math.min(pageNumber, pdf.numPages));
    const page = await pdf.getPage(clampedPage);
    const baseViewport = page.getViewport({ scale: 1 });
    const renderScale = 1.5;
    const viewport = page.getViewport({ scale: renderScale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    const pixelBBox = scanCanvasContentBounds(
      canvas,
      renderScale,
      baseViewport.width,
      baseViewport.height
    );
    const { vectorBBox, imageBBox } = await analyzeOperatorListBounds(
      page,
      baseViewport.transform,
      baseViewport.width,
      baseViewport.height
    );

    const tc = await page.getTextContent();
    const textItems: ExtractedTextItem[] = [];
    for (const item of tc.items) {
      if (!('str' in item) || !item.str.trim()) continue;
      const tx = pdfjsLib.Util.transform(baseViewport.transform, item.transform);
      const fontHeight = Math.hypot(tx[2], tx[3]) || Math.abs(item.height) || 11;
      textItems.push({
        text: item.str,
        x: Number(tx[4].toFixed(2)),
        y: Number(Math.max(0, tx[5] - fontHeight * 0.85).toFixed(2)),
        width: Number(Math.max(4, item.width).toFixed(2)),
        height: Number(Math.max(fontHeight * 1.15, item.height || fontHeight).toFixed(2)),
        fontSize: Number(fontHeight.toFixed(2)),
        fontName: item.fontName || 'Helvetica',
      });
    }

    releaseCanvas(canvas);
    return buildDetectedBounds(
      baseViewport.width,
      baseViewport.height,
      textItems,
      vectorBBox,
      imageBBox,
      pixelBBox
    );
  } catch (err) {
    console.warn('Boundary detection failed:', err);
    return null;
  }
}

export async function renderSinglePagePreview(
  pdfBase64: string,
  pageNumber: number,
  scale = 1.5
): Promise<string | null> {
  const sig = getPdfSignature(pdfBase64);
  const cacheKey = `${sig}:p${pageNumber}:s${scale.toFixed(2)}`;
  const cached = previewCache.get(cacheKey);
  if (cached) return cached;

  try {
    const bytes = base64ToUint8Array(pdfBase64);
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const clampedPage = Math.max(1, Math.min(pageNumber, pdf.numPages));
    const page = await pdf.getPage(clampedPage);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    const dataUrl = scale <= 0.6 ? canvas.toDataURL('image/jpeg', 0.78) : canvas.toDataURL('image/png');
    releaseCanvas(canvas);
    cacheSet(cacheKey, dataUrl);
    return dataUrl;
  } catch (err) {
    console.error('Preview render failed:', err);
    return null;
  }
}

export async function renderPageThumbnail(
  pdfBase64: string,
  pageNumber: number
): Promise<string | null> {
  return renderSinglePagePreview(pdfBase64, pageNumber, 0.35);
}
