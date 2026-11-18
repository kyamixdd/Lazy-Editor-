import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { createWorker } from 'tesseract.js';
import {
  DetectedPageBounds,
  OriginalPageMeta,
  RectPt,
} from '../types/pdfStudio';

if (typeof pdfjsWorker === 'string' && pdfjsWorker.length > 0) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
}

// True LRU cache of rendered page previews & thumbnails keyed by pdfSignature + pageNumber + scale
const previewCache = new Map<string, string>();
const MAX_PREVIEW_CACHE = 48;
const inFlightPreviewRenders = new Map<string, Promise<string | null>>();

// Small LRU cache of parsed PDFDocumentProxy instances so page/thumbnail switching skips re-parsing
const pdfDocCache = new Map<string, Promise<pdfjsLib.PDFDocumentProxy>>();
const MAX_DOC_CACHE = 3;

function cacheGet(key: string): string | undefined {
  const val = previewCache.get(key);
  if (val !== undefined) {
    previewCache.delete(key);
    previewCache.set(key, val);
  }
  return val;
}

function cacheSet(key: string, val: string) {
  if (previewCache.has(key)) {
    previewCache.delete(key);
  } else if (previewCache.size >= MAX_PREVIEW_CACHE) {
    const oldest = previewCache.keys().next().value;
    if (oldest) previewCache.delete(oldest);
  }
  previewCache.set(key, val);
}

function getPdfSignature(base64: string): string {
  return `${base64.length}:${base64.slice(0, 32)}:${base64.slice(-24)}`;
}

async function getCachedPdfDocument(base64: string): Promise<pdfjsLib.PDFDocumentProxy> {
  const sig = getPdfSignature(base64);
  const existing = pdfDocCache.get(sig);
  if (existing) {
    pdfDocCache.delete(sig);
    pdfDocCache.set(sig, existing);
    return existing;
  }
  if (pdfDocCache.size >= MAX_DOC_CACHE) {
    const oldestKey = pdfDocCache.keys().next().value;
    if (oldestKey) {
      const oldestPromise = pdfDocCache.get(oldestKey);
      pdfDocCache.delete(oldestKey);
      oldestPromise
        ?.then((d) => {
          try {
            void d.loadingTask.destroy();
          } catch {
            // Ignore cleanup failure
          }
        })
        .catch(() => undefined);
    }
  }
  const promise = pdfjsLib
    .getDocument({ data: base64ToUint8Array(base64) })
    .promise.catch((err) => {
      pdfDocCache.delete(sig);
      throw err;
    });
  pdfDocCache.set(sig, promise);
  return promise;
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
  resolvedFontFamily?: string;
  fontWeight?: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  color?: string;
  rotation?: number;
  confidence?: number;
  fromOcr?: boolean;
}

export interface ExtractedVectorPrimitive {
  kind: 'line' | 'rect' | 'image';
  x: number;
  y: number;
  width: number;
  height: number;
  strokeColor?: string;
  fillColor?: string;
  lineWidth?: number;
  hasStroke?: boolean;
  hasFill?: boolean;
}

export interface RenderedPdfPageData {
  pageNumber: number;
  widthPt: number;
  heightPt: number;
  orientation: 'portrait' | 'landscape';
  imageBase64: string;
  extractedTextItems: ExtractedTextItem[];
  vectorPrimitives?: ExtractedVectorPrimitive[];
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

function rgbUnitToHex(r: number, g: number, b: number): string {
  const clamp255 = (v: number) => {
    const scaled = v <= 1 && (r <= 1 && g <= 1 && b <= 1) ? v * 255 : v;
    return Math.max(0, Math.min(255, Math.round(scaled)));
  };
  const toHex = (n: number) => clamp255(n).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

function cmykToHex(c: number, m: number, y: number, k: number): string {
  const r = 1 - Math.min(1, c * (1 - k) + k);
  const g = 1 - Math.min(1, m * (1 - k) + k);
  const b = 1 - Math.min(1, y * (1 - k) + k);
  return rgbUnitToHex(r, g, b);
}

function resolveFontMetadata(
  pdfFontName: string,
  styles?: Record<string, { fontFamily?: string; ascent?: number; descent?: number }>
): {
  resolvedFontFamily: string;
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
} {
  const styleEntry = styles?.[pdfFontName];
  const rawCombined = `${pdfFontName || ''} ${styleEntry?.fontFamily || ''}`.toLowerCase();

  const fontWeight: 'normal' | 'bold' =
    /bold|black|heavy|semibold|demibold|\b700\b|\b800\b/.test(rawCombined)
      ? 'bold'
      : 'normal';
  const fontStyle: 'normal' | 'italic' =
    /italic|oblique|slant/.test(rawCombined) ? 'italic' : 'normal';

  let resolvedFontFamily = 'Helvetica';
  if (/courier|mono|consolas|jetbrains/.test(rawCombined)) {
    resolvedFontFamily = 'Courier';
  } else if (/times|serif|georgia|garamond|cambria|palatino/.test(rawCombined)) {
    resolvedFontFamily = 'Times-Roman';
  } else {
    resolvedFontFamily = 'Helvetica';
  }

  return { resolvedFontFamily, fontWeight, fontStyle };
}

function sampleTextColorFromCanvas(
  canvas: HTMLCanvasElement,
  scale: number,
  rect: { x: number; y: number; width: number; height: number }
): string {
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return '#111827';
    const sx = Math.max(0, Math.floor(rect.x * scale));
    const sy = Math.max(0, Math.floor(rect.y * scale));
    const sw = Math.max(2, Math.min(canvas.width - sx, Math.ceil(rect.width * scale)));
    const sh = Math.max(2, Math.min(canvas.height - sy, Math.ceil(rect.height * scale)));
    if (sw <= 0 || sh <= 0) return '#111827';

    const data = ctx.getImageData(sx, sy, sw, sh).data;
    // Sample outer corner of page as background reference (default white)
    const bgData = ctx.getImageData(0, 0, 1, 1).data;
    const bgR = bgData[3] > 20 ? bgData[0] : 255;
    const bgG = bgData[3] > 20 ? bgData[1] : 255;
    const bgB = bgData[3] > 20 ? bgData[2] : 255;

    let bestDist = 35;
    let bestHex = '#111827';
    // Collect top saturated/contrasting ink pixels and average near max contrast
    const step = sw * sh > 2500 ? 2 : 1;
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let count = 0;
    let maxDistSeen = 0;

    for (let i = 0; i < data.length; i += 4 * step) {
      if (data[i + 3] < 40) continue;
      const dist =
        Math.abs(data[i] - bgR) +
        Math.abs(data[i + 1] - bgG) +
        Math.abs(data[i + 2] - bgB);
      if (dist > maxDistSeen) {
        maxDistSeen = dist;
      }
    }

    const threshold = Math.max(bestDist, maxDistSeen * 0.72);
    for (let i = 0; i < data.length; i += 4 * step) {
      if (data[i + 3] < 80) continue;
      const dist =
        Math.abs(data[i] - bgR) +
        Math.abs(data[i + 1] - bgG) +
        Math.abs(data[i + 2] - bgB);
      if (dist >= threshold) {
        sumR += data[i];
        sumG += data[i + 1];
        sumB += data[i + 2];
        count++;
      }
    }

    if (count > 0) {
      const r = Math.round(sumR / count);
      const g = Math.round(sumG / count);
      const b = Math.round(sumB / count);
      const toHex = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
      bestHex = `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
    }
    return bestHex;
  } catch {
    return '#111827';
  }
}

export async function analyzeOperatorListBounds(
  page: pdfjsLib.PDFPageProxy,
  baseTransform: number[],
  pageW: number,
  pageH: number
): Promise<{
  vectorBBox?: RectPt;
  imageBBox?: RectPt;
  vectorPrimitives: ExtractedVectorPrimitive[];
}> {
  const vectorRects: RectPt[] = [];
  const imageRects: RectPt[] = [];
  const vectorPrimitives: ExtractedVectorPrimitive[] = [];

  const parseColorArg = (args: unknown[]): string | null => {
    if (!Array.isArray(args) || args.length === 0) return null;
    if (typeof args[0] === 'string') {
      const hex = args[0].trim();
      if (/^#[0-9a-fA-F]{6}$/.test(hex)) return hex.toUpperCase();
      return hex;
    }
    if (args.length >= 3) {
      return rgbUnitToHex(Number(args[0]), Number(args[1]), Number(args[2]));
    }
    return null;
  };

  try {
    const opList = await page.getOperatorList();
    const { OPS } = pdfjsLib;
    const stack: Array<{
      ctm: number[];
      strokeColor: string;
      fillColor: string;
      lineWidth: number;
    }> = [];
    let ctm = [...baseTransform];
    let strokeColor = '#1E293B';
    let fillColor = 'transparent';
    let lineWidth = 1;
    const pageArea = pageW * pageH;

    const strokeOps = new Set<number>([
      OPS.stroke,
      OPS.closeStroke,
      OPS.fillStroke,
      OPS.eoFillStroke,
      OPS.closeFillStroke,
      OPS.closeEOFillStroke,
    ]);
    const fillOps = new Set<number>([
      OPS.fill,
      OPS.eoFill,
      OPS.fillStroke,
      OPS.eoFillStroke,
      OPS.closeFillStroke,
      OPS.closeEOFillStroke,
    ]);

    for (let i = 0; i < opList.fnArray.length; i++) {
      const fn = opList.fnArray[i];
      const args = opList.argsArray[i];

      if (fn === OPS.save) {
        stack.push({
          ctm: [...ctm],
          strokeColor,
          fillColor,
          lineWidth,
        });
      } else if (fn === OPS.restore) {
        const prev = stack.pop();
        if (prev) {
          ctm = prev.ctm;
          strokeColor = prev.strokeColor;
          fillColor = prev.fillColor;
          lineWidth = prev.lineWidth;
        } else {
          ctm = [...baseTransform];
        }
      } else if (fn === OPS.transform && Array.isArray(args) && args.length >= 6) {
        ctm = mulMatrix(ctm, args as number[]);
      } else if (fn === OPS.setLineWidth && Array.isArray(args) && args.length >= 1) {
        lineWidth = Math.max(0.5, Number(args[0]) || 1);
      } else if (fn === OPS.setStrokeRGBColor && Array.isArray(args)) {
        const parsed = parseColorArg(args);
        if (parsed) strokeColor = parsed;
      } else if (fn === OPS.setFillRGBColor && Array.isArray(args)) {
        const parsed = parseColorArg(args);
        if (parsed) fillColor = parsed;
      } else if (fn === OPS.setStrokeGray && Array.isArray(args) && args.length >= 1) {
        const v = Number(args[0]);
        strokeColor = rgbUnitToHex(v, v, v);
      } else if (fn === OPS.setFillGray && Array.isArray(args) && args.length >= 1) {
        const v = Number(args[0]);
        fillColor = rgbUnitToHex(v, v, v);
      } else if (fn === OPS.setStrokeCMYKColor && Array.isArray(args) && args.length >= 4) {
        strokeColor = cmykToHex(
          Number(args[0]),
          Number(args[1]),
          Number(args[2]),
          Number(args[3])
        );
      } else if (fn === OPS.setFillCMYKColor && Array.isArray(args) && args.length >= 4) {
        fillColor = cmykToHex(
          Number(args[0]),
          Number(args[1]),
          Number(args[2]),
          Number(args[3])
        );
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
        // Only emit interactive image objects when image is smaller than a full-page scan background
        if (
          rect.width * rect.height < pageArea * 0.85 &&
          rect.width >= 10 &&
          rect.height >= 10
        ) {
          vectorPrimitives.push({
            kind: 'image',
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          });
        }
      } else if (fn === OPS.constructPath && Array.isArray(args) && args.length >= 2) {
        // pdfjs-dist v6 format: args = [paintOpNumber, [Float32Array], minMaxFloat32Array]
        // Legacy format: args = [subOpsArray, coordsArray]
        const isV6Format = typeof args[0] === 'number';
        let paintOp: number | undefined;
        const pts: Array<[number, number]> = [];
        let isClosedRectShape = false;

        if (isV6Format) {
          paintOp = args[0] as number;
          const minMax = args[2] as ArrayLike<number> | undefined;
          const pathBufWrap = args[1] as Array<ArrayLike<number>> | undefined;
          const buf = Array.isArray(pathBufWrap) ? pathBufWrap[0] : undefined;

          if (minMax && minMax.length >= 4) {
            const minX = minMax[0];
            const minY = minMax[1];
            const maxX = minMax[2];
            const maxY = minMax[3];
            pts.push(
              applyPoint(ctm, minX, minY),
              applyPoint(ctm, maxX, minY),
              applyPoint(ctm, minX, maxY),
              applyPoint(ctm, maxX, maxY)
            );
          }

          // Inspect packed path buffer to distinguish thin lines vs closed shapes/rectangles
          if (buf && buf.length >= 6) {
            let lineSegments = 0;
            let hasClose = false;
            let idx = 0;
            while (idx < buf.length) {
              const op = buf[idx];
              if (op === 0 || op === 1) {
                if (op === 1) lineSegments++;
                if (pts.length === 0 && idx + 2 < buf.length) {
                  pts.push(applyPoint(ctm, buf[idx + 1], buf[idx + 2]));
                }
                idx += 3;
              } else if (op === 2) {
                idx += 7;
              } else if (op === 3) {
                idx += 5;
              } else if (op === 4) {
                hasClose = true;
                idx += 1;
              } else {
                break;
              }
            }
            isClosedRectShape = hasClose || lineSegments >= 3;
          }
        } else {
          paintOp = i + 1 < opList.fnArray.length ? opList.fnArray[i + 1] : undefined;
          const subOps = args[0] as number[];
          const coords = args[1] as number[];
          if (Array.isArray(subOps) && Array.isArray(coords)) {
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
                isClosedRectShape = true;
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
          }
        }

        const isStrokeOp = paintOp !== undefined && strokeOps.has(paintOp);
        const isFillOp = paintOp !== undefined && fillOps.has(paintOp);
        const isClipOp =
          paintOp === OPS.clip || paintOp === OPS.eoClip || paintOp === OPS.endPath;

        if (pts.length >= 2) {
          const xs = pts.map((p) => p[0]);
          const ys = pts.map((p) => p[1]);
          const rawW = Math.max(...xs) - Math.min(...xs);
          const rawH = Math.max(...ys) - Math.min(...ys);
          const rect = clampBox(
            { x: Math.min(...xs), y: Math.min(...ys), width: rawW, height: rawH },
            pageW,
            pageH
          );
          // Ignore full-page background rectangles (>96% area) and pure clipping paths
          if (
            !isClipOp &&
            rect.width * rect.height < pageArea * 0.96 &&
            (rawW > 1 || rawH > 1)
          ) {
            vectorRects.push(rect);

            if (!isFillOp && (rawH <= 3 || rawW <= 3)) {
              vectorPrimitives.push({
                kind: 'line',
                x: rect.x,
                y: rect.y,
                width: Math.max(4, Number(rawW.toFixed(2))),
                height: Math.max(2, Number(rawH.toFixed(2))),
                strokeColor,
                lineWidth,
                hasStroke: true,
                hasFill: false,
              });
            } else if (
              (isClosedRectShape || isFillOp || isStrokeOp) &&
              rawW >= 8 &&
              rawH >= 6 &&
              (isStrokeOp || isFillOp)
            ) {
              vectorPrimitives.push({
                kind: 'rect',
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
                strokeColor: isStrokeOp ? strokeColor : undefined,
                fillColor: isFillOp && fillColor !== 'transparent' ? fillColor : undefined,
                lineWidth,
                hasStroke: isStrokeOp,
                hasFill: isFillOp,
              });
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
    vectorPrimitives,
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
    isCancelled?: () => boolean;
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
    isCancelled,
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
      if (isCancelled?.()) {
        throw new Error('PDF scan cancelled.');
      }
      onProgress?.('Reading PDF page & extracting structure', pageNum, pageCount);
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

      onProgress?.('Extracting PDF text, fonts & coordinates', pageNum, pageCount);
      // Extract exact PDF.js text coordinates and sample exact rendered colors before releasing canvas
      const textContent = await page.getTextContent();
      const extractedTextItems: ExtractedTextItem[] = [];
      const stylesMap = (textContent.styles || {}) as Record<
        string,
        { fontFamily?: string; ascent?: number; descent?: number }
      >;

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
        const fontMeta = resolveFontMetadata(item.fontName || 'Helvetica', stylesMap);
        const sampledColor = sampleTextColorFromCanvas(canvas, effectiveScale, {
          x,
          y,
          width,
          height,
        });

        extractedTextItems.push({
          text: item.str,
          x: Number(x.toFixed(2)),
          y: Number(y.toFixed(2)),
          width: Number(width.toFixed(2)),
          height: Number(height.toFixed(2)),
          fontSize: Number(fontHeight.toFixed(2)),
          fontName: item.fontName || 'Helvetica',
          resolvedFontFamily: fontMeta.resolvedFontFamily,
          fontWeight: fontMeta.fontWeight,
          fontStyle: fontMeta.fontStyle,
          color: sampledColor,
          confidence: 0.98,
          fromOcr: false,
        });
      }

      let usedOcr = false;
      // If scanned / image-based PDF (very few text items) and OCR enabled
      if (
        enableOcrFallback &&
        extractedTextItems.length < 3 &&
        pageNum <= pagesToProcess
      ) {
        onProgress?.('Running local Tesseract OCR on scanned page', pageNum, pageCount);
        if (!ocrWorker) {
          ocrWorker = await createWorker(ocrLanguage);
        }
        const ocrResult = await ocrWorker.recognize(imageBase64);
        const words = (ocrResult.data as unknown as {
          blocks?: Array<{
            paragraphs?: Array<{
              lines?: Array<{
                text: string;
                confidence?: number;
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
                const xPt = line.bbox.x0 / effectiveScale;
                const yPt = line.bbox.y0 / effectiveScale;
                const wPt = (line.bbox.x1 - line.bbox.x0) / effectiveScale;
                const hPt = (line.bbox.y1 - line.bbox.y0) / effectiveScale;
                const ocrColor = sampleTextColorFromCanvas(canvas, effectiveScale, {
                  x: xPt,
                  y: yPt,
                  width: wPt,
                  height: hPt,
                });
                const lineConf =
                  typeof line.confidence === 'number'
                    ? Math.max(0.2, Math.min(0.98, line.confidence / 100))
                    : 0.72;
                extractedTextItems.push({
                  text: txt,
                  x: Number(xPt.toFixed(2)),
                  y: Number(yPt.toFixed(2)),
                  width: Number(Math.max(8, wPt).toFixed(2)),
                  height: Number(Math.max(10, hPt).toFixed(2)),
                  fontSize: Number(Math.max(8, hPt * 0.78).toFixed(1)),
                  fontName: 'Helvetica',
                  resolvedFontFamily: 'Helvetica',
                  fontWeight: 'normal',
                  fontStyle: 'normal',
                  color: ocrColor,
                  confidence: Number(lineConf.toFixed(2)),
                  fromOcr: true,
                });
              }
            }
          }
          usedOcr = true;
        }
      }

      releaseCanvas(canvas);
      await yieldToMainThread();
      onProgress?.('Inspecting vector shapes, borders & images', pageNum, pageCount);
      const { vectorBBox, imageBBox, vectorPrimitives } =
        await analyzeOperatorListBounds(
          page,
          baseViewport.transform,
          widthPt,
          heightPt
        );

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
          vectorPrimitives,
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
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const existingTask = inFlightPreviewRenders.get(cacheKey);
  if (existingTask) return existingTask;

  const task = (async () => {
    try {
      const pdf = await getCachedPdfDocument(pdfBase64);
      const clampedPage = Math.max(1, Math.min(pageNumber, pdf.numPages));
      const page = await pdf.getPage(clampedPage);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      const dataUrl =
        scale <= 0.6
          ? canvas.toDataURL('image/jpeg', 0.78)
          : canvas.toDataURL('image/png');
      releaseCanvas(canvas);
      cacheSet(cacheKey, dataUrl);
      return dataUrl;
    } catch (err) {
      console.error('Preview render failed:', err);
      return null;
    } finally {
      inFlightPreviewRenders.delete(cacheKey);
    }
  })();

  inFlightPreviewRenders.set(cacheKey, task);
  return task;
}

export async function renderPageThumbnail(
  pdfBase64: string,
  pageNumber: number
): Promise<string | null> {
  return renderSinglePagePreview(pdfBase64, pageNumber, 0.35);
}
