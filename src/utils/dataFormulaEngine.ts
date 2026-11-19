import * as XLSX from 'xlsx';
import {
  ConditionalFieldRule,
  DataColumn,
  DataQualityReport,
  DataRow,
} from '../types/pdfStudio';
import { triggerBlobDownload } from './downloadHelper';

function evaluateConditionClause(
  lhsRaw: string,
  operator: ConditionalFieldRule['operator'],
  rhsRaw: string
): boolean {
  const lhs = lhsRaw.trim();
  const rhs = rhsRaw.trim();
  switch (operator) {
    case 'is_empty':
      return lhs.length === 0;
    case 'not_empty':
      return lhs.length > 0;
    case 'equals':
      return lhs.toLowerCase() === rhs.toLowerCase();
    case 'not_equals':
      return lhs.toLowerCase() !== rhs.toLowerCase();
    case 'contains':
      return lhs.toLowerCase().includes(rhs.toLowerCase());
    case 'gt': {
      const a = Number(lhs.replace(/[^0-9.-]/g, ''));
      const b = Number(rhs.replace(/[^0-9.-]/g, ''));
      return Number.isFinite(a) && Number.isFinite(b) && a > b;
    }
    case 'lt': {
      const a = Number(lhs.replace(/[^0-9.-]/g, ''));
      const b = Number(rhs.replace(/[^0-9.-]/g, ''));
      return Number.isFinite(a) && Number.isFinite(b) && a < b;
    }
    default:
      return false;
  }
}

export function applyColumnConditionRules(
  baseFormatted: string,
  column: DataColumn,
  row: DataRow
): string {
  if (!column.conditionRules || column.conditionRules.length === 0) {
    return baseFormatted;
  }
  for (const rule of column.conditionRules) {
    const colVal =
      rule.whenColumn === column.name
        ? baseFormatted
        : String(row[rule.whenColumn] ?? '');
    const matched = evaluateConditionClause(
      colVal,
      rule.operator,
      rule.compareValue
    );
    if (matched) {
      return rule.thenValue
        .replace(/\{VALUE\}/g, baseFormatted)
        .replace(/\{ROW\}/g, String(row[rule.whenColumn] ?? ''));
    }
    if (rule.elseValue !== undefined && rule.elseValue !== '') {
      return rule.elseValue.replace(/\{VALUE\}/g, baseFormatted);
    }
  }
  return baseFormatted;
}

export function formatCellValue(
  rawValue: string | number | undefined,
  column: DataColumn,
  row: DataRow,
  allColumns: DataColumn[]
): string {
  let result = '';
  if (column.type === 'formula') {
    result = evaluateFormula(
      column.formula || String(rawValue || ''),
      row,
      allColumns
    );
    return applyColumnConditionRules(result, column, row);
  }
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return applyColumnConditionRules('', column, row);
  }

  if (column.type === 'currency') {
    const num = Number(String(rawValue).replace(/[^0-9.-]/g, ''));
    if (!Number.isFinite(num)) {
      result = String(rawValue);
    } else {
      const sym = column.currencySymbol || '$';
      result = `${sym}${num.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    }
    return applyColumnConditionRules(result, column, row);
  }

  if (column.type === 'number') {
    const num = Number(rawValue);
    if (!Number.isFinite(num)) {
      result = String(rawValue);
    } else if (column.numberDecimals !== undefined) {
      result = num.toLocaleString('en-US', {
        minimumFractionDigits: column.numberDecimals,
        maximumFractionDigits: column.numberDecimals,
      });
    } else {
      result = num.toLocaleString('en-US');
    }
    return applyColumnConditionRules(result, column, row);
  }

  if (column.type === 'date') {
    const parsed = new Date(String(rawValue));
    if (Number.isNaN(parsed.getTime())) {
      result = String(rawValue);
    } else {
      const y = parsed.getFullYear();
      const m = String(parsed.getMonth() + 1).padStart(2, '0');
      const d = String(parsed.getDate()).padStart(2, '0');
      switch (column.dateFormat) {
        case 'MM/DD/YYYY':
          result = `${m}/${d}/${y}`;
          break;
        case 'DD/MM/YYYY':
          result = `${d}/${m}/${y}`;
          break;
        case 'MMM D, YYYY':
          result = parsed.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          });
          break;
        case 'YYYY-MM-DD':
        default:
          result = `${y}-${m}-${d}`;
          break;
      }
    }
    return applyColumnConditionRules(result, column, row);
  }

  return applyColumnConditionRules(String(rawValue), column, row);
}

function resolveFormulaToken(token: string, row: DataRow): string {
  const clean = token.trim();
  if (
    (clean.startsWith('"') && clean.endsWith('"')) ||
    (clean.startsWith("'") && clean.endsWith("'"))
  ) {
    return clean.slice(1, -1);
  }
  if (row[clean] !== undefined) return String(row[clean]);
  return clean;
}

export function evaluateFormula(
  formulaInput: string,
  row: DataRow,
  columns: DataColumn[]
): string {
  const exprRaw = formulaInput.trim();
  if (!exprRaw.startsWith('=')) return exprRaw;
  let expr = exprRaw.slice(1).trim();

  // Support IF(cond, trueVal, falseVal) e.g. =IF(amount > 500, "VIP", "Standard")
  const ifMatch = expr.match(/^IF\((.+)\)$/i);
  if (ifMatch) {
    const args: string[] = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';
    for (const ch of ifMatch[1]) {
      if ((ch === '"' || ch === "'") && !inQuotes) {
        inQuotes = true;
        quoteChar = ch;
        current += ch;
      } else if (ch === quoteChar && inQuotes) {
        inQuotes = false;
        current += ch;
      } else if (ch === ',' && !inQuotes) {
        args.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim()) args.push(current.trim());

    if (args.length >= 2) {
      const condStr = args[0];
      const trueBranch = resolveFormulaToken(args[1], row);
      const falseBranch = args[2] ? resolveFormulaToken(args[2], row) : '';
      const opMatch = condStr.match(/^(.+?)\s*(==|!=|>=|<=|>|<|CONTAINS)\s*(.+)$/i);
      if (opMatch) {
        const lhs = resolveFormulaToken(opMatch[1], row);
        const op = opMatch[2].toUpperCase();
        const rhs = resolveFormulaToken(opMatch[3], row);
        let ok = false;
        if (op === '==') ok = lhs.toLowerCase() === rhs.toLowerCase();
        else if (op === '!=') ok = lhs.toLowerCase() !== rhs.toLowerCase();
        else if (op === 'CONTAINS') ok = lhs.toLowerCase().includes(rhs.toLowerCase());
        else {
          const na = Number(lhs.replace(/[^0-9.-]/g, ''));
          const nb = Number(rhs.replace(/[^0-9.-]/g, ''));
          if (Number.isFinite(na) && Number.isFinite(nb)) {
            if (op === '>') ok = na > nb;
            if (op === '<') ok = na < nb;
            if (op === '>=') ok = na >= nb;
            if (op === '<=') ok = na <= nb;
          }
        }
        return ok ? trueBranch : falseBranch;
      }
      return resolveFormulaToken(condStr, row) ? trueBranch : falseBranch;
    }
  }

  // Support UPPER(col), LOWER(col), CONCAT(a, b), SUM(a, b)
  const upperMatch = expr.match(/^UPPER\((.+)\)$/i);
  if (upperMatch) {
    const colName = upperMatch[1].trim();
    return String(row[colName] ?? '').toUpperCase();
  }

  const lowerMatch = expr.match(/^LOWER\((.+)\)$/i);
  if (lowerMatch) {
    const colName = lowerMatch[1].trim();
    return String(row[colName] ?? '').toLowerCase();
  }

  const concatMatch = expr.match(/^CONCAT\((.+)\)$/i);
  if (concatMatch) {
    return concatMatch[1]
      .split(',')
      .map((part) => {
        const clean = part.trim().replace(/^["']|["']$/g, '');
        return row[clean] !== undefined ? String(row[clean]) : clean;
      })
      .join('');
  }

  const sumMatch = expr.match(/^SUM\((.+)\)$/i);
  if (sumMatch) {
    const total = sumMatch[1]
      .split(',')
      .map((part) => {
        const key = part.trim();
        const val = row[key] !== undefined ? row[key] : key;
        return Number(String(val).replace(/[^0-9.-]/g, '')) || 0;
      })
      .reduce((acc, n) => acc + n, 0);
    return total.toFixed(2);
  }

  // Replace column names with numeric values for simple arithmetic expressions like =qty * unit_price
  for (const col of columns) {
    const escaped = col.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'g');
    const raw = row[col.name];
    const num = Number(String(raw ?? 0).replace(/[^0-9.-]/g, '')) || 0;
    expr = expr.replace(regex, String(num));
  }

  // Safe arithmetic evaluation only allowing digits, operators, parentheses, spaces, decimal points
  if (/^[0-9+\-*/().\s]+$/.test(expr)) {
    try {
      const fn = new Function(`return (${expr});`);
      const result = fn();
      if (typeof result === 'number' && Number.isFinite(result)) {
        return Number.isInteger(result) ? String(result) : result.toFixed(2);
      }
    } catch {
      return '#ERR';
    }
  }

  return '#ERR';
}

export function analyzeDataQuality(
  columns: DataColumn[],
  rows: DataRow[],
  duplicateKeyColumns: string[] = [],
  mappedFieldKeys: string[] = []
): DataQualityReport {
  const keyGroups = new Map<string, { rowIds: string[]; rowIndices: number[] }>();
  const missingValues: DataQualityReport['missingValues'] = [];

  const requiredCols = columns.filter(
    (c) =>
      c.type !== 'formula' &&
      (c.required || mappedFieldKeys.includes(c.name))
  );

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    // Check missing required/mapped values
    for (const col of requiredCols) {
      const val = row[col.name];
      if (val === undefined || val === null || String(val).trim() === '') {
        missingValues.push({
          rowId: row._rowId,
          rowIndex: i + 1,
          columnName: col.name,
        });
      }
    }

    // Check duplicate key records (O(N))
    if (duplicateKeyColumns.length > 0) {
      const keyParts = duplicateKeyColumns.map((k) =>
        String(row[k] ?? '').trim().toLowerCase()
      );
      if (keyParts.some((p) => p.length > 0)) {
        const composite = keyParts.join(' | ');
        const existing = keyGroups.get(composite);
        if (existing) {
          existing.rowIds.push(row._rowId);
          existing.rowIndices.push(i + 1);
        } else {
          keyGroups.set(composite, {
            rowIds: [row._rowId],
            rowIndices: [i + 1],
          });
        }
      }
    }
  }

  const duplicates = Array.from(keyGroups.entries())
    .filter(([, g]) => g.rowIds.length > 1)
    .map(([key, g]) => ({
      key,
      rowIds: g.rowIds,
      rowIndices: g.rowIndices,
    }));

  return {
    duplicates,
    missingValues,
    totalIssues: duplicates.length + missingValues.length,
  };
}

export async function parseSpreadsheetFile(file: File): Promise<{
  columns: DataColumn[];
  rows: DataRow[];
}> {
  const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
  const MAX_IMPORT_ROWS = 50000;
  const MAX_IMPORT_COLUMNS = 250;

  if (!file || typeof file.arrayBuffer !== 'function') {
    throw new Error('Choose a valid CSV, Excel, or JSON file.');
  }
  if (file.size > MAX_IMPORT_BYTES) {
    throw new Error('This file is larger than the 20 MB import limit. Split it into smaller files and try again.');
  }

  let jsonRows: Record<string, unknown>[];
  const isJson = file.name.toLowerCase().endsWith('.json') ||
    file.type.toLowerCase().includes('json');

  if (isJson) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      throw new Error('The JSON file is invalid. Check its syntax and try again.');
    }

    let candidate: unknown = parsed;
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      const root = candidate as Record<string, unknown>;
      candidate = Array.isArray(root.rows) ? root.rows
        : Array.isArray(root.dataRows) ? root.dataRows
        : Array.isArray(root.data) ? root.data
        : candidate;
    }
    if (!Array.isArray(candidate)) {
      throw new Error('JSON import expects an array of records, or an object containing a rows, dataRows, or data array.');
    }
    if (candidate.length === 0) {
      throw new Error('JSON file contains no data rows.');
    }
    if (candidate.length > MAX_IMPORT_ROWS) {
      throw new Error(`This import contains more than ${MAX_IMPORT_ROWS.toLocaleString()} rows. Split it into smaller files.`);
    }
    jsonRows = candidate.map((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new Error(`JSON row ${index + 1} is not an object. Each row must be a record of named fields.`);
      }
      return item as Record<string, unknown>;
    });
  } else {
    const buffer = await file.arrayBuffer();
    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, { type: 'array' });
    } catch {
      throw new Error('Could not read this file. Supported formats are CSV, XLS, XLSX, and JSON.');
    }
    const firstSheet = workbook.SheetNames[0];
    if (!firstSheet) throw new Error('Spreadsheet contains no sheets.');
    const worksheet = workbook.Sheets[firstSheet];
    jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '' });
  }

  if (jsonRows.length === 0) throw new Error('File contains no data rows.');

  // Build a union of headers so fields appearing after the first JSON record are not lost.
  const seen = new Set<string>();
  const headers: string[] = [];
  for (const raw of jsonRows) {
    for (const key of Object.keys(raw)) {
      const safe = key.trim() && !['__proto__', 'prototype', 'constructor', '_rowId'].includes(key.trim())
        ? key.trim()
        : '';
      if (safe && !seen.has(safe)) {
        seen.add(safe);
        headers.push(safe);
      }
    }
  }
  if (headers.length === 0) throw new Error('No usable column names were found in the imported file.');
  if (headers.length > MAX_IMPORT_COLUMNS) {
    throw new Error(`This import contains more than ${MAX_IMPORT_COLUMNS} columns. Reduce the number of fields and try again.`);
  }

  const columns: DataColumn[] = headers.map((header, idx) => {
    const values = jsonRows.map((row) => row[header]).filter((value) => value !== '' && value !== null && value !== undefined);
    const isNum = values.length > 0 && values.every((value) =>
      typeof value === 'number' ||
      (typeof value === 'string' && /^-?\\d+(\\.\\d+)?$/.test(value.trim()))
    );
    return {
      id: `col-${idx}-${Math.random().toString(36).slice(2, 6)}`,
      name: header,
      type: isNum ? 'number' : 'text',
      required: false,
    };
  });

  const rows: DataRow[] = jsonRows.map((raw, idx) => {
    const row: DataRow = {
      _rowId: `row-${idx}-${Math.random().toString(36).slice(2, 6)}`,
    };
    for (const header of headers) {
      const value = raw[header];
      row[header] = value === null || value === undefined ? ''
        : typeof value === 'string' || typeof value === 'number' ? value
        : typeof value === 'boolean' ? String(value)
        : JSON.stringify(value);
    }
    return row;
  });

  return { columns, rows };
}

export function exportRowsToCsv(
  columns: DataColumn[],
  rows: DataRow[],
  fileName: string
): void {
  const exportData = rows.map((row) => {
    const out: Record<string, string | number> = {};
    for (const col of columns) {
      out[col.name] = formatCellValue(row[col.name], col, row, columns);
    }
    return out;
  });

  const ws = XLSX.utils.json_to_sheet(exportData);
  const csv = XLSX.utils.sheet_to_csv(ws);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  triggerBlobDownload(
    blob,
    fileName.endsWith('.csv') ? fileName : `${fileName}.csv`
  );
}
