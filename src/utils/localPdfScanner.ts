import {
  DocumentElement,
  ElementType,
  ExtractedImageResource,
  OriginalPageMeta,
  ScanCorrectionRule,
  ScanQualityReport,
  SerialSequenceRule,
} from '../types/pdfStudio';
import { runPageStructureAnalysis } from '../workers/scanStructureWorker';
import {
  computeScanQualityReport,
  processRawPageScan,
} from './documentRelationshipEngine';
import {
  PdfDocumentInspection,
  inspectPdfStructure,
} from './pdfStructureInspector';
import {
  RenderedPdfPageData,
  renderPdfPagesForStudio,
} from './pdfRenderer';
import { RawPageScanInput } from './scanPrimitives';

export interface LocalScanOptions {
  enableOcr?: boolean;
  ocrLanguage?: string;
  renderScale?: number;
  maxPages?: number;
  correctionRules?: ScanCorrectionRule[];
  signal?: AbortSignal;
  isCancelled?: () => boolean;
  onProgress?: (stage: string, percent: number) => void;
}

export interface LocalScanResult {
  pageCount: number;
  pages: RenderedPdfPageData[];
  originalPages: OriginalPageMeta[];
  elements: DocumentElement[];
  serialRules: SerialSequenceRule[];
  imageResources: Record<string, ExtractedImageResource>;
  scanReport: ScanQualityReport;
  documentMetadata?: PdfDocumentInspection['metadata'];
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

function parseSerialTokenFromText(
  text: string,
  fallbackType: ElementType
): {
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

function buildInputFromRenderedPage(
  page: RenderedPdfPageData,
  inspectionPage: PdfDocumentInspection['pages'][number] | undefined,
  imageResources: Record<string, ExtractedImageResource>
): RawPageScanInput {
  return {
    pageNumber: page.pageNumber,
    widthPt: page.widthPt,
    heightPt: page.heightPt,
    rotation: inspectionPage?.rotation ?? 0,
    textRuns: page.rawTextRuns || [],
    vectorPaths: page.rawVectorPaths || [],
    imagePlacements: page.rawImagePlacements || [],
    imageResources,
    annotations: inspectionPage?.annotations || [],
    formWidgets: inspectionPage?.formWidgets || [],
    ocrRegionsCount: page.ocrRegionsCount || 0,
  };
}

function finalizeScanStatsAndReport(
  pageCount: number,
  pages: RenderedPdfPageData[],
  originalPages: OriginalPageMeta[],
  allElements: DocumentElement[],
  imageResources: Record<string, ExtractedImageResource>,
  documentMetadata?: PdfDocumentInspection['metadata']
): LocalScanResult {
  const usedOcrPages = pages.filter((p) => p.usedOcr).map((p) => p.pageNumber);
  const ocrRegionsCount = pages.reduce((sum, p) => sum + (p.ocrRegionsCount || 0), 0);
  const serialRules = buildAutoSerialRules(allElements);
  const scanReport = computeScanQualityReport(allElements, pageCount, ocrRegionsCount);

  const headingCount = allElements.filter((e) => e.type === 'heading').length;
  const serialFieldCount = allElements.filter(
    (e) => e.type === 'invoice_number' || e.type === 'receipt_number'
  ).length;
  const repeatedBlockCount = allElements.filter((e) => e.type === 'repeated_block').length;

  const summaryParts = [
    `Precision Scan 2.0: ${pageCount} page${pageCount === 1 ? '' : 's'}`,
    `${scanReport.totalElements} objects`,
  ];
  if (scanReport.rectangles > 0) summaryParts.push(`${scanReport.rectangles} rects`);
  if (scanReport.lines > 0) summaryParts.push(`${scanReport.lines} lines`);
  if (scanReport.tables > 0) summaryParts.push(`${scanReport.tables} tables`);
  if (scanReport.imageObjects > 0) summaryParts.push(`${scanReport.imageObjects} images`);
  if (usedOcrPages.length > 0) {
    summaryParts.push(`OCR on page${usedOcrPages.length === 1 ? '' : 's'} ${usedOcrPages.join(', ')}`);
  }

  return {
    pageCount,
    pages,
    originalPages,
    elements: allElements,
    serialRules,
    imageResources,
    scanReport,
    documentMetadata,
    summary: summaryParts.join(' · '),
    usedOcrPages,
    stats: {
      textCount: scanReport.textObjects,
      headingCount,
      serialFieldCount,
      tableCount: scanReport.tables,
      vectorAndImageCount: scanReport.vectorPaths + scanReport.imageObjects,
      repeatedBlockCount,
      reviewCount: scanReport.needsReviewObjects,
    },
  };
}

/**
 * Synchronous helper for already-rendered pages (used by ExportCenterView & tests).
 */
export function analyzeRenderedPagesLocally(rendered: {
  pageCount: number;
  pages: RenderedPdfPageData[];
  originalPages: OriginalPageMeta[];
  imageResources?: Record<string, ExtractedImageResource>;
  inspection?: PdfDocumentInspection;
  correctionRules?: ScanCorrectionRule[];
}): LocalScanResult {
  const imageResources = rendered.imageResources || {};
  const allElements: DocumentElement[] = [];
  const updatedOriginalPages = rendered.originalPages.map((p) => ({ ...p }));

  for (const page of rendered.pages) {
    const inspPage = rendered.inspection?.pages.find(
      (ip) => ip.pageNumber === page.pageNumber
    );
    const rawInput = buildInputFromRenderedPage(page, inspPage, imageResources);
    const processed = processRawPageScan(rawInput, rendered.correctionRules || []);
    allElements.push(...processed.elements);

    const origIdx = updatedOriginalPages.findIndex(
      (p) => p.pageNumber === page.pageNumber
    );
    if (origIdx >= 0) {
      updatedOriginalPages[origIdx] = {
        ...updatedOriginalPages[origIdx],
        rotation: inspPage?.rotation,
        boxes: inspPage?.boxes,
        embeddedFonts: inspPage?.embeddedFonts,
        hasTransparency: inspPage?.hasTransparency,
        streamCount: inspPage?.streamCount,
        annotationsCount: inspPage?.annotations.filter((a) => !a.isWidget).length ?? 0,
        formFieldsCount: inspPage?.formWidgets.length ?? 0,
        ocrRegionsCount: page.ocrRegionsCount || 0,
        hierarchy: processed.hierarchy,
        contentBBox: processed.contentBBox,
        detectedBounds: updatedOriginalPages[origIdx].detectedBounds
          ? {
              ...updatedOriginalPages[origIdx].detectedBounds!,
              contentBBox: processed.contentBBox,
              blockBoxes: processed.blockBoxes,
            }
          : undefined,
      };
    }
  }

  return finalizeScanStatsAndReport(
    rendered.pageCount,
    rendered.pages,
    updatedOriginalPages,
    allElements,
    imageResources,
    rendered.inspection?.metadata
  );
}

/**
 * Precision Scan Engine 2.0 Full Multi-Pass Pipeline:
 * Pass 1: PDF Document Inspection (boxes, rotation, embedded fonts, transparency, annotations, AcroForms)
 * Pass 2: Text Run Extraction (glyph/baseline positions, fonts, rotation, color)
 * Pass 3: Vector Path Extraction (lines, rects, rounded rects, circles, ellipses, polygons, Bezier curves)
 * Pass 4: Embedded Image XObject & Mask Extraction (actual pixel buffers -> PNG data URLs)
 * Pass 5: Region-Aware Local Tesseract OCR (only on image regions lacking native text)
 * Pass 6: Worker-accelerated Geometric Classification, Table Reconstruction & Hierarchy Tree
 */
export async function scanPdfLocally(
  pdfBytes: Uint8Array,
  options: LocalScanOptions = {}
): Promise<LocalScanResult> {
  const {
    enableOcr = true,
    ocrLanguage = 'eng',
    renderScale = 1.75,
    maxPages = 25,
    correctionRules = [],
    signal,
    isCancelled,
    onProgress,
  } = options;

  const checkCancel = () => {
    if (signal?.aborted || isCancelled?.()) {
      throw new Error('PDF scan cancelled by user');
    }
  };

  checkCancel();
  onProgress?.('Pass 1: Inspecting PDF boxes, fonts, forms & structure', 6);

  let inspection: PdfDocumentInspection | undefined;
  try {
    inspection = await inspectPdfStructure(pdfBytes);
  } catch {
    inspection = undefined;
  }

  checkCancel();
  onProgress?.('Passes 2–5: Extracting text runs, vector ops, images & OCR', 16);

  const rendered = await renderPdfPagesForStudio(pdfBytes, {
    renderScale,
    enableOcrFallback: enableOcr,
    ocrLanguage,
    maxPagesForAi: maxPages,
    isCancelled: () => Boolean(signal?.aborted || isCancelled?.()),
    onProgress: (stage, cur, total) => {
      const pct = 18 + Math.round((cur / Math.max(1, total)) * 56);
      onProgress?.(`${stage} (${cur}/${total})`, pct);
    },
  });

  checkCancel();
  onProgress?.('Pass 6: Reconstructing rectangles, tables & hierarchy', 78);

  const allElements: DocumentElement[] = [];
  const updatedOriginalPages = rendered.originalPages.map((p) => ({ ...p }));

  for (let idx = 0; idx < rendered.pages.length; idx++) {
    checkCancel();
    const page = rendered.pages[idx];
    const inspPage = inspection?.pages.find((ip) => ip.pageNumber === page.pageNumber);
    const rawInput = buildInputFromRenderedPage(
      page,
      inspPage,
      rendered.imageResources
    );

    const processed = await runPageStructureAnalysis(
      rawInput,
      correctionRules,
      signal
    );
    allElements.push(...processed.elements);

    const origIdx = updatedOriginalPages.findIndex(
      (p) => p.pageNumber === page.pageNumber
    );
    if (origIdx >= 0) {
      updatedOriginalPages[origIdx] = {
        ...updatedOriginalPages[origIdx],
        rotation: inspPage?.rotation,
        boxes: inspPage?.boxes,
        embeddedFonts: inspPage?.embeddedFonts,
        hasTransparency: inspPage?.hasTransparency,
        streamCount: inspPage?.streamCount,
        annotationsCount: inspPage?.annotations.filter((a) => !a.isWidget).length ?? 0,
        formFieldsCount: inspPage?.formWidgets.length ?? 0,
        ocrRegionsCount: page.ocrRegionsCount || 0,
        hierarchy: processed.hierarchy,
        contentBBox: processed.contentBBox,
        detectedBounds: updatedOriginalPages[origIdx].detectedBounds
          ? {
              ...updatedOriginalPages[origIdx].detectedBounds!,
              contentBBox: processed.contentBBox,
              blockBoxes: processed.blockBoxes,
            }
          : undefined,
      };
    }

    const pct = 78 + Math.round(((idx + 1) / Math.max(1, rendered.pages.length)) * 20);
    onProgress?.(`Structured page ${page.pageNumber}/${rendered.pages.length}`, pct);
  }

  onProgress?.('Precision Scan Engine 2.0 complete', 100);

  return finalizeScanStatsAndReport(
    rendered.pageCount,
    rendered.pages,
    updatedOriginalPages,
    allElements,
    rendered.imageResources,
    inspection?.metadata
  );
}
