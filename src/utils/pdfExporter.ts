import fontkit from '@pdf-lib/fontkit';
import JSZip from 'jszip';
import {
  clip,
  degrees,
  endPath,
  PDFArray,
  PDFDocument,
  PDFEmbeddedPage,
  PDFFont,
  PDFImage,
  PDFName,
  PDFPage,
  PDFString,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
  StandardFonts,
} from 'pdf-lib';
import {
  AssetFontItem,
  DocumentElement,
  PDFProject,
  RectPt,
} from '../types/pdfStudio';
import { formatCellValue } from './dataFormulaEngine';
import { computeSheetLayout, SheetLayoutPlan, SlotGeometry } from './geometryEngine';
import { base64ToUint8Array, renderSinglePagePreview } from './pdfRenderer';
import { renderSanitizedRedactedPagePng } from './redactionEngine';
import { applyRestorationToDataUrl } from './restorationEngine';
import { computeSerialValueForSlot } from './serialEngine';
import { computeTypographyLayout } from './typographyEngine';

function hexToRgb(hex: string) {
  const clean = (hex || '#000000').replace('#', '');
  if (clean.length !== 6) return rgb(0, 0, 0);
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return rgb(
    Number.isFinite(r) ? r : 0,
    Number.isFinite(g) ? g : 0,
    Number.isFinite(b) ? b : 0
  );
}

interface FontBundle {
  helvetica: PDFFont;
  helveticaBold: PDFFont;
  helveticaOblique: PDFFont;
  helveticaBoldOblique: PDFFont;
  times: PDFFont;
  timesBold: PDFFont;
  courier: PDFFont;
  courierBold: PDFFont;
  custom: Map<string, PDFFont>;
}

async function embedFontsForDoc(
  doc: PDFDocument,
  customFonts: AssetFontItem[] = [],
  allowCustomEmbedding = true
): Promise<FontBundle> {
  const custom = new Map<string, PDFFont>();
  if (allowCustomEmbedding && customFonts.length > 0) {
    try {
      doc.registerFontkit(fontkit);
      for (const cf of customFonts) {
        if (!cf.canEmbedInPdf || cf.format === 'woff') continue;
        try {
          const bytes = base64ToUint8Array(cf.dataBase64);
          const embedded = await doc.embedFont(bytes, { subset: true });
          custom.set(cf.fontFamily.toLowerCase(), embedded);
        } catch (err) {
          console.warn(`Could not embed custom font "${cf.fontFamily}":`, err);
        }
      }
    } catch {
      // Fallback safely to StandardFonts
    }
  }

  return {
    helvetica: await doc.embedFont(StandardFonts.Helvetica),
    helveticaBold: await doc.embedFont(StandardFonts.HelveticaBold),
    helveticaOblique: await doc.embedFont(StandardFonts.HelveticaOblique),
    helveticaBoldOblique: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
    times: await doc.embedFont(StandardFonts.TimesRoman),
    timesBold: await doc.embedFont(StandardFonts.TimesRomanBold),
    courier: await doc.embedFont(StandardFonts.Courier),
    courierBold: await doc.embedFont(StandardFonts.CourierBold),
    custom,
  };
}

function pickFont(el: DocumentElement, fonts: FontBundle): PDFFont {
  const fam = (el.fontFamily || '').toLowerCase();
  const customHit = fonts.custom.get(fam);
  if (customHit) return customHit;

  const isBold = el.fontWeight === 'bold';
  const isItalic = el.fontStyle === 'italic';

  if (fam.includes('courier') || fam.includes('mono')) {
    return isBold ? fonts.courierBold : fonts.courier;
  }
  if (fam.includes('times') || fam.includes('serif')) {
    return isBold ? fonts.timesBold : fonts.times;
  }
  if (isBold && isItalic) return fonts.helveticaBoldOblique;
  if (isBold) return fonts.helveticaBold;
  if (isItalic) return fonts.helveticaOblique;
  return fonts.helvetica;
}

interface SlotTransform {
  rot: 0 | 90 | 180 | 270;
  anchorX: number;
  anchorY: number;
  slotHeightPt: number;
}

function mapSlotPoint(
  u: number,
  v: number,
  st?: SlotTransform
): { x: number; y: number; rotDeg: number } {
  if (!st || st.rot === 0) {
    return { x: u, y: v, rotDeg: 0 };
  }
  switch (st.rot) {
    case 90:
      return { x: st.anchorX + v, y: st.anchorY - u, rotDeg: -90 };
    case 180:
      return { x: st.anchorX - u, y: st.anchorY - v, rotDeg: -180 };
    case 270:
      return { x: st.anchorX - v, y: st.anchorY + u, rotDeg: -270 };
  }
}

/**
 * Computes exact PDF-space coordinates for a point `(localDx, localDyFromTop)` inside an element
 * whose Konva rotation pivots around its top-left `(el.x, el.y)` clockwise by `el.rotation` deg.
 */
function rotateAroundKonvaTopLeft(
  elX: number,
  elYTop: number,
  localDx: number,
  localDyFromTop: number,
  rotDegClockwise: number,
  localHeight: number
): { u: number; v: number } {
  if (!rotDegClockwise) {
    return { u: elX + localDx, v: localHeight - (elYTop + localDyFromTop) };
  }
  const rad = (rotDegClockwise * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const screenX = elX + localDx * cos - localDyFromTop * sin;
  const screenY = elYTop + localDx * sin + localDyFromTop * cos;
  return { u: screenX, v: localHeight - screenY };
}

function appendPdfAnnotationEntry(
  pdfDoc: PDFDocument,
  page: PDFPage,
  opts: {
    subtype: 'Highlight' | 'Underline' | 'StrikeOut' | 'Text' | 'Square' | 'Circle' | 'FreeText';
    rect: [number, number, number, number];
    contents?: string;
    colorHex?: string;
  }
) {
  try {
    const context = pdfDoc.context;
    const c = hexToRgb(opts.colorHex || '#111111');
    const cObj =
      c.type === 'RGB'
        ? [c.red, c.green, c.blue]
        : [0.1, 0.1, 0.1];
    const annotDict = context.obj({
      Type: PDFName.of('Annot'),
      Subtype: PDFName.of(opts.subtype),
      Rect: opts.rect,
      Contents: PDFString.of(opts.contents || ''),
      C: cObj,
      F: 4, // Print flag
    });
    const annotRef = context.register(annotDict);
    const existingAnnots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (existingAnnots) {
      existingAnnots.push(annotRef);
    } else {
      page.node.set(PDFName.of('Annots'), context.obj([annotRef]));
    }
  } catch {
    // Non-fatal if viewer dictionary registration fails
  }
}

async function prepareImageBytesForExport(
  dataUrl: string,
  cropRect?: RectPt,
  maskShape?: 'none' | 'rect' | 'rounded' | 'circle',
  quality?: number
): Promise<{ bytes: Uint8Array; isPng: boolean } | null> {
  const needsCanvasTransform =
    Boolean(cropRect && cropRect.width > 1 && cropRect.height > 1) ||
    maskShape === 'circle' ||
    maskShape === 'rounded' ||
    (quality !== undefined && quality < 0.99);

  if (!needsCanvasTransform || typeof document === 'undefined') {
    const isPng = dataUrl.startsWith('data:image/png');
    return {
      bytes: base64ToUint8Array(dataUrl.replace(/^data:image\/\w+;base64,/, '')),
      isPng,
    };
  }

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.crossOrigin = 'anonymous';
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = dataUrl;
    });

    const sx = cropRect ? Math.max(0, cropRect.x) : 0;
    const sy = cropRect ? Math.max(0, cropRect.y) : 0;
    const sw = cropRect
      ? Math.max(2, Math.min(img.naturalWidth - sx, cropRect.width))
      : img.naturalWidth;
    const sh = cropRect
      ? Math.max(2, Math.min(img.naturalHeight - sy, cropRect.height))
      : img.naturalHeight;

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(2, Math.round(sw));
    canvas.height = Math.max(2, Math.round(sh));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    if (maskShape === 'circle') {
      ctx.beginPath();
      ctx.ellipse(
        canvas.width / 2,
        canvas.height / 2,
        canvas.width / 2,
        canvas.height / 2,
        0,
        0,
        Math.PI * 2
      );
      ctx.clip();
    } else if (maskShape === 'rounded') {
      const r = Math.min(canvas.width, canvas.height) * 0.14;
      ctx.beginPath();
      ctx.roundRect(0, 0, canvas.width, canvas.height, r);
      ctx.clip();
    }

    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

    const hasAlphaMask =
      maskShape === 'circle' || maskShape === 'rounded' || dataUrl.startsWith('data:image/png');
    const outMime = hasAlphaMask && (quality === undefined || quality >= 0.95)
      ? 'image/png'
      : 'image/jpeg';
    const outUrl =
      outMime === 'image/jpeg'
        ? canvas.toDataURL('image/jpeg', Math.max(0.25, Math.min(1, quality ?? 0.92)))
        : canvas.toDataURL('image/png');
    canvas.width = 0;
    canvas.height = 0;

    return {
      bytes: base64ToUint8Array(outUrl.replace(/^data:image\/\w+;base64,/, '')),
      isPng: outMime === 'image/png',
    };
  } catch {
    const isPng = dataUrl.startsWith('data:image/png');
    return {
      bytes: base64ToUint8Array(dataUrl.replace(/^data:image\/\w+;base64,/, '')),
      isPng,
    };
  }
}

async function drawElementOntoPage(
  pdfDoc: PDFDocument,
  page: PDFPage,
  el: DocumentElement,
  overrideText: string | null,
  pageHeightPt: number,
  fonts: FontBundle,
  pageBgHex: string,
  imageCache: Map<string, PDFImage>,
  slotTransform?: SlotTransform
) {
  if (!el.visible && !el.eraseOriginal) return;

  const localHeight = slotTransform ? slotTransform.slotHeightPt : pageHeightPt;
  const x = el.x;
  const elRot = el.rotation || 0;
  const pdfYBottom = localHeight - el.y - el.height;

  const toPagePt = (u: number, v: number, extraDeg = 0) => {
    const mapped = mapSlotPoint(u, v, slotTransform);
    const totalDeg = extraDeg + mapped.rotDeg;
    return {
      x: mapped.x,
      y: mapped.y,
      rotate: totalDeg !== 0 ? degrees(totalDeg) : undefined,
    };
  };

  const toElementBottomLeftPt = (
    localDx: number,
    localDyFromTop: number,
    boxHeightFromTop: number
  ) => {
    const anchor = rotateAroundKonvaTopLeft(
      el.x,
      el.y,
      localDx,
      localDyFromTop + boxHeightFromTop,
      elRot,
      localHeight
    );
    return toPagePt(anchor.u, anchor.v, elRot ? -elRot : 0);
  };

  if (el.eraseOriginal && el.sourceOriginalRect) {
    const r = el.sourceOriginalRect;
    const pos = toPagePt(r.x - 1, localHeight - r.y - r.height - 1);
    page.drawRectangle({
      x: pos.x,
      y: pos.y,
      width: r.width + 2,
      height: r.height + 2,
      color: hexToRgb(pageBgHex === 'transparent' ? '#FFFFFF' : pageBgHex),
      rotate: pos.rotate,
    });
  }

  if (!el.visible) return;

  // Redaction boxes
  if (el.type === 'redaction') {
    const pos = toElementBottomLeftPt(0, 0, el.height);
    page.drawRectangle({
      x: pos.x,
      y: pos.y,
      width: el.width,
      height: el.height,
      color: rgb(0, 0, 0),
      opacity: 1,
      rotate: pos.rotate,
    });
    return;
  }

  // Background fill box (non-annotation shapes/text)
  if (
    el.backgroundColor &&
    el.backgroundColor !== 'transparent' &&
    el.type !== 'annotation' &&
    el.type !== 'stamp'
  ) {
    const pos = toElementBottomLeftPt(0, 0, el.height);
    page.drawRectangle({
      x: pos.x,
      y: pos.y,
      width: el.width,
      height: el.height,
      color: hexToRgb(el.backgroundColor),
      opacity: el.opacity ?? 1,
      rotate: pos.rotate,
    });
  }

  const isModifiedOrAdded = Boolean(el.isUserAdded || el.eraseOriginal);

  // Freehand Draw (Ink)
  if (el.type === 'draw' && el.points && el.points.length >= 4) {
    const strokeCol = hexToRgb(el.color || '#111111');
    const thickness = Math.max(0.75, el.borderWidth ?? 2);
    for (let i = 0; i < el.points.length - 2; i += 2) {
      const p1Local = rotateAroundKonvaTopLeft(
        el.x,
        el.y,
        el.points[i],
        el.points[i + 1],
        elRot,
        localHeight
      );
      const p2Local = rotateAroundKonvaTopLeft(
        el.x,
        el.y,
        el.points[i + 2],
        el.points[i + 3],
        elRot,
        localHeight
      );
      const p1 = toPagePt(p1Local.u, p1Local.v);
      const p2 = toPagePt(p2Local.u, p2Local.v);
      page.drawLine({
        start: { x: p1.x, y: p1.y },
        end: { x: p2.x, y: p2.y },
        thickness,
        color: strokeCol,
        opacity: el.opacity ?? 1,
      });
    }
    return;
  }

  // Measurement line
  if (el.type === 'measure') {
    const midY = el.height / 2;
    const startL = rotateAroundKonvaTopLeft(el.x, el.y, 0, midY, elRot, localHeight);
    const endL = rotateAroundKonvaTopLeft(el.x, el.y, el.width, midY, elRot, localHeight);
    const p1 = toPagePt(startL.u, startL.v);
    const p2 = toPagePt(endL.u, endL.v);
    const col = hexToRgb(el.color || '#111111');
    page.drawLine({
      start: { x: p1.x, y: p1.y },
      end: { x: p2.x, y: p2.y },
      thickness: Math.max(0.8, el.borderWidth ?? 1.2),
      color: col,
    });
    // End ticks
    const tick1a = rotateAroundKonvaTopLeft(el.x, el.y, 0, midY - 4, elRot, localHeight);
    const tick1b = rotateAroundKonvaTopLeft(el.x, el.y, 0, midY + 4, elRot, localHeight);
    const tick2a = rotateAroundKonvaTopLeft(el.x, el.y, el.width, midY - 4, elRot, localHeight);
    const tick2b = rotateAroundKonvaTopLeft(el.x, el.y, el.width, midY + 4, elRot, localHeight);
    const t1a = toPagePt(tick1a.u, tick1a.v);
    const t1b = toPagePt(tick1b.u, tick1b.v);
    const t2a = toPagePt(tick2a.u, tick2a.v);
    const t2b = toPagePt(tick2b.u, tick2b.v);
    page.drawLine({ start: { x: t1a.x, y: t1a.y }, end: { x: t1b.x, y: t1b.y }, thickness: 1, color: col });
    page.drawLine({ start: { x: t2a.x, y: t2a.y }, end: { x: t2b.x, y: t2b.y }, thickness: 1, color: col });

    if (el.text) {
      const labelPos = toPagePt(
        (p1.x + p2.x) / 2 - Math.min(28, el.text.length * 2.5),
        (p1.y + p2.y) / 2 + 5
      );
      page.drawText(el.text, {
        x: labelPos.x,
        y: labelPos.y,
        size: 8.5,
        font: fonts.helveticaBold,
        color: col,
      });
    }
    return;
  }

  // Callout (leader line + pointer + box + text)
  if (el.type === 'callout') {
    const pos = toElementBottomLeftPt(0, 0, el.height);
    page.drawRectangle({
      x: pos.x,
      y: pos.y,
      width: el.width,
      height: el.height,
      color: hexToRgb(el.backgroundColor === 'transparent' ? '#FFFFFF' : el.backgroundColor),
      borderColor: hexToRgb(el.borderColor || el.color || '#111111'),
      borderWidth: el.borderWidth ?? 1.2,
      opacity: el.opacity ?? 1,
      rotate: pos.rotate,
    });
    if (el.calloutTarget) {
      const startPt = toPagePt(el.x + el.width / 2, localHeight - (el.y + el.height));
      const endPt = toPagePt(el.calloutTarget.x, localHeight - el.calloutTarget.y);
      page.drawLine({
        start: { x: startPt.x, y: startPt.y },
        end: { x: endPt.x, y: endPt.y },
        thickness: 1.1,
        color: hexToRgb(el.borderColor || el.color || '#111111'),
      });
      page.drawEllipse({
        x: endPt.x,
        y: endPt.y,
        xScale: 2.6,
        yScale: 2.6,
        color: hexToRgb(el.borderColor || el.color || '#111111'),
      });
    }
    if (el.text) {
      const tPos = toElementBottomLeftPt(4, (el.fontSize || 10) + 4, 0);
      page.drawText(el.text, {
        x: tPos.x,
        y: tPos.y,
        size: Math.max(6, el.fontSize || 10),
        font: pickFont(el, fonts),
        color: hexToRgb(el.color || '#111111'),
        maxWidth: Math.max(12, el.width - 8),
        rotate: tPos.rotate,
      });
    }
    appendPdfAnnotationEntry(pdfDoc, page, {
      subtype: 'FreeText',
      rect: [x, pdfYBottom, x + el.width, pdfYBottom + el.height],
      contents: el.text,
      colorHex: el.borderColor || '#111111',
    });
    return;
  }

  // Stamp
  if (el.type === 'stamp') {
    const col = hexToRgb(el.color || '#111111');
    const outer = toElementBottomLeftPt(0, 0, el.height);
    page.drawRectangle({
      x: outer.x,
      y: outer.y,
      width: el.width,
      height: el.height,
      borderColor: col,
      borderWidth: el.borderWidth ?? 2,
      opacity: el.opacity ?? 0.9,
      rotate: outer.rotate,
    });
    const inner = toElementBottomLeftPt(3, 3, Math.max(4, el.height - 6));
    page.drawRectangle({
      x: inner.x,
      y: inner.y,
      width: Math.max(4, el.width - 6),
      height: Math.max(4, el.height - 6),
      borderColor: col,
      borderWidth: 0.8,
      opacity: el.opacity ?? 0.9,
      rotate: inner.rotate,
    });
    const label = el.stampText || el.text || 'APPROVED';
    const fontSize = Math.max(8, Math.min(el.fontSize || 14, el.height * 0.55));
    const lw = fonts.helveticaBold.widthOfTextAtSize(label, fontSize);
    const tAnchor = rotateAroundKonvaTopLeft(
      el.x,
      el.y,
      Math.max(4, (el.width - lw) / 2),
      el.stampDate ? el.height * 0.45 : el.height * 0.58,
      elRot,
      localHeight
    );
    const tPos = toPagePt(tAnchor.u, tAnchor.v, elRot ? -elRot : 0);
    page.drawText(label, {
      x: tPos.x,
      y: tPos.y,
      size: fontSize,
      font: fonts.helveticaBold,
      color: col,
      rotate: tPos.rotate,
    });
    if (el.stampDate) {
      const dw = fonts.courierBold.widthOfTextAtSize(el.stampDate, 7.5);
      const dAnchor = rotateAroundKonvaTopLeft(
        el.x,
        el.y,
        Math.max(4, (el.width - dw) / 2),
        el.height * 0.78,
        elRot,
        localHeight
      );
      const dPos = toPagePt(dAnchor.u, dAnchor.v, elRot ? -elRot : 0);
      page.drawText(el.stampDate, {
        x: dPos.x,
        y: dPos.y,
        size: 7.5,
        font: fonts.courierBold,
        color: col,
        rotate: dPos.rotate,
      });
    }
    return;
  }

  // Annotations
  if (el.type === 'annotation') {
    const kind = el.annotationKind || 'highlight';
    const col = hexToRgb(el.color || '#111111');
    if (kind === 'highlight') {
      const pos = toElementBottomLeftPt(0, 0, el.height);
      page.drawRectangle({
        x: pos.x,
        y: pos.y,
        width: el.width,
        height: el.height,
        color: col,
        opacity: Math.min(0.45, el.opacity ?? 0.25),
        rotate: pos.rotate,
      });
      appendPdfAnnotationEntry(pdfDoc, page, {
        subtype: 'Highlight',
        rect: [x, pdfYBottom, x + el.width, pdfYBottom + el.height],
        contents: el.commentText || el.text,
        colorHex: el.color || '#111111',
      });
    } else if (kind === 'underline' || kind === 'strikeout') {
      const yOff = kind === 'underline' ? el.height - 2 : el.height / 2;
      const p1L = rotateAroundKonvaTopLeft(el.x, el.y, 0, yOff, elRot, localHeight);
      const p2L = rotateAroundKonvaTopLeft(el.x, el.y, el.width, yOff, elRot, localHeight);
      const p1 = toPagePt(p1L.u, p1L.v);
      const p2 = toPagePt(p2L.u, p2L.v);
      page.drawLine({
        start: { x: p1.x, y: p1.y },
        end: { x: p2.x, y: p2.y },
        thickness: Math.max(1.2, el.borderWidth ?? 1.5),
        color: col,
      });
      appendPdfAnnotationEntry(pdfDoc, page, {
        subtype: kind === 'underline' ? 'Underline' : 'StrikeOut',
        rect: [x, pdfYBottom, x + el.width, pdfYBottom + el.height],
        contents: el.commentText || el.text,
        colorHex: el.color || '#111111',
      });
    } else if (kind === 'note') {
      const pos = toElementBottomLeftPt(0, 0, el.height);
      page.drawRectangle({
        x: pos.x,
        y: pos.y,
        width: el.width,
        height: el.height,
        color: hexToRgb('#F3F4F6'),
        borderColor: col,
        borderWidth: 1,
        rotate: pos.rotate,
      });
      appendPdfAnnotationEntry(pdfDoc, page, {
        subtype: 'Text',
        rect: [x, pdfYBottom, x + el.width, pdfYBottom + el.height],
        contents: el.commentText || el.text || 'Note',
        colorHex: el.color || '#111111',
      });
    } else if (kind === 'ellipse') {
      const cAnchor = rotateAroundKonvaTopLeft(el.x, el.y, el.width / 2, el.height / 2, elRot, localHeight);
      const pos = toPagePt(cAnchor.u, cAnchor.v);
      page.drawEllipse({
        x: pos.x,
        y: pos.y,
        xScale: el.width / 2,
        yScale: el.height / 2,
        borderColor: col,
        borderWidth: el.borderWidth ?? 1.5,
        opacity: el.opacity ?? 0.9,
      });
      appendPdfAnnotationEntry(pdfDoc, page, {
        subtype: 'Circle',
        rect: [x, pdfYBottom, x + el.width, pdfYBottom + el.height],
        contents: el.commentText || el.text,
        colorHex: el.color || '#111111',
      });
    } else {
      const pos = toElementBottomLeftPt(0, 0, el.height);
      page.drawRectangle({
        x: pos.x,
        y: pos.y,
        width: el.width,
        height: el.height,
        borderColor: col,
        borderWidth: el.borderWidth ?? 1.5,
        opacity: el.opacity ?? 0.9,
        rotate: pos.rotate,
      });
      appendPdfAnnotationEntry(pdfDoc, page, {
        subtype: 'Square',
        rect: [x, pdfYBottom, x + el.width, pdfYBottom + el.height],
        contents: el.commentText || el.text,
        colorHex: el.color || '#111111',
      });
    }
    return;
  }

  // Shapes & Borders
  if (el.type === 'shape' || el.type === 'border') {
    if (isModifiedOrAdded) {
      if (el.shapeKind === 'circle') {
        const cAnchor = rotateAroundKonvaTopLeft(el.x, el.y, el.width / 2, el.height / 2, elRot, localHeight);
        const pos = toPagePt(cAnchor.u, cAnchor.v);
        const swapped =
          slotTransform && (slotTransform.rot === 90 || slotTransform.rot === 270);
        page.drawEllipse({
          x: pos.x,
          y: pos.y,
          xScale: swapped ? el.height / 2 : el.width / 2,
          yScale: swapped ? el.width / 2 : el.height / 2,
          borderColor: hexToRgb(el.borderColor || el.color || '#1E293B'),
          borderWidth: el.borderWidth ?? 1.2,
          color:
            el.backgroundColor && el.backgroundColor !== 'transparent'
              ? hexToRgb(el.backgroundColor)
              : undefined,
          opacity: el.opacity ?? 1,
        });
      } else if (el.shapeKind === 'arrow') {
        const midY = el.height / 2;
        const p1L = rotateAroundKonvaTopLeft(el.x, el.y, 0, midY, elRot, localHeight);
        const p2L = rotateAroundKonvaTopLeft(el.x, el.y, el.width, midY, elRot, localHeight);
        const p1 = toPagePt(p1L.u, p1L.v);
        const p2 = toPagePt(p2L.u, p2L.v);
        const col = hexToRgb(el.borderColor || el.color || '#1E293B');
        const thick = Math.max(1, el.borderWidth ?? 1.8);
        page.drawLine({
          start: { x: p1.x, y: p1.y },
          end: { x: p2.x, y: p2.y },
          thickness: thick,
          color: col,
          opacity: el.opacity ?? 1,
        });
        // Arrowhead wings
        const wingLen = Math.min(10, Math.max(5, el.width * 0.14));
        const wTopL = rotateAroundKonvaTopLeft(el.x, el.y, el.width - wingLen, midY - wingLen * 0.55, elRot, localHeight);
        const wBotL = rotateAroundKonvaTopLeft(el.x, el.y, el.width - wingLen, midY + wingLen * 0.55, elRot, localHeight);
        const wt = toPagePt(wTopL.u, wTopL.v);
        const wb = toPagePt(wBotL.u, wBotL.v);
        page.drawLine({ start: { x: p2.x, y: p2.y }, end: { x: wt.x, y: wt.y }, thickness: thick, color: col });
        page.drawLine({ start: { x: p2.x, y: p2.y }, end: { x: wb.x, y: wb.y }, thickness: thick, color: col });
      } else {
        const pos = toElementBottomLeftPt(0, 0, el.height);
        page.drawRectangle({
          x: pos.x,
          y: pos.y,
          width: el.width,
          height: el.height,
          borderColor: hexToRgb(el.borderColor || el.color || '#1E293B'),
          borderWidth: el.borderWidth ?? 1,
          opacity: el.opacity ?? 1,
          rotate: pos.rotate,
        });
      }
    }
    if (!el.text) return;
  }

  if (el.type === 'line') {
    if (isModifiedOrAdded) {
      const midY = el.height / 2;
      const p1L = rotateAroundKonvaTopLeft(el.x, el.y, 0, midY, elRot, localHeight);
      const p2L = rotateAroundKonvaTopLeft(el.x, el.y, el.width, midY, elRot, localHeight);
      const p1 = toPagePt(p1L.u, p1L.v);
      const p2 = toPagePt(p2L.u, p2L.v);
      page.drawLine({
        start: { x: p1.x, y: p1.y },
        end: { x: p2.x, y: p2.y },
        thickness: Math.max(0.5, el.borderWidth ?? 1.5),
        color: hexToRgb(el.color || '#1E293B'),
        opacity: el.opacity ?? 1,
      });
    }
    return;
  }

  // Images & Signatures
  if ((el.type === 'image' || el.type === 'signature') && el.imageDataUrl) {
    try {
      const cacheKey = `${el.imageDataUrl.slice(0, 48)}:${JSON.stringify(el.imageCropRect || '')}:${el.maskShape || ''}:${el.imageCompressionQuality || ''}`;
      let embedded = imageCache.get(cacheKey);
      if (!embedded) {
        const prepared = await prepareImageBytesForExport(
          el.imageDataUrl,
          el.imageCropRect,
          el.maskShape,
          el.imageCompressionQuality
        );
        if (!prepared) return;
        embedded = prepared.isPng
          ? await pdfDoc.embedPng(prepared.bytes)
          : await pdfDoc.embedJpg(prepared.bytes);
        imageCache.set(cacheKey, embedded);
      }
      const pos = toElementBottomLeftPt(0, 0, el.height);
      page.drawImage(embedded, {
        x: pos.x,
        y: pos.y,
        width: el.width,
        height: el.height,
        opacity: el.opacity ?? 1,
        rotate: pos.rotate,
      });
    } catch (e) {
      console.warn('Could not embed image into PDF:', e);
    }
    return;
  }

  // Tables
  if (el.type === 'table' && el.tableData && isModifiedOrAdded) {
    const { rows, borderColor, headerBgColor, headerRow, cellPadding } =
      el.tableData;
    const rowCount = Math.max(1, rows.length);
    const colCount = Math.max(1, rows[0]?.length || 1);
    const rowH = el.height / rowCount;
    const colW = el.width / colCount;
    const font = fonts.helvetica;
    const boldFont = fonts.helveticaBold;

    for (let rIdx = 0; rIdx < rowCount; rIdx++) {
      for (let cIdx = 0; cIdx < colCount; cIdx++) {
        const localDx = cIdx * colW;
        const localDyTop = rIdx * rowH;
        const rectPos = toElementBottomLeftPt(localDx, localDyTop, rowH);
        page.drawRectangle({
          x: rectPos.x,
          y: rectPos.y,
          width: colW,
          height: rowH,
          color:
            headerRow && rIdx === 0
              ? hexToRgb(headerBgColor || '#F1F5F9')
              : undefined,
          borderColor: hexToRgb(borderColor || '#CBD5E1'),
          borderWidth: 0.7,
          rotate: rectPos.rotate,
        });
        const cellText = String(rows[rIdx]?.[cIdx] ?? '');
        if (cellText) {
          const textSize = Math.min(el.fontSize || 9, rowH * 0.65);
          const tAnchor = rotateAroundKonvaTopLeft(
            el.x,
            el.y,
            localDx + (cellPadding || 4),
            localDyTop + rowH / 2 + textSize * 0.35,
            elRot,
            localHeight
          );
          const textPos = toPagePt(tAnchor.u, tAnchor.v, elRot ? -elRot : 0);
          page.drawText(cellText, {
            x: textPos.x,
            y: textPos.y,
            size: textSize,
            font: headerRow && rIdx === 0 ? boldFont : font,
            color: hexToRgb(el.color || '#111827'),
            maxWidth: Math.max(10, colW - (cellPadding || 4) * 2),
            rotate: textPos.rotate,
          });
        }
      }
    }
    return;
  }

  // Text elements with full Typography Studio parity
  const shouldDrawText = overrideText !== null || isModifiedOrAdded;
  if (!shouldDrawText) return;

  const textToDraw = overrideText !== null ? overrideText : el.text;
  if (!textToDraw) return;

  if (overrideText !== null && !el.eraseOriginal && el.sourceOriginalRect) {
    const r = el.sourceOriginalRect;
    const maskPos = toPagePt(r.x - 1, localHeight - r.y - r.height - 1);
    page.drawRectangle({
      x: maskPos.x,
      y: maskPos.y,
      width: r.width + 2,
      height: r.height + 2,
      color: hexToRgb(pageBgHex === 'transparent' ? '#FFFFFF' : pageBgHex),
      rotate: maskPos.rotate,
    });
  }

  const font = pickFont(el, fonts);
  const typo = computeTypographyLayout(el, textToDraw);
  const size = typo.effectiveFontSize;
  const paddingPt = Math.max(0, el.paddingPt ?? 1);
  const letterSpacing = el.letterSpacing ?? 0;
  const baselineOffset = el.baselineOffset ?? 0;
  const textColor = hexToRgb(el.color || '#111827');

  let cursorY = typo.verticalOffsetPt;
  typo.lines.forEach((lineObj, idx) => {
    if (idx > 0 && lineObj.paragraphIndex !== typo.lines[idx - 1].paragraphIndex) {
      cursorY += typo.paragraphSpacingPt;
    }

    const line = lineObj.text;
    const basePdfW = font.widthOfTextAtSize(line, size);
    const trackingExtra = Math.max(0, line.length - 1) * letterSpacing;
    const totalLineW = basePdfW + trackingExtra;

    let localX = paddingPt;
    if (el.align === 'center') {
      localX = paddingPt + (typo.contentBoxWidthPt - totalLineW) / 2;
    } else if (el.align === 'right') {
      localX = paddingPt + typo.contentBoxWidthPt - totalLineW;
    }

    const baselineFromTop = cursorY + size * 0.85 - baselineOffset;

    if (Math.abs(letterSpacing) > 0.05 && line.length > 1) {
      let charX = localX;
      for (const ch of line) {
        const chAnchor = rotateAroundKonvaTopLeft(
          el.x,
          el.y,
          charX,
          baselineFromTop,
          elRot,
          localHeight
        );
        const chPos = toPagePt(chAnchor.u, chAnchor.v, elRot ? -elRot : 0);
        page.drawText(ch, {
          x: chPos.x,
          y: chPos.y,
          size,
          font,
          color: textColor,
          opacity: el.opacity ?? 1,
          rotate: chPos.rotate,
        });
        charX += font.widthOfTextAtSize(ch, size) + letterSpacing;
      }
    } else {
      const anchor = rotateAroundKonvaTopLeft(
        el.x,
        el.y,
        localX,
        baselineFromTop,
        elRot,
        localHeight
      );
      const pos = toPagePt(anchor.u, anchor.v, elRot ? -elRot : 0);
      page.drawText(line, {
        x: pos.x,
        y: pos.y,
        size,
        font,
        color: textColor,
        opacity: el.opacity ?? 1,
        rotate: pos.rotate,
      });
    }

    // Underline & Strikethrough decoration lines
    if (el.underline && line.trim().length > 0) {
      const uY = baselineFromTop + Math.max(1, size * 0.12);
      const u1L = rotateAroundKonvaTopLeft(el.x, el.y, localX, uY, elRot, localHeight);
      const u2L = rotateAroundKonvaTopLeft(el.x, el.y, localX + totalLineW, uY, elRot, localHeight);
      const u1 = toPagePt(u1L.u, u1L.v);
      const u2 = toPagePt(u2L.u, u2L.v);
      page.drawLine({
        start: { x: u1.x, y: u1.y },
        end: { x: u2.x, y: u2.y },
        thickness: Math.max(0.6, size * 0.07),
        color: textColor,
        opacity: el.opacity ?? 1,
      });
    }

    if (el.strikethrough && line.trim().length > 0) {
      const sY = baselineFromTop - size * 0.3;
      const s1L = rotateAroundKonvaTopLeft(el.x, el.y, localX, sY, elRot, localHeight);
      const s2L = rotateAroundKonvaTopLeft(el.x, el.y, localX + totalLineW, sY, elRot, localHeight);
      const s1 = toPagePt(s1L.u, s1L.v);
      const s2 = toPagePt(s2L.u, s2L.v);
      page.drawLine({
        start: { x: s1.x, y: s1.y },
        end: { x: s2.x, y: s2.y },
        thickness: Math.max(0.6, size * 0.07),
        color: textColor,
        opacity: el.opacity ?? 1,
      });
    }

    cursorY += typo.lineHeightPt;
  });
}

function drawCropMarksAndGuides(
  page: PDFPage,
  x: number,
  yBottom: number,
  w: number,
  h: number,
  options: { cropMarks: boolean; cuttingGuides: boolean; showBorders: boolean }
) {
  if (options.showBorders) {
    page.drawRectangle({
      x,
      y: yBottom,
      width: w,
      height: h,
      borderColor: rgb(0.65, 0.7, 0.78),
      borderWidth: 0.6,
    });
  }

  if (options.cuttingGuides) {
    page.drawRectangle({
      x,
      y: yBottom,
      width: w,
      height: h,
      borderColor: rgb(0.4, 0.52, 0.72),
      borderWidth: 0.4,
      borderDashArray: [4, 3],
    });
  }

  if (options.cropMarks) {
    const len = 8;
    const offset = 2;
    const c = rgb(0.1, 0.1, 0.1);
    const corners = [
      [
        [x - len - offset, yBottom],
        [x - offset, yBottom],
      ],
      [
        [x, yBottom - len - offset],
        [x, yBottom - offset],
      ],
      [
        [x + w + offset, yBottom],
        [x + w + len + offset, yBottom],
      ],
      [
        [x + w, yBottom - len - offset],
        [x + w, yBottom - offset],
      ],
      [
        [x - len - offset, yBottom + h],
        [x - offset, yBottom + h],
      ],
      [
        [x, yBottom + h + offset],
        [x, yBottom + h + len + offset],
      ],
      [
        [x + w + offset, yBottom + h],
        [x + w + len + offset, yBottom + h],
      ],
      [
        [x + w, yBottom + h + offset],
        [x + w, yBottom + h + len + offset],
      ],
    ];
    for (const [start, end] of corners) {
      page.drawLine({
        start: { x: start[0], y: start[1] },
        end: { x: end[0], y: end[1] },
        thickness: 0.6,
        color: c,
      });
    }
  }
}

function buildDynamicOverridesForSlot(
  project: PDFProject,
  pageZeroIdx: number,
  slotZeroIdx: number,
  copiesPerPage: number
): Map<string, string> {
  const overrides = new Map<string, string>();
  const mode = project.bulkConfig.dataSourceMode || 'hybrid';
  const globalRecordIdx = pageZeroIdx * copiesPerPage + slotZeroIdx;
  const row = project.dataRows[globalRecordIdx];

  if (row && mode !== 'serial_only') {
    for (const col of project.dataColumns) {
      const formatted = formatCellValue(
        row[col.name],
        col,
        row,
        project.dataColumns
      );
      overrides.set(col.name, formatted);
    }
  }

  if (mode !== 'dataset') {
    for (const rule of project.serialRules) {
      const matchingRules = project.serialRules.filter(
        (r) => r.targetFieldKey === rule.targetFieldKey
      );
      if (matchingRules.length > 1 && copiesPerPage > 1 && rule.blockIndex !== slotZeroIdx) {
        continue;
      }
      const res = computeSerialValueForSlot(
        rule,
        pageZeroIdx,
        slotZeroIdx,
        copiesPerPage,
        project.dataRows,
        matchingRules.length,
        rule.blockIndex
      );
      if (matchingRules.length > 1) {
        overrides.set(`__block_${rule.blockIndex}::${rule.targetFieldKey}`, res.value);
        if (rule.blockIndex === slotZeroIdx) {
          overrides.set(rule.targetFieldKey, res.value);
        }
      } else {
        overrides.set(rule.targetFieldKey, res.value);
      }
    }
  }

  return overrides;
}

function resolveBlockIndex(blockId?: string): number | null {
  if (!blockId) return null;
  const letterMatch = blockId.match(/block[-_]?([A-Z])$/i);
  if (letterMatch) {
    return letterMatch[1].toUpperCase().charCodeAt(0) - 65;
  }
  const numMatch = blockId.match(/(\d+)$/);
  if (numMatch) {
    return Math.max(0, parseInt(numMatch[1], 10) - 1);
  }
  return null;
}

async function renderSlotOntoPage(
  outDoc: PDFDocument,
  outPage: PDFPage,
  srcDoc: PDFDocument | null,
  embeddedPageCache: Map<string, PDFEmbeddedPage>,
  sanitizedBitmapCache: Map<string, PDFImage>,
  project: PDFProject,
  layout: SheetLayoutPlan,
  slot: SlotGeometry,
  templatePageNum: number,
  bleed: number,
  outH: number,
  fonts: FontBundle,
  imageCache: Map<string, PDFImage>,
  overrides?: Map<string, string>
) {
  const { pageConfig, copiesConfig } = project;
  const { sourceBox } = layout;

  const drawX = bleed + slot.drawXPt;
  const drawTop = bleed + slot.drawTopPt;
  const copyW = slot.unrotatedWidthPt;
  const copyH = slot.unrotatedHeightPt;
  const boxW = slot.placedWidthPt;
  const boxH = slot.placedHeightPt;
  const drawYBottom = outH - drawTop - boxH;
  const rot = slot.rotation;
  const scale = slot.scale;

  let anchorX = drawX;
  let anchorY = drawYBottom;
  if (rot === 90) {
    anchorX = drawX;
    anchorY = drawYBottom + boxH;
  } else if (rot === 180) {
    anchorX = drawX + boxW;
    anchorY = drawYBottom + boxH;
  } else if (rot === 270) {
    anchorX = drawX + boxW;
    anchorY = drawYBottom;
  }

  const shouldClipToCell =
    layout.scalingMode === 'fill_cell' ||
    layout.boundaryMode !== 'original_page' ||
    (copiesConfig.enabled && copiesConfig.sourceScope === 'selected_block');

  if (shouldClipToCell) {
    const clipX =
      layout.scalingMode === 'fill_cell' ? bleed + slot.cellLeftPt : drawX;
    const clipW =
      layout.scalingMode === 'fill_cell' ? slot.cellWidthPt : boxW;
    const clipTop =
      layout.scalingMode === 'fill_cell' ? bleed + slot.cellTopPt : drawTop;
    const clipH =
      layout.scalingMode === 'fill_cell' ? slot.cellHeightPt : boxH;
    const clipYBottom = outH - clipTop - clipH;
    outPage.pushOperators(
      pushGraphicsState(),
      rectangle(clipX, clipYBottom, clipW, clipH),
      clip(),
      endPath()
    );
  }

  const pageMeta = project.originalPages.find(
    (p) => p.pageNumber === templatePageNum
  );
  const hasAppliedRedactions = Boolean(pageMeta?.appliedRedactions?.length);
  const hasActiveRestoration = Boolean(pageMeta?.restoration?.enabled);
  const isInsertedBlank = Boolean(pageMeta?.isBlankInserted);

  // If page has true applied redactions or active non-destructive restoration, bake sanitized raster background
  // so underlying PDF glyphs inside redacted rectangles are 100% destroyed and unextractable.
  if (!isInsertedBlank && (hasAppliedRedactions || hasActiveRestoration)) {
    const key = `sanitized-p${templatePageNum}-${hasAppliedRedactions ? pageMeta!.appliedRedactions!.length : 0}-${JSON.stringify(pageMeta?.restoration || '')}`;
    let sanitizedImg = sanitizedBitmapCache.get(key);
    if (!sanitizedImg && pageMeta) {
      let baseDataUrl = pageMeta.previewImageDataUrl;
      if (!baseDataUrl && project.sourcePdfBase64) {
        baseDataUrl =
          (await renderSinglePagePreview(
            project.sourcePdfBase64,
            pageMeta.sourcePdfPageNumber || templatePageNum,
            Math.min(3, Math.max(2, project.exportConfig.dpi / 72))
          )) || undefined;
      }
      if (baseDataUrl && hasActiveRestoration && pageMeta.restoration) {
        baseDataUrl = await applyRestorationToDataUrl(baseDataUrl, pageMeta.restoration);
      }
      const pngBytes = await renderSanitizedRedactedPagePng({
        pdfBase64: baseDataUrl ? undefined : project.sourcePdfBase64,
        pageImageDataUrl: baseDataUrl,
        pageNumber: pageMeta.sourcePdfPageNumber || templatePageNum,
        pageWidthPt: pageMeta.widthPt,
        pageHeightPt: pageMeta.heightPt,
        redactions: pageMeta.appliedRedactions || [],
        scale: Math.min(3, Math.max(2, project.exportConfig.dpi / 72)),
      });
      if (pngBytes) {
        sanitizedImg = await outDoc.embedPng(pngBytes);
        sanitizedBitmapCache.set(key, sanitizedImg);
      }
    }
    if (sanitizedImg) {
      outPage.drawImage(sanitizedImg, {
        x: anchorX,
        y: anchorY,
        width: copyW,
        height: copyH,
        rotate: rot ? degrees(-rot) : undefined,
      });
    }
  } else if (srcDoc && !isInsertedBlank) {
    const origPdfPageNum = pageMeta?.sourcePdfPageNumber || templatePageNum;
    const srcIdx = Math.max(
      0,
      Math.min(origPdfPageNum - 1, srcDoc.getPageCount() - 1)
    );
    const srcPage = srcDoc.getPage(srcIdx);
    const cropBox = srcPage.getCropBox();
    const bLeft = cropBox.x + sourceBox.x;
    const bRight = cropBox.x + Math.min(cropBox.width, sourceBox.x + sourceBox.width);
    const bTop = cropBox.y + cropBox.height - sourceBox.y;
    const bBottom = cropBox.y + Math.max(0, cropBox.height - (sourceBox.y + sourceBox.height));

    const cacheKey = `p${srcIdx}-${bLeft.toFixed(2)}-${bBottom.toFixed(2)}-${bRight.toFixed(2)}-${bTop.toFixed(2)}`;
    let embeddedBg = embeddedPageCache.get(cacheKey);
    if (!embeddedBg) {
      embeddedBg = await outDoc.embedPage(srcPage, {
        left: bLeft,
        right: Math.max(bLeft + 1, bRight),
        bottom: bBottom,
        top: Math.max(bBottom + 1, bTop),
      });
      embeddedPageCache.set(cacheKey, embeddedBg);
    }

    outPage.drawPage(embeddedBg, {
      x: anchorX,
      y: anchorY,
      width: copyW,
      height: copyH,
      rotate: rot ? degrees(-rot) : undefined,
    });
  }

  const slotTransform: SlotTransform | undefined = rot
    ? {
        rot,
        anchorX,
        anchorY,
        slotHeightPt: copyH,
      }
    : undefined;

  const els = project.elements.filter((e) => e.pageNumber === templatePageNum);
  for (const el of els) {
    if (
      copiesConfig.enabled &&
      copiesConfig.sourceScope === 'selected_block' &&
      copiesConfig.selectedBlockId &&
      el.blockId &&
      el.blockId !== copiesConfig.selectedBlockId
    ) {
      continue;
    }
    const relX = (el.x - sourceBox.x) * scale;
    const relY = (el.y - sourceBox.y) * scale;
    const scaledEl: DocumentElement = {
      ...el,
      x: rot ? relX : drawX + relX,
      y: rot ? relY : drawTop + relY,
      width: el.width * scale,
      height: el.height * scale,
      fontSize: Math.max(4, el.fontSize * scale),
      points: el.points ? el.points.map((pt) => pt * scale) : undefined,
      calloutTarget: el.calloutTarget
        ? {
            x: (rot ? 0 : drawX) + (el.calloutTarget.x - sourceBox.x) * scale,
            y: (rot ? 0 : drawTop) + (el.calloutTarget.y - sourceBox.y) * scale,
          }
        : undefined,
      sourceOriginalRect: el.sourceOriginalRect
        ? {
            x: (rot ? 0 : drawX) + (el.sourceOriginalRect.x - sourceBox.x) * scale,
            y: (rot ? 0 : drawTop) + (el.sourceOriginalRect.y - sourceBox.y) * scale,
            width: el.sourceOriginalRect.width * scale,
            height: el.sourceOriginalRect.height * scale,
          }
        : undefined,
    };
    let override: string | null = null;
    if (overrides && el.fieldKey) {
      const bIdx = resolveBlockIndex(el.blockId);
      const blockSpecificKey =
        bIdx !== null ? `__block_${bIdx}::${el.fieldKey}` : null;
      if (blockSpecificKey && overrides.has(blockSpecificKey)) {
        override = overrides.get(blockSpecificKey)!;
      } else if (overrides.has(el.fieldKey)) {
        override = overrides.get(el.fieldKey)!;
      }
    }
    await drawElementOntoPage(
      outDoc,
      outPage,
      scaledEl,
      override,
      outH,
      fonts,
      pageConfig.backgroundColor,
      imageCache,
      slotTransform
    );
  }

  if (shouldClipToCell) {
    outPage.pushOperators(popGraphicsState());
  }

  if (copiesConfig.enabled) {
    drawCropMarksAndGuides(outPage, drawX, drawYBottom, boxW, boxH, {
      cropMarks: copiesConfig.cropMarks || project.exportConfig.cropMarks,
      cuttingGuides: copiesConfig.cuttingGuides,
      showBorders: copiesConfig.showBorders,
    });
  }
}

async function buildSingleModifiedTemplatePage(
  project: PDFProject,
  sourcePageNumber = 1,
  overrides?: Map<string, string>,
  customFonts: AssetFontItem[] = []
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fonts = await embedFontsForDoc(
    doc,
    customFonts,
    project.exportConfig.embedFonts
  );
  const imageCache = new Map<string, PDFImage>();
  const embeddedPageCache = new Map<string, PDFEmbeddedPage>();
  const sanitizedBitmapCache = new Map<string, PDFImage>();
  const layout = computeSheetLayout(project, sourcePageNumber);
  const bleed = Math.max(0, project.exportConfig.bleedPt || project.pageConfig.bleedPt || 0);
  const baseOutW = layout.outputSheetWidthPt;
  const baseOutH = layout.outputSheetHeightPt;
  const outW = baseOutW + bleed * 2;
  const outH = baseOutH + bleed * 2;

  const page = doc.addPage([outW, outH]);
  page.setMediaBox(0, 0, outW, outH);
  if (bleed > 0) {
    page.setBleedBox(0, 0, outW, outH);
    page.setTrimBox(bleed, bleed, baseOutW, baseOutH);
  }
  if (project.pageConfig.backgroundColor && project.pageConfig.backgroundColor !== '#FFFFFF') {
    page.drawRectangle({
      x: 0,
      y: 0,
      width: outW,
      height: outH,
      color: hexToRgb(project.pageConfig.backgroundColor),
    });
  }

  let srcDoc: PDFDocument | null = null;
  if (project.sourcePdfBase64) {
    try {
      srcDoc = await PDFDocument.load(base64ToUint8Array(project.sourcePdfBase64), {
        ignoreEncryption: true,
      });
    } catch {
      srcDoc = null;
    }
  }

  for (const slot of layout.slots) {
    await renderSlotOntoPage(
      doc,
      page,
      srcDoc,
      embeddedPageCache,
      sanitizedBitmapCache,
      project,
      layout,
      slot,
      sourcePageNumber,
      bleed,
      outH,
      fonts,
      imageCache,
      overrides
    );
  }

  if (project.exportConfig.cropMarks || project.pageConfig.cropMarks) {
    drawCropMarksAndGuides(page, bleed, bleed, baseOutW, baseOutH, {
      cropMarks: true,
      cuttingGuides: false,
      showBorders: false,
    });
  }

  const pageMeta = project.originalPages.find((p) => p.pageNumber === sourcePageNumber);
  const effectiveRotation = pageMeta?.rotation ?? project.pageConfig.rotation;
  if (effectiveRotation) {
    page.setRotation(degrees(effectiveRotation));
  }

  return doc.save();
}

export interface ExportJobControl {
  isCancelled: () => boolean;
  waitWhilePaused: () => Promise<void>;
}

export async function generateExportBytes(
  project: PDFProject,
  options: {
    onProgress?: (stage: string, current: number, total: number) => void;
    extraMergePdfBytes?: Uint8Array[];
    customFonts?: AssetFontItem[];
    control?: ExportJobControl;
  } = {}
): Promise<{
  data: Uint8Array;
  fileName: string;
  mimeType: string;
}> {
  const {
    onProgress,
    extraMergePdfBytes = [],
    customFonts = [],
    control,
  } = options;
  const { exportConfig, pageConfig, copiesConfig, bulkConfig } = project;

  const checkControl = async () => {
    if (control?.isCancelled()) {
      throw new Error('Export cancelled by user.');
    }
    if (control) {
      await control.waitWhilePaused();
      if (control.isCancelled()) {
        throw new Error('Export cancelled by user.');
      }
    }
  };

  const rawBleed = Math.max(0, exportConfig.bleedPt || pageConfig.bleedPt || 0);
  const bleed =
    exportConfig.mode === 'print_ready'
      ? Math.max(9, rawBleed)
      : rawBleed;
  const baseOutW = exportConfig.customWidthPt || pageConfig.widthPt;
  const baseOutH = exportConfig.customHeightPt || pageConfig.heightPt;
  const outW = baseOutW + bleed * 2;
  const outH = baseOutH + bleed * 2;

  const isBulkOrImposition =
    copiesConfig.enabled ||
    bulkConfig.enabled ||
    bulkConfig.totalOutputPages > 1 ||
    project.serialRules.length > 0;

  const totalPages = isBulkOrImposition
    ? Math.max(
        1,
        bulkConfig.totalOutputPages ||
          bulkConfig.endPageNumber - bulkConfig.startPageNumber + 1
      )
    : Math.max(1, project.pageCount);

  const copiesPerPage = copiesConfig.enabled
    ? Math.max(1, copiesConfig.columns * copiesConfig.rows)
    : 1;

  if (exportConfig.mode === 'merge') {
    onProgress?.('Merging PDF documents', 1, extraMergePdfBytes.length + 1);
    const mergedDoc = await PDFDocument.create();
    for (let p = 1; p <= Math.max(1, project.pageCount); p++) {
      await checkControl();
      const baseBytes = await buildSingleModifiedTemplatePage(
        project,
        p,
        undefined,
        customFonts
      );
      const baseLoaded = await PDFDocument.load(baseBytes);
      const basePages = await mergedDoc.copyPages(
        baseLoaded,
        baseLoaded.getPageIndices()
      );
      basePages.forEach((pg) => mergedDoc.addPage(pg));
    }

    for (let i = 0; i < extraMergePdfBytes.length; i++) {
      await checkControl();
      onProgress?.('Merging PDF documents', i + 2, extraMergePdfBytes.length + 1);
      const extraDoc = await PDFDocument.load(extraMergePdfBytes[i], {
        ignoreEncryption: true,
      });
      const copied = await mergedDoc.copyPages(extraDoc, extraDoc.getPageIndices());
      copied.forEach((pg) => mergedDoc.addPage(pg));
    }

    const bytes = await mergedDoc.save({ useObjectStreams: true });
    return {
      data: bytes,
      fileName: `${project.name.replace(/\s+/g, '_')}_merged.pdf`,
      mimeType: 'application/pdf',
    };
  }

  if (exportConfig.mode === 'separate_documents') {
    const zip = new JSZip();
    const totalDocs = Math.min(250, totalPages * copiesPerPage);
    for (let i = 0; i < totalDocs; i++) {
      await checkControl();
      const pIdx = Math.floor(i / copiesPerPage);
      const sIdx = i % copiesPerPage;
      onProgress?.('Generating separate document PDFs', i + 1, totalDocs);
      const overrides = buildDynamicOverridesForSlot(
        project,
        pIdx,
        sIdx,
        copiesPerPage
      );
      const singleBytes = await buildSingleModifiedTemplatePage(
        project,
        1,
        overrides,
        customFonts
      );
      zip.file(`document_${String(i + 1).padStart(4, '0')}.pdf`, singleBytes);
      if (i % 10 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    const zipBlob = await zip.generateAsync({ type: 'uint8array' });
    return {
      data: zipBlob,
      fileName: `${project.name.replace(/\s+/g, '_')}_separate_docs.zip`,
      mimeType: 'application/zip',
    };
  }

  const outDoc = await PDFDocument.create();
  const fonts = await embedFontsForDoc(
    outDoc,
    customFonts,
    exportConfig.embedFonts
  );
  const imageCache = new Map<string, PDFImage>();
  const embeddedPageCache = new Map<string, PDFEmbeddedPage>();
  const sanitizedBitmapCache = new Map<string, PDFImage>();

  let srcDoc: PDFDocument | null = null;
  if (project.sourcePdfBase64) {
    try {
      srcDoc = await PDFDocument.load(base64ToUint8Array(project.sourcePdfBase64), {
        ignoreEncryption: true,
      });
    } catch {
      srcDoc = null;
    }
  }

  const effectiveProject =
    exportConfig.customWidthPt || exportConfig.customHeightPt
      ? {
          ...project,
          pageConfig: {
            ...pageConfig,
            widthPt: baseOutW,
            heightPt: baseOutH,
          },
        }
      : project;

  const layoutCache = new Map<number, SheetLayoutPlan>();
  const getLayoutForPage = (templatePageNum: number) => {
    let plan = layoutCache.get(templatePageNum);
    if (!plan) {
      plan = computeSheetLayout(effectiveProject, templatePageNum);
      layoutCache.set(templatePageNum, plan);
    }
    return plan;
  };

  const selectedPagesSet = parsePageRange(exportConfig.selectedPagesRange, totalPages);

  for (let pageZero = 0; pageZero < totalPages; pageZero++) {
    await checkControl();
    const humanPageNum =
      (isBulkOrImposition ? bulkConfig.startPageNumber : 1) + pageZero;
    if (
      exportConfig.mode === 'selected_pages' &&
      !selectedPagesSet.has(humanPageNum)
    ) {
      continue;
    }

    if (pageZero % 10 === 0 || pageZero === totalPages - 1) {
      onProgress?.('Building PDF pages', pageZero + 1, totalPages);
    }

    const templatePageNum =
      copiesConfig.enabled || isBulkOrImposition
        ? 1
        : Math.min(pageZero + 1, project.pageCount || 1);
    const layout = getLayoutForPage(templatePageNum);
    const pageW = exportConfig.customWidthPt || layout.outputSheetWidthPt;
    const pageH = exportConfig.customHeightPt || layout.outputSheetHeightPt;
    const sheetW = pageW + bleed * 2;
    const sheetH = pageH + bleed * 2;

    const outPage = outDoc.addPage([sheetW, sheetH]);
    outPage.setMediaBox(0, 0, sheetW, sheetH);
    if (bleed > 0) {
      outPage.setBleedBox(0, 0, sheetW, sheetH);
      outPage.setTrimBox(bleed, bleed, pageW, pageH);
    }
    if (pageConfig.backgroundColor && pageConfig.backgroundColor !== '#FFFFFF') {
      outPage.drawRectangle({
        x: 0,
        y: 0,
        width: sheetW,
        height: sheetH,
        color: hexToRgb(pageConfig.backgroundColor),
      });
    }

    for (const slot of layout.slots) {
      const overrides =
        copiesConfig.enabled || isBulkOrImposition
          ? buildDynamicOverridesForSlot(
              effectiveProject,
              pageZero,
              slot.slotIndex,
              copiesPerPage
            )
          : undefined;

      await renderSlotOntoPage(
        outDoc,
        outPage,
        srcDoc,
        embeddedPageCache,
        sanitizedBitmapCache,
        effectiveProject,
        layout,
        slot,
        templatePageNum,
        bleed,
        sheetH,
        fonts,
        imageCache,
        overrides
      );
    }

    const pageMeta = project.originalPages.find((p) => p.pageNumber === templatePageNum);
    const headerTxt = pageMeta?.headerText ?? pageConfig.headerText;
    const footerTxt = pageMeta?.footerText ?? pageConfig.footerText;

    if (headerTxt?.trim()) {
      const hLabel = headerTxt
        .replace(/\{page\}/g, String(humanPageNum))
        .replace(/\{total\}/g, String(totalPages));
      const hw = fonts.helvetica.widthOfTextAtSize(hLabel, 9);
      outPage.drawText(hLabel, {
        x: (sheetW - hw) / 2,
        y: sheetH - bleed - 16,
        size: 9,
        font: fonts.helvetica,
        color: rgb(0.35, 0.4, 0.48),
      });
    }

    if (footerTxt?.trim()) {
      const fLabel = footerTxt
        .replace(/\{page\}/g, String(humanPageNum))
        .replace(/\{total\}/g, String(totalPages));
      const fw = fonts.helvetica.widthOfTextAtSize(fLabel, 9);
      outPage.drawText(fLabel, {
        x: (sheetW - fw) / 2,
        y: bleed + 20,
        size: 9,
        font: fonts.helvetica,
        color: rgb(0.35, 0.4, 0.48),
      });
    }

    if (exportConfig.addPageNumbers) {
      const label = (exportConfig.pageNumberFormat || 'Page {page} of {total}')
        .replace(/\{page\}/g, String(humanPageNum))
        .replace(/\{total\}/g, String(totalPages));
      const w = fonts.helvetica.widthOfTextAtSize(label, 9);
      outPage.drawText(label, {
        x: (sheetW - w) / 2,
        y: bleed + 10,
        size: 9,
        font: fonts.helvetica,
        color: rgb(0.35, 0.4, 0.48),
      });
    }

    if (exportConfig.watermarkText.trim()) {
      const wmText = exportConfig.watermarkText.trim();
      const wmSize = Math.min(64, sheetW * 0.08);
      const wmW = fonts.helveticaBold.widthOfTextAtSize(wmText, wmSize);
      outPage.drawText(wmText, {
        x: (sheetW - wmW * 0.7) / 2,
        y: sheetH * 0.42,
        size: wmSize,
        font: fonts.helveticaBold,
        color: rgb(0.45, 0.48, 0.54),
        opacity: Math.max(0.04, Math.min(0.8, exportConfig.watermarkOpacity)),
        rotate: degrees(35),
      });
    }

    if (exportConfig.cropMarks || pageConfig.cropMarks) {
      drawCropMarksAndGuides(
        outPage,
        bleed,
        bleed,
        pageW,
        pageH,
        { cropMarks: true, cuttingGuides: false, showBorders: false }
      );
    }

    const effectiveRot = pageMeta?.rotation ?? pageConfig.rotation;
    if (effectiveRot) {
      outPage.setRotation(degrees(effectiveRot));
    }

    if (pageZero % 8 === 0) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  if (exportConfig.mode === 'individual_pages') {
    const zip = new JSZip();
    const count = outDoc.getPageCount();
    for (let i = 0; i < count; i++) {
      await checkControl();
      onProgress?.('Splitting individual pages', i + 1, count);
      const single = await PDFDocument.create();
      const [copied] = await single.copyPages(outDoc, [i]);
      single.addPage(copied);
      const bytes = await single.save();
      zip.file(`page_${String(i + 1).padStart(4, '0')}.pdf`, bytes);
      if (i % 8 === 0) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    const zipBytes = await zip.generateAsync({ type: 'uint8array' });
    return {
      data: zipBytes,
      fileName: `${project.name.replace(/\s+/g, '_')}_pages.zip`,
      mimeType: 'application/zip',
    };
  }

  if (exportConfig.mode === 'flattened' || exportConfig.mode === 'compress') {
    const rawPdfBytes = await outDoc.save();
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < rawPdfBytes.length; i += chunk) {
      binary += String.fromCharCode(...rawPdfBytes.subarray(i, i + chunk));
    }
    const base64 = btoa(binary);
    const flatDoc = await PDFDocument.create();
    const count = outDoc.getPageCount();
    const dpiScale =
      exportConfig.mode === 'compress'
        ? 1.2
        : Math.min(3, exportConfig.dpi / 72);

    for (let i = 1; i <= count; i++) {
      await checkControl();
      onProgress?.(
        exportConfig.mode === 'flattened'
          ? 'Flattening PDF pages'
          : 'Compressing PDF pages',
        i,
        count
      );
      const dataUrl = await renderSinglePagePreview(base64, i, dpiScale);
      if (dataUrl) {
        const imgBytes = base64ToUint8Array(
          dataUrl.replace(/^data:image\/\w+;base64,/, '')
        );
        const embeddedImg = await flatDoc.embedPng(imgBytes);
        const p = flatDoc.addPage([outW, outH]);
        p.drawImage(embeddedImg, { x: 0, y: 0, width: outW, height: outH });
      }
      if (i % 5 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    const flatBytes = await flatDoc.save({ useObjectStreams: true });
    return {
      data: flatBytes,
      fileName: `${project.name.replace(/\s+/g, '_')}_${exportConfig.mode}.pdf`,
      mimeType: 'application/pdf',
    };
  }

  const finalBytes = await outDoc.save({
    useObjectStreams: exportConfig.mode !== 'editable',
  });

  return {
    data: finalBytes,
    fileName: `${project.name.replace(/\s+/g, '_')}_${exportConfig.mode}.pdf`,
    mimeType: 'application/pdf',
  };
}

function parsePageRange(rangeStr: string, maxPage: number): Set<number> {
  const result = new Set<number>();
  const parts = (rangeStr || '1')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const part of parts) {
    if (part.includes('-')) {
      const [aStr, bStr] = part.split('-');
      const a = Math.max(1, parseInt(aStr, 10) || 1);
      const b = Math.min(maxPage, parseInt(bStr, 10) || maxPage);
      for (let i = a; i <= b; i++) result.add(i);
    } else {
      const n = parseInt(part, 10);
      if (n >= 1 && n <= maxPage) result.add(n);
    }
  }
  if (result.size === 0) {
    for (let i = 1; i <= maxPage; i++) result.add(i);
  }
  return result;
}
