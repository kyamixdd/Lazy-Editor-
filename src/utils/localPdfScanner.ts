import {
  DocumentElement,
  ElementType,
  OriginalPageMeta,
  RectPt,
  SerialSequenceRule,
} from '../types/pdfStudio';
import {
  ExtractedTextItem,
  ExtractedVectorPrimitive,
  RenderedPdfPageData,
  renderPdfPagesForStudio,
} from './pdfRenderer';

export interface LocalScanOptions {
  enableOcr?: boolean;
  ocrLanguage?: string;
  renderScale?: number;
  maxPages?: number;
  isCancelled?: () => boolean;
  onProgress?: (stage: string, percent: number) => void;
}

export interface LocalScanResult {
  pageCount: number;
  pages: RenderedPdfPageData[];
  originalPages: OriginalPageMeta[];
  elements: DocumentElement[];
  serialRules: SerialSequenceRule[];
  summary: string;
  usedOcrPages: number[];
  stats: {
    textCount: number;
    headingCount: number;
    serialFieldCount: number;
    tableCount: number;
    vectorAndImageCount: number;
    repeatedBlockCount: number;
    reviewCount: number;
  };
}

function rectIou(a: RectPt, b: RectPt): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const interW = Math.max(0, x2 - x1);
  const interH = Math.max(0, y2 - y1);
  const interArea = interW * interH;
  if (interArea <= 0) return 0;
  const unionArea = a.width * a.height + b.width * b.height - interArea;
  return unionArea > 0 ? interArea / unionArea : 0;
}

function pointInsideRect(px: number, py: number, rect: RectPt, pad = 4): boolean {
  return (
    px >= rect.x - pad &&
    px <= rect.x + rect.width + pad &&
    py >= rect.y - pad &&
    py <= rect.y + rect.height + pad
  );
}

function mergeAdjacentTextSpans(items: ExtractedTextItem[]): ExtractedTextItem[] {
  if (items.length <= 1) return [...items];

  const sorted = [...items].sort((a, b) => {
    const rowDiff = a.y - b.y;
    if (Math.abs(rowDiff) > Math.max(a.fontSize, b.fontSize) * 0.45) {
      return rowDiff;
    }
    return a.x - b.x;
  });

  const merged: ExtractedTextItem[] = [];
  for (const item of sorted) {
    const prev = merged[merged.length - 1];
    if (!prev) {
      merged.push({ ...item });
      continue;
    }

    const sameRow =
      Math.abs(prev.y - item.y) <= Math.max(prev.fontSize, item.fontSize) * 0.45;
    const gap = item.x - (prev.x + prev.width);
    const maxInlineGap = Math.max(prev.fontSize, item.fontSize) * 1.15;
    const sameFontSize = Math.abs(prev.fontSize - item.fontSize) <= 1.25;
    const sameWeight = (prev.fontWeight || 'normal') === (item.fontWeight || 'normal');
    const sameOcrFlag = Boolean(prev.fromOcr) === Boolean(item.fromOcr);

    if (
      sameRow &&
      gap >= -prev.fontSize * 0.4 &&
      gap <= maxInlineGap &&
      sameFontSize &&
      sameWeight &&
      sameOcrFlag
    ) {
      const needsSpace = gap > prev.fontSize * 0.14 && !prev.text.endsWith(' ') && !item.text.startsWith(' ');
      const joinedText = `${prev.text}${needsSpace ? ' ' : ''}${item.text}`;
      const newRight = Math.max(prev.x + prev.width, item.x + item.width);
      const newBottom = Math.max(prev.y + prev.height, item.y + item.height);
      prev.text = joinedText;
      prev.y = Math.min(prev.y, item.y);
      prev.width = Number((newRight - prev.x).toFixed(2));
      prev.height = Number((newBottom - prev.y).toFixed(2));
      if (typeof prev.confidence === 'number' && typeof item.confidence === 'number') {
        prev.confidence = Number(Math.min(prev.confidence, item.confidence).toFixed(2));
      }
    } else {
      merged.push({ ...item });
    }
  }

  return merged;
}

function classifyTextElement(
  item: ExtractedTextItem,
  medianFontSize: number,
  pageWidthPt: number
): {
  type: ElementType;
  fieldKey?: string;
  align: 'left' | 'center' | 'right';
  relationshipNote?: string;
} {
  const txt = item.text.trim();

  // Form field blanks / checkboxes
  if (/_{3,}|\[\s*\]|[☐☑]/.test(txt)) {
    let fieldKey: string | undefined;
    if (/customer|client|name/i.test(txt)) fieldKey = 'customer_name';
    else if (/date/i.test(txt)) fieldKey = 'date';
    else if (/receipt/i.test(txt)) fieldKey = 'receipt_number';
    else if (/invoice/i.test(txt)) fieldKey = 'invoice_number';
    else if (/amount|total/i.test(txt)) fieldKey = 'total_amount';
    return {
      type: 'form_field',
      fieldKey,
      align: 'left',
      relationshipNote: fieldKey ? `Form input field (${fieldKey})` : 'Form input field',
    };
  }

  // Receipt numbers (must contain digits so standalone headings aren't misclassified)
  if (
    /\b(r(?:e)?c(?:ei)?pt\s*(?:no\.?|num(?:ber)?|#)?\s*[:#-]?\s*[a-z]*\d+[a-z0-9-]*|\bRCP[-_]\d+\b)/i.test(
      txt
    )
  ) {
    return {
      type: 'receipt_number',
      fieldKey: 'receipt_number',
      align: item.x > pageWidthPt * 0.55 ? 'right' : 'left',
      relationshipNote: 'Dynamic receipt identifier',
    };
  }

  // Invoice numbers
  if (
    /\b(inv(?:oice)?\s*(?:no\.?|num(?:ber)?|#)?\s*[:#-]?\s*[a-z]*\d+[a-z0-9-]*|\bINV[-_]\d+\b)/i.test(
      txt
    )
  ) {
    return {
      type: 'invoice_number',
      fieldKey: 'invoice_number',
      align: item.x > pageWidthPt * 0.55 ? 'right' : 'left',
      relationshipNote: 'Dynamic invoice identifier',
    };
  }

  // Headings & document titles
  const isLargerHeading = item.fontSize >= Math.max(13.5, medianFontSize * 1.24);
  const isBoldSubheading =
    item.fontWeight === 'bold' &&
    item.fontSize >= medianFontSize * 1.12 &&
    txt.length <= 64 &&
    !/[:$]\s*[\d,.]+$/.test(txt);

  let type: ElementType = isLargerHeading || isBoldSubheading ? 'heading' : 'text';

  // Alignment inference relative to page geometry
  const centerDiff = Math.abs(item.x + item.width / 2 - pageWidthPt / 2);
  let align: 'left' | 'center' | 'right' = 'left';
  if (centerDiff <= 14 && item.x > pageWidthPt * 0.15) {
    align = 'center';
  } else if (item.x > pageWidthPt * 0.62 && item.x + item.width > pageWidthPt * 0.72) {
    align = 'right';
  }

  // Semantic field key suggestion
  let fieldKey: string | undefined;
  let relationshipNote: string | undefined;

  if (/bill\s*to|customer|client|recipient|sold\s*to/i.test(txt)) {
    fieldKey = 'customer_name';
    relationshipNote = 'Customer / recipient field';
  } else if (/^(?:issue\s*)?date\s*:|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/i.test(txt)) {
    fieldKey = 'date';
    relationshipNote = 'Document date field';
  } else if (/total\s*paid|amount\s*due|grand\s*total|total\s*amount|^total\s*[:$]/i.test(txt)) {
    fieldKey = 'total_amount';
    relationshipNote = 'Document total amount';
  } else if (type === 'heading') {
    relationshipNote = 'Section heading / title';
  }

  return { type, fieldKey, align, relationshipNote };
}

function deduplicatePrimitives(
  primitives: ExtractedVectorPrimitive[]
): ExtractedVectorPrimitive[] {
  const unique: ExtractedVectorPrimitive[] = [];
  for (const p of primitives) {
    const dup = unique.some(
      (u) =>
        u.kind === p.kind &&
        Math.abs(u.x - p.x) <= 2 &&
        Math.abs(u.y - p.y) <= 2 &&
        Math.abs(u.width - p.width) <= 2 &&
        Math.abs(u.height - p.height) <= 2
    );
    if (!dup) {
      unique.push(p);
    }
  }
  return unique;
}

function detectRepeatedBlocksOnPage(
  pageW: number,
  pageH: number,
  textItems: ExtractedTextItem[],
  primitives: ExtractedVectorPrimitive[],
  fallbackBoxes: Array<{ blockId: string; rect: RectPt }>
): Array<{ blockId: string; rect: RectPt }> {
  // Priority 1: Distinct non-overlapping bordered rectangles containing >= 2 text items
  const containerRects = primitives
    .filter(
      (p) =>
        p.kind === 'rect' &&
        p.hasStroke &&
        p.width >= pageW * 0.32 &&
        p.height >= pageH * 0.16 &&
        p.height <= pageH * 0.82
    )
    .map((p) => ({ x: p.x, y: p.y, width: p.width, height: p.height }))
    .filter((rect) => {
      const insideCount = textItems.filter((t) =>
        pointInsideRect(t.x + t.width / 2, t.y + t.height / 2, rect, 4)
      ).length;
      return insideCount >= 2;
    });

  // Remove overlapping nested containers (keep outer distinct ones)
  const nonOverlapping: RectPt[] = [];
  const byAreaDesc = [...containerRects].sort(
    (a, b) => b.width * b.height - a.width * a.height
  );
  for (const cand of byAreaDesc) {
    if (!nonOverlapping.some((existing) => rectIou(existing, cand) > 0.25)) {
      nonOverlapping.push(cand);
    }
  }

  if (nonOverlapping.length >= 2) {
    const sorted = nonOverlapping.sort((a, b) =>
      Math.abs(a.y - b.y) > 20 ? a.y - b.y : a.x - b.x
    );
    return sorted.map((rect, idx) => ({
      blockId: `block-${String.fromCharCode(65 + (idx % 26))}`,
      rect,
    }));
  }

  // Priority 2: Spatially clustered text blocks that each contain >= 2 items
  const multiItemClusters = fallbackBoxes.filter((b) => {
    const count = textItems.filter((t) =>
      pointInsideRect(t.x + t.width / 2, t.y + t.height / 2, b.rect, 4)
    ).length;
    return count >= 2;
  });

  if (multiItemClusters.length >= 2) {
    // Check if clusters look like repeated blocks (similar widths or both contain titles/numbers)
    const expanded = multiItemClusters.map((b, idx) => ({
      blockId: `block-${String.fromCharCode(65 + (idx % 26))}`,
      rect: {
        x: Math.max(0, Number((b.rect.x - 8).toFixed(2))),
        y: Math.max(0, Number((b.rect.y - 8).toFixed(2))),
        width: Math.min(pageW, Number((b.rect.width + 16).toFixed(2))),
        height: Math.min(pageH, Number((b.rect.height + 16).toFixed(2))),
      },
    }));
    return expanded;
  }

  return [];
}

function detectTableRegionsOnPage(
  pageNumber: number,
  textElements: DocumentElement[]
): {
  tableContainers: DocumentElement[];
  cellTagMap: Map<string, string>;
} {
  const candidates = textElements.filter(
    (e) =>
      (e.type === 'text' || e.type === 'form_field') &&
      e.height < 40 &&
      e.text.trim().length > 0
  );

  // Group into visual rows
  const sorted = [...candidates].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: DocumentElement[][] = [];
  for (const el of sorted) {
    const lastRow = rows[rows.length - 1];
    if (lastRow && Math.abs(lastRow[0].y - el.y) <= 7) {
      lastRow.push(el);
    } else {
      rows.push([el]);
    }
  }

  const multiColRows = rows.filter((r) => r.length >= 2);
  const tableContainers: DocumentElement[] = [];
  const cellTagMap = new Map<string, string>();

  // Group vertically consecutive multi-column rows whose vertical spacing is compact (< 42pt)
  const bands: DocumentElement[][][] = [];
  for (const r of multiColRows) {
    r.sort((a, b) => a.x - b.x);
    const prevBand = bands[bands.length - 1];
    if (prevBand) {
      const prevRow = prevBand[prevBand.length - 1];
      const yGap = r[0].y - (prevRow[0].y + prevRow[0].height);
      const prevCols = prevRow.map((c) => c.x);
      const alignedCols = r.filter((c) =>
        prevCols.some((px) => Math.abs(px - c.x) <= 28)
      ).length;
      if (yGap >= -4 && yGap <= 42 && alignedCols >= 2) {
        prevBand.push(r);
        continue;
      }
    }
    bands.push([r]);
  }

  let tableIdx = 0;
  for (const band of bands) {
    if (band.length < 2) continue;
    // Ensure at least one row has 3+ columns or currency/quantity figures so simple key-value header lines aren't over-tagged
    const has3Cols = band.some((r) => r.length >= 3);
    const hasNumericCell = band.some((r) =>
      r.some((c) => /\$|\d+\.\d{2}|\bqty\b|\bamount\b|\btotal\b/i.test(c.text))
    );
    if (!has3Cols && !hasNumericCell) continue;

    tableIdx++;
    const allCells = band.flat();
    const minX = Math.max(0, Math.min(...allCells.map((c) => c.x)) - 6);
    const minY = Math.max(0, Math.min(...allCells.map((c) => c.y)) - 6);
    const maxX = Math.max(...allCells.map((c) => c.x + c.width)) + 6;
    const maxY = Math.max(...allCells.map((c) => c.y + c.height)) + 6;
    const maxCols = Math.max(...band.map((r) => r.length));

    band.forEach((row, rIdx) => {
      row.forEach((cell, cIdx) => {
        cellTagMap.set(cell.id, `Table ${tableIdx} (R${rIdx + 1}, C${cIdx + 1})`);
      });
    });

    tableContainers.push({
      id: `local-tbl-p${pageNumber}-${tableIdx}`,
      type: 'table',
      pageNumber,
      x: Number(minX.toFixed(2)),
      y: Number(minY.toFixed(2)),
      width: Number(Math.max(40, maxX - minX).toFixed(2)),
      height: Number(Math.max(24, maxY - minY).toFixed(2)),
      rotation: 0,
      text: `Table (${band.length}×${maxCols})`,
      fontFamily: 'Helvetica',
      fontSize: 10,
      fontWeight: 'normal',
      fontStyle: 'normal',
      color: '#111827',
      backgroundColor: 'transparent',
      align: 'left',
      opacity: 1,
      editable: true,
      locked: false,
      visible: true,
      confidence: 0.9,
      needsReview: false,
      relationshipNote: `Detected ${band.length} rows × ${maxCols} columns`,
      isUserAdded: false,
      eraseOriginal: false,
      sourceOrigin: 'original_pdf',
      sourceOriginalRect: {
        x: Number(minX.toFixed(2)),
        y: Number(minY.toFixed(2)),
        width: Number(Math.max(40, maxX - minX).toFixed(2)),
        height: Number(Math.max(24, maxY - minY).toFixed(2)),
      },
    });
  }

  return { tableContainers, cellTagMap };
}

function parseSerialTokenFromText(text: string, fallbackType: ElementType): {
  prefix: string;
  startNumber: number;
  digits: number;
} {
  const match = text.match(/([A-Za-z]+[-_#]?)(\d{2,8})/);
  if (match) {
    const rawPrefix = match[1].endsWith('#') ? `${match[1].slice(0, -1)}-` : match[1];
    const numStr = match[2];
    const parsed = parseInt(numStr, 10);
    return {
      prefix: rawPrefix.toUpperCase(),
      startNumber: Number.isFinite(parsed) && parsed > 0 ? parsed : 1,
      digits: Math.max(3, numStr.length),
    };
  }
  return {
    prefix: fallbackType === 'receipt_number' ? 'RCP-' : 'INV-',
    startNumber: 1,
    digits: 4,
  };
}

function buildAutoSerialRules(elements: DocumentElement[]): SerialSequenceRule[] {
  const serialCandidates = elements.filter(
    (e) =>
      e.type === 'invoice_number' ||
      e.type === 'receipt_number' ||
      (e.fieldKey &&
        (e.fieldKey.includes('invoice') || e.fieldKey.includes('receipt')))
  );
  if (serialCandidates.length === 0) return [];

  // Group by blockId if multiple repeated blocks each contain a serial field
  const distinctBlockIds = Array.from(
    new Set(
      serialCandidates
        .map((c) => c.blockId)
        .filter((b): b is string => Boolean(b))
    )
  ).sort();

  if (distinctBlockIds.length >= 2) {
    const rangeSize = 250;
    return distinctBlockIds.map((blockId, idx) => {
      const rep = serialCandidates.find((c) => c.blockId === blockId) || serialCandidates[0];
      const fKey = rep.fieldKey || 'serial_number';
      if (!rep.fieldKey) rep.fieldKey = fKey;
      const parsed = parseSerialTokenFromText(rep.text, rep.type);
      const start = idx * rangeSize + 1;
      const end = (idx + 1) * rangeSize;
      return {
        id: `seq-local-${idx + 1}`,
        name: `Block ${blockId.replace('block-', '')} Sequence`,
        targetFieldKey: fKey,
        blockIndex: idx,
        mode: 'auto',
        startNumber: start,
        endNumber: end,
        increment: 1,
        prefix: parsed.prefix,
        suffix: '',
        digits: parsed.digits,
        leadingZeros: true,
        repeatCount: 1,
      };
    });
  }

  const first = serialCandidates[0];
  const fKey = first.fieldKey || 'serial_number';
  if (!first.fieldKey) first.fieldKey = fKey;
  const parsed = parseSerialTokenFromText(first.text, first.type);

  return [
    {
      id: `seq-local-1`,
      name: 'Primary Sequence',
      targetFieldKey: fKey,
      blockIndex: 0,
      mode: 'auto',
      startNumber: parsed.startNumber,
      endNumber: parsed.startNumber + 249,
      increment: 1,
      prefix: parsed.prefix,
      suffix: '',
      digits: parsed.digits,
      leadingZeros: true,
      repeatCount: 1,
    },
  ];
}

export function analyzeRenderedPagesLocally(rendered: {
  pageCount: number;
  pages: RenderedPdfPageData[];
  originalPages: OriginalPageMeta[];
}): LocalScanResult {
  const allElements: DocumentElement[] = [];
  const usedOcrPages: number[] = [];

  let textCount = 0;
  let headingCount = 0;
  let serialFieldCount = 0;
  let tableCount = 0;
  let vectorAndImageCount = 0;
  let repeatedBlockCount = 0;
  let reviewCount = 0;

  const updatedOriginalPages: OriginalPageMeta[] = rendered.originalPages.map((orig) => ({
    ...orig,
  }));

  for (const page of rendered.pages) {
    if (page.usedOcr) {
      usedOcrPages.push(page.pageNumber);
    }

    const mergedSpans = mergeAdjacentTextSpans(page.extractedTextItems);
    const fontSizes = mergedSpans
      .map((t) => t.fontSize)
      .filter((s) => Number.isFinite(s) && s > 0)
      .sort((a, b) => a - b);
    const medianFontSize =
      fontSizes.length > 0 ? fontSizes[Math.floor(fontSizes.length / 2)] : 11;

    const uniquePrimitives = deduplicatePrimitives(page.vectorPrimitives || []);
    const blockBoxes = detectRepeatedBlocksOnPage(
      page.widthPt,
      page.heightPt,
      mergedSpans,
      uniquePrimitives,
      page.detectedBounds.blockBoxes || []
    );

    // Sync detected blockBoxes back into originalPages metadata
    const origIdx = updatedOriginalPages.findIndex(
      (p) => p.pageNumber === page.pageNumber
    );
    if (origIdx >= 0 && blockBoxes.length > 0 && updatedOriginalPages[origIdx].detectedBounds) {
      updatedOriginalPages[origIdx] = {
        ...updatedOriginalPages[origIdx],
        detectedBounds: {
          ...updatedOriginalPages[origIdx].detectedBounds!,
          blockBoxes,
        },
      };
    }

    const assignBlockId = (cx: number, cy: number): string | undefined => {
      const hit = blockBoxes.find((b) => pointInsideRect(cx, cy, b.rect, 4));
      return hit?.blockId;
    };

    // 1. Emit Repeated Block frames (at bottom of layer stack so text sits cleanly above)
    blockBoxes.forEach((b) => {
      repeatedBlockCount++;
      allElements.push({
        id: `local-blk-p${page.pageNumber}-${b.blockId}`,
        type: 'repeated_block',
        pageNumber: page.pageNumber,
        x: b.rect.x,
        y: b.rect.y,
        width: b.rect.width,
        height: b.rect.height,
        rotation: 0,
        text: b.blockId,
        fontFamily: 'Helvetica',
        fontSize: 10,
        fontWeight: 'normal',
        fontStyle: 'normal',
        color: '#2563EB',
        backgroundColor: 'transparent',
        borderColor: '#2563EB',
        borderWidth: 1,
        align: 'left',
        opacity: 1,
        editable: true,
        locked: false,
        visible: true,
        blockId: b.blockId,
        confidence: 0.94,
        needsReview: false,
        relationshipNote: `Repeated document block (${b.blockId})`,
        isUserAdded: false,
        eraseOriginal: false,
        sourceOrigin: 'original_pdf',
        sourceOriginalRect: { ...b.rect },
      });
    });

    // 2. Emit extracted vector graphics & embedded images
    uniquePrimitives.forEach((prim, pIdx) => {
      vectorAndImageCount++;
      const blockId = assignBlockId(prim.x + prim.width / 2, prim.y + prim.height / 2);
      const elType: ElementType =
        prim.kind === 'image'
          ? 'image'
          : prim.kind === 'line'
          ? 'line'
          : prim.hasFill && !prim.hasStroke
          ? 'shape'
          : 'border';

      allElements.push({
        id: `local-vec-p${page.pageNumber}-${pIdx + 1}`,
        type: elType,
        shapeKind: prim.kind === 'rect' ? 'rect' : prim.kind === 'line' ? 'line' : undefined,
        pageNumber: page.pageNumber,
        x: prim.x,
        y: prim.y,
        width: prim.width,
        height: prim.height,
        rotation: 0,
        text:
          elType === 'image'
            ? `Embedded Image ${pIdx + 1}`
            : elType === 'line'
            ? 'Rule Line'
            : '',
        fontFamily: 'Helvetica',
        fontSize: 10,
        fontWeight: 'normal',
        fontStyle: 'normal',
        color: prim.strokeColor || '#1E293B',
        backgroundColor: prim.fillColor || 'transparent',
        borderColor: prim.strokeColor || '#1E293B',
        borderWidth: prim.lineWidth || 1,
        align: 'left',
        opacity: 1,
        editable: true,
        locked: false,
        visible: true,
        blockId,
        confidence: 0.95,
        needsReview: false,
        relationshipNote:
          elType === 'image'
            ? 'Embedded PDF graphic/logo'
            : blockId
            ? `Container geometry (${blockId})`
            : 'Vector shape/border',
        isUserAdded: false,
        eraseOriginal: false,
        sourceOrigin: 'original_pdf',
        sourceOriginalRect: {
          x: prim.x,
          y: prim.y,
          width: prim.width,
          height: prim.height,
        },
      });
    });

    // 3. Emit text, heading, serial, and form elements
    const pageTextElements: DocumentElement[] = [];
    mergedSpans.forEach((item, idx) => {
      const cls = classifyTextElement(item, medianFontSize, page.widthPt);
      const blockId = assignBlockId(item.x + item.width / 2, item.y + item.height / 2);

      const isOcr = Boolean(item.fromOcr);
      const confidence =
        typeof item.confidence === 'number'
          ? item.confidence
          : isOcr
          ? 0.72
          : 0.98;
      const needsReview =
        isOcr ? confidence < 0.78 || item.text.trim().length <= 1 : false;

      if (cls.type === 'heading') headingCount++;
      else if (cls.type === 'invoice_number' || cls.type === 'receipt_number') {
        serialFieldCount++;
      } else {
        textCount++;
      }
      if (needsReview) reviewCount++;

      const noteParts: string[] = [];
      if (cls.relationshipNote) noteParts.push(cls.relationshipNote);
      if (blockId) noteParts.push(`Inside ${blockId}`);

      const el: DocumentElement = {
        id: `local-txt-p${page.pageNumber}-${idx + 1}`,
        type: cls.type,
        pageNumber: page.pageNumber,
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        rotation: item.rotation || 0,
        text: item.text,
        fontFamily: item.resolvedFontFamily || 'Helvetica',
        fontSize: item.fontSize,
        fontWeight: item.fontWeight || 'normal',
        fontStyle: item.fontStyle || 'normal',
        color: item.color || '#111827',
        backgroundColor: 'transparent',
        align: cls.align,
        opacity: 1,
        editable: true,
        locked: false,
        visible: true,
        blockId,
        fieldKey: cls.fieldKey,
        confidence,
        needsReview,
        reviewReason: needsReview
          ? `Extracted locally via Tesseract OCR (${Math.round(confidence * 100)}% confidence) — verify accuracy`
          : undefined,
        relationshipNote: noteParts.length > 0 ? noteParts.join(' · ') : undefined,
        isUserAdded: false,
        eraseOriginal: false,
        sourceOrigin: isOcr ? 'scanned_ocr' : 'original_pdf',
        sourceOriginalRect: {
          x: item.x,
          y: item.y,
          width: item.width,
          height: item.height,
        },
      };

      pageTextElements.push(el);
    });

    // 4. Detect tabular structures and tag cells without hiding original text
    const { tableContainers, cellTagMap } = detectTableRegionsOnPage(
      page.pageNumber,
      pageTextElements
    );
    tableCount += tableContainers.length;

    pageTextElements.forEach((el) => {
      const tblTag = cellTagMap.get(el.id);
      if (tblTag) {
        el.relationshipNote = el.relationshipNote
          ? `${el.relationshipNote} · ${tblTag}`
          : tblTag;
      }
    });

    allElements.push(...tableContainers, ...pageTextElements);
  }

  const serialRules = buildAutoSerialRules(allElements);

  const summaryParts = [
    `Local PDF Scan: ${rendered.pageCount} page${rendered.pageCount === 1 ? '' : 's'}`,
    `${allElements.length} elements extracted`,
  ];
  if (repeatedBlockCount > 0) {
    summaryParts.push(`${repeatedBlockCount} repeated blocks`);
  }
  if (tableCount > 0) {
    summaryParts.push(`${tableCount} table${tableCount === 1 ? '' : 's'}`);
  }
  if (usedOcrPages.length > 0) {
    summaryParts.push(`OCR applied on page${usedOcrPages.length === 1 ? '' : 's'} ${usedOcrPages.join(', ')}`);
  }
  summaryParts.push('0 AI credits used');

  return {
    pageCount: rendered.pageCount,
    pages: rendered.pages,
    originalPages: updatedOriginalPages,
    elements: allElements,
    serialRules,
    summary: summaryParts.join(' · '),
    usedOcrPages,
    stats: {
      textCount,
      headingCount,
      serialFieldCount,
      tableCount,
      vectorAndImageCount,
      repeatedBlockCount,
      reviewCount,
    },
  };
}

export async function scanPdfLocally(
  pdfBytes: Uint8Array,
  options: LocalScanOptions = {}
): Promise<LocalScanResult> {
  const {
    enableOcr = true,
    ocrLanguage = 'eng',
    renderScale = 1.7,
    maxPages = 25,
    isCancelled,
    onProgress,
  } = options;

  onProgress?.('Reading original PDF locally (PDF.js)', 10);

  const rendered = await renderPdfPagesForStudio(pdfBytes, {
    renderScale,
    enableOcrFallback: enableOcr,
    ocrLanguage,
    maxPagesForAi: maxPages,
    isCancelled,
    onProgress: (stage, cur, total) => {
      const pct = 15 + Math.round((cur / Math.max(1, total)) * 65);
      onProgress?.(`${stage} (${cur}/${total})`, pct);
    },
  });

  if (isCancelled?.()) {
    throw new Error('PDF scan cancelled by user');
  }

  onProgress?.('Detecting headings, tables, shapes & repeated blocks locally', 88);
  const result = analyzeRenderedPagesLocally(rendered);
  onProgress?.('Local PDF Scan complete', 100);
  return result;
}
