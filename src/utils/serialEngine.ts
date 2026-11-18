import { DataRow, SerialSequenceRule } from '../types/pdfStudio';

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

export function computeSerialValueForSlot(
  rule: SerialSequenceRule,
  pageZeroIndex: number,
  slotZeroIndex: number,
  copiesPerPage: number,
  dataRows: DataRow[],
  matchingRulesForFieldCount = 1,
  ruleOrdinalWithinSameField = 0
): { value: string; outOfRange: boolean; numericValue: number | null } {
  // Global occurrence index for this rule
  // If each copy slot on a page has its own rule (e.g. Block A rule -> blockIndex 0, Block B rule -> blockIndex 1),
  // then each page advances by 1 (or repeatCount) for that specific block!
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
    return {
      value: val ?? '',
      outOfRange: val === undefined,
      numericValue: null,
    };
  }

  const repeatFactor =
    rule.mode === 'repeating' ? Math.max(1, rule.repeatCount || 1) : 1;
  const stepIndex = Math.floor(occurrenceIndex / repeatFactor);
  const inc = rule.increment === 0 ? 1 : rule.increment;
  const numVal = rule.startNumber + stepIndex * inc;

  const outOfRange =
    inc > 0
      ? numVal > rule.endNumber
      : numVal < rule.endNumber;

  void ruleOrdinalWithinSameField;

  return {
    value: formatSerialNumber(numVal, rule),
    outOfRange,
    numericValue: numVal,
  };
}

export interface SerialPreviewRow {
  pageNumber: number;
  slotIndex: number;
  blockLabel: string;
  fieldKey: string;
  formattedValue: string;
  outOfRange: boolean;
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
        // If multiple rules target the same fieldKey, only apply the rule matching this slot/blockIndex
        if (rulesForField.length > 1 && rule.blockIndex !== s) {
          continue;
        }
        // When copiesPerPage is smaller than blockIndex+1, skip single-rule duplication past copiesPerPage
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
