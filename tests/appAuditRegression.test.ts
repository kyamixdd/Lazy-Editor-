import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { PDFDocument, PDFName, StandardFonts, rgb } from 'pdf-lib';
import {
  DocumentElement,
  PDFProject,
  SerialSequenceRule,
} from '../src/types/pdfStudio';
import {
  defaultCategoryForTool,
  parseCommittedNumericDraft,
  resolveEditorEscapeStep,
  toggleEditorTool,
  toggleSyncedSnapAndGuides,
} from '../src/utils/editorInteractions';
import {
  computeSheetLayout,
  suggestOptimalGridForCopies,
} from '../src/utils/geometryEngine';
import {
  advanceSkippingReserved,
  analyzeSerialIntelligence,
  generateSerialPreview,
} from '../src/utils/serialEngine';
import {
  analyzeDataQuality,
  evaluateFormula,
  formatCellValue,
} from '../src/utils/dataFormulaEngine';
import {
  alignSelectedElements,
  computeSmartSnapAndGuides,
  distributeSelectedElements,
  getElementsInMarquee,
} from '../src/utils/alignmentEngine';
import {
  addAcroFormFieldsToPdf,
  mergePdfByteArrays,
  readAcroFormValues,
  readPdfMetadata,
  splitOrExtractPdfPages,
  writeOrScrubPdfMetadata,
} from '../src/utils/pdfUtilitiesEngine';
import {
  applyTrueRedactionsToProject,
  inspectPendingRedactions,
} from '../src/utils/redactionEngine';
import { validateProject } from '../src/utils/validationEngine';
import { generateExportBytes } from '../src/utils/pdfExporter';
import {
  createDefaultBulkConfig,
  createDefaultCopiesConfig,
  createDefaultExportConfig,
  createDefaultFitConfig,
  createDefaultPageConfig,
} from '../src/utils/units';

function makeElement(overrides: Partial<DocumentElement> = {}): DocumentElement {
  return {
    id: 'el-1',
    type: 'text',
    pageNumber: 1,
    x: 40,
    y: 40,
    width: 140,
    height: 22,
    rotation: 0,
    text: 'Sample Text',
    fontFamily: 'Helvetica',
    fontSize: 12,
    fontWeight: 'normal',
    fontStyle: 'normal',
    color: '#000000',
    backgroundColor: 'transparent',
    align: 'left',
    opacity: 1,
    editable: true,
    locked: false,
    visible: true,
    confidence: 0.99,
    needsReview: false,
    ...overrides,
  };
}

function makeTestProject(overrides: Partial<PDFProject> = {}): PDFProject {
  const pageConfig = createDefaultPageConfig(595.28, 841.89, 'mm');
  return {
    id: 'proj-audit-test',
    name: 'Audit Regression Project',
    description: 'Regression test fixture',
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    sourcePdfName: 'fixture.pdf',
    pageCount: 1,
    originalPages: [
      {
        pageNumber: 1,
        sourcePdfPageNumber: 1,
        widthPt: 595.28,
        heightPt: 841.89,
        orientation: 'portrait',
      },
    ],
    elements: [
      makeElement({
        id: 'el-serial',
        type: 'receipt_number',
        fieldKey: 'receipt_no',
        text: '0001',
        x: 60,
        y: 60,
        width: 120,
        height: 20,
      }),
    ],
    pageConfig,
    fitConfig: createDefaultFitConfig(595.28, 841.89),
    copiesConfig: createDefaultCopiesConfig(),
    serialRules: [],
    bulkConfig: createDefaultBulkConfig(),
    dataColumns: [],
    dataRows: [],
    exportConfig: createDefaultExportConfig(),
    isTemplate: false,
    versions: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Editor Interaction Helpers (Toggles, Escape Stack, Numeric Commit)
// ---------------------------------------------------------------------------

test('editorInteractions: toggleEditorTool activates, deactivates on repeat, and switches cleanly', () => {
  const first = toggleEditorTool('select', 'rect', false);
  assert.deepEqual(first, { activeTool: 'rect', stylePainterActive: false });

  // Clicking active tool again deactivates back to select
  const second = toggleEditorTool(first.activeTool, 'rect', first.stylePainterActive);
  assert.deepEqual(second, { activeTool: 'select', stylePainterActive: false });

  // Activating style_painter sets stylePainterActive = true, switching to line clears it
  const painter = toggleEditorTool('select', 'style_painter', false);
  assert.deepEqual(painter, { activeTool: 'style_painter', stylePainterActive: true });
  const switched = toggleEditorTool(painter.activeTool, 'line', painter.stylePainterActive);
  assert.deepEqual(switched, { activeTool: 'line', stylePainterActive: false });

  assert.equal(defaultCategoryForTool('callout'), 'annotate');
  assert.equal(defaultCategoryForTool('measure'), 'measure');
});

test('editorInteractions: toggleSyncedSnapAndGuides recovers inverted state deterministically', () => {
  assert.deepEqual(toggleSyncedSnapAndGuides(false, false), {
    snapToGrid: true,
    showGuides: true,
  });
  assert.deepEqual(toggleSyncedSnapAndGuides(true, true), {
    snapToGrid: false,
    showGuides: false,
  });
  // Partially enabled (out of sync) -> snaps both cleanly ON rather than flipping inverted
  assert.deepEqual(toggleSyncedSnapAndGuides(true, false), {
    snapToGrid: true,
    showGuides: true,
  });
});

test('editorInteractions: resolveEditorEscapeStep enforces clean priority hierarchy', () => {
  const base = {
    hasOpenModal: false,
    showAssetInsertMenu: false,
    showSearchBar: false,
    cropMode: false,
    stylePainterActive: false,
    activeTool: 'select' as const,
    hasOpenMobileOrTabletOverlay: false,
    selectedCount: 0,
  };

  assert.equal(resolveEditorEscapeStep({ ...base, hasOpenModal: true, showSearchBar: true }), 'none');
  assert.equal(resolveEditorEscapeStep({ ...base, showAssetInsertMenu: true, showSearchBar: true }), 'asset_menu');
  assert.equal(resolveEditorEscapeStep({ ...base, showSearchBar: true, cropMode: true }), 'search_bar');
  assert.equal(resolveEditorEscapeStep({ ...base, cropMode: true, activeTool: 'rect' }), 'crop_mode');
  assert.equal(resolveEditorEscapeStep({ ...base, stylePainterActive: true, activeTool: 'rect' }), 'style_painter');
  assert.equal(resolveEditorEscapeStep({ ...base, activeTool: 'draw', selectedCount: 2 }), 'active_tool');
  assert.equal(resolveEditorEscapeStep({ ...base, hasOpenMobileOrTabletOverlay: true, selectedCount: 2 }), 'mobile_or_tablet_drawer');
  assert.equal(resolveEditorEscapeStep({ ...base, selectedCount: 1 }), 'selection');
  assert.equal(resolveEditorEscapeStep(base), 'none');
});

test('editorInteractions: parseCommittedNumericDraft handles transient drafts, integer, allowZero, and bounds', () => {
  assert.equal(parseCommittedNumericDraft('', 42), 42);
  assert.equal(parseCommittedNumericDraft('-', 42), 42);
  assert.equal(parseCommittedNumericDraft('.', 42), 42);
  assert.equal(parseCommittedNumericDraft('  -. ', 42), 42);
  assert.equal(parseCommittedNumericDraft('0', 12, { allowZero: false }), 12);
  assert.equal(parseCommittedNumericDraft('12.7', 10, { integer: true }), 13);
  assert.equal(parseCommittedNumericDraft('999', 10, { min: 1, max: 100 }), 100);
  assert.equal(parseCommittedNumericDraft('-5', 10, { min: 0, max: 100 }), 0);
  assert.equal(parseCommittedNumericDraft('12.3456', 10, { decimals: 2 }), 12.35);
});

// ---------------------------------------------------------------------------
// 2. Geometry & Multi-Copy Imposition Engine
// ---------------------------------------------------------------------------

test('geometryEngine: computes non-overlapping 4-up grid with fitToPage and flags unsafe manual overflow', () => {
  const project = makeTestProject({
    copiesConfig: {
      ...createDefaultCopiesConfig(),
      enabled: true,
      copiesPreset: 4,
      columns: 2,
      rows: 2,
      fitToPage: true,
    },
  });

  const safeLayout = computeSheetLayout(project, 1);
  assert.equal(safeLayout.slots.length, 4);
  assert.equal(safeLayout.hasOverlap, false);
  assert.equal(safeLayout.hasClipping, false);

  const oversized = makeTestProject({
    copiesConfig: {
      ...createDefaultCopiesConfig(),
      enabled: true,
      copiesPreset: 4,
      columns: 2,
      rows: 2,
      fitToPage: false,
      copyScale: 1.0,
    },
    fitConfig: {
      ...createDefaultFitConfig(595.28, 841.89),
      scalingMode: 'custom_percent',
      customPercent: 100,
    },
  });

  const brokenLayout = computeSheetLayout(oversized, 1);
  assert.equal(brokenLayout.hasOverlap, true);
  assert.equal(brokenLayout.hasClipping, true);

  const suggested = suggestOptimalGridForCopies(6, 595.28, 841.89, {
    x: 0,
    y: 0,
    width: 200,
    height: 150,
  });
  assert.ok(suggested.columns * suggested.rows >= 6);
});

// ---------------------------------------------------------------------------
// 3. Advanced Serial Numbering & Conflict Intelligence
// ---------------------------------------------------------------------------

test('serialEngine: Block A (0001-0250) and Block B (0251-0500) produce 500 unique numbers across 250 pages', () => {
  const rules: SerialSequenceRule[] = [
    {
      id: 'rule-a',
      name: 'Block A',
      targetFieldKey: 'receipt_no',
      blockIndex: 0,
      mode: 'auto',
      startNumber: 1,
      endNumber: 250,
      increment: 1,
      prefix: '',
      suffix: '',
      digits: 4,
      leadingZeros: true,
      repeatCount: 1,
    },
    {
      id: 'rule-b',
      name: 'Block B',
      targetFieldKey: 'receipt_no',
      blockIndex: 1,
      mode: 'auto',
      startNumber: 251,
      endNumber: 500,
      increment: 1,
      prefix: '',
      suffix: '',
      digits: 4,
      leadingZeros: true,
      repeatCount: 1,
    },
  ];

  const preview = generateSerialPreview(rules, 250, 2, [], 2);
  assert.equal(preview.duplicates.length, 0);
  assert.equal(preview.outOfRangeCount, 0);
  assert.equal(preview.previewRows[0].formattedValue, '0001');
  assert.equal(preview.previewRows[1].formattedValue, '0251');
  assert.equal(preview.previewRows[2].formattedValue, '0002');
  assert.equal(preview.previewRows[3].formattedValue, '0252');

  const intel = analyzeSerialIntelligence(rules, 250, 2, [], []);
  assert.equal(intel.hasCriticalConflicts, false);
  assert.equal(intel.ruleSpans[0].firstNumber, 1);
  assert.equal(intel.ruleSpans[0].lastNumber, 250);
  assert.equal(intel.ruleSpans[1].firstNumber, 251);
  assert.equal(intel.ruleSpans[1].lastNumber, 500);
});

test('serialEngine: advanceSkippingReserved skips reserved ranges and intelligence detects overlapping rules', () => {
  const skipped = advanceSkippingReserved(10, 3, 1, [
    { id: 'res-1', start: 11, end: 15, label: 'Reserved Hold' },
  ]);
  // Sequence: 10 (step 0), 16 (step 1), 17 (step 2), 18 (step 3)
  assert.equal(skipped.value, 18);

  const overlappingRules: SerialSequenceRule[] = [
    {
      id: 'r1',
      name: 'Slot 1',
      targetFieldKey: 'inv_no',
      blockIndex: 0,
      mode: 'auto',
      startNumber: 1,
      endNumber: 50,
      increment: 1,
      prefix: 'INV-',
      suffix: '',
      digits: 3,
      leadingZeros: true,
      repeatCount: 1,
    },
    {
      id: 'r2',
      name: 'Slot 2',
      targetFieldKey: 'inv_no',
      blockIndex: 1,
      mode: 'auto',
      startNumber: 25,
      endNumber: 75,
      increment: 1,
      prefix: 'INV-',
      suffix: '',
      digits: 3,
      leadingZeros: true,
      repeatCount: 1,
    },
  ];

  const report = analyzeSerialIntelligence(overlappingRules, 30, 2, [], []);
  assert.equal(report.hasCriticalConflicts, true);
  assert.ok(report.conflicts.some((c) => c.code === 'duplicate_value'));
  assert.ok(report.conflicts.some((c) => c.code === 'rule_range_overlap'));
});

// ---------------------------------------------------------------------------
// 4. Spreadsheet Formula, Formatting & Quality Engine
// ---------------------------------------------------------------------------

test('dataFormulaEngine: evaluates arithmetic/IF/UPPER/SUM formulas, formats cells, and detects duplicates/missing', () => {
  const cols = [
    { id: 'c1', name: 'client', type: 'text' as const, required: true },
    { id: 'c2', name: 'qty', type: 'number' as const },
    { id: 'c3', name: 'price', type: 'currency' as const, currencySymbol: '$' },
    {
      id: 'c4',
      name: 'line_total',
      type: 'formula' as const,
      formula: '=qty * price',
    },
    {
      id: 'c5',
      name: 'issued_on',
      type: 'date' as const,
      dateFormat: 'MM/DD/YYYY' as const,
    },
  ];
  const row1 = {
    _rowId: 'r1',
    client: 'Acme Corp',
    qty: 5,
    price: 250,
    issued_on: '2026-03-15T12:00:00Z',
  };
  const row2 = {
    _rowId: 'r2',
    client: 'Acme Corp',
    qty: 2,
    price: 100,
    issued_on: '2026-03-16T12:00:00Z',
  };
  const row3 = {
    _rowId: 'r3',
    client: '',
    qty: 1,
    price: 50,
    issued_on: '2026-03-17T12:00:00Z',
  };

  assert.equal(evaluateFormula('=qty * price', row1, cols), '1250');
  assert.equal(evaluateFormula('=IF(qty >= 5, "BULK", "STD")', row1, cols), 'BULK');
  assert.equal(evaluateFormula('=UPPER(client)', row1, cols), 'ACME CORP');
  assert.equal(evaluateFormula('=SUM(qty, 10)', row1, cols), '15.00');
  assert.equal(formatCellValue(row1.price, cols[2], row1, cols), '$250.00');
  assert.equal(formatCellValue(row1.issued_on, cols[4], row1, cols), '03/15/2026');

  const quality = analyzeDataQuality(cols, [row1, row2, row3], ['client'], ['client']);
  assert.equal(quality.duplicates.length, 1);
  assert.equal(quality.missingValues.length, 1);
  assert.equal(quality.totalIssues, 2);
});

// ---------------------------------------------------------------------------
// 5. Canvas Alignment, Distribution, Smart Snap & Marquee Selection
// ---------------------------------------------------------------------------

test('alignmentEngine: aligns, distributes, snaps to guides, and selects marquee intersection', () => {
  const e1 = makeElement({ id: 'a', x: 20, y: 30, width: 40, height: 20, isUserAdded: false });
  const e2 = makeElement({ id: 'b', x: 100, y: 80, width: 60, height: 20, isUserAdded: true });
  const e3 = makeElement({ id: 'c', x: 240, y: 120, width: 40, height: 20, isUserAdded: true });

  const alignedLeft = alignSelectedElements([e1, e2, e3], ['a', 'b', 'c'], 'left');
  assert.equal(alignedLeft.length, 3);
  assert.equal(alignedLeft[1].patch.x, 20);
  assert.equal(alignedLeft[0].patch.eraseOriginal, true);

  const distH = distributeSelectedElements([e1, e2, e3], ['a', 'b', 'c'], 'horizontal');
  // span = (240+40) - 20 = 260, widths = 40+60+40 = 140, gap = 60 -> a=20, b=120, c=240
  assert.equal(distH.find((u) => u.id === 'b')?.patch.x, 120);

  const snap = computeSmartSnapAndGuides(
    { x: 103, y: 82, width: 40, height: 20 },
    [e1, e2],
    {
      canvasW: 600,
      canvasH: 800,
      snapToGrid: false,
      gridSizePt: 10,
      snapToObjects: true,
      showAlignmentGuides: true,
      snapThresholdPt: 6,
    }
  );
  assert.equal(snap.x, 100);
  assert.equal(snap.y, 80);
  assert.ok(snap.guides.length >= 2);

  const hits = getElementsInMarquee([e1, e2, e3], { x: 15, y: 25, width: 100, height: 70 });
  assert.deepEqual(hits, ['a', 'b']);
});

// ---------------------------------------------------------------------------
// 6. Real PDF Export, True Redaction, Utilities & Validation Pipeline
// ---------------------------------------------------------------------------

test('pdfExporter & pdfUtilitiesEngine: generates valid multi-page imposed PDF and processes utilities', async () => {
  // Build real 2-page source PDF with Helvetica text
  const srcDoc = await PDFDocument.create();
  const font = await srcDoc.embedFont(StandardFonts.HelveticaBold);
  const p1 = srcDoc.addPage([595.28, 841.89]);
  p1.drawText('TEMPLATE RECEIPT', { x: 50, y: 760, size: 16, font, color: rgb(0, 0, 0) });
  const p2 = srcDoc.addPage([595.28, 841.89]);
  p2.drawText('SECOND PAGE BACK', { x: 50, y: 760, size: 14, font, color: rgb(0, 0, 0) });
  const srcBytes = await srcDoc.save();
  const srcBase64 = Buffer.from(srcBytes).toString('base64');

  const project = makeTestProject({
    sourcePdfBase64: srcBase64,
    pageCount: 2,
    originalPages: [
      { pageNumber: 1, sourcePdfPageNumber: 1, widthPt: 595.28, heightPt: 841.89, orientation: 'portrait' },
      { pageNumber: 2, sourcePdfPageNumber: 2, widthPt: 595.28, heightPt: 841.89, orientation: 'portrait' },
    ],
    copiesConfig: {
      ...createDefaultCopiesConfig(),
      enabled: true,
      copiesPreset: 2,
      columns: 1,
      rows: 2,
      fitToPage: true,
    },
    bulkConfig: {
      ...createDefaultBulkConfig(),
      enabled: true,
      totalOutputPages: 2,
      copiesPerPage: 2,
      totalRecords: 4,
      startPageNumber: 1,
      endPageNumber: 2,
    },
    serialRules: [
      {
        id: 'seq-1',
        name: 'Receipt Serial',
        targetFieldKey: 'receipt_no',
        blockIndex: 0,
        mode: 'auto',
        startNumber: 1001,
        endNumber: 1010,
        increment: 1,
        prefix: 'REC-',
        suffix: '',
        digits: 4,
        leadingZeros: true,
        repeatCount: 1,
      },
    ],
  });

  const issues = validateProject(project);
  assert.equal(issues.filter((i) => i.severity === 'error').length, 0);

  const exported = await generateExportBytes(project);
  assert.equal(exported.mimeType, 'application/pdf');
  assert.ok(exported.data.byteLength > 500);

  const loadedOut = await PDFDocument.load(exported.data);
  assert.equal(loadedOut.getPageCount(), 2);

  // Split, merge, metadata write/scrub, and AcroForm roundtrip via pdfUtilitiesEngine
  const pageOneOnly = await splitOrExtractPdfPages(srcBytes, [1]);
  const mergedBack = await mergePdfByteArrays([pageOneOnly, exported.data]);
  const mergedDoc = await PDFDocument.load(mergedBack);
  assert.equal(mergedDoc.getPageCount(), 3);

  const withMeta = await writeOrScrubPdfMetadata(
    pageOneOnly,
    { title: 'Invoice Template', author: 'Finance Ops' },
    false
  );
  const readMeta = await readPdfMetadata(withMeta);
  assert.equal(readMeta.title, 'Invoice Template');
  assert.equal(readMeta.author, 'Finance Ops');

  const scrubbed = await writeOrScrubPdfMetadata(withMeta, {}, true);
  const readScrubbed = await readPdfMetadata(scrubbed);
  assert.equal(readScrubbed.title, '');
  assert.equal(readScrubbed.author, '');

  const withForm = await addAcroFormFieldsToPdf(pageOneOnly, [
    {
      name: 'CustomerName',
      kind: 'text',
      pageNumber: 1,
      xPt: 80,
      yPt: 120,
      widthPt: 180,
      heightPt: 22,
      defaultValue: 'Northwind Traders',
    },
    {
      name: 'Approved',
      kind: 'checkbox',
      pageNumber: 1,
      xPt: 80,
      yPt: 160,
      widthPt: 16,
      heightPt: 16,
      defaultValue: 'checked',
    },
  ]);
  const formVals = await readAcroFormValues(withForm);
  assert.equal(formVals.find((f) => f.name === 'CustomerName')?.value, 'Northwind Traders');
  assert.equal(formVals.find((f) => f.name === 'Approved')?.value, 'checked');
});

test('redactionEngine & validationEngine: detects errors before export and sanitizes true redactions', () => {
  const secretEl = makeElement({
    id: 'secret-text',
    text: 'SSN 123-45-6789',
    x: 60,
    y: 200,
    width: 140,
    height: 20,
  });
  const outOfBoundsEl = makeElement({
    id: 'oob-el',
    text: 'Clipped Footer',
    x: 560,
    y: 20,
    width: 120,
    height: 20,
  });
  const pendingRedact = makeElement({
    id: 'redact-1',
    type: 'redaction',
    text: 'REDACTED',
    x: 55,
    y: 195,
    width: 150,
    height: 30,
    redactionMode: 'visual_mask',
    redactionApplied: false,
  });

  const project = makeTestProject({
    elements: [secretEl, outOfBoundsEl, pendingRedact],
  });

  const preIssues = validateProject(project);
  assert.ok(preIssues.some((i) => i.category === 'out_of_bounds' && i.severity === 'error'));
  assert.ok(preIssues.some((i) => i.category === 'pending_redaction'));

  const summary = inspectPendingRedactions(project);
  assert.equal(summary.pendingCount, 1);
  assert.ok(summary.overlappingTextStrings.includes('SSN 123-45-6789'));

  const applied = applyTrueRedactionsToProject(project);
  assert.equal(applied.appliedRedactionCount, 1);
  assert.equal(applied.removedElementCount, 1);
  assert.equal(
    applied.updatedProject.elements.some((e) => e.id === 'secret-text'),
    false
  );
  assert.equal(applied.updatedProject.originalPages[0].appliedRedactions?.length, 1);

  const postIssues = validateProject(applied.updatedProject);
  assert.equal(
    postIssues.some((i) => i.category === 'pending_redaction'),
    false
  );
});

// ---------------------------------------------------------------------------
// 7. Image Alpha / Overlapping Export & Editor Save State Regression Tests
// ---------------------------------------------------------------------------

function crc32Bytes(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeSolidOrAlphaPngDataUrl(
  width: number,
  height: number,
  rgbTuple: [number, number, number],
  alphaOnLeftHalf: number
): string {
  const raw = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      const px = rowStart + 1 + x * 4;
      raw[px] = rgbTuple[0];
      raw[px + 1] = rgbTuple[1];
      raw[px + 2] = rgbTuple[2];
      raw[px + 3] = x < width / 2 ? alphaOnLeftHalf : 255;
    }
  }
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length, false);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32Bytes(out.subarray(4, 8 + data.length)), false);
    return out;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width, false);
  dv.setUint32(4, height, false);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const c1 = chunk('IHDR', ihdr);
  const c2 = chunk('IDAT', zlib.deflateSync(raw));
  const c3 = chunk('IEND', new Uint8Array(0));
  const full = new Uint8Array(sig.length + c1.length + c2.length + c3.length);
  let off = 0;
  for (const part of [sig, c1, c2, c3]) {
    full.set(part, off);
    off += part.length;
  }
  return `data:image/png;base64,${Buffer.from(full).toString('base64')}`;
}

test('pdfExporter: preserves transparent/overlapping PNG logos and avoids cache collisions on export', async () => {
  const { isImageElementModified, rgbaPixelsHaveTransparency } = await import(
    '../src/utils/pdfExporter'
  );

  // Verify pixel transparency detector catches partially transparent logos and ignores opaque ones
  const transparentPixels = new Uint8ClampedArray([255, 0, 0, 0, 255, 0, 0, 255]);
  const opaquePixels = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]);
  assert.equal(rgbaPixelsHaveTransparency(transparentPixels), true);
  assert.equal(rgbaPixelsHaveTransparency(opaquePixels), false);

  // Verify unmodified original_pdf image vs modified/user-added image detection
  const origImgEl = makeElement({
    id: 'orig-bg-img',
    type: 'image',
    isUserAdded: false,
    eraseOriginal: false,
    x: 40,
    y: 40,
    width: 120,
    height: 60,
    sourceOriginalRect: { x: 40, y: 40, width: 120, height: 60 },
  });
  assert.equal(isImageElementModified(origImgEl), false);
  assert.equal(isImageElementModified({ ...origImgEl, maskShape: 'circle' }), true);
  assert.equal(isImageElementModified({ ...origImgEl, opacity: 0.7 }), true);
  assert.equal(isImageElementModified({ ...origImgEl, x: 55 }), true);

  // Build real source PDF with native content + overlapping transparent PNG logos under medium compression (0.85)
  const srcDoc = await PDFDocument.create();
  const font = await srcDoc.embedFont(StandardFonts.HelveticaBold);
  const srcPage = srcDoc.addPage([595.28, 841.89]);
  srcPage.drawText('OVERLAPPING UNDERLAY TEXT', { x: 60, y: 740, size: 14, font, color: rgb(0.1, 0.1, 0.1) });
  const srcBase64 = Buffer.from(await srcDoc.save()).toString('base64');

  const logoA = makeSolidOrAlphaPngDataUrl(24, 24, [20, 120, 220], 0);
  const logoB = makeSolidOrAlphaPngDataUrl(24, 24, [220, 60, 40], 0);

  const project = makeTestProject({
    sourcePdfBase64: srcBase64,
    exportConfig: {
      ...createDefaultExportConfig(),
      imageCompression: 'medium',
    },
    elements: [
      {
        ...origImgEl,
        imageDataUrl: logoA,
      },
      makeElement({
        id: 'logo-a',
        type: 'image',
        isUserAdded: true,
        x: 60,
        y: 80,
        width: 48,
        height: 48,
        imageDataUrl: logoA,
      }),
      makeElement({
        id: 'logo-b-same-size',
        type: 'image',
        isUserAdded: true,
        x: 90,
        y: 95,
        width: 48,
        height: 48,
        maskShape: 'rounded',
        imageDataUrl: logoB,
      }),
    ],
  });

  const exported = await generateExportBytes(project);
  assert.equal(exported.mimeType, 'application/pdf');
  const outDoc = await PDFDocument.load(exported.data);
  assert.equal(outDoc.getPageCount(), 1);

  // Confirm embedded XObjects include two distinct images with alpha SMask preserved (not flattened to opaque black JPEG)
  const outPage = outDoc.getPage(0);
  const resources = outPage.node.Resources();
  const xObjects = resources?.lookup(PDFName.of('XObject')) as
    | { entries: () => [unknown, unknown][] }
    | undefined;
  assert.ok(xObjects, 'Exported page must contain XObject resources');

  let imageWithSmaskCount = 0;
  for (const [, refOrObj] of xObjects.entries()) {
    const obj = outDoc.context.lookup(refOrObj as never) as { dict?: { get: (k: unknown) => unknown } };
    const subtype = obj?.dict?.get(PDFName.of('Subtype'));
    const smask = obj?.dict?.get(PDFName.of('SMask'));
    if (subtype === PDFName.of('Image') && smask) {
      imageWithSmaskCount++;
    }
  }
  assert.equal(
    imageWithSmaskCount,
    2,
    'Both distinct overlapping PNG logos must embed with SMask alpha preserved (no black JPEG or cache collision)'
  );
});

test('editorInteractions: computeProjectDirtySignature ignores version increments while detecting layout edits', async () => {
  const { computeProjectDirtySignature } = await import('../src/utils/editorInteractions');
  const proj = makeTestProject();
  const sigInitial = computeProjectDirtySignature(proj);

  // Saving increments version/updatedAt without changing editable layout -> signature stays equal
  const afterSave = {
    ...proj,
    version: proj.version + 1,
    updatedAt: '2026-11-18T12:00:00.000Z',
  };
  assert.equal(computeProjectDirtySignature(afterSave), sigInitial);

  // Editing an element changes the dirty signature
  const afterEdit = {
    ...afterSave,
    elements: [{ ...afterSave.elements[0], text: 'Updated 0002' }],
  };
  assert.notEqual(computeProjectDirtySignature(afterEdit), sigInitial);
});

