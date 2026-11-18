import * as pdfjsLib from 'pdfjs-dist';
import { createWorker } from 'tesseract.js';
import {
  DetectedPageBounds,
  ExtractedImageResource,
  OriginalPageMeta,
  RectPt,
  VectorPathCommand,
} from '../types/pdfStudio';
import {
  RawImagePlacement,
  RawTextRun,
  RawVectorPath,
} from './scanPrimitives';
import { rectIntersectionArea } from './spatialIndex';

if (typeof window !== 'undefined') {
  void import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    .then((mod) => {
      if (typeof mod.default === 'string' && mod.default.length > 0) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = mod.default;
      }
    })
    .catch(() => {
      // Non-browser environment (e.g. Node unit tests)
    });
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
  baselineY?: number;
  transformMatrix?: [number, number, number, number, number, number];
  charSpacingPt?: number;
  wordSpacingPt?: number;
  hasEOL?: boolean;
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
  rawTextRuns: RawTextRun[];
  rawVectorPaths: RawVectorPath[];
  rawImagePlacements: RawImagePlacement[];
  vectorPrimitives?: ExtractedVectorPrimitive[];
  usedOcr: boolean;
  ocrRegionsCount: number;
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
  const isUnit = r <= 1 && g <= 1 && b <= 1;
  const clamp255 = (v: number) => {
    const scaled = isUnit ? v * 255 : v;
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

function hexToRgbTuple(hex: string): [number, number, number] {
  const clean = (hex || '#111827').replace('#', '');
  if (clean.length !== 6) return [17, 24, 39];
  return [
    parseInt(clean.slice(0, 2), 16) || 0,
    parseInt(clean.slice(2, 4), 16) || 0,
    parseInt(clean.slice(4, 6), 16) || 0,
  ];
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
    const bgData = ctx.getImageData(0, 0, 1, 1).data;
    const bgR = bgData[3] > 20 ? bgData[0] : 255;
    const bgG = bgData[3] > 20 ? bgData[1] : 255;
    const bgB = bgData[3] > 20 ? bgData[2] : 255;

    const bestDist = 35;
    let bestHex = '#111827';
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

interface PdfJsImageLike {
  width?: number;
  height?: number;
  kind?: number;
  data?: Uint8ClampedArray | Uint8Array;
  bitmap?: ImageBitmap;
  interpolate?: boolean;
}

async function resolvePdfJsObject(
  objs: pdfjsLib.PDFPageProxy['objs'],
  name: string,
  timeoutMs = 1500
): Promise<PdfJsImageLike | null> {
  if (!name) return null;
  try {
    if (objs.has(name)) {
      return (objs.get(name) as PdfJsImageLike) || null;
    }
  } catch {
    // Fall through to callback form
  }

  return new Promise<PdfJsImageLike | null>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, timeoutMs);

    try {
      objs.get(name, (data: unknown) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve((data as PdfJsImageLike) || null);
        }
      });
    } catch {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(null);
      }
    }
  });
}

/**
 * Pass 4 Helper: Converts a genuine decoded PDF.js XObject or inline image buffer
 * into a lossless PNG data URL (NEVER a page screenshot).
 */
function encodePdfJsImageToDataUrl(
  imgObj: PdfJsImageLike | null,
  maskTintHex?: string
): {
  dataUrl: string;
  naturalWidth: number;
  naturalHeight: number;
  hasAlpha: boolean;
} | null {
  if (!imgObj || typeof document === 'undefined') return null;

  if (imgObj.bitmap && imgObj.bitmap.width > 0 && imgObj.bitmap.height > 0) {
    const w = imgObj.bitmap.width;
    const h = imgObj.bitmap.height;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(imgObj.bitmap, 0, 0);
    const dataUrl = c.toDataURL('image/png');
    releaseCanvas(c);
    return { dataUrl, naturalWidth: w, naturalHeight: h, hasAlpha: true };
  }

  const w = imgObj.width || 0;
  const h = imgObj.height || 0;
  const raw = imgObj.data;
  if (!raw || w <= 0 || h <= 0) return null;

  const pixelCount = w * h;
  const rgba = new Uint8ClampedArray(pixelCount * 4);
  let hasAlpha = false;

  if (raw.length >= pixelCount * 4) {
    for (let i = 0; i < pixelCount * 4; i += 4) {
      rgba[i] = raw[i];
      rgba[i + 1] = raw[i + 1];
      rgba[i + 2] = raw[i + 2];
      const a = raw[i + 3];
      rgba[i + 3] = a;
      if (a < 255) hasAlpha = true;
    }
  } else if (raw.length >= pixelCount * 3) {
    for (let p = 0, s = 0, d = 0; p < pixelCount; p++, s += 3, d += 4) {
      rgba[d] = raw[s];
      rgba[d + 1] = raw[s + 1];
      rgba[d + 2] = raw[s + 2];
      rgba[d + 3] = 255;
    }
  } else if (raw.length >= pixelCount) {
    // 8-bit grayscale or alpha mask
    const tint = maskTintHex ? hexToRgbTuple(maskTintHex) : null;
    for (let p = 0, d = 0; p < pixelCount; p++, d += 4) {
      const v = raw[p];
      if (tint && maskTintHex) {
        rgba[d] = tint[0];
        rgba[d + 1] = tint[1];
        rgba[d + 2] = tint[2];
        rgba[d + 3] = 255 - v;
        hasAlpha = true;
      } else {
        rgba[d] = v;
        rgba[d + 1] = v;
        rgba[d + 2] = v;
        rgba[d + 3] = 255;
      }
    }
  } else {
    // 1-bpp monochrome image mask (kind === 1)
    const rowBytes = Math.ceil(w / 8);
    const tint = hexToRgbTuple(maskTintHex || '#111827');
    hasAlpha = Boolean(maskTintHex);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const byteIdx = y * rowBytes + (x >> 3);
        const bit = (raw[byteIdx] >> (7 - (x & 7))) & 1;
        const d = (y * w + x) * 4;
        if (maskTintHex) {
          rgba[d] = tint[0];
          rgba[d + 1] = tint[1];
          rgba[d + 2] = tint[2];
          rgba[d + 3] = bit === 0 ? 255 : 0;
        } else {
          const val = bit ? 255 : 0;
          rgba[d] = val;
          rgba[d + 1] = val;
          rgba[d + 2] = val;
          rgba[d + 3] = 255;
        }
      }
    }
  }

  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  const imageData = new ImageData(rgba, w, h);
  ctx.putImageData(imageData, 0, 0);
  const dataUrl = c.toDataURL('image/png');
  releaseCanvas(c);

  return { dataUrl, naturalWidth: w, naturalHeight: h, hasAlpha };
}

function sampleCubicBezierPoints(
  x0: number,
  y0: number,
  cx1: number,
  cy1: number,
  cx2: number,
  cy2: number,
  x3: number,
  y3: number,
  steps = 6
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const mt = 1 - t;
    const x =
      mt * mt * mt * x0 +
      3 * mt * mt * t * cx1 +
      3 * mt * t * t * cx2 +
      t * t * t * x3;
    const y =
      mt * mt * mt * y0 +
      3 * mt * mt * t * cy1 +
      3 * mt * t * t * cy2 +
      t * t * t * y3;
    out.push([x, y]);
  }
  return out;
}

function sampleQuadBezierPoints(
  x0: number,
  y0: number,
  cx: number,
  cy: number,
  x2: number,
  y2: number,
  steps = 5
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const mt = 1 - t;
    const x = mt * mt * x0 + 2 * mt * t * cx + t * t * x2;
    const y = mt * mt * y0 + 2 * mt * t * cy + t * t * y2;
    out.push([x, y]);
  }
  return out;
}

/**
 * Pass 3 & Pass 4 Core Operator Inspector:
 * Walks the PDF page operator list with full graphics state (CTM stack, stroke/fill color,
 * dash patterns, caps/joins, opacity/alpha, clipping paths), decodes all path geometry
 * (lines, rects, rounded rects, Bezier curves, polygons), AND extracts actual embedded
 * image resources from page.objs / page.commonObjs / inline images.
 */
export async function analyzeOperatorListBounds(
  page: pdfjsLib.PDFPageProxy,
  baseTransform: number[],
  pageW: number,
  pageH: number,
  pageNumber = 1,
  sharedImageResources?: Record<string, ExtractedImageResource>
): Promise<{
  vectorBBox?: RectPt;
  imageBBox?: RectPt;
  vectorPrimitives: ExtractedVectorPrimitive[];
  rawVectorPaths: RawVectorPath[];
  rawImagePlacements: RawImagePlacement[];
}> {
  const vectorRects: RectPt[] = [];
  const imageRects: RectPt[] = [];
  const vectorPrimitives: ExtractedVectorPrimitive[] = [];
  const rawVectorPaths: RawVectorPath[] = [];
  const rawImagePlacements: RawImagePlacement[] = [];
  const imageResources = sharedImageResources || {};

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

    interface GState {
      ctm: number[];
      strokeColor: string;
      fillColor: string;
      lineWidth: number;
      dashArray: number[];
      lineCap: 'butt' | 'round' | 'square';
      lineJoin: 'miter' | 'round' | 'bevel';
      fillAlpha: number;
      strokeAlpha: number;
    }

    const stack: GState[] = [];
    let state: GState = {
      ctm: [...baseTransform],
      strokeColor: '#1E293B',
      fillColor: 'transparent',
      lineWidth: 1,
      dashArray: [],
      lineCap: 'butt',
      lineJoin: 'miter',
      fillAlpha: 1,
      strokeAlpha: 1,
    };

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

    let zSeq = 0;

    for (let i = 0; i < opList.fnArray.length; i++) {
      const fn = opList.fnArray[i];
      const args = opList.argsArray[i];

      if (fn === OPS.save) {
        stack.push({
          ctm: [...state.ctm],
          strokeColor: state.strokeColor,
          fillColor: state.fillColor,
          lineWidth: state.lineWidth,
          dashArray: [...state.dashArray],
          lineCap: state.lineCap,
          lineJoin: state.lineJoin,
          fillAlpha: state.fillAlpha,
          strokeAlpha: state.strokeAlpha,
        });
      } else if (fn === OPS.restore) {
        const prev = stack.pop();
        if (prev) {
          state = prev;
        } else {
          state.ctm = [...baseTransform];
        }
      } else if (fn === OPS.transform && Array.isArray(args) && args.length >= 6) {
        state.ctm = mulMatrix(state.ctm, args as number[]);
      } else if (fn === OPS.setLineWidth && Array.isArray(args) && args.length >= 1) {
        state.lineWidth = Math.max(0.25, Number(args[0]) || 1);
      } else if (fn === OPS.setLineCap && Array.isArray(args) && args.length >= 1) {
        const capNum = Number(args[0]);
        state.lineCap = capNum === 1 ? 'round' : capNum === 2 ? 'square' : 'butt';
      } else if (fn === OPS.setLineJoin && Array.isArray(args) && args.length >= 1) {
        const joinNum = Number(args[0]);
        state.lineJoin = joinNum === 1 ? 'round' : joinNum === 2 ? 'bevel' : 'miter';
      } else if (fn === OPS.setDash && Array.isArray(args) && Array.isArray(args[0])) {
        state.dashArray = (args[0] as number[])
          .map((n) => Number(n))
          .filter((n) => Number.isFinite(n) && n > 0);
      } else if (fn === OPS.setGState && Array.isArray(args) && Array.isArray(args[0])) {
        for (const pair of args[0] as Array<[string, unknown]>) {
          if (!Array.isArray(pair) || pair.length < 2) continue;
          const [key, val] = pair;
          if (key === 'ca' && typeof val === 'number') state.fillAlpha = val;
          else if (key === 'CA' && typeof val === 'number') state.strokeAlpha = val;
          else if (key === 'LW' && typeof val === 'number') state.lineWidth = val;
        }
      } else if (fn === OPS.setStrokeRGBColor && Array.isArray(args)) {
        const parsed = parseColorArg(args);
        if (parsed) state.strokeColor = parsed;
      } else if (fn === OPS.setFillRGBColor && Array.isArray(args)) {
        const parsed = parseColorArg(args);
        if (parsed) state.fillColor = parsed;
      } else if (fn === OPS.setStrokeGray && Array.isArray(args) && args.length >= 1) {
        const v = Number(args[0]);
        state.strokeColor = rgbUnitToHex(v, v, v);
      } else if (fn === OPS.setFillGray && Array.isArray(args) && args.length >= 1) {
        const v = Number(args[0]);
        state.fillColor = rgbUnitToHex(v, v, v);
      } else if (fn === OPS.setStrokeCMYKColor && Array.isArray(args) && args.length >= 4) {
        state.strokeColor = cmykToHex(
          Number(args[0]),
          Number(args[1]),
          Number(args[2]),
          Number(args[3])
        );
      } else if (fn === OPS.setFillCMYKColor && Array.isArray(args) && args.length >= 4) {
        state.fillColor = cmykToHex(
          Number(args[0]),
          Number(args[1]),
          Number(args[2]),
          Number(args[3])
        );
      } else if (
        fn === OPS.paintImageXObject ||
        fn === OPS.paintInlineImageXObject ||
        fn === OPS.paintImageMaskXObject ||
        fn === OPS.paintImageXObjectRepeat
      ) {
        const ctm = state.ctm;
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

        if (rect.width < 3 || rect.height < 3) continue;

        if (rect.width * rect.height < pageArea * 0.97) {
          imageRects.push(rect);
        }

        // Compute displayed rotation from CTM basis vector
        const imgAngleRad = Math.atan2(ctm[1], ctm[0]);
        const imgRot = Math.round(((imgAngleRad * 180) / Math.PI) % 360);

        const isMask = fn === OPS.paintImageMaskXObject;
        const isInline = fn === OPS.paintInlineImageXObject;
        const objName =
          typeof args?.[0] === 'string'
            ? (args[0] as string)
            : `inline-${pageNumber}-${rawImagePlacements.length + 1}`;
        const resourceId = `imgres-${objName}`;

        if (!imageResources[resourceId]) {
          let imgObj: PdfJsImageLike | null = null;
          if (isInline || isMask) {
            imgObj = (args?.[0] as PdfJsImageLike) || null;
          } else if (typeof args?.[0] === 'string') {
            imgObj =
              (await resolvePdfJsObject(page.objs, args[0])) ||
              (await resolvePdfJsObject(page.commonObjs, args[0], 600));
          }
          const encoded = encodePdfJsImageToDataUrl(
            imgObj,
            isMask ? state.fillColor : undefined
          );
          if (encoded) {
            imageResources[resourceId] = {
              id: resourceId,
              sourceXObjectName: objName,
              dataUrl: encoded.dataUrl,
              mimeType: 'image/png',
              naturalWidth: encoded.naturalWidth,
              naturalHeight: encoded.naturalHeight,
              hasAlpha: encoded.hasAlpha,
              hasMask: isMask,
              isInlineImage: isInline,
              usageCount: 1,
            };
          }
        } else {
          imageResources[resourceId].usageCount += 1;
        }

        const res = imageResources[resourceId];
        zSeq++;
        rawImagePlacements.push({
          id: `el-p${pageNumber}-img-${rawImagePlacements.length + 1}`,
          pageNumber,
          resourceId,
          sourceXObjectName: objName,
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          rotation: Math.abs(imgRot) <= 1 ? 0 : imgRot,
          transformMatrix: [
            Number(ctm[0].toFixed(4)),
            Number(ctm[1].toFixed(4)),
            Number(ctm[2].toFixed(4)),
            Number(ctm[3].toFixed(4)),
            Number(ctm[4].toFixed(2)),
            Number(ctm[5].toFixed(2)),
          ],
          naturalWidth: res?.naturalWidth || Math.round(rect.width),
          naturalHeight: res?.naturalHeight || Math.round(rect.height),
          hasAlpha: Boolean(res?.hasAlpha),
          hasMask: isMask,
          isInlineImage: isInline,
          isImageMask: isMask,
          zOrder: zSeq,
          originalObjectRef: objName,
        });

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
        const ctm = state.ctm;
        const isV6Format = typeof args[0] === 'number';
        let paintOp: number | undefined;
        const commands: VectorPathCommand[] = [];
        const sampledPts: Array<[number, number]> = [];
        let isClosed = false;
        let curX = 0;
        let curY = 0;
        let startX = 0;
        let startY = 0;

        if (isV6Format) {
          paintOp = args[0] as number;
          const pathBufWrap = args[1] as Array<ArrayLike<number>> | undefined;
          const buf = Array.isArray(pathBufWrap) ? pathBufWrap[0] : undefined;

          if (buf && buf.length >= 3) {
            let idx = 0;
            while (idx < buf.length) {
              const op = buf[idx];
              if (op === 0 && idx + 2 < buf.length) {
                const [px, py] = applyPoint(ctm, buf[idx + 1], buf[idx + 2]);
                curX = px;
                curY = py;
                startX = px;
                startY = py;
                sampledPts.push([px, py]);
                commands.push({ op: 'M', args: [Number(px.toFixed(2)), Number(py.toFixed(2))] });
                idx += 3;
              } else if (op === 1 && idx + 2 < buf.length) {
                const [px, py] = applyPoint(ctm, buf[idx + 1], buf[idx + 2]);
                curX = px;
                curY = py;
                sampledPts.push([px, py]);
                commands.push({ op: 'L', args: [Number(px.toFixed(2)), Number(py.toFixed(2))] });
                idx += 3;
              } else if (op === 2 && idx + 6 < buf.length) {
                const [c1x, c1y] = applyPoint(ctm, buf[idx + 1], buf[idx + 2]);
                const [c2x, c2y] = applyPoint(ctm, buf[idx + 3], buf[idx + 4]);
                const [px, py] = applyPoint(ctm, buf[idx + 5], buf[idx + 6]);
                const curveSamples = sampleCubicBezierPoints(
                  curX,
                  curY,
                  c1x,
                  c1y,
                  c2x,
                  c2y,
                  px,
                  py,
                  6
                );
                sampledPts.push(...curveSamples);
                commands.push({
                  op: 'C',
                  args: [c1x, c1y, c2x, c2y, px, py].map((n) => Number(n.toFixed(2))),
                });
                curX = px;
                curY = py;
                idx += 7;
              } else if (op === 3 && idx + 4 < buf.length) {
                const [cx, cy] = applyPoint(ctm, buf[idx + 1], buf[idx + 2]);
                const [px, py] = applyPoint(ctm, buf[idx + 3], buf[idx + 4]);
                const quadSamples = sampleQuadBezierPoints(curX, curY, cx, cy, px, py, 5);
                sampledPts.push(...quadSamples);
                commands.push({
                  op: 'Q',
                  args: [cx, cy, px, py].map((n) => Number(n.toFixed(2))),
                });
                curX = px;
                curY = py;
                idx += 5;
              } else if (op === 4) {
                isClosed = true;
                commands.push({ op: 'Z', args: [] });
                curX = startX;
                curY = startY;
                idx += 1;
              } else {
                break;
              }
            }
          } else {
            const minMax = args[2] as ArrayLike<number> | undefined;
            if (minMax && minMax.length >= 4) {
              const p1 = applyPoint(ctm, minMax[0], minMax[1]);
              const p2 = applyPoint(ctm, minMax[2], minMax[1]);
              const p3 = applyPoint(ctm, minMax[2], minMax[3]);
              const p4 = applyPoint(ctm, minMax[0], minMax[3]);
              sampledPts.push(p1, p2, p3, p4);
              commands.push(
                { op: 'M', args: [p1[0], p1[1]] },
                { op: 'L', args: [p2[0], p2[1]] },
                { op: 'L', args: [p3[0], p3[1]] },
                { op: 'L', args: [p4[0], p4[1]] },
                { op: 'Z', args: [] }
              );
              isClosed = true;
            }
          }
        } else {
          paintOp = i + 1 < opList.fnArray.length ? opList.fnArray[i + 1] : undefined;
          const subOps = args[0] as number[];
          const coords = args[1] as number[];
          if (Array.isArray(subOps) && Array.isArray(coords)) {
            let ci = 0;
            for (const sop of subOps) {
              if (sop === OPS.moveTo && ci + 1 < coords.length) {
                const [px, py] = applyPoint(ctm, coords[ci], coords[ci + 1]);
                curX = px;
                curY = py;
                startX = px;
                startY = py;
                sampledPts.push([px, py]);
                commands.push({ op: 'M', args: [Number(px.toFixed(2)), Number(py.toFixed(2))] });
                ci += 2;
              } else if (sop === OPS.lineTo && ci + 1 < coords.length) {
                const [px, py] = applyPoint(ctm, coords[ci], coords[ci + 1]);
                curX = px;
                curY = py;
                sampledPts.push([px, py]);
                commands.push({ op: 'L', args: [Number(px.toFixed(2)), Number(py.toFixed(2))] });
                ci += 2;
              } else if (sop === OPS.curveTo && ci + 5 < coords.length) {
                const [c1x, c1y] = applyPoint(ctm, coords[ci], coords[ci + 1]);
                const [c2x, c2y] = applyPoint(ctm, coords[ci + 2], coords[ci + 3]);
                const [px, py] = applyPoint(ctm, coords[ci + 4], coords[ci + 5]);
                sampledPts.push(
                  ...sampleCubicBezierPoints(curX, curY, c1x, c1y, c2x, c2y, px, py, 6)
                );
                commands.push({
                  op: 'C',
                  args: [c1x, c1y, c2x, c2y, px, py].map((n) => Number(n.toFixed(2))),
                });
                curX = px;
                curY = py;
                ci += 6;
              } else if (sop === OPS.closePath) {
                isClosed = true;
                commands.push({ op: 'Z', args: [] });
                curX = startX;
                curY = startY;
              } else if (sop === OPS.rectangle && ci + 3 < coords.length) {
                isClosed = true;
                const rx = coords[ci];
                const ry = coords[ci + 1];
                const rw = coords[ci + 2];
                const rh = coords[ci + 3];
                const p1 = applyPoint(ctm, rx, ry);
                const p2 = applyPoint(ctm, rx + rw, ry);
                const p3 = applyPoint(ctm, rx + rw, ry + rh);
                const p4 = applyPoint(ctm, rx, ry + rh);
                sampledPts.push(p1, p2, p3, p4);
                commands.push(
                  { op: 'M', args: [p1[0], p1[1]] },
                  { op: 'L', args: [p2[0], p2[1]] },
                  { op: 'L', args: [p3[0], p3[1]] },
                  { op: 'L', args: [p4[0], p4[1]] },
                  { op: 'Z', args: [] }
                );
                ci += 4;
              }
            }
          }
        }

        const isStrokeOp = paintOp !== undefined && strokeOps.has(paintOp);
        const isFillOp = paintOp !== undefined && fillOps.has(paintOp);
        const isClipOp = paintOp === OPS.clip || paintOp === OPS.eoClip;
        const isCloseStroke =
          paintOp === OPS.closeStroke ||
          paintOp === OPS.closeFillStroke ||
          paintOp === OPS.closeEOFillStroke;
        if (isCloseStroke) isClosed = true;

        if (sampledPts.length >= 2 && (isStrokeOp || isFillOp)) {
          const xs = sampledPts.map((p) => p[0]);
          const ys = sampledPts.map((p) => p[1]);
          const rawW = Math.max(...xs) - Math.min(...xs);
          const rawH = Math.max(...ys) - Math.min(...ys);
          const rect = clampBox(
            { x: Math.min(...xs), y: Math.min(...ys), width: rawW, height: rawH },
            pageW,
            pageH
          );

          if ((rawW > 1 || rawH > 1) && rect.width * rect.height < pageArea * 0.96) {
            vectorRects.push(rect);
            zSeq++;

            const flatPts: number[] = [];
            for (const p of sampledPts) {
              flatPts.push(Number(p[0].toFixed(2)), Number(p[1].toFixed(2)));
            }

            rawVectorPaths.push({
              id: `el-p${pageNumber}-vec-${rawVectorPaths.length + 1}`,
              pageNumber,
              commands,
              points: flatPts,
              bbox: rect,
              isClosed,
              isFilled: isFillOp,
              isStroked: isStrokeOp,
              isClippingPath: isClipOp,
              strokeColor: isStrokeOp ? state.strokeColor : undefined,
              fillColor:
                isFillOp && state.fillColor !== 'transparent' ? state.fillColor : undefined,
              strokeWidth: state.lineWidth,
              dashArray: [...state.dashArray],
              lineCap: state.lineCap,
              lineJoin: state.lineJoin,
              opacity: Number(
                Math.min(
                  isFillOp ? state.fillAlpha : 1,
                  isStrokeOp ? state.strokeAlpha : 1
                ).toFixed(2)
              ),
              transformMatrix: [
                Number(ctm[0].toFixed(4)),
                Number(ctm[1].toFixed(4)),
                Number(ctm[2].toFixed(4)),
                Number(ctm[3].toFixed(4)),
                Number(ctm[4].toFixed(2)),
                Number(ctm[5].toFixed(2)),
              ],
              zOrder: zSeq,
            });

            if (!isFillOp && (rawH <= 3 || rawW <= 3)) {
              vectorPrimitives.push({
                kind: 'line',
                x: rect.x,
                y: rect.y,
                width: Math.max(4, Number(rawW.toFixed(2))),
                height: Math.max(2, Number(rawH.toFixed(2))),
                strokeColor: state.strokeColor,
                lineWidth: state.lineWidth,
                hasStroke: true,
                hasFill: false,
              });
            } else if (rawW >= 6 && rawH >= 6) {
              vectorPrimitives.push({
                kind: 'rect',
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
                strokeColor: isStrokeOp ? state.strokeColor : undefined,
                fillColor:
                  isFillOp && state.fillColor !== 'transparent'
                    ? state.fillColor
                    : undefined,
                lineWidth: state.lineWidth,
                hasStroke: isStrokeOp,
                hasFill: isFillOp,
              });
            }
          }
        }
      }
    }
  } catch {
    // Non-fatal fallback to text + canvas scan
  }

  return {
    vectorBBox: unionRects(vectorRects),
    imageBBox: unionRects(imageRects),
    vectorPrimitives,
    rawVectorPaths,
    rawImagePlacements,
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

/**
 * Pass 5 Helper: Checks whether an image region lacks usable native PDF text.
 * Prevents duplicate OCR text over pages or sub-regions that already have native text runs.
 */
function imageRegionNeedsOcr(
  region: RectPt,
  nativeTextRuns: RawTextRun[]
): boolean {
  if (region.width < 48 || region.height < 20) return false;
  const regionArea = region.width * region.height;
  let coveredArea = 0;
  let overlappingCount = 0;
  for (const t of nativeTextRuns) {
    const inter = rectIntersectionArea(region, {
      x: t.x,
      y: t.y,
      width: t.width,
      height: t.height,
    });
    if (inter > 0) {
      coveredArea += inter;
      overlappingCount++;
    }
  }
  return overlappingCount < 2 && coveredArea / Math.max(1, regionArea) < 0.04;
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
  imageResources: Record<string, ExtractedImageResource>;
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
  const imageResources: Record<string, ExtractedImageResource> = {};
  let ocrWorker: Awaited<ReturnType<typeof createWorker>> | null = null;

  try {
    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      if (isCancelled?.()) {
        throw new Error('PDF scan cancelled.');
      }
      onProgress?.('Reading PDF page & rendering reference bitmap', pageNum, pageCount);
      const page = await pdf.getPage(pageNum);
      const baseViewport = page.getViewport({ scale: 1 });
      const widthPt = baseViewport.width;
      const heightPt = baseViewport.height;
      const orientation: 'portrait' | 'landscape' =
        widthPt > heightPt ? 'landscape' : 'portrait';

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

      // PASS 2: Detailed Text Extraction (individual runs, baseline, transform matrix, rotation)
      onProgress?.('Pass 2: Extracting text runs, baselines & typography', pageNum, pageCount);
      const textContent = await page.getTextContent();
      const extractedTextItems: ExtractedTextItem[] = [];
      const rawTextRuns: RawTextRun[] = [];
      const stylesMap = (textContent.styles || {}) as Record<
        string,
        { fontFamily?: string; ascent?: number; descent?: number }
      >;

      let runIdx = 0;
      for (const item of textContent.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        const tx = pdfjsLib.Util.transform(baseViewport.transform, item.transform);
        const fontHeight =
          Math.hypot(tx[0], tx[1]) ||
          Math.hypot(tx[2], tx[3]) ||
          Math.abs(item.height) ||
          11;
        const angleRad = Math.atan2(tx[1], tx[0]);
        const rotDeg = Number((((angleRad * 180) / Math.PI) % 360).toFixed(2));
        const normalizedRot = Math.abs(rotDeg) <= 1 ? 0 : rotDeg;

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

        runIdx++;
        const matrixTuple: [number, number, number, number, number, number] = [
          Number(tx[0].toFixed(4)),
          Number(tx[1].toFixed(4)),
          Number(tx[2].toFixed(4)),
          Number(tx[3].toFixed(4)),
          Number(tx[4].toFixed(2)),
          Number(tx[5].toFixed(2)),
        ];

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
          rotation: normalizedRot,
          confidence: 0.98,
          fromOcr: false,
          baselineY: Number(yBaseline.toFixed(2)),
          transformMatrix: matrixTuple,
          hasEOL: Boolean(item.hasEOL),
        });

        rawTextRuns.push({
          id: `run-p${pageNum}-${runIdx}`,
          pageNumber: pageNum,
          text: item.str,
          x: Number(x.toFixed(2)),
          y: Number(y.toFixed(2)),
          width: Number(width.toFixed(2)),
          height: Number(height.toFixed(2)),
          baselineY: Number(yBaseline.toFixed(2)),
          rotation: normalizedRot,
          transformMatrix: matrixTuple,
          fontName: item.fontName || 'Helvetica',
          fontFamily: fontMeta.resolvedFontFamily,
          fontSize: Number(fontHeight.toFixed(2)),
          fontWeight: fontMeta.fontWeight,
          fontStyle: fontMeta.fontStyle,
          color: sampledColor,
          hasEOL: Boolean(item.hasEOL),
          confidence: 0.98,
          sourceOrigin: 'original_pdf',
          originalObjectRef: item.fontName,
          zOrder: 1000 + runIdx,
        });
      }

      // PASS 3 & PASS 4: Vector Graphics & Real Embedded Image Extraction
      onProgress?.('Pass 3 & 4: Extracting vector paths & embedded images', pageNum, pageCount);
      const {
        vectorBBox,
        imageBBox,
        vectorPrimitives,
        rawVectorPaths,
        rawImagePlacements,
      } = await analyzeOperatorListBounds(
        page,
        baseViewport.transform,
        widthPt,
        heightPt,
        pageNum,
        imageResources
      );

      // PASS 5: Region-Aware Local Tesseract OCR
      // Runs on scanned pages (< 3 text runs) OR large non-text image regions lacking native PDF text
      let usedOcr = false;
      let ocrRegionsCount = 0;

      if (enableOcrFallback && pageNum <= pagesToProcess) {
        const ocrTargetRegions: Array<{ region: RectPt; imageDataUrl: string; scaleToPt: number }> = [];

        if (rawTextRuns.length < 3) {
          ocrTargetRegions.push({
            region: { x: 0, y: 0, width: widthPt, height: heightPt },
            imageDataUrl: imageBase64,
            scaleToPt: effectiveScale,
          });
        } else {
          // Check if any large raster image contains no native PDF text over it (e.g., scanned receipt/stamp region)
          for (const imgP of rawImagePlacements) {
            const imgRes = imageResources[imgP.resourceId];
            if (!imgRes?.dataUrl) continue;
            if (imgP.width >= 90 && imgP.height >= 40 && imageRegionNeedsOcr(imgP, rawTextRuns)) {
              ocrTargetRegions.push({
                region: { x: imgP.x, y: imgP.y, width: imgP.width, height: imgP.height },
                imageDataUrl: imgRes.dataUrl,
                scaleToPt: imgP.naturalWidth / Math.max(1, imgP.width),
              });
            }
          }
        }

        if (ocrTargetRegions.length > 0) {
          onProgress?.('Pass 5: Running local Tesseract OCR on image regions', pageNum, pageCount);
          if (!ocrWorker) {
            ocrWorker = await createWorker(ocrLanguage);
          }

          for (const target of ocrTargetRegions) {
            try {
              const ocrResult = await ocrWorker.recognize(target.imageDataUrl);
              const blocks = (
                ocrResult.data as unknown as {
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
              ).blocks;

              let addedFromRegion = 0;
              if (blocks) {
                for (const block of blocks) {
                  for (const para of block.paragraphs || []) {
                    for (const line of para.lines || []) {
                      const txt = (line.text || '').trim();
                      if (!txt || txt.length < 2) continue;
                      const xPt = target.region.x + line.bbox.x0 / target.scaleToPt;
                      const yPt = target.region.y + line.bbox.y0 / target.scaleToPt;
                      const wPt = (line.bbox.x1 - line.bbox.x0) / target.scaleToPt;
                      const hPt = (line.bbox.y1 - line.bbox.y0) / target.scaleToPt;

                      // Never duplicate native PDF text already occupying the same bbox
                      const candidateRect: RectPt = {
                        x: xPt,
                        y: yPt,
                        width: Math.max(8, wPt),
                        height: Math.max(8, hPt),
                      };
                      const overlapsNative = rawTextRuns.some(
                        (n) =>
                          n.sourceOrigin === 'original_pdf' &&
                          rectIntersectionArea(candidateRect, n) /
                            Math.max(1, candidateRect.width * candidateRect.height) >
                            0.25
                      );
                      if (overlapsNative) continue;

                      const ocrColor = sampleTextColorFromCanvas(canvas, effectiveScale, {
                        x: xPt,
                        y: yPt,
                        width: wPt,
                        height: hPt,
                      });
                      const lineConf =
                        typeof line.confidence === 'number'
                          ? Math.max(0.25, Math.min(0.98, line.confidence / 100))
                          : 0.72;
                      const estFs = Number(Math.max(7.5, hPt * 0.78).toFixed(1));

                      runIdx++;
                      addedFromRegion++;
                      extractedTextItems.push({
                        text: txt,
                        x: Number(xPt.toFixed(2)),
                        y: Number(yPt.toFixed(2)),
                        width: Number(Math.max(8, wPt).toFixed(2)),
                        height: Number(Math.max(10, hPt).toFixed(2)),
                        fontSize: estFs,
                        fontName: 'Helvetica',
                        resolvedFontFamily: 'Helvetica',
                        fontWeight: 'normal',
                        fontStyle: 'normal',
                        color: ocrColor,
                        rotation: 0,
                        confidence: Number(lineConf.toFixed(2)),
                        fromOcr: true,
                        baselineY: Number((yPt + hPt * 0.82).toFixed(2)),
                      });

                      rawTextRuns.push({
                        id: `ocr-p${pageNum}-${runIdx}`,
                        pageNumber: pageNum,
                        text: txt,
                        x: Number(xPt.toFixed(2)),
                        y: Number(yPt.toFixed(2)),
                        width: Number(Math.max(8, wPt).toFixed(2)),
                        height: Number(Math.max(10, hPt).toFixed(2)),
                        baselineY: Number((yPt + hPt * 0.82).toFixed(2)),
                        rotation: 0,
                        transformMatrix: [estFs, 0, 0, -estFs, xPt, yPt + hPt * 0.82],
                        fontName: 'Helvetica',
                        fontFamily: 'Helvetica',
                        fontSize: estFs,
                        fontWeight: 'normal',
                        fontStyle: 'normal',
                        color: ocrColor,
                        confidence: Number(lineConf.toFixed(2)),
                        sourceOrigin: 'scanned_ocr',
                        zOrder: 1500 + runIdx,
                      });
                    }
                  }
                }
              }
              if (addedFromRegion > 0) {
                usedOcr = true;
                ocrRegionsCount++;
              }
            } catch {
              // Skip failed OCR region safely without failing whole scan
            }
          }
        }
      }

      releaseCanvas(canvas);
      await yieldToMainThread();

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
        ocrRegionsCount,
      });

      if (pageNum <= pagesToProcess) {
        pages.push({
          pageNumber: pageNum,
          widthPt,
          heightPt,
          orientation,
          imageBase64,
          extractedTextItems,
          rawTextRuns,
          rawVectorPaths,
          rawImagePlacements,
          vectorPrimitives,
          usedOcr,
          ocrRegionsCount,
          detectedBounds,
        });
      }
    }
  } finally {
    if (ocrWorker) {
      await ocrWorker.terminate();
    }
  }

  return { pageCount, pages, originalPages, imageResources };
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
      baseViewport.height,
      clampedPage
    );

    const tc = await page.getTextContent();
    const textItems: ExtractedTextItem[] = [];
    for (const item of tc.items) {
      if (!('str' in item) || !item.str.trim()) continue;
      const tx = pdfjsLib.Util.transform(baseViewport.transform, item.transform);
      const fontHeight =
        Math.hypot(tx[0], tx[1]) ||
        Math.hypot(tx[2], tx[3]) ||
        Math.abs(item.height) ||
        11;
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
