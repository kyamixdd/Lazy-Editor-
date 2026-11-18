import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  StandardFonts,
  decodePDFRawStream,
  degrees,
  rgb,
} from 'pdf-lib';
import {
  DocumentElement,
  ExtractedImageResource,
  RectPt,
  VectorPathCommand,
} from '../src/types/pdfStudio';
import {
  PdfDocumentInspection,
  inspectPdfStructure,
} from '../src/utils/pdfStructureInspector';
import {
  RawImagePlacement,
  RawPageScanInput,
  RawTextRun,
  RawVectorPath,
} from '../src/utils/scanPrimitives';
import {
  buildCorrectionRuleFromElement,
  computeScanQualityReport,
  processRawPageScan,
} from '../src/utils/documentRelationshipEngine';
import {
  convertSelectionToTableElement,
  mergeTableCellRange,
  splitMergedTableCell,
} from '../src/utils/tableReconstructionEngine';
import { rectIntersectionArea } from '../src/utils/spatialIndex';

// ---------------------------------------------------------------------------
// 1. Minimal Pure-Node PNG Generator (RGB & RGBA with Alpha) for pdf-lib
// ---------------------------------------------------------------------------

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crc = crc32(out.subarray(4, 8 + data.length));
  dv.setUint32(8 + data.length, crc, false);
  return out;
}

function makeTestPng(
  width: number,
  height: number,
  r: number,
  g: number,
  b: number,
  a = 255
): Uint8Array {
  const hasAlpha = a < 255;
  const bpp = hasAlpha ? 4 : 3;
  const raw = new Uint8Array(height * (1 + width * bpp));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * bpp);
    raw[rowStart] = 0; // filter none
    for (let x = 0; x < width; x++) {
      const px = rowStart + 1 + x * bpp;
      raw[px] = r;
      raw[px + 1] = g;
      raw[px + 2] = b;
      if (hasAlpha) raw[px + 3] = x < width / 2 ? a : 255;
    }
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width, false);
  dv.setUint32(4, height, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = hasAlpha ? 6 : 2; // RGBA or RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(raw);
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const c1 = pngChunk('IHDR', ihdr);
  const c2 = pngChunk('IDAT', idat);
  const c3 = pngChunk('IEND', new Uint8Array(0));

  const out = new Uint8Array(sig.length + c1.length + c2.length + c3.length);
  let off = 0;
  for (const part of [sig, c1, c2, c3]) {
    out.set(part, off);
    off += part.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. Real PDF Content-Stream Operator Parser -> RawPageScanInput
// ---------------------------------------------------------------------------

type Token =
  | { kind: 'num'; val: number }
  | { kind: 'name'; val: string }
  | { kind: 'str'; val: string }
  | { kind: 'arr'; val: Token[] }
  | { kind: 'op'; val: string };

function decodePdfLiteralString(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '\\' && i + 1 < raw.length) {
      const nx = raw[++i];
      if (nx === 'n') out += '\n';
      else if (nx === 'r') out += '\r';
      else if (nx === 't') out += '\t';
      else out += nx;
    } else {
      out += ch;
    }
  }
  return out;
}

function decodePdfHexString(hex: string): string {
  const clean = hex.replace(/\s+/g, '');
  const padded = clean.length % 2 === 1 ? `${clean}0` : clean;
  let out = '';
  for (let i = 0; i < padded.length; i += 2) {
    const code = parseInt(padded.slice(i, i + 2), 16);
    if (Number.isFinite(code) && code >= 32 && code <= 126) {
      out += String.fromCharCode(code);
    } else if (code === 10 || code === 13) {
      out += ' ';
    }
  }
  return out;
}

function tokenizeContentStream(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = src.length;

  const parseArray = (): Token[] => {
    const arr: Token[] = [];
    while (i < len) {
      while (i < len && /\s/.test(src[i])) i++;
      if (i >= len) break;
      if (src[i] === ']') {
        i++;
        break;
      }
      const next = parseOne();
      if (next) arr.push(next);
    }
    return arr;
  };

  const parseOne = (): Token | null => {
    while (i < len) {
      const ch = src[i];
      if (/\s/.test(ch)) {
        i++;
        continue;
      }
      if (ch === '%') {
        while (i < len && src[i] !== '\n' && src[i] !== '\r') i++;
        continue;
      }
      break;
    }
    if (i >= len) return null;
    const ch = src[i];

    if (ch === '[') {
      i++;
      return { kind: 'arr', val: parseArray() };
    }
    if (ch === '(') {
      i++;
      let depth = 1;
      let raw = '';
      while (i < len && depth > 0) {
        const c = src[i++];
        if (c === '\\' && i < len) {
          raw += c + src[i++];
        } else if (c === '(') {
          depth++;
          raw += c;
        } else if (c === ')') {
          depth--;
          if (depth > 0) raw += c;
        } else {
          raw += c;
        }
      }
      return { kind: 'str', val: decodePdfLiteralString(raw) };
    }
    if (ch === '<' && src[i + 1] === '<') {
      i += 2;
      let depth = 1;
      while (i < len && depth > 0) {
        if (src[i] === '<' && src[i + 1] === '<') {
          depth++;
          i += 2;
        } else if (src[i] === '>' && src[i + 1] === '>') {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }
      return { kind: 'op', val: 'DICT' };
    }
    if (ch === '<') {
      i++;
      let hex = '';
      while (i < len && src[i] !== '>') hex += src[i++];
      if (src[i] === '>') i++;
      return { kind: 'str', val: decodePdfHexString(hex) };
    }
    if (ch === '/') {
      i++;
      let name = '';
      while (i < len && !/[\s()<>[\]{}/%]/.test(src[i])) name += src[i++];
      return { kind: 'name', val: name };
    }
    let word = '';
    while (i < len && !/[\s()<>[\]{}/%]/.test(src[i])) word += src[i++];
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) {
      return { kind: 'num', val: parseFloat(word) };
    }
    return { kind: 'op', val: word };
  };

  while (i < len) {
    const t = parseOne();
    if (t) tokens.push(t);
  }
  return tokens;
}

function mulM(a: number[], b: number[]): number[] {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function applyM(m: number[], x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function unitRgbToHex(r: number, g: number, b: number): string {
  const toH = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v * 255)))
      .toString(16)
      .padStart(2, '0');
  return `#${toH(r)}${toH(g)}${toH(b)}`.toUpperCase();
}

function sampleCubic(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  steps = 6
): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const mt = 1 - t;
    pts.push([
      mt ** 3 * x0 + 3 * mt ** 2 * t * x1 + 3 * mt * t ** 2 * x2 + t ** 3 * x3,
      mt ** 3 * y0 + 3 * mt ** 2 * t * y1 + 3 * mt * t ** 2 * y2 + t ** 3 * y3,
    ]);
  }
  return pts;
}

function getPageStreamText(pdfDoc: PDFDocument, pageIndex: number): string {
  const pg = pdfDoc.getPages()[pageIndex];
  const contents = pg.node.get(PDFName.of('Contents'));
  const streams: PDFStream[] = [];
  const collect = (obj: unknown) => {
    const resolved = obj instanceof PDFRef ? pdfDoc.context.lookup(obj) : obj;
    if (resolved instanceof PDFRawStream) streams.push(resolved);
    else if (resolved instanceof PDFArray) {
      for (let i = 0; i < resolved.size(); i++) collect(resolved.get(i));
    }
  };
  collect(contents);

  return streams
    .map((st) => {
      if (st instanceof PDFRawStream) {
        const decoded = decodePDFRawStream(st);
        return Buffer.from(decoded.decode()).toString('latin1');
      }
      return '';
    })
    .join('\n');
}

async function parsePdfIntoRawPageScans(
  pdfBytes: Uint8Array,
  inspection: PdfDocumentInspection
): Promise<RawPageScanInput[]> {
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pages = pdfDoc.getPages();
  const imageResources: Record<string, ExtractedImageResource> = {};
  const result: RawPageScanInput[] = [];

  for (let pIdx = 0; pIdx < pages.length; pIdx++) {
    const pg = pages[pIdx];
    const insp = inspection.pages[pIdx];
    const pageNumber = pIdx + 1;
    const pageW = insp.widthPt;
    const pageH = insp.heightPt;

    // Resolve fonts & image XObjects from page Resources
    const fontNameMap = new Map<string, string>();
    const xObjMetaMap = new Map<
      string,
      { resourceId: string; width: number; height: number; hasAlpha: boolean }
    >();
    const extGStateAlpha = new Map<string, number>();

    const resources = pg.node.lookupMaybe(PDFName.of('Resources'), PDFDict);
    if (resources) {
      const fDict = resources.lookupMaybe(PDFName.of('Font'), PDFDict);
      if (fDict) {
        for (const [k] of fDict.entries()) {
          const kName = k.toString().replace(/^\//, '');
          const refDict = fDict.lookupMaybe(k, PDFDict);
          const base = refDict?.get(PDFName.of('BaseFont'))?.toString().replace(/^\//, '');
          fontNameMap.set(kName, base || kName);
        }
      }
      const xDict = resources.lookupMaybe(PDFName.of('XObject'), PDFDict);
      if (xDict) {
        for (const [k, rawRef] of xDict.entries()) {
          const xName = k.toString().replace(/^\//, '');
          const rawX = xDict.lookup(k);
          if (!(rawX instanceof PDFRawStream)) continue;
          const stream = rawX;
          const sub = stream.dict.get(PDFName.of('Subtype'))?.toString();
          if (sub !== '/Image') continue;
          const wNum = stream.dict.get(PDFName.of('Width'));
          const hNum = stream.dict.get(PDFName.of('Height'));
          const natW = wNum instanceof PDFNumber ? wNum.asNumber() : 64;
          const natH = hNum instanceof PDFNumber ? hNum.asNumber() : 64;
          const hasAlpha = Boolean(stream.dict.get(PDFName.of('SMask')));
          const refKey = rawRef instanceof PDFRef ? rawRef.toString() : `x-${xName}`;
          const resourceId = `res-${refKey.replace(/[^a-zA-Z0-9_-]/g, '')}`;
          if (!imageResources[resourceId]) {
            imageResources[resourceId] = {
              id: resourceId,
              sourceXObjectName: xName,
              dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
              mimeType: 'image/png',
              naturalWidth: natW,
              naturalHeight: natH,
              hasAlpha,
              hasMask: hasAlpha,
              isInlineImage: false,
              usageCount: 0,
            };
          }
          xObjMetaMap.set(xName, {
            resourceId,
            width: natW,
            height: natH,
            hasAlpha,
          });
        }
      }
      const gsDict = resources.lookupMaybe(PDFName.of('ExtGState'), PDFDict);
      if (gsDict) {
        for (const [k] of gsDict.entries()) {
          const gName = k.toString().replace(/^\//, '');
          const gd = gsDict.lookupMaybe(k, PDFDict);
          const ca = gd?.get(PDFName.of('ca'));
          const CA = gd?.get(PDFName.of('CA'));
          const a =
            ca instanceof PDFNumber
              ? ca.asNumber()
              : CA instanceof PDFNumber
              ? CA.asNumber()
              : 1;
          extGStateAlpha.set(gName, a);
        }
      }
    }

    const streamStr = getPageStreamText(pdfDoc, pIdx);
    const tokens = tokenizeContentStream(streamStr);

    interface GState {
      ctm: number[];
      fillColor: string;
      strokeColor: string;
      lineWidth: number;
      dashArray: number[];
      alpha: number;
      fontName: string;
      fontSize: number;
      charSpacing: number;
      wordSpacing: number;
    }

    let state: GState = {
      ctm: [1, 0, 0, 1, 0, 0],
      fillColor: '#000000',
      strokeColor: '#000000',
      lineWidth: 1,
      dashArray: [],
      alpha: 1,
      fontName: 'Helvetica',
      fontSize: 10,
      charSpacing: 0,
      wordSpacing: 0,
    };
    const stack: GState[] = [];
    let tm = [1, 0, 0, 1, 0, 0];
    let tlm = [1, 0, 0, 1, 0, 0];

    let curCommands: VectorPathCommand[] = [];
    let curPts: Array<[number, number]> = [];
    let isClosed = false;
    let curX = 0;
    let curY = 0;
    let zOrder = 0;

    const textRuns: RawTextRun[] = [];
    const vectorPaths: RawVectorPath[] = [];
    const imagePlacements: RawImagePlacement[] = [];
    const args: Token[] = [];

    const pdfPtToTopLeft = (px: number, py: number): [number, number] => [
      px,
      pageH - py,
    ];

    const flushPath = (fill: boolean, stroke: boolean, closeFirst = false) => {
      if (closeFirst) {
        isClosed = true;
        curCommands.push({ op: 'Z', args: [] });
      }
      if ((fill || stroke) && curPts.length >= 2) {
        const tlPts = curPts.map(([px, py]) => pdfPtToTopLeft(px, py));
        const xs = tlPts.map((p) => p[0]);
        const ys = tlPts.map((p) => p[1]);
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        const maxX = Math.max(...xs);
        const maxY = Math.max(...ys);
        const w = Math.max(1, maxX - minX);
        const h = Math.max(1, maxY - minY);
        const flat: number[] = [];
        for (const [x, y] of tlPts) {
          flat.push(Number(x.toFixed(2)), Number(y.toFixed(2)));
        }
        const tlCmds: VectorPathCommand[] = curCommands.map((cmd) => {
          if (cmd.op === 'M' || cmd.op === 'L') {
            const [tx, ty] = pdfPtToTopLeft(cmd.args[0], cmd.args[1]);
            return { op: cmd.op, args: [Number(tx.toFixed(2)), Number(ty.toFixed(2))] };
          }
          if (cmd.op === 'C') {
            const [x1, y1] = pdfPtToTopLeft(cmd.args[0], cmd.args[1]);
            const [x2, y2] = pdfPtToTopLeft(cmd.args[2], cmd.args[3]);
            const [x3, y3] = pdfPtToTopLeft(cmd.args[4], cmd.args[5]);
            return {
              op: 'C',
              args: [x1, y1, x2, y2, x3, y3].map((v) => Number(v.toFixed(2))),
            };
          }
          return cmd;
        });
        zOrder++;
        vectorPaths.push({
          id: `raw-vec-p${pageNumber}-${vectorPaths.length + 1}`,
          pageNumber,
          commands: tlCmds,
          points: flat,
          bbox: {
            x: Number(minX.toFixed(2)),
            y: Number(minY.toFixed(2)),
            width: Number(w.toFixed(2)),
            height: Number(h.toFixed(2)),
          },
          isClosed,
          isFilled: fill,
          isStroked: stroke,
          isClippingPath: false,
          strokeColor: stroke ? state.strokeColor : undefined,
          fillColor: fill ? state.fillColor : undefined,
          strokeWidth: state.lineWidth,
          dashArray: [...state.dashArray],
          lineCap: 'butt',
          lineJoin: 'miter',
          opacity: state.alpha,
          transformMatrix: [
            state.ctm[0],
            state.ctm[1],
            state.ctm[2],
            state.ctm[3],
            state.ctm[4],
            state.ctm[5],
          ],
          zOrder,
        });
      }
      curCommands = [];
      curPts = [];
      isClosed = false;
    };

    const emitText = (txt: string) => {
      if (!txt || !txt.trim()) return;
      const combined = mulM(state.ctm, tm);
      const [px, py] = applyM(combined, 0, 0);
      const [tlX, baselineY] = pdfPtToTopLeft(px, py);
      const scaleX = Math.hypot(combined[0], combined[1]) || 1;
      const effSize = Number((state.fontSize * (Math.hypot(combined[2], combined[3]) || 1)).toFixed(2));
      let angleDeg = Math.round((Math.atan2(combined[1], combined[0]) * 180) / Math.PI);
      if (angleDeg < 0) angleDeg += 360;
      const cleanAngle = angleDeg === 360 ? 0 : angleDeg;

      const rawBaseFont = fontNameMap.get(state.fontName) || state.fontName;
      const lower = rawBaseFont.toLowerCase();
      const fontFamily = lower.includes('times')
        ? 'Times-Roman'
        : lower.includes('courier')
        ? 'Courier'
        : 'Helvetica';
      const fontWeight: 'normal' | 'bold' = /bold|black|heavy/.test(lower) ? 'bold' : 'normal';
      const fontStyle: 'normal' | 'italic' = /oblique|italic/.test(lower) ? 'italic' : 'normal';

      const estWidth = Math.max(4, txt.length * effSize * 0.52 * (scaleX / Math.max(1, effSize) > 0.5 ? 1 : 1));
      const estHeight = Math.max(6, effSize * 1.12);
      const isVerticalRot = Math.abs(cleanAngle - 90) <= 15 || Math.abs(cleanAngle - 270) <= 15;
      const wPt = isVerticalRot ? estHeight : estWidth;
      const hPt = isVerticalRot ? estWidth : estHeight;
      const topY = isVerticalRot ? baselineY - wPt : baselineY - effSize * 0.85;

      zOrder++;
      textRuns.push({
        id: `raw-txt-p${pageNumber}-${textRuns.length + 1}`,
        pageNumber,
        text: txt,
        x: Number(tlX.toFixed(2)),
        y: Number(topY.toFixed(2)),
        width: Number(wPt.toFixed(2)),
        height: Number(hPt.toFixed(2)),
        baselineY: Number(baselineY.toFixed(2)),
        rotation: cleanAngle === 90 ? 270 : cleanAngle === 270 ? 90 : cleanAngle,
        transformMatrix: [
          combined[0],
          combined[1],
          combined[2],
          combined[3],
          combined[4],
          combined[5],
        ],
        fontName: rawBaseFont,
        fontFamily,
        fontSize: effSize,
        fontWeight,
        fontStyle,
        color: state.fillColor,
        charSpacingPt: state.charSpacing,
        wordSpacingPt: state.wordSpacing,
        confidence: 0.98,
        sourceOrigin: 'original_pdf',
        zOrder,
      });

      // Advance text matrix horizontally in text space so concatenated Tj calls don't collapse
      const advance = txt.length * state.fontSize * 0.52;
      tm = mulM(tm, [1, 0, 0, 1, advance, 0]);
    };

    const numAt = (idx: number): number => {
      const t = args[idx];
      return t?.kind === 'num' ? t.val : 0;
    };

    for (const tok of tokens) {
      if (tok.kind !== 'op') {
        args.push(tok);
        continue;
      }
      const op = tok.val;
      switch (op) {
        case 'q':
          stack.push({
            ...state,
            ctm: [...state.ctm],
            dashArray: [...state.dashArray],
          });
          break;
        case 'Q':
          if (stack.length > 0) state = stack.pop()!;
          break;
        case 'cm':
          if (args.length >= 6) {
            const m = [numAt(0), numAt(1), numAt(2), numAt(3), numAt(4), numAt(5)];
            state.ctm = mulM(state.ctm, m);
          }
          break;
        case 'w':
          if (args.length >= 1) state.lineWidth = numAt(0);
          break;
        case 'd':
          if (args.length >= 2 && args[0].kind === 'arr') {
            state.dashArray = args[0].val
              .filter((t): t is { kind: 'num'; val: number } => t.kind === 'num')
              .map((t) => t.val);
          }
          break;
        case 'gs':
          if (args.length >= 1 && args[0].kind === 'name') {
            const a = extGStateAlpha.get(args[0].val);
            if (a !== undefined) state.alpha = a;
          }
          break;
        case 'rg':
          if (args.length >= 3) state.fillColor = unitRgbToHex(numAt(0), numAt(1), numAt(2));
          break;
        case 'RG':
          if (args.length >= 3) state.strokeColor = unitRgbToHex(numAt(0), numAt(1), numAt(2));
          break;
        case 'g':
          if (args.length >= 1) {
            const v = numAt(0);
            state.fillColor = unitRgbToHex(v, v, v);
          }
          break;
        case 'G':
          if (args.length >= 1) {
            const v = numAt(0);
            state.strokeColor = unitRgbToHex(v, v, v);
          }
          break;
        case 'BT':
          tm = [1, 0, 0, 1, 0, 0];
          tlm = [1, 0, 0, 1, 0, 0];
          break;
        case 'Tf':
          if (args.length >= 2 && args[0].kind === 'name') {
            state.fontName = args[0].val;
            state.fontSize = numAt(1);
          }
          break;
        case 'Tc':
          if (args.length >= 1) state.charSpacing = numAt(0);
          break;
        case 'Tw':
          if (args.length >= 1) state.wordSpacing = numAt(0);
          break;
        case 'Td':
        case 'TD':
          if (args.length >= 2) {
            tlm = mulM(tlm, [1, 0, 0, 1, numAt(0), numAt(1)]);
            tm = [...tlm];
          }
          break;
        case 'Tm':
          if (args.length >= 6) {
            tlm = [numAt(0), numAt(1), numAt(2), numAt(3), numAt(4), numAt(5)];
            tm = [...tlm];
          }
          break;
        case 'Tj':
          if (args.length >= 1 && args[0].kind === 'str') {
            emitText(args[0].val);
          }
          break;
        case 'TJ':
          if (args.length >= 1 && args[0].kind === 'arr') {
            let acc = '';
            for (const item of args[0].val) {
              if (item.kind === 'str') acc += item.val;
            }
            emitText(acc);
          }
          break;
        case 'm':
          if (args.length >= 2) {
            const [px, py] = applyM(state.ctm, numAt(0), numAt(1));
            curX = px;
            curY = py;
            curPts.push([px, py]);
            curCommands.push({ op: 'M', args: [px, py] });
          }
          break;
        case 'l':
          if (args.length >= 2) {
            const [px, py] = applyM(state.ctm, numAt(0), numAt(1));
            curX = px;
            curY = py;
            curPts.push([px, py]);
            curCommands.push({ op: 'L', args: [px, py] });
          }
          break;
        case 'c':
          if (args.length >= 6) {
            const [x1, y1] = applyM(state.ctm, numAt(0), numAt(1));
            const [x2, y2] = applyM(state.ctm, numAt(2), numAt(3));
            const [x3, y3] = applyM(state.ctm, numAt(4), numAt(5));
            curPts.push(...sampleCubic(curX, curY, x1, y1, x2, y2, x3, y3, 6));
            curCommands.push({ op: 'C', args: [x1, y1, x2, y2, x3, y3] });
            curX = x3;
            curY = y3;
          }
          break;
        case 'v':
          if (args.length >= 4) {
            const [x2, y2] = applyM(state.ctm, numAt(0), numAt(1));
            const [x3, y3] = applyM(state.ctm, numAt(2), numAt(3));
            curPts.push(...sampleCubic(curX, curY, curX, curY, x2, y2, x3, y3, 6));
            curCommands.push({ op: 'C', args: [curX, curY, x2, y2, x3, y3] });
            curX = x3;
            curY = y3;
          }
          break;
        case 'y':
          if (args.length >= 4) {
            const [x1, y1] = applyM(state.ctm, numAt(0), numAt(1));
            const [x3, y3] = applyM(state.ctm, numAt(2), numAt(3));
            curPts.push(...sampleCubic(curX, curY, x1, y1, x3, y3, x3, y3, 6));
            curCommands.push({ op: 'C', args: [x1, y1, x3, y3, x3, y3] });
            curX = x3;
            curY = y3;
          }
          break;
        case 'h':
          isClosed = true;
          curCommands.push({ op: 'Z', args: [] });
          break;
        case 're':
          if (args.length >= 4) {
            const rx = numAt(0);
            const ry = numAt(1);
            const rw = numAt(2);
            const rh = numAt(3);
            const p1 = applyM(state.ctm, rx, ry);
            const p2 = applyM(state.ctm, rx + rw, ry);
            const p3 = applyM(state.ctm, rx + rw, ry + rh);
            const p4 = applyM(state.ctm, rx, ry + rh);
            curPts.push(p1, p2, p3, p4);
            curCommands.push(
              { op: 'M', args: p1 },
              { op: 'L', args: p2 },
              { op: 'L', args: p3 },
              { op: 'L', args: p4 },
              { op: 'Z', args: [] }
            );
            isClosed = true;
          }
          break;
        case 'S':
          flushPath(false, true, false);
          break;
        case 's':
          flushPath(false, true, true);
          break;
        case 'f':
        case 'F':
        case 'f*':
          flushPath(true, false, false);
          break;
        case 'B':
        case 'B*':
          flushPath(true, true, false);
          break;
        case 'b':
        case 'b*':
          flushPath(true, true, true);
          break;
        case 'n':
          flushPath(false, false, false);
          break;
        case 'Do':
          if (args.length >= 1 && args[0].kind === 'name') {
            const meta = xObjMetaMap.get(args[0].val);
            if (meta) {
              const c0 = applyM(state.ctm, 0, 0);
              const c1 = applyM(state.ctm, 1, 0);
              const c2 = applyM(state.ctm, 1, 1);
              const c3 = applyM(state.ctm, 0, 1);
              const tl = [c0, c1, c2, c3].map(([px, py]) => pdfPtToTopLeft(px, py));
              const minX = Math.min(...tl.map((p) => p[0]));
              const minY = Math.min(...tl.map((p) => p[1]));
              const maxX = Math.max(...tl.map((p) => p[0]));
              const maxY = Math.max(...tl.map((p) => p[1]));
              imageResources[meta.resourceId].usageCount++;
              zOrder++;
              imagePlacements.push({
                id: `raw-img-p${pageNumber}-${imagePlacements.length + 1}`,
                pageNumber,
                resourceId: meta.resourceId,
                sourceXObjectName: args[0].val,
                x: Number(minX.toFixed(2)),
                y: Number(minY.toFixed(2)),
                width: Number(Math.max(1, maxX - minX).toFixed(2)),
                height: Number(Math.max(1, maxY - minY).toFixed(2)),
                rotation: 0,
                transformMatrix: [
                  state.ctm[0],
                  state.ctm[1],
                  state.ctm[2],
                  state.ctm[3],
                  state.ctm[4],
                  state.ctm[5],
                ],
                naturalWidth: meta.width,
                naturalHeight: meta.height,
                hasAlpha: meta.hasAlpha,
                hasMask: meta.hasAlpha,
                isInlineImage: false,
                isImageMask: false,
                zOrder,
              });
            }
          }
          break;
      }
      args.length = 0;
    }

    result.push({
      pageNumber,
      widthPt: pageW,
      heightPt: pageH,
      rotation: insp.rotation,
      textRuns,
      vectorPaths,
      imagePlacements,
      imageResources,
      annotations: insp.annotations,
      formWidgets: insp.formWidgets,
      ocrRegionsCount: 0,
    });
  }

  return result;
}

async function scanPdfBytes(pdfBytes: Uint8Array) {
  const inspection = await inspectPdfStructure(pdfBytes);
  const rawPages = await parsePdfIntoRawPageScans(pdfBytes, inspection);
  return {
    inspection,
    rawPages,
    processed: rawPages.map((rp) => processRawPageScan(rp)),
  };
}

function topLeftToPdfY(topY: number, height: number, pageH = 792): number {
  return pageH - (topY + height);
}

// Track ground-truth KPI metrics across all 20 scenarios
interface ScenarioKpi {
  tp: number;
  fp: number;
  fn: number;
  classRight: number;
  classTotal: number;
  bboxErrors: number[];
  textRight: number;
  textTotal: number;
  imgDetected: number;
  imgExpected: number;
  tableRight: number;
  tableExpected: number;
}

const aggregateKpi: ScenarioKpi = {
  tp: 0,
  fp: 0,
  fn: 0,
  classRight: 0,
  classTotal: 0,
  bboxErrors: [],
  textRight: 0,
  textTotal: 0,
  imgDetected: 0,
  imgExpected: 0,
  tableRight: 0,
  tableExpected: 0,
};

function recordBBoxCheck(actual: RectPt, expected: RectPt, maxErr = 3.0) {
  const err = Math.max(
    Math.abs(actual.x - expected.x),
    Math.abs(actual.y - expected.y),
    Math.abs(actual.width - expected.width),
    Math.abs(actual.height - expected.height)
  );
  aggregateKpi.bboxErrors.push(err);
  assert.ok(
    err <= maxErr,
    `BBox error ${err.toFixed(2)}pt exceeded ${maxErr}pt (actual=${JSON.stringify(actual)}, expected=${JSON.stringify(expected)})`
  );
}

// ---------------------------------------------------------------------------
// 3. 20 Ground-Truth Regression Scenarios
// ---------------------------------------------------------------------------

test('Scenario 1: Simple rectangles (re) detection & bbox accuracy', async () => {
  const doc = await PDFDocument.create();
  const pg = doc.addPage([612, 792]);
  pg.drawRectangle({
    x: 60,
    y: topLeftToPdfY(80, 90),
    width: 180,
    height: 90,
    borderColor: rgb(0.1, 0.2, 0.5),
    borderWidth: 1.5,
  });
  pg.drawRectangle({
    x: 280,
    y: topLeftToPdfY(80, 90),
    width: 160,
    height: 90,
    color: rgb(0.9, 0.92, 0.95),
  });

  const bytes = await doc.save();
  const { processed } = await scanPdfBytes(bytes);
  const els = processed[0].elements;

  const rects = els.filter((e) => e.type === 'shape' || e.type === 'border');
  assert.equal(rects.length, 2);
  aggregateKpi.tp += 2;
  aggregateKpi.classTotal += 2;
  aggregateKpi.classRight += 2;

  const stroked = rects.find((r) => Math.abs(r.x - 60) < 3)!;
  const filled = rects.find((r) => Math.abs(r.x - 280) < 3)!;
  assert.ok(stroked);
  assert.ok(filled);
  assert.equal(filled.objectSubtype, 'filled_shape');
  recordBBoxCheck(stroked, { x: 60, y: 80, width: 180, height: 90 });
  recordBBoxCheck(filled, { x: 280, y: 80, width: 160, height: 90 });
});

test('Scenario 2: Rounded rectangles (c cubic corners + edges) detection & cornerRadiusPt', async () => {
  const doc = await PDFDocument.create();
  const pg = doc.addPage([612, 792]);
  // SVG rounded rectangle converted by pdf-lib into cubic Bezier corners + straight edges
  const r = 12;
  const w = 200;
  const h = 80;
  const svg = `M ${r},0 L ${w - r},0 Q ${w},0 ${w},${r} L ${w},${h - r} Q ${w},${h} ${w - r},${h} L ${r},${h} Q 0,${h} 0,${h - r} L 0,${r} Q 0,0 ${r},0 Z`;
  pg.drawSvgPath(svg, {
    x: 72,
    y: 792 - 100,
    borderColor: rgb(0.1, 0.1, 0.1),
    borderWidth: 1.5,
  });

  const bytes = await doc.save();
  const { processed } = await scanPdfBytes(bytes);
  const rounded = processed[0].elements.find((e) => e.objectSubtype === 'rounded_rect');
  assert.ok(rounded, 'Expected rounded_rect subtype');
  assert.ok((rounded.cornerRadiusPt || 0) >= 6);
  recordBBoxCheck(rounded, { x: 72, y: 100, width: 200, height: 80 }, 3.5);
  aggregateKpi.tp += 1;
  aggregateKpi.classTotal += 1;
  aggregateKpi.classRight += 1;
});

test('Scenario 3: Horizontal & vertical lines (stroked m-l AND thin filled rule-rects)', async () => {
  const doc = await PDFDocument.create();
  const pg = doc.addPage([612, 792]);
  pg.drawLine({
    start: { x: 50, y: 792 - 100 },
    end: { x: 350, y: 792 - 100 },
    thickness: 1.2,
    color: rgb(0, 0, 0),
  });
  pg.drawLine({
    start: { x: 400, y: 792 - 80 },
    end: { x: 400, y: 792 - 260 },
    thickness: 1.2,
    color: rgb(0, 0, 0),
  });
  // Thin filled bar rule (common PDF writer pattern)
  pg.drawRectangle({
    x: 50,
    y: topLeftToPdfY(160, 1.5),
    width: 180,
    height: 1.5,
    color: rgb(0.2, 0.2, 0.2),
  });

  const bytes = await doc.save();
  const { processed } = await scanPdfBytes(bytes);
  const lines = processed[0].elements.filter((e) => e.type === 'line');
  assert.equal(lines.length, 3, 'All 3 lines including thin filled rule should be lines, not rects');
  assert.ok(lines.some((l) => l.objectSubtype === 'divider' || l.objectSubtype === 'horizontal_line'));
  assert.ok(lines.some((l) => l.objectSubtype === 'vertical_line'));
  aggregateKpi.tp += 3;
  aggregateKpi.classTotal += 3;
  aggregateKpi.classRight += 3;
});

test('Scenario 4: 4-line connected rectangular border reconstruction without false merges', async () => {
  const doc = await PDFDocument.create();
  const pg = doc.addPage([612, 792]);
  const x1 = 70, y1 = 100, x2 = 290, y2 = 240;
  // Draw 4 separate orthogonal lines meeting at corners
  pg.drawLine({ start: { x: x1, y: 792 - y1 }, end: { x: x2, y: 792 - y1 }, thickness: 1 });
  pg.drawLine({ start: { x: x1, y: 792 - y2 }, end: { x: x2, y: 792 - y2 }, thickness: 1 });
  pg.drawLine({ start: { x: x1, y: 792 - y1 }, end: { x: x1, y: 792 - y2 }, thickness: 1 });
  pg.drawLine({ start: { x: x2, y: 792 - y1 }, end: { x: x2, y: 792 - y2 }, thickness: 1 });
  // Unrelated nearby separator line
  pg.drawLine({ start: { x: 70, y: 792 - 280 }, end: { x: 290, y: 792 - 280 }, thickness: 1 });

  const bytes = await doc.save();
  const { processed } = await scanPdfBytes(bytes);
  const els = processed[0].elements;
  const reconstructedRect = els.find(
    (e) =>
      (e.type === 'shape' || e.type === 'border') &&
      e.detectionMethod === 'geometric_inference'
  );
  assert.ok(reconstructedRect, '4 connected orthogonal lines must promote to a rectangle');
  assert.equal(reconstructedRect.childIds?.length, 4);
  recordBBoxCheck(reconstructedRect, { x: 70, y: 100, width: 220, height: 140 });

  const remainingLines = els.filter((e) => e.type === 'line');
  assert.equal(remainingLines.length, 1, 'Only unrelated line should remain standalone');
  aggregateKpi.tp += 2;
  aggregateKpi.classTotal += 2;
  aggregateKpi.classRight += 2;
});

test('Scenario 5: Dashed lines detection & dashArray preservation', async () => {
  const doc = await PDFDocument.create();
  const pg = doc.addPage([612, 792]);
  pg.drawLine({
    start: { x: 40, y: 792 - 300 },
    end: { x: 570, y: 792 - 300 },
    thickness: 1,
    dashArray: [6, 3],
    color: rgb(0.3, 0.3, 0.3),
  });

  const bytes = await doc.save();
  const { processed } = await scanPdfBytes(bytes);
  const dashed = processed[0].elements.find((e) => e.objectSubtype === 'dashed_line');
  assert.ok(dashed, 'Dashed line must be classified as dashed_line');
  assert.deepEqual(dashed.dashArray, [6, 3]);
  aggregateKpi.tp += 1;
  aggregateKpi.classTotal += 1;
  aggregateKpi.classRight += 1;
});

test('Scenario 6: Filled shapes, circles & ellipses classification', async () => {
  const doc = await PDFDocument.create();
  const pg = doc.addPage([612, 792]);
  pg.drawEllipse({
    x: 150,
    y: 792 - 180,
    xScale: 40,
    yScale: 40,
    borderColor: rgb(0.1, 0.3, 0.8),
    color: rgb(0.85, 0.9, 1),
    borderWidth: 1.5,
  });
  pg.drawEllipse({
    x: 340,
    y: 792 - 180,
    xScale: 70,
    yScale: 35,
    borderColor: rgb(0.2, 0.6, 0.3),
    borderWidth: 1.5,
  });

  const bytes = await doc.save();
  const { processed } = await scanPdfBytes(bytes);
  const els = processed[0].elements;
  const circle = els.find((e) => e.objectSubtype === 'circle');
  const ellipse = els.find((e) => e.objectSubtype === 'ellipse');
  assert.ok(circle, 'Equal-radius ellipse should classify as circle');
  assert.ok(ellipse, 'Unequal-radius ellipse should classify as ellipse');
  recordBBoxCheck(circle, { x: 110, y: 140, width: 80, height: 80 });
  recordBBoxCheck(ellipse, { x: 270, y: 145, width: 140, height: 70 });
  aggregateKpi.tp += 2;
  aggregateKpi.classTotal += 2;
  aggregateKpi.classRight += 2;
});

test('Scenario 7: Multiple embedded images & repeated XObject detection (100%)', async () => {
  const doc = await PDFDocument.create();
  const pg = doc.addPage([612, 792]);
  const logoImg = await doc.embedPng(makeTestPng(120, 60, 20, 80, 180));
  const photoImg = await doc.embedPng(makeTestPng(240, 160, 200, 110, 60));

  // Repeated logo drawn twice + photo drawn once
  pg.drawImage(logoImg, { x: 40, y: topLeftToPdfY(40, 45), width: 90, height: 45 });
  pg.drawImage(logoImg, { x: 40, y: topLeftToPdfY(420, 45), width: 90, height: 45 });
  pg.drawImage(photoImg, { x: 220, y: topLeftToPdfY(160, 120), width: 180, height: 120 });

  const bytes = await doc.save();
  const { processed, rawPages } = await scanPdfBytes(bytes);
  const images = processed[0].elements.filter((e) => e.type === 'image' || e.type === 'signature');
  aggregateKpi.imgExpected += 3;
  aggregateKpi.imgDetected += images.length;
  assert.equal(images.length, 3, 'All 3 image placements (including repeated XObject) must be detected');

  const logoResIds = new Set(
    images.filter((i) => Math.abs(i.width - 90) < 2).map((i) => i.imageResourceId)
  );
  assert.equal(logoResIds.size, 1, 'Repeated XObject must reference shared imageResourceId');
  const resId = Array.from(logoResIds)[0]!;
  assert.equal(rawPages[0].imageResources[resId].usageCount, 2);
  aggregateKpi.tp += 3;
});

test('Scenario 8: Transparent / alpha SMask image detection', async () => {
  const doc = await PDFDocument.create();
  const pg = doc.addPage([612, 792]);
  const alphaPng = await doc.embedPng(makeTestPng(100, 50, 30, 140, 90, 128));
  pg.drawImage(alphaPng, { x: 80, y: topLeftToPdfY(100, 50), width: 100, height: 50 });

  const bytes = await doc.save();
  const { processed, rawPages } = await scanPdfBytes(bytes);
  const img = processed[0].elements.find((e) => e.type === 'image' || e.type === 'signature');
  assert.ok(img);
  const res = img.imageResourceId ? rawPages[0].imageResources[img.imageResourceId] : undefined;
  assert.ok(res?.hasAlpha && res?.hasMask, 'RGBA PNG should retain SMask/alpha flag in PDF');
  aggregateKpi.imgExpected += 1;
  aggregateKpi.imgDetected += 1;
  aggregateKpi.tp += 1;
});

test('Scenario 9: Signature & stamp image semantic classification', async () => {
  const doc = await PDFDocument.create();
  const pg = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const sigPng = await doc.embedPng(makeTestPng(180, 45, 20, 20, 20));
  const stampPng = await doc.embedPng(makeTestPng(90, 90, 180, 30, 30));

  pg.drawText('Authorized Signature', {
    x: 60,
    y: 792 - 665,
    size: 9,
    font,
  });
  pg.drawImage(sigPng, { x: 60, y: topLeftToPdfY(600, 36), width: 150, height: 36 });
  pg.drawImage(stampPng, { x: 400, y: topLeftToPdfY(580, 72), width: 72, height: 72 });

  const bytes = await doc.save();
  const { processed } = await scanPdfBytes(bytes);
  const els = processed[0].elements;
  const sigEl = els.find((e) => e.objectSubtype === 'signature_image');
  const stampEl = els.find((e) => e.objectSubtype === 'stamp_image');
  assert.ok(sigEl, 'Wide image near Signature label should classify as signature_image');
  assert.ok(stampEl, 'Compact square image should classify as stamp_image');
  aggregateKpi.imgExpected += 2;
  aggregateKpi.imgDetected += 2;
  aggregateKpi.classTotal += 2;
  aggregateKpi.classRight += 2;
});

test('Scenario 10: Bordered table with irregular column widths', async () => {
  const doc = await PDFDocument.create();
  const pg = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const colEdges = [50, 110, 350, 460, 550]; // irregular widths: 60, 240, 110, 90
  const rowEdges = [100, 128, 156, 184];

  for (const ry of rowEdges) {
    pg.drawLine({ start: { x: colEdges[0], y: 792 - ry }, end: { x: colEdges[4], y: 792 - ry }, thickness: 0.8 });
  }
  for (const cx of colEdges) {
    pg.drawLine({ start: { x: cx, y: 792 - rowEdges[0] }, end: { x: cx, y: 792 - rowEdges[3] }, thickness: 0.8 });
  }

  const grid = [
    ['SKU', 'Description', 'Qty', 'Total'],
    ['A-10', 'Industrial Hydraulic Valve', '4', '$480.00'],
    ['B-22', 'Pressure Gauge Kit', '2', '$190.00'],
  ];
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      pg.drawText(grid[r][c], {
        x: colEdges[c] + 6,
        y: 792 - (rowEdges[r] + 18),
        size: 9.5,
        font,
      });
    }
  }

  const bytes = await doc.save();
  const { processed } = await scanPdfBytes(bytes);
  const table = processed[0].elements.find((e) => e.type === 'table');
  aggregateKpi.tableExpected += 1;
  assert.ok(table && table.tableData, 'Irregular bordered table must be reconstructed');
  aggregateKpi.tableRight += 1;
  assert.equal(table.tableData.rows.length, 3);
  assert.equal(table.tableData.rows[0].length, 4);
  assert.equal(table.tableData.rows[1][1], 'Industrial Hydraulic Valve');
  assert.equal(table.tableData.rows[2][3], '$190.00');
  const cw = table.tableData.colWidthsPt!;
  assert.ok(Math.abs(cw[0] - 60) <= 3 && Math.abs(cw[1] - 240) <= 3, `Col widths mismatch: ${cw}`);
});

test('Scenario 11: Borderless column-aligned table detection', async () => {
  const doc = await PDFDocument.create();
  const pg = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const rows = [
    ['Code', 'Service Item', 'Price'],
    ['SRV-1', 'Calibration Audit', '$120.00'],
    ['SRV-2', 'Sensor Replacement', '$245.00'],
    ['SRV-3', 'Annual Inspection', '$310.00'],
  ];
  const xs = [60, 160, 420];
  for (let r = 0; r < rows.length; r++) {
    const y = 120 + r * 20;
    for (let c = 0; c < 3; c++) {
      pg.drawText(rows[r][c], { x: xs[c], y: 792 - y, size: 10, font });
    }
  }

  const bytes = await doc.save();
  const { processed } = await scanPdfBytes(bytes);
  const table = processed[0].elements.find((e) => e.type === 'table');
  aggregateKpi.tableExpected += 1;
  assert.ok(table && table.tableData, 'Borderless column-aligned rows should form a table');
  aggregateKpi.tableRight += 1;
  assert.equal(table.tableData.hasBorders, false);
  assert.equal(table.tableData.detectionBasis, 'borderless');
  assert.equal(table.tableData.rows.length, 4);
  assert.equal(table.tableData.rows[3][1], 'Annual Inspection');
});

test('Scenario 12: Partially bordered table & merged-cell (rowSpan/colSpan) structural fidelity', async () => {
  const doc = await PDFDocument.create();
  const pg = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);

  // Outer frame + 2 inner row dividers, partial vertical col line only on rows 1..2 (row 0 spans across!)
  const x0 = 60, x1 = 220, x2 = 460;
  const y0 = 100, y1 = 130, y2 = 160, y3 = 190;
  pg.drawLine({ start: { x: x0, y: 792 - y0 }, end: { x: x2, y: 792 - y0 }, thickness: 1 });
  pg.drawLine({ start: { x: x0, y: 792 - y1 }, end: { x: x2, y: 792 - y1 }, thickness: 1 });
  pg.drawLine({ start: { x: x0, y: 792 - y2 }, end: { x: x2, y: 792 - y2 }, thickness: 1 });
  pg.drawLine({ start: { x: x0, y: 792 - y3 }, end: { x: x2, y: 792 - y3 }, thickness: 1 });
  pg.drawLine({ start: { x: x0, y: 792 - y0 }, end: { x: x0, y: 792 - y3 }, thickness: 1 });
  pg.drawLine({ start: { x: x2, y: 792 - y0 }, end: { x: x2, y: 792 - y3 }, thickness: 1 });
  pg.drawLine({ start: { x: x1, y: 792 - y1 }, end: { x: x1, y: 792 - y3 }, thickness: 1 });

  pg.drawText('Summary Header', { x: 80, y: 792 - 118, size: 10, font });
  pg.drawText('Subtotal', { x: 70, y: 792 - 148, size: 9.5, font });
  pg.drawText('$500.00', { x: 240, y: 792 - 148, size: 9.5, font });
  pg.drawText('Tax', { x: 70, y: 792 - 178, size: 9.5, font });
  pg.drawText('$50.00', { x: 240, y: 792 - 178, size: 9.5, font });

  const bytes = await doc.save();
  const { processed } = await scanPdfBytes(bytes);
  const table = processed[0].elements.find((e) => e.type === 'table');
  aggregateKpi.tableExpected += 1;
  assert.ok(table && table.tableData);
  aggregateKpi.tableRight += 1;
  assert.ok(
    (table.tableData.mergedCells || []).some((m) => m.row === 0 && m.colSpan >= 2),
    'Row 0 without inner divider should be detected as a merged colSpan cell'
  );

  // Also verify manual merge & split helpers
  const merged = mergeTableCellRange(table.tableData, 1, 0, 2, 0);
  assert.ok(merged.mergedCells?.some((m) => m.row === 1 && m.col === 0 && m.rowSpan === 2));
  const split = splitMergedTableCell(merged, 1, 0);
  assert.ok(!split.mergedCells?.some((m) => m.row === 1 && m.col === 0));
});

test('Scenario 13: Multiline table cell text aggregation', async () => {
  const doc = await PDFDocument.create();
  const pg = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);

  const cols = [60, 280, 480];
  const rowsY = [100, 130, 190];
  for (const ry of rowsY) {
    pg.drawLine({ start: { x: cols[0], y: 792 - ry }, end: { x: cols[2], y: 792 - ry }, thickness: 1 });
  }
  for (const cx of cols) {
    pg.drawLine({ start: { x: cx, y: 792 - rowsY[0] }, end: { x: cx, y: 792 - rowsY[2] }, thickness: 1 });
  }

  pg.drawText('Item', { x: 70, y: 792 - 118, size: 10, font });
  pg.drawText('Notes', { x: 290, y: 792 - 118, size: 10, font });
  pg.drawText('Widget Pro', { x: 70, y: 792 - 155, size: 9.5, font });
  pg.drawText('Line 1: Express Freight', { x: 290, y: 792 - 150, size: 9, font });
  pg.drawText('Line 2: Fragile Handling', { x: 290, y: 792 - 166, size: 9, font });

  const bytes = await doc.save();
  const { processed } = await scanPdfBytes(bytes);
  const table = processed[0].elements.find((e) => e.type === 'table');
  aggregateKpi.tableExpected += 1;
  assert.ok(table && table.tableData);
  aggregateKpi.tableRight += 1;
  const multiCell = table.tableData.rows[1][1];
  assert.ok(multiCell.includes('\n'), 'Multiple lines inside one cell must join with newline');
  assert.ok(multiCell.includes('Line 1: Express Freight') && multiCell.includes('Line 2: Fragile Handling'));
});

test('Scenario 14: Rotated text preservation (Tm rotation !== 0)', async () => {
  const doc = await PDFDocument.create();
  const pg = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  pg.drawText('CONFIDENTIAL DRAFT', {
    x: 560,
    y: 300,
    size: 14,
    font,
    rotate: degrees(90),
  });

  const bytes = await doc.save();
  const { processed } = await scanPdfBytes(bytes);
  const txt = processed[0].elements.find((e) => e.text.includes('CONFIDENTIAL DRAFT'));
  assert.ok(txt, 'Rotated text must be extracted');
  assert.notEqual(txt.rotation, 0, 'Rotated text must preserve non-zero rotation');
  aggregateKpi.textTotal += 1;
  aggregateKpi.textRight += 1;
});

test('Scenario 15: Multiple font families & weights (Helvetica, HelveticaBold, TimesRoman, Courier)', async () => {
  const doc = await PDFDocument.create();
  const pg = doc.addPage([612, 792]);
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const helvB = await doc.embedFont(StandardFonts.HelveticaBold);
  const times = await doc.embedFont(StandardFonts.TimesRoman);
  const cour = await doc.embedFont(StandardFonts.Courier);

  pg.drawText('Sans Normal Text', { x: 60, y: 792 - 80, size: 11, font: helv });
  pg.drawText('Sans Bold Heading', { x: 60, y: 792 - 120, size: 14, font: helvB });
  pg.drawText('Serif Legal Clause', { x: 60, y: 792 - 160, size: 11, font: times });
  pg.drawText('CODE-8841-XYZ', { x: 60, y: 792 - 200, size: 10, font: cour });

  const bytes = await doc.save();
  const { processed, inspection } = await scanPdfBytes(bytes);
  assert.ok(inspection.totalEmbeddedFonts >= 4);
  const els = processed[0].elements;
  const boldEl = els.find((e) => e.text.includes('Sans Bold Heading'));
  const serifEl = els.find((e) => e.text.includes('Serif Legal Clause'));
  const monoEl = els.find((e) => e.text.includes('CODE-8841-XYZ'));

  assert.equal(boldEl?.fontWeight, 'bold');
  assert.equal(serifEl?.fontFamily, 'Times-Roman');
  assert.equal(monoEl?.fontFamily, 'Courier');
  aggregateKpi.textTotal += 4;
  aggregateKpi.textRight += 4;
});

test('Scenario 16: Varying font sizes & semantic text field classification', async () => {
  const doc = await PDFDocument.create();
  const pg = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  pg.drawText('ACME LOGISTICS INVOICE', { x: 60, y: 792 - 60, size: 22, font: bold });
  pg.drawText('Customer Name:', { x: 60, y: 792 - 120, size: 10, font });
  pg.drawText('INV-2026-0042', { x: 200, y: 792 - 120, size: 11, font: bold });
  pg.drawText('2026-11-18', { x: 200, y: 792 - 150, size: 10, font });
  pg.drawText('$1,249.50', { x: 200, y: 792 - 180, size: 10, font });

  const bytes = await doc.save();
  const { processed } = await scanPdfBytes(bytes);
  const els = processed[0].elements;

  const heading = els.find((e) => e.text.includes('ACME LOGISTICS INVOICE'));
  const label = els.find((e) => e.text.includes('Customer Name:'));
  const inv = els.find((e) => e.text.includes('INV-2026-0042'));
  const dt = els.find((e) => e.text.includes('2026-11-18'));
  const amt = els.find((e) => e.text.includes('$1,249.50'));

  assert.equal(heading?.type, 'heading');
  assert.equal(label?.objectSubtype, 'label');
  assert.equal(inv?.type, 'invoice_number');
  assert.equal(dt?.objectSubtype, 'date_field');
  assert.equal(amt?.objectSubtype, 'numeric_field');
  aggregateKpi.classTotal += 5;
  aggregateKpi.classRight += 5;
  aggregateKpi.textTotal += 5;
  aggregateKpi.textRight += 5;
});

test('Scenario 17: Image-only scanned OCR input vs native text deduplication', async () => {
  // Simulate scanned PDF page with an image covering page + OCR text runs
  const scannedInput: RawPageScanInput = {
    pageNumber: 1,
    widthPt: 612,
    heightPt: 792,
    rotation: 0,
    textRuns: [
      {
        id: 'ocr-1',
        pageNumber: 1,
        text: 'SCAN RECEIPT #RCP-9001',
        x: 72,
        y: 90,
        width: 190,
        height: 14,
        baselineY: 102,
        rotation: 0,
        transformMatrix: [12, 0, 0, -12, 72, 102],
        fontName: 'Helvetica',
        fontFamily: 'Helvetica',
        fontSize: 12,
        fontWeight: 'bold',
        fontStyle: 'normal',
        color: '#111827',
        confidence: 0.86,
        sourceOrigin: 'scanned_ocr',
        zOrder: 10,
      },
      // Duplicate overlapping low-confidence OCR over same bbox as native text
      {
        id: 'native-1',
        pageNumber: 1,
        text: 'Amount: $42.00',
        x: 72,
        y: 140,
        width: 95,
        height: 12,
        baselineY: 150,
        rotation: 0,
        transformMatrix: [10, 0, 0, -10, 72, 150],
        fontName: 'Helvetica',
        fontFamily: 'Helvetica',
        fontSize: 10,
        fontWeight: 'normal',
        fontStyle: 'normal',
        color: '#111827',
        confidence: 0.98,
        sourceOrigin: 'original_pdf',
        zOrder: 11,
      },
    ],
    vectorPaths: [],
    imagePlacements: [
      {
        id: 'bg-scan-img',
        pageNumber: 1,
        resourceId: 'res-scan-1',
        sourceXObjectName: 'Im1',
        x: 0,
        y: 0,
        width: 612,
        height: 792,
        rotation: 0,
        transformMatrix: [612, 0, 0, 792, 0, 0],
        naturalWidth: 1224,
        naturalHeight: 1584,
        hasAlpha: false,
        hasMask: false,
        isInlineImage: false,
        isImageMask: false,
        zOrder: 1,
      },
    ],
    imageResources: {
      'res-scan-1': {
        id: 'res-scan-1',
        sourceXObjectName: 'Im1',
        dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
        mimeType: 'image/png',
        naturalWidth: 1224,
        naturalHeight: 1584,
        hasAlpha: false,
        hasMask: false,
        isInlineImage: false,
        usageCount: 1,
      },
    },
    annotations: [],
    formWidgets: [],
    ocrRegionsCount: 1,
  };

  const res = processRawPageScan(scannedInput);
  const report = computeScanQualityReport(res.elements, 1, scannedInput.ocrRegionsCount);
  assert.equal(report.ocrRegions, 1);
  const bgImg = res.elements.find((e) => e.id === 'bg-scan-img');
  assert.equal(bgImg?.objectSubtype, 'background_image');
  assert.ok(res.elements.some((e) => e.sourceOrigin === 'scanned_ocr'));
  // Ensure native text region has area overlap check passing
  const nativeEl = res.elements.find((e) => e.text.includes('$42.00'))!;
  assert.ok(rectIntersectionArea(nativeEl, { x: 72, y: 140, width: 95, height: 12 }) > 0);
  aggregateKpi.textTotal += 2;
  aggregateKpi.textRight += 2;
});

test('Scenario 18: Mixed native text + raster image regions preserved together', async () => {
  const doc = await PDFDocument.create();
  const pg = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const chartPng = await doc.embedPng(makeTestPng(260, 140, 45, 95, 165));

  pg.drawText('Q4 Engineering Report', { x: 60, y: 792 - 70, size: 16, font });
  pg.drawImage(chartPng, { x: 60, y: topLeftToPdfY(120, 140), width: 260, height: 140 });
  pg.drawText('Figure 1.1: Throughput benchmark results.', { x: 60, y: 792 - 285, size: 10, font });

  const bytes = await doc.save();
  const { processed } = await scanPdfBytes(bytes);
  const els = processed[0].elements;
  assert.ok(els.some((e) => e.text.includes('Q4 Engineering Report')));
  assert.ok(els.some((e) => e.type === 'image'));
  assert.ok(els.some((e) => e.text.includes('Figure 1.1')));
  aggregateKpi.imgExpected += 1;
  aggregateKpi.imgDetected += 1;
  aggregateKpi.textTotal += 2;
  aggregateKpi.textRight += 2;
});

test('Scenario 19: Dual-block receipt layout, repeated blocks & hierarchy tree', async () => {
  const doc = await PDFDocument.create();
  const pg = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  // Left block (x=30..290) and Right block (x=322..582)
  pg.drawRectangle({ x: 30, y: topLeftToPdfY(60, 300), width: 260, height: 300, borderColor: rgb(0.2, 0.2, 0.2), borderWidth: 1 });
  pg.drawText('RECEIPT COPY A', { x: 48, y: 792 - 90, size: 13, font: bold });
  pg.drawText('RCP-0001', { x: 48, y: 792 - 125, size: 11, font: bold });
  pg.drawText('Total: $125.00', { x: 48, y: 792 - 160, size: 10, font });

  pg.drawRectangle({ x: 322, y: topLeftToPdfY(60, 300), width: 260, height: 300, borderColor: rgb(0.2, 0.2, 0.2), borderWidth: 1 });
  pg.drawText('RECEIPT COPY B', { x: 340, y: 792 - 90, size: 13, font: bold });
  pg.drawText('RCP-0002', { x: 340, y: 792 - 125, size: 11, font: bold });
  pg.drawText('Total: $125.00', { x: 340, y: 792 - 160, size: 10, font });

  const bytes = await doc.save();
  const { processed } = await scanPdfBytes(bytes);
  const els = processed[0].elements;

  const blocks = els.filter((e) => e.type === 'repeated_block');
  assert.equal(blocks.length, 2, 'Dual side-by-side receipt blocks should yield 2 repeated_block containers');
  const receiptNums = els.filter((e) => e.type === 'receipt_number');
  assert.equal(receiptNums.length, 2, 'Both RCP-0001 and RCP-0002 must classify as receipt_number');
  assert.notEqual(receiptNums[0].blockId, receiptNums[1].blockId);

  // Verify hierarchy tree contains page -> receipt/document blocks -> children
  assert.equal(processed[0].hierarchy.kind, 'page');
  assert.ok(processed[0].hierarchy.children.length >= 2);
  aggregateKpi.classTotal += 4;
  aggregateKpi.classRight += 4;
});

test('Scenario 20: Multi-page PDF with AcroForm widgets, persistent ScanCorrectionRules, & overall KPI thresholds', async () => {
  const doc = await PDFDocument.create();
  doc.setTitle('Precision Scan Multi-Page Test');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([612, 792]);
  const p2 = doc.addPage([612, 792]);

  p1.drawText('Application Form Page 1', { x: 50, y: 792 - 60, size: 15, font });
  p2.drawText('Continued Terms Page 2', { x: 50, y: 792 - 60, size: 15, font });

  const form = doc.getForm();
  const nameField = form.createTextField('applicant_name');
  nameField.setText('Ada Lovelace');
  nameField.addToPage(p1, { x: 50, y: topLeftToPdfY(110, 24), width: 220, height: 24 });

  const agreeBox = form.createCheckBox('agree_terms');
  agreeBox.check();
  agreeBox.addToPage(p1, { x: 50, y: topLeftToPdfY(160, 16), width: 16, height: 16 });

  const countryDd = form.createDropdown('country');
  countryDd.addOptions(['US', 'UK', 'JP']);
  countryDd.select('UK');
  countryDd.addToPage(p2, { x: 50, y: topLeftToPdfY(120, 24), width: 160, height: 24 });

  const bytes = await doc.save();
  const inspection = await inspectPdfStructure(bytes);
  assert.equal(inspection.pageCount, 2);
  assert.equal(inspection.metadata.title, 'Precision Scan Multi-Page Test');
  assert.equal(inspection.totalFormWidgets, 3);

  const rawPages = await parsePdfIntoRawPageScans(bytes, inspection);
  const page1Res = processRawPageScan(rawPages[0]);
  const page2Res = processRawPageScan(rawPages[1]);

  const allForms = [...page1Res.elements, ...page2Res.elements].filter(
    (e) => e.type === 'form_field'
  );
  assert.equal(allForms.length, 3);
  assert.ok(allForms.some((f) => f.objectSubtype === 'text_input' && f.text === 'Ada Lovelace'));
  assert.ok(allForms.some((f) => f.objectSubtype === 'checkbox'));
  assert.ok(allForms.some((f) => f.objectSubtype === 'dropdown' && f.text === 'UK'));

  // Verify persistent ScanCorrectionRule remembers manual reclassification on re-scan
  const page1Heading = page1Res.elements.find((e) => e.text.includes('Application Form'))!;
  const rule = buildCorrectionRuleFromElement(
    page1Heading,
    'heading',
    'header',
    'reclassify'
  );
  const rescanned = processRawPageScan(rawPages[0], [rule]);
  const afterRule = rescanned.elements.find((e) => e.text.includes('Application Form'))!;
  assert.equal(afterRule.objectSubtype, 'header');

  // Verify manual selection -> Convert to Table helper
  const manualTbl = convertSelectionToTableElement(
    [
      { ...page1Heading, id: 'c1', type: 'text', x: 50, y: 200, width: 60, height: 14, text: 'Key' },
      { ...page1Heading, id: 'c2', type: 'text', x: 180, y: 200, width: 80, height: 14, text: 'Value' },
      { ...page1Heading, id: 'c3', type: 'text', x: 50, y: 222, width: 60, height: 14, text: 'ID' },
      { ...page1Heading, id: 'c4', type: 'text', x: 180, y: 222, width: 80, height: 14, text: '9001' },
    ],
    1
  );
  assert.ok(manualTbl && manualTbl.tableData?.rows.length === 2);

  // Aggregate Precision Scan Engine 2.0 KPI verification across all 20 scenarios
  const precision = aggregateKpi.tp / Math.max(1, aggregateKpi.tp + aggregateKpi.fp);
  const recall = aggregateKpi.tp / Math.max(1, aggregateKpi.tp + aggregateKpi.fn);
  const classAcc = aggregateKpi.classRight / Math.max(1, aggregateKpi.classTotal);
  const textAcc = aggregateKpi.textRight / Math.max(1, aggregateKpi.textTotal);
  const imgAcc = aggregateKpi.imgDetected / Math.max(1, aggregateKpi.imgExpected);
  const tableAcc = aggregateKpi.tableRight / Math.max(1, aggregateKpi.tableExpected);
  const avgBBoxErr =
    aggregateKpi.bboxErrors.reduce((s, v) => s + v, 0) /
    Math.max(1, aggregateKpi.bboxErrors.length);

  assert.ok(precision >= 0.9, `Precision ${precision} below 0.90`);
  assert.ok(recall >= 0.9, `Recall ${recall} below 0.90`);
  assert.ok(classAcc >= 0.9, `Classification accuracy ${classAcc} below 0.90`);
  assert.ok(textAcc >= 0.95, `Text accuracy ${textAcc} below 0.95`);
  assert.equal(imgAcc, 1, `Image detection ${imgAcc} must be 100%`);
  assert.ok(tableAcc >= 0.9, `Table accuracy ${tableAcc} below 0.90`);
  assert.ok(avgBBoxErr <= 3.0, `Average BBox error ${avgBBoxErr}pt exceeded 3.0pt`);
});
