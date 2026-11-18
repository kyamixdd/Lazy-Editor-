import JSZip from 'jszip';
import {
  clip,
  degrees,
  endPath,
  PDFDocument,
  PDFEmbeddedPage,
  PDFFont,
  PDFImage,
  PDFPage,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
  StandardFonts,
} from 'pdf-lib';
import {
  DocumentElement,
  PDFProject,
} from '../types/pdfStudio';
import { formatCellValue } from './dataFormulaEngine';
import { computeSheetLayout, SheetLayoutPlan, SlotGeometry } from './geometryEngine';
import { base64ToUint8Array, renderSinglePagePreview } from './pdfRenderer';
import { computeSerialValueForSlot } from './serialEngine';

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
}

async function embedStandardFonts(doc: PDFDocument): Promise<FontBundle> {
  return {
    helvetica: await doc.embedFont(StandardFonts.Helvetica),
    helveticaBold: await doc.embedFont(StandardFonts.HelveticaBold),
    helveticaOblique: await doc.embedFont(StandardFonts.HelveticaOblique),
    helveticaBoldOblique: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
    times: await doc.embedFont(StandardFonts.TimesRoman),
    timesBold: await doc.embedFont(StandardFonts.TimesRomanBold),
    courier: await doc.embedFont(StandardFonts.Courier),
    courierBold: await doc.embedFont(StandardFonts.CourierBold),
  };
}

function pickFont(el: DocumentElement, fonts: FontBundle): PDFFont {
  const fam = (el.fontFamily || '').toLowerCase();
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

  // Mask original coordinates cleanly when original detected item was edited, moved, or deleted
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

  // Background fill for element
  if (el.backgroundColor && el.backgroundColor !== 'transparent') {
    const pos = toPagePt(x, pdfYBottom, el.rotation ? -el.rotation : 0);
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

  // Border / Shape / Line: only draw if added or modified by user (original PDF keeps its native vectors)
  if (el.type === 'shape' || el.type === 'border') {
    if (isModifiedOrAdded) {
      if (el.shapeKind === 'circle') {
        const pos = toPagePt(x + el.width / 2, pdfYBottom + el.height / 2);
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
      } else {
        const pos = toPagePt(x, pdfYBottom, el.rotation ? -el.rotation : 0);
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
      const midY = pdfYBottom + el.height / 2;
      const p1 = toPagePt(x, midY);
      const p2 = toPagePt(x + el.width, midY);
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

  // Image (cached per PDFDocument for high-speed 250+ page generation)
  if (el.type === 'image' && el.imageDataUrl) {
    try {
      let embedded = imageCache.get(el.imageDataUrl);
      if (!embedded) {
        const isPng = el.imageDataUrl.startsWith('data:image/png');
        const imgBytes = base64ToUint8Array(
          el.imageDataUrl.replace(/^data:image\/\w+;base64,/, '')
        );
        embedded = isPng
          ? await pdfDoc.embedPng(imgBytes)
          : await pdfDoc.embedJpg(imgBytes);
        imageCache.set(el.imageDataUrl, embedded);
      }
      const pos = toPagePt(x, pdfYBottom, el.rotation ? -el.rotation : 0);
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

  // Table
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
      const cellY = localHeight - el.y - (rIdx + 1) * rowH;
      for (let cIdx = 0; cIdx < colCount; cIdx++) {
        const cellX = x + cIdx * colW;
        const rectPos = toPagePt(cellX, cellY);
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
          const textPos = toPagePt(
            cellX + (cellPadding || 4),
            cellY + rowH / 2 - (el.fontSize || 9) * 0.35
          );
          page.drawText(cellText, {
            x: textPos.x,
            y: textPos.y,
            size: Math.min(el.fontSize || 9, rowH * 0.65),
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

  // Text rendering: draw if added, modified, or dynamically overridden by serial/dataset
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
  const size = Math.max(5, el.fontSize || 11);
  const lines = textToDraw.split('\n');
  const lineHeight = size * 1.2;

  lines.forEach((line, idx) => {
    const lineWidth = font.widthOfTextAtSize(line, size);
    let drawX = x;
    if (el.align === 'center') {
      drawX = x + (el.width - lineWidth) / 2;
    } else if (el.align === 'right') {
      drawX = x + el.width - lineWidth;
    }
    const drawY = localHeight - el.y - size * 0.85 - idx * lineHeight;
    const pos = toPagePt(drawX, drawY, el.rotation ? -el.rotation : 0);
    page.drawText(line, {
      x: pos.x,
      y: pos.y,
      size,
      font,
      color: hexToRgb(el.color || '#111827'),
      opacity: el.opacity ?? 1,
      rotate: pos.rotate,
    });
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
      if (matchingRules.length > 1 && rule.blockIndex !== slotZeroIdx) {
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
      overrides.set(rule.targetFieldKey, res.value);
    }
  }

  return overrides;
}

async function renderSlotOntoPage(
  outDoc: PDFDocument,
  outPage: PDFPage,
  srcDoc: PDFDocument | null,
  embeddedPageCache: Map<string, PDFEmbeddedPage>,
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

  if (srcDoc) {
    const pageMeta = project.originalPages.find(
      (p) => p.pageNumber === templatePageNum
    );
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
      sourceOriginalRect: el.sourceOriginalRect
        ? {
            x: (rot ? 0 : drawX) + (el.sourceOriginalRect.x - sourceBox.x) * scale,
            y: (rot ? 0 : drawTop) + (el.sourceOriginalRect.y - sourceBox.y) * scale,
            width: el.sourceOriginalRect.width * scale,
            height: el.sourceOriginalRect.height * scale,
          }
        : undefined,
    };
    const override =
      overrides && el.fieldKey && overrides.has(el.fieldKey)
        ? overrides.get(el.fieldKey)!
        : null;
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
  overrides?: Map<string, string>
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fonts = await embedStandardFonts(doc);
  const imageCache = new Map<string, PDFImage>();
  const embeddedPageCache = new Map<string, PDFEmbeddedPage>();
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

  if (project.pageConfig.rotation) {
    page.setRotation(degrees(project.pageConfig.rotation));
  }

  return doc.save();
}

export async function generateExportBytes(
  project: PDFProject,
  options: {
    onProgress?: (stage: string, current: number, total: number) => void;
    extraMergePdfBytes?: Uint8Array[];
  } = {}
): Promise<{
  data: Uint8Array;
  fileName: string;
  mimeType: string;
}> {
  const { onProgress, extraMergePdfBytes = [] } = options;
  const { exportConfig, pageConfig, copiesConfig, bulkConfig } = project;

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

  // Handle "Merge PDFs" mode
  if (exportConfig.mode === 'merge') {
    onProgress?.('Merging PDF documents', 1, extraMergePdfBytes.length + 1);
    const mergedDoc = await PDFDocument.create();
    for (let p = 1; p <= Math.max(1, project.pageCount); p++) {
      const baseBytes = await buildSingleModifiedTemplatePage(project, p);
      const baseLoaded = await PDFDocument.load(baseBytes);
      const basePages = await mergedDoc.copyPages(
        baseLoaded,
        baseLoaded.getPageIndices()
      );
      basePages.forEach((pg) => mergedDoc.addPage(pg));
    }

    for (let i = 0; i < extraMergePdfBytes.length; i++) {
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

  // Handle "Separate Document Exports" (ZIP of 1 PDF per copy/record)
  if (exportConfig.mode === 'separate_documents') {
    const zip = new JSZip();
    const totalDocs = Math.min(250, totalPages * copiesPerPage);
    for (let i = 0; i < totalDocs; i++) {
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
        overrides
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

  // Build master output PDF document
  const outDoc = await PDFDocument.create();
  const fonts = await embedStandardFonts(outDoc);
  const imageCache = new Map<string, PDFImage>();
  const embeddedPageCache = new Map<string, PDFEmbeddedPage>();

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

  // Precompute layout plans per template page so export matches live preview 1:1
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

    const outPage = outDoc.addPage([outW, outH]);
    outPage.setMediaBox(0, 0, outW, outH);
    if (bleed > 0) {
      outPage.setBleedBox(0, 0, outW, outH);
      outPage.setTrimBox(bleed, bleed, baseOutW, baseOutH);
    }
    if (pageConfig.backgroundColor && pageConfig.backgroundColor !== '#FFFFFF') {
      outPage.drawRectangle({
        x: 0,
        y: 0,
        width: outW,
        height: outH,
        color: hexToRgb(pageConfig.backgroundColor),
      });
    }

    const templatePageNum =
      copiesConfig.enabled || isBulkOrImposition
        ? 1
        : Math.min(pageZero + 1, project.pageCount || 1);
    const layout = getLayoutForPage(templatePageNum);

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
        effectiveProject,
        layout,
        slot,
        templatePageNum,
        bleed,
        outH,
        fonts,
        imageCache,
        overrides
      );
    }

    // Optional Page Numbering
    if (exportConfig.addPageNumbers) {
      const label = (exportConfig.pageNumberFormat || 'Page {page} of {total}')
        .replace(/\{page\}/g, String(humanPageNum))
        .replace(/\{total\}/g, String(totalPages));
      const w = fonts.helvetica.widthOfTextAtSize(label, 9);
      outPage.drawText(label, {
        x: (outW - w) / 2,
        y: bleed + 10,
        size: 9,
        font: fonts.helvetica,
        color: rgb(0.35, 0.4, 0.48),
      });
    }

    // Optional Watermark
    if (exportConfig.watermarkText.trim()) {
      const wmText = exportConfig.watermarkText.trim();
      const wmSize = Math.min(64, outW * 0.08);
      const wmW = fonts.helveticaBold.widthOfTextAtSize(wmText, wmSize);
      outPage.drawText(wmText, {
        x: (outW - wmW * 0.7) / 2,
        y: outH * 0.42,
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
        baseOutW,
        baseOutH,
        { cropMarks: true, cuttingGuides: false, showBorders: false }
      );
    }

    if (pageConfig.rotation) {
      outPage.setRotation(degrees(pageConfig.rotation));
    }

    if (pageZero % 20 === 0) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  // Individual page ZIP export
  if (exportConfig.mode === 'individual_pages') {
    const zip = new JSZip();
    const count = outDoc.getPageCount();
    for (let i = 0; i < count; i++) {
      onProgress?.('Splitting individual pages', i + 1, count);
      const single = await PDFDocument.create();
      const [copied] = await single.copyPages(outDoc, [i]);
      single.addPage(copied);
      const bytes = await single.save();
      zip.file(`page_${String(i + 1).padStart(4, '0')}.pdf`, bytes);
    }
    const zipBytes = await zip.generateAsync({ type: 'uint8array' });
    return {
      data: zipBytes,
      fileName: `${project.name.replace(/\s+/g, '_')}_pages.zip`,
      mimeType: 'application/zip',
    };
  }

  // Flattened PDF or Compressed PDF
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
