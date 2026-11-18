import * as XLSX from 'xlsx';
import { DataColumn, DataRow } from '../types/pdfStudio';

export function formatCellValue(
  rawValue: string | number | undefined,
  column: DataColumn,
  row: DataRow,
  allColumns: DataColumn[]
): string {
  if (column.type === 'formula') {
    return evaluateFormula(column.formula || String(rawValue || ''), row, allColumns);
  }
  if (rawValue === undefined || rawValue === null || rawValue === '') return '';

  if (column.type === 'currency') {
    const num = Number(String(rawValue).replace(/[^0-9.-]/g, ''));
    if (!Number.isFinite(num)) return String(rawValue);
    const sym = column.currencySymbol || '$';
    return `${sym}${num.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  if (column.type === 'number') {
    const num = Number(rawValue);
    return Number.isFinite(num) ? num.toLocaleString('en-US') : String(rawValue);
  }

  if (column.type === 'date') {
    const parsed = new Date(String(rawValue));
    if (Number.isNaN(parsed.getTime())) return String(rawValue);
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    switch (column.dateFormat) {
      case 'MM/DD/YYYY':
        return `${m}/${d}/${y}`;
      case 'DD/MM/YYYY':
        return `${d}/${m}/${y}`;
      case 'MMM D, YYYY':
        return parsed.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        });
      case 'YYYY-MM-DD':
      default:
        return `${y}-${m}-${d}`;
    }
  }

  return String(rawValue);
}

export function evaluateFormula(
  formulaInput: string,
  row: DataRow,
  columns: DataColumn[]
): string {
  const exprRaw = formulaInput.trim();
  if (!exprRaw.startsWith('=')) return exprRaw;
  let expr = exprRaw.slice(1).trim();

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

export async function parseSpreadsheetFile(file: File): Promise<{
  columns: DataColumn[];
  rows: DataRow[];
}> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) {
    throw new Error('Spreadsheet contains no sheets.');
  }
  const worksheet = workbook.Sheets[firstSheet];
  const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    defval: '',
  });

  if (jsonRows.length === 0) {
    throw new Error('Spreadsheet contains no data rows.');
  }

  const headers = Object.keys(jsonRows[0]);
  const columns: DataColumn[] = headers.map((header, idx) => {
    const sample = jsonRows[0][header];
    const isNum =
      typeof sample === 'number' ||
      (typeof sample === 'string' && /^-?\d+(\.\d+)?$/.test(sample.trim()));
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
    for (const h of headers) {
      const val = raw[h];
      row[h] =
        typeof val === 'number' || typeof val === 'string'
          ? val
          : String(val ?? '');
    }
    return row;
  });

  return { columns, rows };
}

export function exportRowsToCsv(columns: DataColumn[], rows: DataRow[], fileName: string): void {
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
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName.endsWith('.csv') ? fileName : `${fileName}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
