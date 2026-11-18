import React, { useId, useMemo, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  LayoutGrid,
  Link2,
  Plus,
  Search,
  SlidersHorizontal,
  Table,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  bannerVariants,
  MOTION_SPRING,
  popoverVariants,
} from '../config/motionSystem';
import {
  ConditionalFieldRule,
  DataColumn,
  DataRow,
  DocumentElement,
  PDFProject,
} from '../types/pdfStudio';
import { useViewport } from '../hooks/useViewport';
import {
  analyzeDataQuality,
  exportRowsToCsv,
  formatCellValue,
  parseSpreadsheetFile,
} from '../utils/dataFormulaEngine';
import { GlassButton, GlassCard } from './glass';

interface DataManagerViewProps {
  project: PDFProject;
  onUpdateProject: (updated: PDFProject) => void;
}

const PAGE_SIZE = 50;

export const DataManagerView: React.FC<DataManagerViewProps> = ({
  project,
  onUpdateProject,
}) => {
  const shouldReduceMotion = useReducedMotion();
  const filterGroupId = useId();
  const mobileSwitchId = useId();
  const viewport = useViewport();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [newColName, setNewColName] = useState('');
  const [newColType, setNewColType] = useState<DataColumn['type']>('text');
  const [newColFormula, setNewColFormula] = useState('=qty * unit_price');
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [rowSearch, setRowSearch] = useState('');
  const [qualityFilter, setQualityFilter] = useState<'all' | 'duplicates' | 'missing'>('all');
  const [duplicateKeyCols, setDuplicateKeyCols] = useState<string[]>(() =>
    project.dataColumns[0] ? [project.dataColumns[0].name] : []
  );
  const [currentPage, setCurrentPage] = useState(1);
  const [editingColId, setEditingColId] = useState<string | null>(null);
  const [showMappingPanel, setShowMappingPanel] = useState(false);
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
      numberDecimals: newColType === 'number' ? 0 : undefined,
      formula: newColType === 'formula' ? newColFormula : undefined,
      required: false,
      conditionRules: [],
    };
    const updatedRows = dataRows.map((r) => ({ ...r, [clean]: '' }));
    commitData([...dataColumns, col], updatedRows);
    if (duplicateKeyCols.length === 0) setDuplicateKeyCols([clean]);
    setNewColName('');
  };

  const handleUpdateColumn = (colId: string, patch: Partial<DataColumn>) => {
    commitData(
      dataColumns.map((c) => (c.id === colId ? { ...c, ...patch } : c)),
      dataRows
    );
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
        _rowId: `row-${Date.now()}-${startIdx + i}-${Math.random().toString(36).slice(2, 5)}`,
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
      if (parsed.columns[0]) setDuplicateKeyCols([parsed.columns[0].name]);
      setCurrentPage(1);
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

  const detectedFieldKeys = useMemo(
    () =>
      project.elements
        .map((e) => e.fieldKey)
        .filter((k): k is string => Boolean(k)),
    [project.elements]
  );

  const mappableElements = useMemo(
    () =>
      project.elements.filter(
        (e) =>
          e.visible &&
          e.type !== 'border' &&
          e.type !== 'shape' &&
          e.type !== 'line' &&
          e.type !== 'repeated_block'
      ),
    [project.elements]
  );

  const handleMapElementField = (el: DocumentElement, columnName: string) => {
    onUpdateProject({
      ...project,
      elements: project.elements.map((item) =>
        item.id === el.id
          ? { ...item, fieldKey: columnName || undefined }
          : item
      ),
      updatedAt: new Date().toISOString(),
    });
  };

  const qualityReport = useMemo(
    () =>
      analyzeDataQuality(
        dataColumns,
        dataRows,
        duplicateKeyCols.filter((k) => dataColumns.some((c) => c.name === k)),
        detectedFieldKeys
      ),
    [dataColumns, dataRows, duplicateKeyCols, detectedFieldKeys]
  );

  const duplicateRowIdSet = useMemo(() => {
    const s = new Set<string>();
    for (const d of qualityReport.duplicates) {
      d.rowIds.forEach((id) => s.add(id));
    }
    return s;
  }, [qualityReport.duplicates]);

  const missingCellKeySet = useMemo(() => {
    const s = new Set<string>();
    for (const m of qualityReport.missingValues) {
      s.add(`${m.rowId}::${m.columnName}`);
    }
    return s;
  }, [qualityReport.missingValues]);

  const missingRowIdSet = useMemo(() => {
    const s = new Set<string>();
    for (const m of qualityReport.missingValues) {
      s.add(m.rowId);
    }
    return s;
  }, [qualityReport.missingValues]);

  const filteredIndexedRows = useMemo(() => {
    const q = rowSearch.trim().toLowerCase();
    const list: Array<{ row: DataRow; originalIndex: number }> = [];
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      if (qualityFilter === 'duplicates' && !duplicateRowIdSet.has(row._rowId)) {
        continue;
      }
      if (qualityFilter === 'missing' && !missingRowIdSet.has(row._rowId)) {
        continue;
      }
      if (q) {
        const hit = dataColumns.some((c) =>
          String(row[c.name] ?? '')
            .toLowerCase()
            .includes(q)
        );
        if (!hit) continue;
      }
      list.push({ row, originalIndex: i });
    }
    return list;
  }, [
    dataRows,
    dataColumns,
    rowSearch,
    qualityFilter,
    duplicateRowIdSet,
    missingRowIdSet,
  ]);

  const totalPages = Math.max(1, Math.ceil(filteredIndexedRows.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const pagedRows = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredIndexedRows.slice(start, start + PAGE_SIZE);
  }, [filteredIndexedRows, safePage]);

  const editingColumn =
    dataColumns.find((c) => c.id === editingColId) || null;

  return (
    <div className="flex-1 overflow-y-auto p-4 tablet:p-6 desktop:p-8 max-w-7xl mx-auto w-full space-y-5 tablet:space-y-6">
      {/* Header */}
      <div className="flex flex-col tablet:flex-row tablet:items-center tablet:justify-between gap-4 pb-5 border-b border-black/10 dark:border-white/12">
        <div>
          <h1 className="text-xl tablet:text-2xl font-display font-semibold tracking-tight text-[#101010] dark:text-white">
            Data Manager
          </h1>
          <p className="mt-1 text-xs tablet:text-sm text-[#555555] dark:text-[#B5B5B5]">
            Manage thousands of merge records, import Excel/CSV sheets, configure formulas & conditional fields, detect duplicates/missing values, and map columns to PDF elements.
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
          <GlassButton
            variant="glass"
            size="md"
            active={showMappingPanel}
            onClick={() => setShowMappingPanel((v) => !v)}
          >
            <Link2 className="w-3.5 h-3.5" />
            Field Mapping ({detectedFieldKeys.length})
          </GlassButton>
          <GlassButton
            variant="glass"
            size="md"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="w-3.5 h-3.5" />
            Import Excel / CSV
          </GlassButton>
          <GlassButton
            variant="glass"
            size="md"
            onClick={() => exportRowsToCsv(dataColumns, dataRows, project.name)}
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </GlassButton>
          <GlassButton
            variant="glass"
            size="md"
            onClick={() => handleGenerateNumberedRows(10)}
          >
            +10 Rows
          </GlassButton>
          <GlassButton
            variant="glass"
            size="md"
            onClick={() => handleGenerateNumberedRows(1000)}
          >
            +1,000 Rows
          </GlassButton>
          <GlassButton variant="primary" size="md" onClick={handleAddRow}>
            <Plus className="w-3.5 h-3.5" />
            Add Row
          </GlassButton>
        </div>
      </div>

      <AnimatePresence>
        {importError && (
          <motion.div
            key="data-import-error"
            variants={bannerVariants}
            initial={shouldReduceMotion ? false : 'initial'}
            animate="animate"
            exit="exit"
            className="p-3 rounded-xl border border-red-500/40 bg-red-500/10 text-xs text-red-700 dark:text-red-300"
          >
            {importError}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Field Mapping Matrix Drawer (Connect any data column to any editable PDF field) */}
      <AnimatePresence>
        {showMappingPanel && (
          <motion.div
            key="mapping-panel"
            variants={popoverVariants}
            initial={shouldReduceMotion ? false : 'initial'}
            animate="animate"
            exit="exit"
          >
            <GlassCard level={3} padding="md" className="border-black/20 dark:border-white/20 space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-[#101010] dark:text-white">
                    PDF Template Field Mapping Matrix
                  </h2>
                  <p className="text-[11px] text-[#555555] dark:text-[#B5B5B5]">
                    Connect any column in your dataset to any editable PDF template element. Values update dynamically during bulk generation & preview.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowMappingPanel(false)}
                  className="p-1 text-[#888888] hover:text-[#101010] dark:hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              {mappableElements.length === 0 ? (
                <p className="text-[#555555] dark:text-[#B5B5B5]">
                  No editable text/field elements detected on this template yet. Add text blocks in PDF Editor.
                </p>
              ) : (
                <div className="grid grid-cols-1 tablet:grid-cols-2 desktop:grid-cols-3 gap-2.5 max-h-64 overflow-y-auto">
                  {mappableElements.map((el) => {
                    const matchedCol = dataColumns.find((c) => c.name === el.fieldKey);
                    const sampleRow = dataRows[0];
                    const samplePreview =
                      matchedCol && sampleRow
                        ? formatCellValue(
                            sampleRow[matchedCol.name],
                            matchedCol,
                            sampleRow,
                            dataColumns
                          )
                        : null;
                    return (
                      <div
                        key={el.id}
                        className="p-2.5 rounded-xl border border-black/10 dark:border-white/12 glass-level-2 space-y-1.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-[#101010] dark:text-white truncate">
                            {el.text || el.type}
                          </span>
                          <span className="text-[10px] text-[#888888] dark:text-[#858585] shrink-0 tabular-nums">
                            P{el.pageNumber} · {el.type}
                          </span>
                        </div>
                        <select
                          value={el.fieldKey || ''}
                          onChange={(e) => handleMapElementField(el, e.target.value)}
                          className="w-full px-2 py-1 rounded-lg studio-select text-xs"
                        >
                          <option value="">-- Unmapped (Static) --</option>
                          {dataColumns.map((col) => (
                            <option key={col.id} value={col.name}>
                              {col.name} ({col.type})
                            </option>
                          ))}
                        </select>
                        {samplePreview !== null && (
                          <div className="text-[10px] text-[#101010] dark:text-white truncate font-mono font-medium">
                            Row 1 preview: {samplePreview || '(empty)'}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Column Rules, Formatting & Conditional Field Drawer */}
      <AnimatePresence>
        {editingColumn && (
          <motion.div
            key={`col-rules-${editingColumn.id}`}
            variants={popoverVariants}
            initial={shouldReduceMotion ? false : 'initial'}
            animate="animate"
            exit="exit"
          >
            <GlassCard level={3} padding="md" className="space-y-4 text-xs">
          <div className="flex items-center justify-between border-b border-black/10 dark:border-white/10 pb-2.5">
            <div>
              <h2 className="text-sm font-semibold text-[#101010] dark:text-white">
                Column Rules & Conditional Formatting · {editingColumn.name}
              </h2>
              <p className="text-[11px] text-[#555555] dark:text-[#B5B5B5]">
                Configure number decimals, currency symbols, date formatting, formulas (=IF, =SUM, =CONCAT), required checks, and conditional field overrides.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setEditingColId(null)}
              className="p-1 text-[#888888] hover:text-[#101010] dark:hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 tablet:grid-cols-4 gap-3">
            <label className="block">
              <span className="text-[11px] text-[#888888] dark:text-[#858585]">Column Type</span>
              <select
                value={editingColumn.type}
                onChange={(e) =>
                  handleUpdateColumn(editingColumn.id, {
                    type: e.target.value as DataColumn['type'],
                  })
                }
                className="mt-1 w-full px-2 py-1.5 rounded-xl studio-select"
              >
                <option value="text">Text</option>
                <option value="number">Number</option>
                <option value="currency">Currency</option>
                <option value="date">Date</option>
                <option value="formula">Formula</option>
              </select>
            </label>

            {editingColumn.type === 'currency' && (
              <label className="block">
                <span className="text-[11px] text-[#888888] dark:text-[#858585]">Currency Symbol</span>
                <input
                  type="text"
                  value={editingColumn.currencySymbol || '$'}
                  onChange={(e) =>
                    handleUpdateColumn(editingColumn.id, {
                      currencySymbol: e.target.value,
                    })
                  }
                  className="mt-1 w-full px-2 py-1.5 rounded-xl studio-input"
                />
              </label>
            )}

            {editingColumn.type === 'number' && (
              <label className="block">
                <span className="text-[11px] text-[#888888] dark:text-[#858585]">Decimal Places</span>
                <input
                  type="number"
                  min={0}
                  max={6}
                  value={editingColumn.numberDecimals ?? 0}
                  onChange={(e) =>
                    handleUpdateColumn(editingColumn.id, {
                      numberDecimals: Math.max(0, Math.min(6, Number(e.target.value) || 0)),
                    })
                  }
                  className="mt-1 w-full px-2 py-1.5 rounded-xl studio-input tabular-nums"
                />
              </label>
            )}

            {editingColumn.type === 'date' && (
              <label className="block">
                <span className="text-[11px] text-[#888888] dark:text-[#858585]">Date Format</span>
                <select
                  value={editingColumn.dateFormat || 'YYYY-MM-DD'}
                  onChange={(e) =>
                    handleUpdateColumn(editingColumn.id, {
                      dateFormat: e.target.value as DataColumn['dateFormat'],
                    })
                  }
                  className="mt-1 w-full px-2 py-1.5 rounded-xl studio-select"
                >
                  <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                  <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                  <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                  <option value="MMM D, YYYY">MMM D, YYYY</option>
                </select>
              </label>
            )}

            {editingColumn.type === 'formula' && (
              <label className="tablet:col-span-2 block">
                <span className="text-[11px] text-[#888888] dark:text-[#858585]">
                  Formula Expression (=IF(amount &gt; 500, &quot;VIP&quot;, &quot;Standard&quot;) or =qty * price)
                </span>
                <input
                  type="text"
                  value={editingColumn.formula || ''}
                  onChange={(e) =>
                    handleUpdateColumn(editingColumn.id, {
                      formula: e.target.value,
                    })
                  }
                  className="mt-1 w-full px-2 py-1.5 rounded-xl studio-input font-mono"
                />
              </label>
            )}

            <label className="flex items-center gap-2 pt-4 cursor-pointer text-[#101010] dark:text-white">
              <input
                type="checkbox"
                checked={Boolean(editingColumn.required)}
                onChange={(e) =>
                  handleUpdateColumn(editingColumn.id, {
                    required: e.target.checked,
                  })
                }
                className="rounded border-black/30 dark:border-white/30 accent-[#101010] dark:accent-white"
              />
              <span>Required (flag empty cells)</span>
            </label>
          </div>

          {/* Conditional Rules */}
          <div className="pt-3 border-t border-black/10 dark:border-white/10 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[#555555] dark:text-[#B5B5B5]">
                Conditional Output Rules ({editingColumn.conditionRules?.length || 0})
              </span>
              <button
                type="button"
                onClick={() => {
                  const newRule: ConditionalFieldRule = {
                    id: `cond-${Date.now()}`,
                    whenColumn: editingColumn.name,
                    operator: 'is_empty',
                    compareValue: '',
                    thenValue: 'N/A',
                    elseValue: '',
                  };
                  handleUpdateColumn(editingColumn.id, {
                    conditionRules: [
                      ...(editingColumn.conditionRules || []),
                      newRule,
                    ],
                  });
                }}
                className="px-2.5 py-1 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/[0.04] dark:hover:bg-white/[0.08] text-[#101010] dark:text-white font-medium flex items-center gap-1"
              >
                <Plus className="w-3 h-3" />
                Add Condition Rule
              </button>
            </div>
            {(editingColumn.conditionRules || []).map((rule, rIdx) => (
              <div
                key={rule.id}
                className="grid grid-cols-1 tablet:grid-cols-6 gap-2 items-center p-2 rounded-xl border border-black/10 dark:border-white/10"
              >
                <select
                  value={rule.whenColumn}
                  onChange={(e) => {
                    const next = [...(editingColumn.conditionRules || [])];
                    next[rIdx] = { ...rule, whenColumn: e.target.value };
                    handleUpdateColumn(editingColumn.id, { conditionRules: next });
                  }}
                  className="px-2 py-1 rounded-lg studio-select"
                >
                  {dataColumns.map((c) => (
                    <option key={c.id} value={c.name}>
                      When {c.name}
                    </option>
                  ))}
                </select>
                <select
                  value={rule.operator}
                  onChange={(e) => {
                    const next = [...(editingColumn.conditionRules || [])];
                    next[rIdx] = {
                      ...rule,
                      operator: e.target.value as ConditionalFieldRule['operator'],
                    };
                    handleUpdateColumn(editingColumn.id, { conditionRules: next });
                  }}
                  className="px-2 py-1 rounded-lg studio-select"
                >
                  <option value="is_empty">is empty</option>
                  <option value="not_empty">not empty</option>
                  <option value="equals">equals</option>
                  <option value="not_equals">not equals</option>
                  <option value="contains">contains</option>
                  <option value="gt">&gt; greater than</option>
                  <option value="lt">&lt; less than</option>
                </select>
                <input
                  type="text"
                  placeholder="Compare value"
                  value={rule.compareValue}
                  onChange={(e) => {
                    const next = [...(editingColumn.conditionRules || [])];
                    next[rIdx] = { ...rule, compareValue: e.target.value };
                    handleUpdateColumn(editingColumn.id, { conditionRules: next });
                  }}
                  className="px-2 py-1 rounded-lg studio-input"
                />
                <input
                  type="text"
                  placeholder="Then output ({VALUE})"
                  value={rule.thenValue}
                  onChange={(e) => {
                    const next = [...(editingColumn.conditionRules || [])];
                    next[rIdx] = { ...rule, thenValue: e.target.value };
                    handleUpdateColumn(editingColumn.id, { conditionRules: next });
                  }}
                  className="px-2 py-1 rounded-lg studio-input"
                />
                <input
                  type="text"
                  placeholder="Else (optional)"
                  value={rule.elseValue || ''}
                  onChange={(e) => {
                    const next = [...(editingColumn.conditionRules || [])];
                    next[rIdx] = { ...rule, elseValue: e.target.value };
                    handleUpdateColumn(editingColumn.id, { conditionRules: next });
                  }}
                  className="px-2 py-1 rounded-lg studio-input"
                />
                <button
                  type="button"
                  onClick={() => {
                    const next = (editingColumn.conditionRules || []).filter(
                      (x) => x.id !== rule.id
                    );
                    handleUpdateColumn(editingColumn.id, { conditionRules: next });
                  }}
                  className="p-1 text-[#888888] hover:text-[#101010] dark:hover:text-white hover:bg-black/[0.05] dark:hover:bg-white/[0.08] rounded-lg justify-self-end"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Data Quality Banner: Duplicate Record & Missing Value Detection */}
      <GlassCard level={3} padding="sm" className="flex flex-col desktop:flex-row desktop:items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-3">
          {qualityReport.totalIssues === 0 ? (
            <span className="text-[#101010] dark:text-white font-medium flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" />
              Data hygiene clean ({dataRows.length.toLocaleString()} rows checked)
            </span>
          ) : (
            <span className="text-amber-600 dark:text-amber-400 font-medium flex items-center gap-1.5 tabular-nums">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {qualityReport.duplicates.length} duplicate group(s) ·{' '}
              {qualityReport.missingValues.length} missing value(s)
            </span>
          )}

          <div className="flex items-center gap-1.5 text-[11px] text-[#888888] dark:text-[#858585]">
            <span>Dup key:</span>
            <select
              value={duplicateKeyCols[0] || ''}
              onChange={(e) =>
                setDuplicateKeyCols(e.target.value ? [e.target.value] : [])
              }
              className="px-2 py-1 rounded-lg studio-select text-xs"
            >
              <option value="">None</option>
              {dataColumns.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <LayoutGroup id={`data-filter-${filterGroupId}`}>
            <div className="inline-flex rounded-xl border border-black/15 dark:border-white/15 overflow-hidden p-0.5 glass-level-2">
              {(
                [
                  ['all', `All (${dataRows.length})`],
                  ['duplicates', `Duplicates (${duplicateRowIdSet.size})`],
                  ['missing', `Missing (${missingRowIdSet.size})`],
                ] as const
              ).map(([k, lbl]) => {
                const active = qualityFilter === k;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => {
                      setQualityFilter(k);
                      setCurrentPage(1);
                    }}
                    className={`relative px-2.5 py-1 rounded-lg font-medium tabular-nums transition-colors ${
                      active
                        ? 'text-white dark:text-[#050505]'
                        : 'text-[#555555] dark:text-[#B5B5B5] hover:text-[#101010] dark:hover:text-white'
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId={`data-filter-pill-${filterGroupId}`}
                        transition={shouldReduceMotion ? { duration: 0.08 } : MOTION_SPRING.nav}
                        className="absolute inset-0 rounded-lg bg-[#101010] dark:bg-white shadow-sm"
                      />
                    )}
                    <span className="relative z-10">{lbl}</span>
                  </button>
                );
              })}
            </div>
          </LayoutGroup>

          <input
            type="text"
            placeholder="Filter rows..."
            value={rowSearch}
            onChange={(e) => {
              setRowSearch(e.target.value);
              setCurrentPage(1);
            }}
            className="w-40 px-2.5 py-1 rounded-xl studio-input"
          />
        </div>
      </GlassCard>

      {/* Toolbar: Add Custom Field & Bulk Find/Replace */}
      <div className="grid grid-cols-1 desktop:grid-cols-2 gap-4">
        <form
          onSubmit={handleAddColumn}
          className="p-4 rounded-2xl border border-black/10 dark:border-white/12 glass-level-3 flex flex-wrap items-end gap-2.5 text-xs"
        >
          <label className="flex-1 min-w-[140px]">
            <span className="text-[11px] text-[#888888] dark:text-[#858585]">New Column Key</span>
            <input
              type="text"
              placeholder="e.g. customer_name"
              value={newColName}
              onChange={(e) => setNewColName(e.target.value)}
              className="mt-1 w-full min-h-[42px] tablet:min-h-0 px-2.5 py-1.5 rounded-xl studio-input"
            />
          </label>
          <label className="w-32">
            <span className="text-[11px] text-[#888888] dark:text-[#858585]">Format</span>
            <select
              value={newColType}
              onChange={(e) =>
                setNewColType(e.target.value as DataColumn['type'])
              }
              className="mt-1 w-full min-h-[42px] tablet:min-h-0 px-2 py-1.5 rounded-xl studio-select"
            >
              <option value="text">Text</option>
              <option value="number">Number</option>
              <option value="currency">Currency</option>
              <option value="date">Date</option>
              <option value="formula">Formula</option>
            </select>
          </label>
          {newColType === 'formula' && (
            <label className="w-full tablet:w-44">
              <span className="text-[11px] text-[#888888] dark:text-[#858585]">Formula</span>
              <input
                type="text"
                value={newColFormula}
                onChange={(e) => setNewColFormula(e.target.value)}
                className="mt-1 w-full min-h-[42px] tablet:min-h-0 px-2 py-1.5 rounded-xl studio-input font-mono"
              />
            </label>
          )}
          <button
            type="submit"
            className="min-h-[42px] tablet:min-h-0 px-3.5 py-1.5 rounded-xl bg-[#101010] text-white hover:bg-[#262626] dark:bg-white dark:text-[#050505] dark:hover:bg-[#E6E6E6] font-medium whitespace-nowrap touch-manipulation transition-colors"
          >
            Add Field
          </button>
        </form>

        <div className="p-4 rounded-2xl border border-black/10 dark:border-white/12 glass-level-3 flex flex-wrap items-end gap-2.5 text-xs">
          <label className="flex-1 min-w-[120px]">
            <span className="text-[11px] text-[#888888] dark:text-[#858585]">Bulk Find</span>
            <input
              type="text"
              placeholder="Search value..."
              value={findText}
              onChange={(e) => setFindText(e.target.value)}
              className="mt-1 w-full min-h-[42px] tablet:min-h-0 px-2.5 py-1.5 rounded-xl studio-input"
            />
          </label>
          <label className="flex-1 min-w-[120px]">
            <span className="text-[11px] text-[#888888] dark:text-[#858585]">Replace With</span>
            <input
              type="text"
              placeholder="Replacement..."
              value={replaceText}
              onChange={(e) => setReplaceText(e.target.value)}
              className="mt-1 w-full min-h-[42px] tablet:min-h-0 px-2.5 py-1.5 rounded-xl studio-input"
            />
          </label>
          <button
            type="button"
            onClick={handleFindReplace}
            className="min-h-[42px] tablet:min-h-0 px-3.5 py-1.5 rounded-xl border border-black/15 dark:border-white/15 hover:bg-black/[0.04] dark:hover:bg-white/[0.08] text-[#101010] dark:text-white font-medium flex items-center gap-1.5 whitespace-nowrap touch-manipulation"
          >
            <Search className="w-3.5 h-3.5" />
            Replace All
          </button>
        </div>
      </div>

      {/* Mobile Cards / Table Switcher */}
      {viewport.isMobile && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-[#555555] dark:text-[#B5B5B5] tabular-nums">
            {filteredIndexedRows.length} records · {dataColumns.length} fields
          </span>
          <LayoutGroup id={`data-mobile-mode-${mobileSwitchId}`}>
            <div className="inline-flex rounded-xl border border-black/15 dark:border-white/15 overflow-hidden p-0.5 glass-level-2">
              <button
                type="button"
                onClick={() => setMobileViewMode('cards')}
                className={`relative min-h-[36px] px-2.5 py-1 rounded-lg flex items-center gap-1 font-medium transition-colors ${
                  mobileViewMode === 'cards'
                    ? 'text-white dark:text-[#050505]'
                    : 'text-[#555555] dark:text-[#B5B5B5]'
                }`}
              >
                {mobileViewMode === 'cards' && (
                  <motion.span
                    layoutId={`data-mobile-pill-${mobileSwitchId}`}
                    transition={shouldReduceMotion ? { duration: 0.08 } : MOTION_SPRING.nav}
                    className="absolute inset-0 rounded-lg bg-[#101010] dark:bg-white"
                  />
                )}
                <LayoutGrid className="relative z-10 w-3.5 h-3.5" />
                <span className="relative z-10">Cards</span>
              </button>
              <button
                type="button"
                onClick={() => setMobileViewMode('table')}
                className={`relative min-h-[36px] px-2.5 py-1 rounded-lg flex items-center gap-1 font-medium transition-colors ${
                  mobileViewMode === 'table'
                    ? 'text-white dark:text-[#050505]'
                    : 'text-[#555555] dark:text-[#B5B5B5]'
                }`}
              >
                {mobileViewMode === 'table' && (
                  <motion.span
                    layoutId={`data-mobile-pill-${mobileSwitchId}`}
                    transition={shouldReduceMotion ? { duration: 0.08 } : MOTION_SPRING.nav}
                    className="absolute inset-0 rounded-lg bg-[#101010] dark:bg-white"
                  />
                )}
                <Table className="relative z-10 w-3.5 h-3.5" />
                <span className="relative z-10">Sheet</span>
              </button>
            </div>
          </LayoutGroup>
        </div>
      )}

      {/* Mobile Cards View (Paginated) */}
      {viewport.isMobile && mobileViewMode === 'cards' ? (
        <div className="space-y-3">
          {pagedRows.map(({ row, originalIndex }) => {
            const isDup = duplicateRowIdSet.has(row._rowId);
            return (
              <div
                key={row._rowId}
                className={`p-4 rounded-2xl border glass-level-3 space-y-3 text-xs ${
                  isDup
                    ? 'border-amber-500/60'
                    : 'border-black/10 dark:border-white/12'
                }`}
              >
                <div className="flex items-center justify-between pb-2 border-b border-black/10 dark:border-white/10">
                  <span className="font-semibold text-[#101010] dark:text-white tabular-nums">
                    Record #{originalIndex + 1}
                    {isDup ? ' · Duplicate Key' : ''}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      commitData(
                        dataColumns,
                        dataRows.filter((r) => r._rowId !== row._rowId)
                      )
                    }
                    className="min-h-[36px] px-2.5 py-1 rounded-lg text-[#555555] hover:text-[#101010] dark:text-[#B5B5B5] dark:hover:text-white hover:bg-black/[0.04] dark:hover:bg-white/[0.08] flex items-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-2.5">
                  {dataColumns.map((col) => {
                    const isFormula = col.type === 'formula';
                    const isMapped = detectedFieldKeys.includes(col.name);
                    const isMissing = missingCellKeySet.has(
                      `${row._rowId}::${col.name}`
                    );
                    const displayVal = isFormula
                      ? formatCellValue(row[col.name], col, row, dataColumns)
                      : String(row[col.name] ?? '');
                    return (
                      <label key={col.id} className="block">
                        <span className="text-[11px] text-[#555555] dark:text-[#B5B5B5] flex items-center justify-between">
                          <span>{col.name}</span>
                          <span className="text-[10px]">
                            {col.type}
                            {isMapped ? ' · Mapped' : ''}
                            {isMissing ? ' · Missing' : ''}
                          </span>
                        </span>
                        {isFormula ? (
                          <div className="mt-1 px-3 py-2.5 rounded-xl border border-black/10 dark:border-white/10 bg-[#F7F7F7] dark:bg-[#0B0B0B] font-mono tabular-nums text-[#101010] dark:text-white">
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
                            className={`mt-1 w-full min-h-[44px] px-3 py-2 rounded-xl studio-input ${
                              isMissing ? '!border-red-500/60' : ''
                            }`}
                          />
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl border border-black/10 dark:border-white/12 glass-level-3 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-black/10 dark:border-white/12 glass-level-2">
                  <th className="py-2.5 px-3 w-12 text-center text-[#888888] dark:text-[#858585] tabular-nums">
                    #
                  </th>
                  {dataColumns.map((col) => {
                    const isMapped = detectedFieldKeys.includes(col.name);
                    return (
                      <th key={col.id} className="py-2.5 px-3 min-w-[170px]">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-semibold text-[#101010] dark:text-white truncate">
                              {col.name}
                            </div>
                            <div className="text-[10px] font-normal text-[#888888] dark:text-[#858585] truncate">
                              {col.type}
                              {col.required ? ' · Req' : ''}
                              {isMapped ? ' · Mapped' : ''}
                              {col.conditionRules?.length
                                ? ` · ${col.conditionRules.length} rule`
                                : ''}
                            </div>
                          </div>
                          <div className="flex items-center gap-0.5 shrink-0">
                            <button
                              type="button"
                              title="Configure column formatting & conditional rules"
                              onClick={() =>
                                setEditingColId(
                                  editingColId === col.id ? null : col.id
                                )
                              }
                              className={`p-1 rounded-lg transition-colors ${
                                editingColId === col.id
                                  ? 'bg-[#101010] text-white dark:bg-white dark:text-[#050505]'
                                  : 'text-[#888888] hover:text-[#101010] dark:hover:text-white'
                              }`}
                            >
                              <SlidersHorizontal className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              title="Delete column"
                              onClick={() =>
                                commitData(
                                  dataColumns.filter((c) => c.id !== col.id),
                                  dataRows
                                )
                              }
                              className="p-1 text-[#888888] hover:text-[#101010] dark:hover:text-white"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      </th>
                    );
                  })}
                  <th className="py-2.5 px-3 w-12" />
                </tr>
              </thead>
              <tbody className="divide-y divide-black/10 dark:divide-white/10">
                {pagedRows.map(({ row, originalIndex }) => {
                  const isDup = duplicateRowIdSet.has(row._rowId);
                  return (
                    <tr
                      key={row._rowId}
                      className={`hover:bg-black/[0.03] dark:hover:bg-white/[0.04] ${
                        isDup ? 'bg-amber-500/5' : ''
                      }`}
                    >
                      <td className="py-1.5 px-3 text-center text-[#888888] dark:text-[#858585] tabular-nums">
                        {originalIndex + 1}
                        {isDup && (
                          <span
                            title="Duplicate key record"
                            className="ml-1 text-amber-600 dark:text-amber-400"
                          >
                            !
                          </span>
                        )}
                      </td>
                      {dataColumns.map((col) => {
                        const isFormula = col.type === 'formula';
                        const isMissing = missingCellKeySet.has(
                          `${row._rowId}::${col.name}`
                        );
                        const displayVal = formatCellValue(
                          row[col.name],
                          col,
                          row,
                          dataColumns
                        );

                        return (
                          <td
                            key={col.id}
                            className={`p-0 border-r border-black/5 dark:border-white/5 ${
                              isMissing ? 'bg-red-500/10' : ''
                            }`}
                          >
                            {isFormula ? (
                              <div className="px-3 py-2 font-mono text-[#555555] dark:text-[#B5B5B5] tabular-nums">
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
                                placeholder={isMissing ? 'Missing required' : undefined}
                                className={`w-full px-3 py-2 bg-transparent text-[#101010] dark:text-white focus:outline-none focus:bg-black/[0.04] dark:focus:bg-white/[0.06] ${
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
                          className="p-1 text-[#888888] hover:text-[#101010] dark:hover:text-white"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pagination Bar (handles thousands of rows smoothly) */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[#555555] dark:text-[#B5B5B5] tabular-nums">
        <span>
          Showing {filteredIndexedRows.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1}–
          {Math.min(safePage * PAGE_SIZE, filteredIndexedRows.length)} of{' '}
          {filteredIndexedRows.length.toLocaleString()} matching records ({dataRows.length.toLocaleString()} total)
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={safePage <= 1}
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            className="min-h-[34px] px-2.5 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/[0.04] dark:hover:bg-white/[0.08] text-[#101010] dark:text-white disabled:opacity-35 flex items-center gap-1"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            Prev
          </button>
          <span className="px-2 font-medium text-[#101010] dark:text-white">
            Page {safePage} / {totalPages}
          </span>
          <button
            type="button"
            disabled={safePage >= totalPages}
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            className="min-h-[34px] px-2.5 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/[0.04] dark:hover:bg-white/[0.08] text-[#101010] dark:text-white disabled:opacity-35 flex items-center gap-1"
          >
            Next
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
