import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import {
  DataRow,
  PDFProject,
  SerialBatchRecord,
  SerialReservedRange,
  SerialSequenceRule,
} from '../types/pdfStudio';

export function formatSerialNumber(
  num: number,
  rule: SerialSequenceRule
): string {
  const absStr = String(Math.abs(Math.trunc(num)));
  const padded = rule.leadingZeros
    ? absStr.padStart(Math.max(1, rule.digits), '0')
    : absStr;
  const signed = num < 0 ? `-${padded}` : padded;

  if (rule.customPattern && rule.customPattern.includes('{NUM}')) {
    return rule.customPattern
      .replace(/\{PREFIX\}/g, rule.prefix || '')
      .replace(/\{SUFFIX\}/g, rule.suffix || '')
      .replace(/\{NUM\}/g, signed)
      .replace(/\{YEAR\}/g, String(new Date().getFullYear()));
  }
  return `${rule.prefix || ''}${signed}${rule.suffix || ''}`;
}

export function isNumberInReservedRanges(
  num: number,
  ranges?: SerialReservedRange[]
): boolean {
  if (!ranges || ranges.length === 0) return false;
  for (const r of ranges) {
    const lo = Math.min(r.start, r.end);
    const hi = Math.max(r.start, r.end);
    if (num >= lo && num <= hi) return true;
  }
  return false;
}

/**
 * Computes the nth sequential integer starting from `startNumber` stepping by `inc`,
 * cleanly jumping over any reserved ranges without infinite loops.
 */
export function advanceSkippingReserved(
  startNumber: number,
  stepIndex: number,
  inc: number,
  ranges?: SerialReservedRange[]
): { value: number; skippedCount: number } {
  const safeInc = inc === 0 ? 1 : inc;
  if (!ranges || ranges.length === 0) {
    return { value: startNumber + stepIndex * safeInc, skippedCount: 0 };
  }

  let current = startNumber;
  let skippedCount = 0;

  const jumpIfReserved = () => {
    let guard = 0;
    while (isNumberInReservedRanges(current, ranges) && guard < 10000) {
      guard++;
      skippedCount++;
      const hit = ranges.find((r) => {
        const lo = Math.min(r.start, r.end);
        const hi = Math.max(r.start, r.end);
        return current >= lo && current <= hi;
      });
      if (!hit) break;
      const lo = Math.min(hit.start, hit.end);
      const hi = Math.max(hit.start, hit.end);
      if (safeInc > 0) {
        current = hi + 1;
      } else {
        current = lo - 1;
      }
    }
  };

  jumpIfReserved();
  for (let i = 0; i < stepIndex; i++) {
    current += safeInc;
    jumpIfReserved();
  }

  return { value: current, skippedCount };
}

export function computeSerialValueForSlot(
  rule: SerialSequenceRule,
  pageZeroIndex: number,
  slotZeroIndex: number,
  copiesPerPage: number,
  dataRows: DataRow[],
  matchingRulesForFieldCount = 1,
  ruleOrdinalWithinSameField = 0
): {
  value: string;
  outOfRange: boolean;
  numericValue: number | null;
  skippedReserved?: boolean;
} {
  const isBlockBound = matchingRulesForFieldCount > 1;
  const occurrenceIndex = isBlockBound
    ? pageZeroIndex
    : pageZeroIndex * copiesPerPage + slotZeroIndex;

  if (rule.mode === 'csv' && rule.csvColumn) {
    const rowIdx = pageZeroIndex * copiesPerPage + slotZeroIndex;
    const row = dataRows[rowIdx];
    const raw = row ? String(row[rule.csvColumn] ?? '') : '';
    return {
      value: raw || `${rule.prefix || ''}${rule.suffix || ''}`,
      outOfRange: !row,
      numericValue: Number.isFinite(Number(raw)) ? Number(raw) : null,
    };
  }

  if (rule.mode === 'manual') {
    const values = rule.manualValues || [];
    const val = values[occurrenceIndex];
    const numParsed = val !== undefined && /^\d+$/.test(val.trim()) ? Number(val.trim()) : null;
    return {
      value: val ?? '',
      outOfRange: val === undefined,
      numericValue: numParsed,
    };
  }

  const repeatFactor =
    rule.mode === 'repeating' ? Math.max(1, rule.repeatCount || 1) : 1;
  const stepIndex = Math.floor(occurrenceIndex / repeatFactor);
  const inc = rule.increment === 0 ? 1 : rule.increment;

  const { value: numVal, skippedCount } = advanceSkippingReserved(
    rule.startNumber,
    stepIndex,
    inc,
    rule.reservedRanges
  );

  const outOfRange =
    inc > 0 ? numVal > rule.endNumber : numVal < rule.endNumber;

  void ruleOrdinalWithinSameField;

  return {
    value: formatSerialNumber(numVal, rule),
    outOfRange,
    numericValue: numVal,
    skippedReserved: skippedCount > 0,
  };
}

export interface SerialPreviewRow {
  pageNumber: number;
  slotIndex: number;
  blockLabel: string;
  fieldKey: string;
  formattedValue: string;
  outOfRange: boolean;
  numericValue?: number | null;
}

export function generateSerialPreview(
  rules: SerialSequenceRule[],
  totalOutputPages: number,
  copiesPerPage: number,
  dataRows: DataRow[],
  maxPreviewPages = 6
): {
  previewRows: SerialPreviewRow[];
  duplicates: string[];
  outOfRangeCount: number;
} {
  const previewRows: SerialPreviewRow[] = [];
  const seenPerField = new Map<string, Set<string>>();
  const duplicates = new Set<string>();
  let outOfRangeCount = 0;

  const pagesToCheck = Math.min(totalOutputPages, 500);
  const maxRuleBlockIndex = rules.reduce(
    (max, r) => Math.max(max, Number.isFinite(r.blockIndex) ? r.blockIndex : 0),
    0
  );
  const effectiveSlotCount = Math.max(1, copiesPerPage, maxRuleBlockIndex + 1);

  for (let p = 0; p < pagesToCheck; p++) {
    for (let s = 0; s < effectiveSlotCount; s++) {
      for (const rule of rules) {
        const rulesForField = rules.filter(
          (r) => r.targetFieldKey === rule.targetFieldKey
        );
        if (rulesForField.length > 1 && rule.blockIndex !== s) {
          continue;
        }
        if (rulesForField.length <= 1 && s >= copiesPerPage) {
          continue;
        }

        const res = computeSerialValueForSlot(
          rule,
          p,
          s,
          copiesPerPage,
          dataRows,
          rulesForField.length,
          rule.blockIndex
        );

        if (res.outOfRange) {
          outOfRangeCount++;
        }

        if (rule.mode !== 'repeating') {
          if (!seenPerField.has(rule.targetFieldKey)) {
            seenPerField.set(rule.targetFieldKey, new Set());
          }
          const fieldSet = seenPerField.get(rule.targetFieldKey)!;
          if (res.value !== undefined) {
            if (fieldSet.has(res.value) && res.value !== '') {
              duplicates.add(`${rule.targetFieldKey}: ${res.value}`);
            }
            fieldSet.add(res.value);
          }
        }

        if (p < maxPreviewPages) {
          previewRows.push({
            pageNumber: p + 1,
            slotIndex: s + 1,
            blockLabel: `Block ${String.fromCharCode(65 + (s % 26))}`,
            fieldKey: rule.targetFieldKey,
            formattedValue: res.value,
            outOfRange: res.outOfRange,
            numericValue: res.numericValue,
          });
        }
      }
    }
  }

  return {
    previewRows,
    duplicates: Array.from(duplicates),
    outOfRangeCount,
  };
}

// --- MODULE 2: SERIAL NUMBER INTELLIGENCE ---

export interface SerialTimelineSegment {
  id: string;
  label: string;
  kind: 'completed_batch' | 'planned_current' | 'reserved' | 'conflict' | 'gap';
  ruleId?: string;
  fieldKey: string;
  start: number;
  end: number;
  count: number;
  timestamp?: string;
}

export interface SerialConflictWarning {
  id: string;
  severity: 'error' | 'warning';
  code:
    | 'duplicate_value'
    | 'batch_overlap'
    | 'reserved_collision'
    | 'sequence_gap'
    | 'out_of_range'
    | 'rule_range_overlap';
  ruleId?: string;
  message: string;
  detail: string;
}

export interface SerialIntelligenceReport {
  conflicts: SerialConflictWarning[];
  gaps: Array<{ fieldKey: string; from: number; to: number; missingCount: number }>;
  timeline: SerialTimelineSegment[];
  nextSafeResumeByRule: Record<string, number>;
  ruleSpans: Array<{
    ruleId: string;
    ruleName: string;
    fieldKey: string;
    blockIndex: number;
    firstNumber: number | null;
    lastNumber: number | null;
    generatedCount: number;
    skippedReservedCount: number;
    outOfRangeCount: number;
  }>;
  hasCriticalConflicts: boolean;
}

export function computeNextSafeResumeStart(
  rule: SerialSequenceRule,
  batchHistory: SerialBatchRecord[]
): number {
  const inc = rule.increment === 0 ? 1 : rule.increment;
  const matching = batchHistory.filter(
    (b) =>
      b.status !== 'planned' &&
      (b.ruleId === rule.id ||
        (b.targetFieldKey === rule.targetFieldKey &&
          b.prefix === rule.prefix &&
          b.suffix === rule.suffix))
  );
  if (matching.length === 0) {
    return rule.startNumber;
  }

  let candidate =
    inc > 0
      ? Math.max(...matching.map((b) => b.actualLastNum)) + inc
      : Math.min(...matching.map((b) => b.actualLastNum)) + inc;

  const { value } = advanceSkippingReserved(candidate, 0, inc, rule.reservedRanges);
  candidate = value;
  return candidate;
}

export function analyzeSerialIntelligence(
  rules: SerialSequenceRule[],
  totalOutputPages: number,
  copiesPerPage: number,
  dataRows: DataRow[],
  batchHistory: SerialBatchRecord[] = []
): SerialIntelligenceReport {
  const preview = generateSerialPreview(
    rules,
    totalOutputPages,
    copiesPerPage,
    dataRows,
    0
  );
  const conflicts: SerialConflictWarning[] = [];
  const timeline: SerialTimelineSegment[] = [];
  const nextSafeResumeByRule: Record<string, number> = {};
  const gaps: SerialIntelligenceReport['gaps'] = [];
  const ruleSpans: SerialIntelligenceReport['ruleSpans'] = [];

  if (preview.duplicates.length > 0) {
    conflicts.push({
      id: 'dup-values',
      severity: 'error',
      code: 'duplicate_value',
      message: `${preview.duplicates.length} duplicate serial value(s) generated`,
      detail: preview.duplicates.slice(0, 6).join(', '),
    });
  }

  if (preview.outOfRangeCount > 0) {
    conflicts.push({
      id: 'out-of-range',
      severity: 'error',
      code: 'out_of_range',
      message: `${preview.outOfRangeCount} slot(s) exceed rule End Number`,
      detail: 'Increase rule endNumber or reduce total pages / copies per page.',
    });
  }

  // Record batch history segments + compute safe resume numbers
  for (const b of batchHistory) {
    timeline.push({
      id: `tl-batch-${b.id}`,
      label: `${b.ruleName} (${b.status})`,
      kind: b.status === 'completed' ? 'completed_batch' : 'planned_current',
      ruleId: b.ruleId,
      fieldKey: b.targetFieldKey,
      start: Math.min(b.actualFirstNum, b.actualLastNum),
      end: Math.max(b.actualFirstNum, b.actualLastNum),
      count: b.generatedCount,
      timestamp: b.createdAt,
    });
  }

  const ruleActualRanges: Array<{
    rule: SerialSequenceRule;
    lo: number;
    hi: number;
  }> = [];

  for (const rule of rules) {
    nextSafeResumeByRule[rule.id] = computeNextSafeResumeStart(rule, batchHistory);

    const rulesForField = rules.filter((r) => r.targetFieldKey === rule.targetFieldKey);
    const isBlockBound = rulesForField.length > 1;
    const occurrences = isBlockBound
      ? totalOutputPages
      : totalOutputPages * copiesPerPage;

    const nums: number[] = [];
    let outOfRangeCount = 0;
    let skippedReservedCount = 0;
    const pages = Math.min(totalOutputPages, 500);

    for (let p = 0; p < pages; p++) {
      if (isBlockBound) {
        const res = computeSerialValueForSlot(
          rule,
          p,
          rule.blockIndex,
          copiesPerPage,
          dataRows,
          rulesForField.length,
          rule.blockIndex
        );
        if (res.outOfRange) outOfRangeCount++;
        if (res.skippedReserved) skippedReservedCount++;
        if (res.numericValue !== null) nums.push(res.numericValue);
      } else {
        for (let s = 0; s < copiesPerPage; s++) {
          const res = computeSerialValueForSlot(
            rule,
            p,
            s,
            copiesPerPage,
            dataRows,
            rulesForField.length,
            rule.blockIndex
          );
          if (res.outOfRange) outOfRangeCount++;
          if (res.skippedReserved) skippedReservedCount++;
          if (res.numericValue !== null) nums.push(res.numericValue);
        }
      }
    }

    const firstNumber = nums.length > 0 ? nums[0] : null;
    const lastNumber = nums.length > 0 ? nums[nums.length - 1] : null;

    ruleSpans.push({
      ruleId: rule.id,
      ruleName: rule.name,
      fieldKey: rule.targetFieldKey,
      blockIndex: rule.blockIndex,
      firstNumber,
      lastNumber,
      generatedCount: occurrences,
      skippedReservedCount,
      outOfRangeCount,
    });

    // Add reserved ranges to timeline
    for (const rr of rule.reservedRanges || []) {
      const lo = Math.min(rr.start, rr.end);
      const hi = Math.max(rr.start, rr.end);
      timeline.push({
        id: `tl-res-${rule.id}-${rr.id}`,
        label: rr.label ? `Reserved: ${rr.label}` : `Reserved (${rule.name})`,
        kind: 'reserved',
        ruleId: rule.id,
        fieldKey: rule.targetFieldKey,
        start: lo,
        end: hi,
        count: hi - lo + 1,
      });
    }

    if (firstNumber !== null && lastNumber !== null) {
      const lo = Math.min(firstNumber, lastNumber);
      const hi = Math.max(firstNumber, lastNumber);
      ruleActualRanges.push({ rule, lo, hi });

      timeline.push({
        id: `tl-curr-${rule.id}`,
        label: `${rule.name} (Current Job)`,
        kind: 'planned_current',
        ruleId: rule.id,
        fieldKey: rule.targetFieldKey,
        start: lo,
        end: hi,
        count: nums.length,
      });

      // Check cross-batch overlap with prior completed batches
      for (const b of batchHistory) {
        if (b.status === 'planned') continue;
        if (b.targetFieldKey !== rule.targetFieldKey) continue;
        if (b.prefix !== rule.prefix || b.suffix !== rule.suffix) continue;
        const bLo = Math.min(b.actualFirstNum, b.actualLastNum);
        const bHi = Math.max(b.actualFirstNum, b.actualLastNum);
        if (Math.max(lo, bLo) <= Math.min(hi, bHi)) {
          const ovStart = Math.max(lo, bLo);
          const ovEnd = Math.min(hi, bHi);
          conflicts.push({
            id: `batch-ov-${rule.id}-${b.id}`,
            severity: 'error',
            code: 'batch_overlap',
            ruleId: rule.id,
            message: `${rule.name} overlaps previous batch (${ovStart}–${ovEnd})`,
            detail: `Previous batch generated ${b.actualFirstNum}–${b.actualLastNum}. Use Resume Next Safe Start (${nextSafeResumeByRule[rule.id]}) to prevent duplicate serials.`,
          });
          timeline.push({
            id: `tl-conflict-${rule.id}-${b.id}`,
            label: `Overlap Conflict`,
            kind: 'conflict',
            ruleId: rule.id,
            fieldKey: rule.targetFieldKey,
            start: ovStart,
            end: ovEnd,
            count: ovEnd - ovStart + 1,
          });
        }
      }

      // Check missing gaps inside manual / csv numeric sequences
      if (rule.mode === 'manual' || rule.mode === 'csv') {
        const sorted = Array.from(new Set(nums)).sort((a, b) => a - b);
        for (let k = 1; k < sorted.length; k++) {
          const diff = sorted[k] - sorted[k - 1];
          if (diff > 1) {
            gaps.push({
              fieldKey: rule.targetFieldKey,
              from: sorted[k - 1] + 1,
              to: sorted[k] - 1,
              missingCount: diff - 1,
            });
            timeline.push({
              id: `tl-gap-${rule.id}-${k}`,
              label: `Missing Gap (${diff - 1})`,
              kind: 'gap',
              ruleId: rule.id,
              fieldKey: rule.targetFieldKey,
              start: sorted[k - 1] + 1,
              end: sorted[k] - 1,
              count: diff - 1,
            });
          }
        }
      }
    }
  }

  // Pairwise rule overlap check for same field & prefix/suffix
  for (let i = 0; i < ruleActualRanges.length; i++) {
    for (let j = i + 1; j < ruleActualRanges.length; j++) {
      const a = ruleActualRanges[i];
      const b = ruleActualRanges[j];
      if (
        a.rule.targetFieldKey === b.rule.targetFieldKey &&
        a.rule.prefix === b.rule.prefix &&
        a.rule.suffix === b.rule.suffix &&
        a.rule.mode !== 'repeating' &&
        b.rule.mode !== 'repeating'
      ) {
        if (Math.max(a.lo, b.lo) <= Math.min(a.hi, b.hi)) {
          const ovStart = Math.max(a.lo, b.lo);
          const ovEnd = Math.min(a.hi, b.hi);
          conflicts.push({
            id: `rule-ov-${a.rule.id}-${b.rule.id}`,
            severity: 'error',
            code: 'rule_range_overlap',
            message: `${a.rule.name} and ${b.rule.name} overlap (${ovStart}–${ovEnd})`,
            detail: `Multiple blocks targeting "${a.rule.targetFieldKey}" share overlapping numeric ranges.`,
          });
        }
      }
    }
  }

  // Detect gaps between historical batches and current job
  const completedSorted = batchHistory
    .filter((b) => b.status === 'completed')
    .sort((a, b) => Math.min(a.actualFirstNum, a.actualLastNum) - Math.min(b.actualFirstNum, b.actualLastNum));
  for (let i = 1; i < completedSorted.length; i++) {
    const prev = completedSorted[i - 1];
    const curr = completedSorted[i];
    if (prev.targetFieldKey !== curr.targetFieldKey) continue;
    const prevHi = Math.max(prev.actualFirstNum, prev.actualLastNum);
    const currLo = Math.min(curr.actualFirstNum, curr.actualLastNum);
    if (currLo > prevHi + 1) {
      gaps.push({
        fieldKey: curr.targetFieldKey,
        from: prevHi + 1,
        to: currLo - 1,
        missingCount: currLo - prevHi - 1,
      });
      conflicts.push({
        id: `batch-gap-${prev.id}-${curr.id}`,
        severity: 'warning',
        code: 'sequence_gap',
        message: `Missing numbers ${prevHi + 1}–${currLo - 1} between batches`,
        detail: `${currLo - prevHi - 1} unassigned number(s) detected on "${curr.targetFieldKey}".`,
      });
    }
  }

  return {
    conflicts,
    gaps,
    timeline: timeline.sort((a, b) => a.start - b.start),
    nextSafeResumeByRule,
    ruleSpans,
    hasCriticalConflicts: conflicts.some((c) => c.severity === 'error'),
  };
}

export function createSerialBatchRecord(
  project: PDFProject,
  rule: SerialSequenceRule,
  totalOutputPages: number,
  copiesPerPage: number,
  status: SerialBatchRecord['status'] = 'completed'
): SerialBatchRecord {
  const rulesForField = project.serialRules.filter(
    (r) => r.targetFieldKey === rule.targetFieldKey
  );
  const isBlockBound = rulesForField.length > 1;
  const firstRes = computeSerialValueForSlot(
    rule,
    0,
    isBlockBound ? rule.blockIndex : 0,
    copiesPerPage,
    project.dataRows,
    rulesForField.length,
    rule.blockIndex
  );
  const lastPage = Math.max(0, totalOutputPages - 1);
  const lastSlot = isBlockBound ? rule.blockIndex : Math.max(0, copiesPerPage - 1);
  const lastRes = computeSerialValueForSlot(
    rule,
    lastPage,
    lastSlot,
    copiesPerPage,
    project.dataRows,
    rulesForField.length,
    rule.blockIndex
  );

  const actualFirstNum = firstRes.numericValue ?? rule.startNumber;
  const actualLastNum = lastRes.numericValue ?? rule.endNumber;
  const inc = rule.increment === 0 ? 1 : rule.increment;
  const nextRaw = actualLastNum + inc;
  const { value: nextSafe } = advanceSkippingReserved(
    nextRaw,
    0,
    inc,
    rule.reservedRanges
  );

  return {
    id: `sbatch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    projectId: project.id,
    projectName: project.name,
    ruleId: rule.id,
    ruleName: rule.name,
    targetFieldKey: rule.targetFieldKey,
    blockIndex: rule.blockIndex,
    prefix: rule.prefix,
    suffix: rule.suffix,
    startNumber: rule.startNumber,
    endNumber: rule.endNumber,
    actualFirstNum,
    actualLastNum,
    generatedCount: isBlockBound
      ? totalOutputPages
      : totalOutputPages * copiesPerPage,
    totalPages: totalOutputPages,
    nextResumeNumber: nextSafe,
    status,
    createdAt: new Date().toISOString(),
  };
}

export function buildSerialReportCsv(
  projectName: string,
  rules: SerialSequenceRule[],
  report: SerialIntelligenceReport,
  batchHistory: SerialBatchRecord[]
): string {
  const esc = (v: unknown) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines: string[] = [];
  lines.push(`Serial Number Intelligence Report,${esc(projectName)},${new Date().toISOString()}`);
  lines.push('');
  lines.push('RULE SPAN SUMMARY');
  lines.push('Rule Name,Field Key,Block Index,First #,Last #,Count,Skipped Reserved,Out of Range,Next Safe Start');
  for (const span of report.ruleSpans) {
    lines.push(
      [
        span.ruleName,
        span.fieldKey,
        span.blockIndex,
        span.firstNumber ?? '',
        span.lastNumber ?? '',
        span.generatedCount,
        span.skippedReservedCount,
        span.outOfRangeCount,
        report.nextSafeResumeByRule[span.ruleId] ?? '',
      ]
        .map(esc)
        .join(',')
    );
  }
  lines.push('');
  lines.push('BATCH HISTORY');
  lines.push('Batch ID,Rule,Field Key,First #,Last #,Generated Count,Next Resume #,Status,Timestamp');
  for (const b of batchHistory) {
    lines.push(
      [
        b.id,
        b.ruleName,
        b.targetFieldKey,
        b.actualFirstNum,
        b.actualLastNum,
        b.generatedCount,
        b.nextResumeNumber,
        b.status,
        b.createdAt,
      ]
        .map(esc)
        .join(',')
    );
  }
  if (report.conflicts.length > 0) {
    lines.push('');
    lines.push('CONFLICTS & WARNINGS');
    lines.push('Severity,Code,Message,Detail');
    for (const c of report.conflicts) {
      lines.push([c.severity, c.code, c.message, c.detail].map(esc).join(','));
    }
  }
  void rules;
  return lines.join('\n');
}

export async function generateSerialReportPdfBytes(
  project: PDFProject,
  report: SerialIntelligenceReport,
  batchHistory: SerialBatchRecord[]
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);

  let page = doc.addPage([595.28, 841.89]);
  let y = 795;

  const ensureSpace = (needed = 40) => {
    if (y - needed < 48) {
      page = doc.addPage([595.28, 841.89]);
      y = 795;
    }
  };

  page.drawText('SERIAL NUMBER INTELLIGENCE REPORT', {
    x: 44,
    y,
    size: 16,
    font: bold,
    color: rgb(0.06, 0.06, 0.06),
  });
  y -= 18;
  page.drawText(
    `Project: ${project.name}   |   Generated: ${new Date().toLocaleString()}`,
    { x: 44, y, size: 9, font, color: rgb(0.35, 0.35, 0.35) }
  );
  y -= 24;

  page.drawText('Active Sequence Rules', { x: 44, y, size: 11, font: bold });
  y -= 16;
  for (const span of report.ruleSpans) {
    ensureSpace(22);
    const line = `${span.ruleName} [${span.fieldKey}] · Range: ${span.firstNumber ?? '-'} to ${span.lastNumber ?? '-'} · Count: ${span.generatedCount} · Next Safe: ${report.nextSafeResumeByRule[span.ruleId] ?? '-'}`;
    page.drawText(line.slice(0, 96), { x: 48, y, size: 8.5, font: mono });
    y -= 14;
  }

  y -= 12;
  ensureSpace(32);
  page.drawText(`Conflicts & Warnings (${report.conflicts.length})`, {
    x: 44,
    y,
    size: 11,
    font: bold,
  });
  y -= 16;
  if (report.conflicts.length === 0) {
    page.drawText('No sequence conflicts, overlaps, or gaps detected.', {
      x: 48,
      y,
      size: 9,
      font,
      color: rgb(0.25, 0.25, 0.25),
    });
    y -= 14;
  } else {
    for (const c of report.conflicts) {
      ensureSpace(24);
      page.drawText(`[${c.severity.toUpperCase()}] ${c.message}`.slice(0, 95), {
        x: 48,
        y,
        size: 8.5,
        font: bold,
      });
      y -= 12;
      page.drawText(c.detail.slice(0, 102), {
        x: 56,
        y,
        size: 8,
        font,
        color: rgb(0.35, 0.35, 0.35),
      });
      y -= 15;
    }
  }

  y -= 12;
  ensureSpace(32);
  page.drawText(`Recorded Batch History (${batchHistory.length})`, {
    x: 44,
    y,
    size: 11,
    font: bold,
  });
  y -= 16;
  for (const b of batchHistory.slice(0, 40)) {
    ensureSpace(16);
    const bLine = `${b.createdAt.slice(0, 16)} · ${b.ruleName} · ${b.actualFirstNum}..${b.actualLastNum} (${b.generatedCount} pcs) · ${b.status}`;
    page.drawText(bLine.slice(0, 96), { x: 48, y, size: 8, font: mono });
    y -= 13;
  }

  return doc.save();
}
