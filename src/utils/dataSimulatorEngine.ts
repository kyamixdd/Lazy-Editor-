import {
  DataColumn,
  DataRow,
  DocumentElement,
  PDFProject,
} from '../types/pdfStudio';
import { formatCellValue } from './dataFormulaEngine';
import { computeSerialValueForSlot } from './serialEngine';
import { computeTypographyLayout } from './typographyEngine';

export type EdgeCaseId =
  | 'long_text'
  | 'large_currency'
  | 'long_serial'
  | 'missing_values'
  | 'special_chars'
  | 'date_formats';

export interface EdgeCasePreset {
  id: EdgeCaseId;
  label: string;
  description: string;
}

export const EDGE_CASE_PRESETS: EdgeCasePreset[] = [
  {
    id: 'long_text',
    label: 'Long Text',
    description: 'Stress-test unusually long customer names, company titles, and addresses',
  },
  {
    id: 'large_currency',
    label: 'Large Currency',
    description: 'Test high-magnitude amounts ($99,842,750.95)',
  },
  {
    id: 'long_serial',
    label: 'Long Invoice #',
    description: 'Test extended prefix/suffix serials (INV-2026-HQ-000099482-REV2)',
  },
  {
    id: 'missing_values',
    label: 'Missing Values',
    description: 'Simulate blank/empty mapped values for required field checks',
  },
  {
    id: 'special_chars',
    label: 'Special Characters',
    description: 'Test accented Latin, CJK/Unicode symbols, ampersands, and punctuation',
  },
  {
    id: 'date_formats',
    label: 'Date Formats',
    description: 'Test verbose international date formats (September 30, 2026 · 30/09/2026)',
  },
];

export type SimulatorElementSeverity = 'ok' | 'warning' | 'error';

export interface SimulatedElementDiagnostic {
  elementId: string;
  elementLabel: string;
  fieldKey?: string;
  effectiveText: string;
  effectiveFontSize: number;
  originalFontSize: number;
  linesCount: number;
  isOverflowingX: boolean;
  isOverflowingY: boolean;
  isClipped: boolean;
  isUnwantedWrap: boolean;
  isFontShrunk: boolean;
  isMissingValue: boolean;
  collidesWithIds: string[];
  severity: SimulatorElementSeverity;
  issues: string[];
}

export interface SimulatedRecordResult {
  recordIndex: number;
  recordLabel: string;
  activeEdgeCases: EdgeCaseId[];
  diagnostics: SimulatedElementDiagnostic[];
  errorCount: number;
  warningCount: number;
  passed: boolean;
}

export interface BatchStressScanSummary {
  scannedCount: number;
  totalDatasetRows: number;
  failingRecordIndices: number[];
  warningRecordIndices: number[];
  worstFieldKeys: Array<{ fieldKey: string; issueCount: number; sampleRecordIndex: number }>;
  edgeCaseResults: Array<{ preset: EdgeCasePreset; errorCount: number; warningCount: number }>;
}

export function synthesizeEdgeCaseValue(
  baseValue: string,
  col: DataColumn | undefined,
  el: DocumentElement,
  activeEdgeCases: EdgeCaseId[]
): string {
  let out = baseValue;
  const fk = (el.fieldKey || col?.name || '').toLowerCase();

  if (activeEdgeCases.includes('missing_values')) {
    return '';
  }

  if (
    activeEdgeCases.includes('long_serial') &&
    (el.type === 'invoice_number' ||
      el.type === 'receipt_number' ||
      fk.includes('invoice') ||
      fk.includes('receipt') ||
      fk.includes('serial') ||
      fk.includes('num'))
  ) {
    out = 'INV-2026-GLOBAL-HQ-000099482-B2';
  } else if (
    activeEdgeCases.includes('large_currency') &&
    (col?.type === 'currency' ||
      fk.includes('amount') ||
      fk.includes('total') ||
      fk.includes('price') ||
      fk.includes('balance'))
  ) {
    out = `${col?.currencySymbol || '$'}99,842,750.95`;
  } else if (
    activeEdgeCases.includes('date_formats') &&
    (col?.type === 'date' || fk.includes('date') || fk.includes('due'))
  ) {
    out = 'Wednesday, 30 September 2026 (Q3)';
  } else if (activeEdgeCases.includes('long_text')) {
    out = `${out ? out + ' — ' : ''}International Consolidated Industrial Logistics & Manufacturing Holdings Corporation Ltd.`;
  }

  if (activeEdgeCases.includes('special_chars')) {
    out = `${out || 'Sample'} · Müller & Söhne Nº 42/B [€£¥] — «Verified»`;
  }

  return out;
}

export function simulateRecordLayout(
  project: PDFProject,
  recordIndex: number,
  activeEdgeCases: EdgeCaseId[] = []
): SimulatedRecordResult {
  const row: DataRow | undefined = project.dataRows[recordIndex];
  const copiesPerPage = project.copiesConfig.enabled
    ? Math.max(1, project.copiesConfig.columns * project.copiesConfig.rows)
    : 1;
  const pageZero = Math.floor(recordIndex / copiesPerPage);
  const slotZero = recordIndex % copiesPerPage;

  const textElements = project.elements.filter(
    (e) =>
      e.visible &&
      (e.type === 'text' ||
        e.type === 'heading' ||
        e.type === 'invoice_number' ||
        e.type === 'receipt_number' ||
        e.type === 'form_field')
  );

  const diagnostics: SimulatedElementDiagnostic[] = [];
  const renderedRects: Array<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }> = [];

  for (const el of textElements) {
    let val = el.text || '';
    const col = el.fieldKey
      ? project.dataColumns.find((c) => c.name === el.fieldKey)
      : undefined;

    if (el.fieldKey) {
      if (row && col) {
        val = formatCellValue(row[col.name], col, row, project.dataColumns);
      } else if (row && row[el.fieldKey] !== undefined) {
        val = String(row[el.fieldKey]);
      }

      const serialRule = project.serialRules.find(
        (r) => r.targetFieldKey === el.fieldKey
      );
      if (serialRule && (!row || project.bulkConfig.dataSourceMode !== 'dataset')) {
        const rulesForField = project.serialRules.filter(
          (r) => r.targetFieldKey === el.fieldKey
        );
        const sRes = computeSerialValueForSlot(
          serialRule,
          pageZero,
          slotZero,
          copiesPerPage,
          project.dataRows,
          rulesForField.length,
          serialRule.blockIndex
        );
        if (sRes.value) val = sRes.value;
      }

      if (activeEdgeCases.length > 0) {
        val = synthesizeEdgeCaseValue(val, col, el, activeEdgeCases);
      }
    }

    const layout = computeTypographyLayout(el, val);
    const issues: string[] = [];

    const isMissingValue = Boolean(el.fieldKey && val.trim().length === 0);
    const isUnwantedWrap =
      el.height < (el.fontSize || 11) * 1.9 && layout.lines.length > 1;
    const isFontShrunk =
      Boolean(el.autofit) && layout.effectiveFontSize < Math.max(6.5, el.fontSize * 0.68);

    if (layout.isOverflowingX) issues.push('Horizontal text overflow');
    if (layout.isOverflowingY) issues.push('Vertical text overflow / clipped');
    if (isUnwantedWrap) issues.push(`Wrapped to ${layout.lines.length} lines in single-line box`);
    if (isFontShrunk) {
      issues.push(
        `Autofit shrunk font from ${el.fontSize}pt to ${layout.effectiveFontSize}pt`
      );
    }
    if (isMissingValue) {
      issues.push(col?.required ? 'Required mapped value is empty' : 'Mapped value is empty');
    }

    const box = {
      id: el.id,
      x: el.x,
      y: el.y,
      width: Math.max(el.width, layout.totalTextWidthPt),
      height: Math.max(el.height, layout.totalTextHeightPt),
    };
    renderedRects.push(box);

    diagnostics.push({
      elementId: el.id,
      elementLabel: el.fieldKey || el.text.slice(0, 28) || el.type,
      fieldKey: el.fieldKey,
      effectiveText: val,
      effectiveFontSize: layout.effectiveFontSize,
      originalFontSize: el.fontSize || 11,
      linesCount: layout.lines.length,
      isOverflowingX: layout.isOverflowingX,
      isOverflowingY: layout.isOverflowingY,
      isClipped: layout.isClipped,
      isUnwantedWrap,
      isFontShrunk,
      isMissingValue,
      collidesWithIds: [],
      severity:
        layout.isOverflowingX || layout.isOverflowingY || (isMissingValue && col?.required)
          ? 'error'
          : isUnwantedWrap || isFontShrunk || isMissingValue
          ? 'warning'
          : 'ok',
      issues,
    });
  }

  // Pairwise collision check for expanded text regions
  for (let i = 0; i < renderedRects.length; i++) {
    for (let j = i + 1; j < renderedRects.length; j++) {
      const a = renderedRects[i];
      const b = renderedRects[j];
      const ix = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const iy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (ix > 1.5 && iy > 1.5) {
        diagnostics[i].collidesWithIds.push(b.id);
        diagnostics[j].collidesWithIds.push(a.id);
        diagnostics[i].issues.push(`Collides with ${diagnostics[j].elementLabel}`);
        diagnostics[j].issues.push(`Collides with ${diagnostics[i].elementLabel}`);
        if (diagnostics[i].severity === 'ok') diagnostics[i].severity = 'warning';
        if (diagnostics[j].severity === 'ok') diagnostics[j].severity = 'warning';
      }
    }
  }

  const errorCount = diagnostics.filter((d) => d.severity === 'error').length;
  const warningCount = diagnostics.filter((d) => d.severity === 'warning').length;

  return {
    recordIndex,
    recordLabel:
      project.dataRows.length > 0
        ? `Record #${recordIndex + 1}`
        : 'Template Sample',
    activeEdgeCases,
    diagnostics,
    errorCount,
    warningCount,
    passed: errorCount === 0,
  };
}

export function runBatchDataStressScan(
  project: PDFProject,
  maxRecordsToScan = 250
): BatchStressScanSummary {
  const total = project.dataRows.length;
  const limit = Math.min(total, maxRecordsToScan);
  const failingRecordIndices: number[] = [];
  const warningRecordIndices: number[] = [];
  const fieldCounts = new Map<string, { count: number; sampleRecordIndex: number }>();

  for (let i = 0; i < limit; i++) {
    const res = simulateRecordLayout(project, i, []);
    if (res.errorCount > 0) failingRecordIndices.push(i);
    else if (res.warningCount > 0) warningRecordIndices.push(i);

    for (const d of res.diagnostics) {
      if (d.severity !== 'ok') {
        const key = d.fieldKey || d.elementLabel;
        const curr = fieldCounts.get(key) || { count: 0, sampleRecordIndex: i };
        curr.count += 1;
        fieldCounts.set(key, curr);
      }
    }
  }

  const baseIdx = total > 0 ? 0 : 0;
  const edgeCaseResults = EDGE_CASE_PRESETS.map((preset) => {
    const res = simulateRecordLayout(project, baseIdx, [preset.id]);
    return {
      preset,
      errorCount: res.errorCount,
      warningCount: res.warningCount,
    };
  });

  const worstFieldKeys = Array.from(fieldCounts.entries())
    .map(([fieldKey, info]) => ({
      fieldKey,
      issueCount: info.count,
      sampleRecordIndex: info.sampleRecordIndex,
    }))
    .sort((a, b) => b.issueCount - a.issueCount)
    .slice(0, 8);

  return {
    scannedCount: limit,
    totalDatasetRows: total,
    failingRecordIndices,
    warningRecordIndices,
    worstFieldKeys,
    edgeCaseResults,
  };
}
