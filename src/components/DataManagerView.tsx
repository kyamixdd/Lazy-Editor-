import React, { useRef, useState } from 'react';
import {
  Download,
  LayoutGrid,
  Plus,
  Search,
  Table,
  Trash2,
  Upload,
} from 'lucide-react';
import { DataColumn, DataRow, PDFProject } from '../types/pdfStudio';
import { useViewport } from '../hooks/useViewport';
import {
  exportRowsToCsv,
  formatCellValue,
  parseSpreadsheetFile,
} from '../utils/dataFormulaEngine';

interface DataManagerViewProps {
  project: PDFProject;
  onUpdateProject: (updated: PDFProject) => void;
}

export const DataManagerView: React.FC<DataManagerViewProps> = ({
  project,
  onUpdateProject,
}) => {
  const viewport = useViewport();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [newColName, setNewColName] = useState('');
  const [newColType, setNewColType] = useState<DataColumn['type']>('text');
  const [newColFormula, setNewColFormula] = useState('=qty * unit_price');
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [mobileViewMode, setMobileViewMode] = useState<'cards' | 'table'>('cards');

  const { dataColumns, dataRows } = project;

  const commitData = (cols: DataColumn[], rows: DataRow[]) => {
    onUpdateProject({
      ...project,
      dataColumns: cols,
      dataRows: rows,
      updatedAt: new Date().toISOString(),
    });
  };

  const handleAddColumn = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newColName.trim().replace(/\s+/g, '_');
    if (!clean || dataColumns.some((c) => c.name === clean)) return;
    const col: DataColumn = {
      id: `col-${Date.now()}`,
      name: clean,
      type: newColType,
      currencySymbol: newColType === 'currency' ? '$' : undefined,
      dateFormat: newColType === 'date' ? 'YYYY-MM-DD' : undefined,
      formula: newColType === 'formula' ? newColFormula : undefined,
    };
    const updatedRows = dataRows.map((r) => ({ ...r, [clean]: '' }));
    commitData([...dataColumns, col], updatedRows);
    setNewColName('');
  };

  const handleAddRow = () => {
    const row: DataRow = {
      _rowId: `row-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    };
    dataColumns.forEach((c) => {
      row[c.name] = '';
    });
    commitData(dataColumns, [...dataRows, row]);
  };

  const handleGenerateNumberedRows = (count = 20) => {
    const startIdx = dataRows.length + 1;
    const generated: DataRow[] = [];
    for (let i = 0; i < count; i++) {
      const row: DataRow = {
        _rowId: `row-${Date.now()}-${i}`,
      };
      dataColumns.forEach((c) => {
        if (c.type === 'number') row[c.name] = startIdx + i;
        else if (c.type === 'currency') row[c.name] = 100 + i * 10;
        else if (c.type === 'date') row[c.name] = new Date().toISOString().slice(0, 10);
        else row[c.name] = `Record ${String(startIdx + i).padStart(4, '0')}`;
      });
      generated.push(row);
    }
    commitData(dataColumns, [...dataRows, ...generated]);
  };

  const handleImportFile = async (file: File | undefined) => {
    if (!file) return;
    setImportError(null);
    try {
      const parsed = await parseSpreadsheetFile(file);
      commitData(parsed.columns, parsed.rows);
    } catch (err) {
      setImportError(
        err instanceof Error ? err.message : 'Failed to parse spreadsheet'
      );
    }
  };

  const handleFindReplace = () => {
    if (!findText) return;
    const nextRows = dataRows.map((row) => {
      const updated = { ...row };
      dataColumns.forEach((col) => {
        const val = String(updated[col.name] ?? '');
        if (val.includes(findText)) {
          updated[col.name] = val.split(findText).join(replaceText);
        }
      });
      return updated;
    });
    commitData(dataColumns, nextRows);
  };

  const detectedFieldKeys = project.elements
    .map((e) => e.fieldKey)
    .filter((k): k is string => Boolean(k));

  return (
    <div className="flex-1 overflow-y-auto p-4 tablet:p-6 desktop:p-8 max-w-7xl mx-auto w-full space-y-5 tablet:space-y-6">
      {/* Header */}
      <div className="flex flex-col tablet:flex-row tablet:items-center tablet:justify-between gap-4 pb-5 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h1 className="text-xl tablet:text-2xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Data Manager
          </h1>
          <p className="mt-1 text-xs tablet:text-sm text-slate-600 dark:text-slate-400">
            Manage dynamic bulk records, import Excel or CSV sheets, evaluate formulas, and map columns to template fields.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => void handleImportFile(e.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="min-h-[44px] tablet:min-h-0 px-3 py-2 rounded-md text-xs font-medium border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1.5 whitespace-nowrap touch-manipulation"
          >
            <Upload className="w-3.5 h-3.5" />
            Import Excel / CSV
          </button>
          <button
            type="button"
            onClick={() => exportRowsToCsv(dataColumns, dataRows, project.name)}
            className="min-h-[44px] tablet:min-h-0 px-3 py-2 rounded-md text-xs font-medium border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1.5 whitespace-nowrap touch-manipulation"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => handleGenerateNumberedRows(10)}
            className="min-h-[44px] tablet:min-h-0 px-3 py-2 rounded-md text-xs font-medium border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap touch-manipulation"
          >
            +10 Auto Rows
          </button>
          <button
            type="button"
            onClick={handleAddRow}
            className="min-h-[44px] tablet:min-h-0 px-3.5 py-2 rounded-md text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 flex items-center gap-1.5 whitespace-nowrap touch-manipulation"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Row
          </button>
        </div>
      </div>

      {importError && (
        <div className="p-3 rounded-md border border-red-500/40 bg-red-500/10 text-xs text-red-600 dark:text-red-300">
          {importError}
        </div>
      )}

      {/* Toolbar: Add Custom Field & Bulk Find/Replace */}
      <div className="grid grid-cols-1 desktop:grid-cols-2 gap-4">
        <form
          onSubmit={handleAddColumn}
          className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] flex flex-wrap items-end gap-2.5 text-xs"
        >
          <label className="flex-1 min-w-[140px]">
            <span className="text-[11px] text-slate-500">New Column Key</span>
            <input
              type="text"
              placeholder="e.g. customer_name"
              value={newColName}
              onChange={(e) => setNewColName(e.target.value)}
              className="mt-1 w-full min-h-[42px] tablet:min-h-0 px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-transparent"
            />
          </label>
          <label className="w-32">
            <span className="text-[11px] text-slate-500">Format</span>
            <select
              value={newColType}
              onChange={(e) =>
                setNewColType(e.target.value as DataColumn['type'])
              }
              className="mt-1 w-full min-h-[42px] tablet:min-h-0 px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0E131D]"
            >
              <option value="text">Text</option>
              <option value="number">Number</option>
              <option value="currency">Currency</option>
              <option value="date">Date</option>
              <option value="formula">Formula</option>
            </select>
          </label>
          {newColType === 'formula' && (
            <label className="w-full tablet:w-40">
              <span className="text-[11px] text-slate-500">Formula</span>
              <input
                type="text"
                value={newColFormula}
                onChange={(e) => setNewColFormula(e.target.value)}
                className="mt-1 w-full min-h-[42px] tablet:min-h-0 px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-transparent font-mono"
              />
            </label>
          )}
          <button
            type="submit"
            className="min-h-[42px] tablet:min-h-0 px-3.5 py-1.5 rounded bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-medium hover:opacity-90 whitespace-nowrap touch-manipulation"
          >
            Add Field
          </button>
        </form>

        <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] flex flex-wrap items-end gap-2.5 text-xs">
          <label className="flex-1 min-w-[120px]">
            <span className="text-[11px] text-slate-500">Bulk Find</span>
            <input
              type="text"
              placeholder="Search value..."
              value={findText}
              onChange={(e) => setFindText(e.target.value)}
              className="mt-1 w-full min-h-[42px] tablet:min-h-0 px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-transparent"
            />
          </label>
          <label className="flex-1 min-w-[120px]">
            <span className="text-[11px] text-slate-500">Replace With</span>
            <input
              type="text"
              placeholder="Replacement..."
              value={replaceText}
              onChange={(e) => setReplaceText(e.target.value)}
              className="mt-1 w-full min-h-[42px] tablet:min-h-0 px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-transparent"
            />
          </label>
          <button
            type="button"
            onClick={handleFindReplace}
            className="min-h-[42px] tablet:min-h-0 px-3.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium flex items-center gap-1.5 whitespace-nowrap touch-manipulation"
          >
            <Search className="w-3.5 h-3.5" />
            Replace All
          </button>
        </div>
      </div>

      {/* Mobile Cards / Table Switcher */}
      {viewport.isMobile && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-500 dark:text-slate-400 tabular-nums">
            {dataRows.length} records · {dataColumns.length} fields
          </span>
          <div className="inline-flex rounded-md border border-slate-300 dark:border-slate-700 overflow-hidden">
            <button
              type="button"
              onClick={() => setMobileViewMode('cards')}
              className={`min-h-[36px] px-2.5 py-1 flex items-center gap-1 font-medium ${
                mobileViewMode === 'cards'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-[#111827] text-slate-600 dark:text-slate-300'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              Cards
            </button>
            <button
              type="button"
              onClick={() => setMobileViewMode('table')}
              className={`min-h-[36px] px-2.5 py-1 flex items-center gap-1 font-medium ${
                mobileViewMode === 'table'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-[#111827] text-slate-600 dark:text-slate-300'
              }`}
            >
              <Table className="w-3.5 h-3.5" />
              Sheet
            </button>
          </div>
        </div>
      )}

      {/* Mobile Cards View */}
      {viewport.isMobile && mobileViewMode === 'cards' ? (
        <div className="space-y-3">
          {dataRows.map((row, rIdx) => (
            <div
              key={row._rowId}
              className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-3 text-xs"
            >
              <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
                <span className="font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                  Record #{rIdx + 1}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    commitData(
                      dataColumns,
                      dataRows.filter((r) => r._rowId !== row._rowId)
                    )
                  }
                  className="min-h-[36px] px-2.5 py-1 rounded text-red-500 hover:bg-red-500/10 flex items-center gap-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete
                </button>
              </div>
              <div className="grid grid-cols-1 gap-2.5">
                {dataColumns.map((col) => {
                  const isFormula = col.type === 'formula';
                  const isMapped = detectedFieldKeys.includes(col.name);
                  const displayVal = isFormula
                    ? formatCellValue(row[col.name], col, row, dataColumns)
                    : String(row[col.name] ?? '');
                  return (
                    <label key={col.id} className="block">
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between">
                        <span>{col.name}</span>
                        <span className="text-[10px]">
                          {col.type}
                          {isMapped ? ' · Mapped' : ''}
                        </span>
                      </span>
                      {isFormula ? (
                        <div className="mt-1 px-3 py-2.5 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0E131D] font-mono tabular-nums">
                          {displayVal}
                        </div>
                      ) : (
                        <input
                          type="text"
                          value={String(row[col.name] ?? '')}
                          onChange={(e) => {
                            const next = dataRows.map((r) =>
                              r._rowId === row._rowId
                                ? { ...r, [col.name]: e.target.value }
                                : r
                            );
                            commitData(dataColumns, next);
                          }}
                          className="mt-1 w-full min-h-[44px] px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-transparent"
                        />
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0E131D]">
                <th className="py-2.5 px-3 w-12 text-center text-slate-500 tabular-nums">
                  #
                </th>
                {dataColumns.map((col) => {
                  const isMapped = detectedFieldKeys.includes(col.name);
                  return (
                    <th key={col.id} className="py-2.5 px-3 min-w-[160px]">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="font-semibold text-slate-900 dark:text-slate-100">
                            {col.name}
                          </div>
                          <div className="text-[10px] font-normal text-slate-500">
                            {col.type}
                            {isMapped ? ' · Mapped to PDF' : ''}
                          </div>
                        </div>
                        <button
                          type="button"
                          title="Delete column"
                          onClick={() =>
                            commitData(
                              dataColumns.filter((c) => c.id !== col.id),
                              dataRows
                            )
                          }
                          className="p-1 text-slate-400 hover:text-red-500"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </th>
                  );
                })}
                <th className="py-2.5 px-3 w-12" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800/80">
              {dataRows.map((row, rIdx) => (
                <tr
                  key={row._rowId}
                  className="hover:bg-slate-50 dark:hover:bg-slate-800/30"
                >
                  <td className="py-1.5 px-3 text-center text-slate-400 tabular-nums">
                    {rIdx + 1}
                  </td>
                  {dataColumns.map((col) => {
                    const isFormula = col.type === 'formula';
                    const displayVal = isFormula
                      ? formatCellValue(row[col.name], col, row, dataColumns)
                      : String(row[col.name] ?? '');

                    return (
                      <td
                        key={col.id}
                        className="p-0 border-r border-slate-100 dark:border-slate-800/50"
                      >
                        {isFormula ? (
                          <div className="px-3 py-2 font-mono text-slate-600 dark:text-slate-300 tabular-nums">
                            {displayVal}
                          </div>
                        ) : (
                          <input
                            type="text"
                            value={String(row[col.name] ?? '')}
                            onChange={(e) => {
                              const next = dataRows.map((r) =>
                                r._rowId === row._rowId
                                  ? { ...r, [col.name]: e.target.value }
                                  : r
                              );
                              commitData(dataColumns, next);
                            }}
                            className={`w-full px-3 py-2 bg-transparent focus:outline-none focus:bg-blue-500/10 ${
                              col.type === 'number' || col.type === 'currency'
                                ? 'text-right tabular-nums'
                                : ''
                            }`}
                          />
                        )}
                      </td>
                    );
                  })}
                  <td className="py-1.5 px-2 text-center">
                    <button
                      type="button"
                      onClick={() =>
                        commitData(
                          dataColumns,
                          dataRows.filter((r) => r._rowId !== row._rowId)
                        )
                      }
                      className="p-1 text-slate-400 hover:text-red-500"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      )}
    </div>
  );
};
