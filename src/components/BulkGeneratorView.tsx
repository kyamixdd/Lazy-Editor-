import React, { useId, useMemo, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  Maximize2,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  BUTTON_TAP,
  MOTION_DURATION,
  MOTION_EASE,
  MOTION_SPRING,
} from '../config/motionSystem';
import {
  BoundaryMode,
  BulkConfig,
  CopiesPerPageConfig,
  PageConfig,
  PDFProject,
  ScalingMode,
  SerialBatchRecord,
  SerialSequenceRule,
  SlotOverride,
  SourceFitConfig,
} from '../types/pdfStudio';
import { useViewport } from '../hooks/useViewport';
import { parseSpreadsheetFile } from '../utils/dataFormulaEngine';
import {
  computeSheetLayout,
  normalizeFitConfig,
  suggestOptimalGridForCopies,
} from '../utils/geometryEngine';
import {
  computeSerialValueForSlot,
  generateSerialPreview,
} from '../utils/serialEngine';
import { presetToGrid, ptToUnit, unitToPt } from '../utils/units';
import { GlassButton } from './glass';
import { PageConfigurationModal } from './PageConfigurationModal';
import { PrintOptimizerPanel } from './PrintOptimizerPanel';
import { SerialIntelligencePanel } from './SerialIntelligencePanel';

interface BulkGeneratorViewProps {
  project: PDFProject;
  serialBatches?: SerialBatchRecord[];
  onSaveSerialBatch?: (record: SerialBatchRecord) => void;
  onDeleteSerialBatch?: (id: string) => void;
  onUpdateProject: (updated: PDFProject) => void;
  onGoToExport: () => void;
}

export const BulkGeneratorView: React.FC<BulkGeneratorViewProps> = ({
  project,
  serialBatches = [],
  onSaveSerialBatch = () => {},
  onDeleteSerialBatch = () => {},
  onUpdateProject,
  onGoToExport,
}) => {
  const shouldReduceMotion = useReducedMotion();
  const subTabGroupId = useId();
  const viewport = useViewport();
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [subTab, setSubTab] = useState<'copies' | 'bulk' | 'serial' | 'optimizer' | 'preview'>('copies');
  const [selectedSlotIdx, setSelectedSlotIdx] = useState<number>(0);
  const [showPageSetupModal, setShowPageSetupModal] = useState(false);
  const [csvImportStatus, setCsvImportStatus] = useState<string | null>(null);
  const { pageConfig, copiesConfig, bulkConfig, serialRules, dataRows } = project;
  const fitConfig = useMemo(() => normalizeFitConfig(project), [project]);
  const unit = pageConfig.unit;
  const effectiveSubTab = viewport.isDesktop && subTab === 'preview' ? 'copies' : subTab;

  const handleImportCsv = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = await parseSpreadsheetFile(file);
      onUpdateProject({
        ...project,
        dataColumns: parsed.columns,
        dataRows: parsed.rows,
        bulkConfig: {
          ...bulkConfig,
          enabled: true,
        },
        updatedAt: new Date().toISOString(),
      });
      setCsvImportStatus(`Imported ${parsed.rows.length} rows from ${file.name}`);
    } catch (err) {
      setCsvImportStatus(
        err instanceof Error ? err.message : 'Failed to import CSV/Excel'
      );
    }
  };

  const updateFitConfig = (patch: Partial<SourceFitConfig>) => {
    onUpdateProject({
      ...project,
      fitConfig: { ...fitConfig, ...patch },
      updatedAt: new Date().toISOString(),
    });
  };

  const updateCopies = (patch: Partial<CopiesPerPageConfig>) => {
    const nextCopies = { ...copiesConfig, ...patch };
    const perPage = nextCopies.enabled
      ? nextCopies.columns * nextCopies.rows
      : 1;
    onUpdateProject({
      ...project,
      copiesConfig: nextCopies,
      bulkConfig: {
        ...bulkConfig,
        enabled: bulkConfig.enabled || nextCopies.enabled,
        copiesPerPage: perPage,
        totalRecords: bulkConfig.totalOutputPages * perPage,
      },
      updatedAt: new Date().toISOString(),
    });
  };

  const updateSlotOverride = (slotIdx: number, patch: Partial<SlotOverride> | null) => {
    const current = { ...(copiesConfig.slotOverrides || {}) };
    if (patch === null) {
      delete current[slotIdx];
    } else {
      current[slotIdx] = { ...(current[slotIdx] || {}), ...patch };
    }
    updateCopies({ slotOverrides: current });
  };

  const updateBulk = (patch: Partial<BulkConfig>) => {
    const merged = { ...bulkConfig, ...patch };
    const pages = Math.max(1, merged.totalOutputPages);
    merged.endPageNumber = merged.startPageNumber + pages - 1;
    merged.totalRecords = pages * Math.max(1, merged.copiesPerPage);
    if (patch.totalOutputPages && patch.totalOutputPages > 1) {
      merged.enabled = true;
    }
    onUpdateProject({
      ...project,
      bulkConfig: merged,
      updatedAt: new Date().toISOString(),
    });
  };

  const updateRules = (nextRules: SerialSequenceRule[]) => {
    onUpdateProject({
      ...project,
      serialRules: nextRules,
      bulkConfig: {
        ...bulkConfig,
        enabled: bulkConfig.enabled || nextRules.length > 0,
      },
      updatedAt: new Date().toISOString(),
    });
  };

  const availableFieldKeys = useMemo(() => {
    const keys = new Set<string>(['invoice_number', 'receipt_number']);
    project.elements.forEach((e) => {
      if (e.fieldKey) keys.add(e.fieldKey);
    });
    project.dataColumns.forEach((c) => keys.add(c.name));
    return Array.from(keys);
  }, [project.elements, project.dataColumns]);

  const availableBlockIds = useMemo(() => {
    const ids = new Set<string>();
    project.elements.forEach((e) => {
      if (e.blockId) ids.add(e.blockId);
    });
    return Array.from(ids);
  }, [project.elements]);

  const copiesPerPage = copiesConfig.enabled
    ? Math.max(1, copiesConfig.columns * copiesConfig.rows)
    : 1;

  // Authoritative imposition & boundary geometry (identical to Export Center)
  const layout = useMemo(() => computeSheetLayout(project, 1), [project]);

  const serialSimulation = useMemo(
    () =>
      generateSerialPreview(
        serialRules,
        bulkConfig.totalOutputPages,
        copiesPerPage,
        dataRows,
        5
      ),
    [serialRules, bulkConfig.totalOutputPages, copiesPerPage, dataRows]
  );

  const addSerialRule = () => {
    const nextIdx = serialRules.length;
    const pages = Math.max(1, bulkConfig.totalOutputPages);
    const newRule: SerialSequenceRule = {
      id: `seq-${Date.now()}-${nextIdx}`,
      name: `Block ${String.fromCharCode(65 + (nextIdx % 26))} Sequence`,
      targetFieldKey: availableFieldKeys[0] || 'receipt_number',
      blockIndex: nextIdx,
      mode: 'auto',
      startNumber: nextIdx * pages + 1,
      endNumber: (nextIdx + 1) * pages,
      increment: 1,
      prefix: '',
      suffix: '',
      digits: 4,
      leadingZeros: true,
      repeatCount: 1,
    };
    updateRules([...serialRules, newRule]);
  };

  // Preview scale factor to fit preview box cleanly across desktop, tablet, and mobile
  const previewMaxW = viewport.isMobile
    ? Math.max(240, Math.min(340, viewport.width - 40))
    : viewport.isTablet
    ? Math.max(320, Math.min(460, viewport.width - 96))
    : 420;
  const previewMaxH = viewport.isMobile ? 420 : 540;
  const previewScale = Math.min(
    previewMaxW / Math.max(1, pageConfig.widthPt),
    previewMaxH / Math.max(1, pageConfig.heightPt)
  );
  const thumbUrl = project.originalPages[0]?.previewImageDataUrl;

  const availableTabs: Array<[typeof subTab, string]> = viewport.isDesktop
    ? [
        ['copies', 'Copies'],
        ['bulk', 'Bulk Job'],
        ['serial', 'Serial Rules'],
        ['optimizer', 'Optimizer'],
      ]
    : [
        ['copies', 'Copies'],
        ['bulk', 'Bulk'],
        ['serial', 'Serial'],
        ['optimizer', 'Optimize'],
        ['preview', 'Preview'],
      ];

  return (
    <div className="flex-1 flex flex-col desktop:flex-row min-h-full desktop:h-screen desktop:overflow-hidden">
      {/* Left Configuration Column */}
      <div className="w-full desktop:w-[540px] shrink-0 border-b desktop:border-b-0 desktop:border-r border-black/10 dark:border-white/12 glass-level-2 flex flex-col desktop:overflow-hidden">
        <div className="px-4 tablet:px-5 py-3.5 tablet:py-4 border-b border-black/10 dark:border-white/12 flex flex-wrap items-center justify-between gap-2.5">
          <div className="min-w-0">
            <h1 className="text-sm tablet:text-base font-display font-semibold text-[#101010] dark:text-white truncate">
              Bulk & Multi-Copy Engine
            </h1>
            <p className="text-[11px] tablet:text-xs text-[#555555] dark:text-[#B5B5B5] tabular-nums">
              {bulkConfig.totalOutputPages} pages × {copiesPerPage} copies ={' '}
              {bulkConfig.totalOutputPages * copiesPerPage} documents
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <GlassButton
              variant="glass"
              size="sm"
              onClick={() => setShowPageSetupModal(true)}
            >
              <Maximize2 className="w-3.5 h-3.5" />
              {pageConfig.customPresetName || pageConfig.sizePreset}
            </GlassButton>
            <GlassButton
              variant="primary"
              size="sm"
              onClick={onGoToExport}
            >
              <Download className="w-3.5 h-3.5" />
              Export
            </GlassButton>
          </div>
        </div>

        {/* Sub-tabs */}
        <LayoutGroup id={`bulk-tabs-${subTabGroupId}`}>
          <div
            className={`grid ${
              availableTabs.length === 5
                ? 'grid-cols-5'
                : availableTabs.length === 4
                ? 'grid-cols-4'
                : 'grid-cols-3'
            } border-b border-black/10 dark:border-white/12 text-xs font-medium shrink-0`}
          >
            {availableTabs.map(([id, label]) => {
              const active = effectiveSubTab === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSubTab(id)}
                  className={`relative min-h-[44px] desktop:min-h-0 py-2.5 px-1 text-center transition-colors flex items-center justify-center gap-1 touch-manipulation ${
                    active
                      ? 'text-[#101010] dark:text-white bg-black/[0.04] dark:bg-white/[0.06]'
                      : 'text-[#888888] dark:text-[#858585] hover:text-[#101010] dark:hover:text-white'
                  }`}
                >
                  {id === 'preview' && <Eye className="w-3.5 h-3.5" />}
                  <span className="truncate">{label}</span>
                  {active && (
                    <motion.span
                      layoutId={`bulk-tab-underline-${subTabGroupId}`}
                      transition={shouldReduceMotion ? { duration: 0.08 } : MOTION_SPRING.nav}
                      className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#101010] dark:bg-white"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </LayoutGroup>

        {effectiveSubTab !== 'preview' && (
        <div className="flex-1 desktop:overflow-y-auto p-4 tablet:p-5 text-xs">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={effectiveSubTab}
              initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
              transition={{ duration: MOTION_DURATION.fast, ease: MOTION_EASE.liquid }}
              className="space-y-5"
            >
          {effectiveSubTab === 'copies' && (
            <>
              <label className="flex items-center justify-between p-3 rounded-xl border border-black/10 dark:border-white/12 bg-black/[0.02] dark:bg-white/[0.02] cursor-pointer">
                <div>
                  <div className="font-semibold text-[#101010] dark:text-white">
                    Enable Multiple Copies Per Page
                  </div>
                  <div className="text-[11px] text-[#555555] dark:text-[#B5B5B5]">
                    Place 2, 4, 6, 8, 9, 12 or custom grid copies on every output sheet
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={copiesConfig.enabled}
                  onChange={(e) => updateCopies({ enabled: e.target.checked })}
                  className="rounded border-black/30 dark:border-white/30 accent-[#101010] dark:accent-white"
                />
              </label>

              {/* Presets */}
              <div>
                <div className="text-[11px] font-medium text-[#555555] dark:text-[#B5B5B5] mb-2">
                  Copies Per Page Preset
                </div>
                <div className="grid grid-cols-3 tablet:grid-cols-5 gap-1.5">
                  {([1, 2, 3, 4, 6, 8, 9, 12, 'custom'] as const).map(
                    (preset) => (
                      <motion.button
                        key={String(preset)}
                        type="button"
                        whileTap={shouldReduceMotion ? undefined : BUTTON_TAP}
                        transition={MOTION_SPRING.snappy}
                        onClick={() => {
                          const grid =
                            preset === 'custom'
                              ? { columns: copiesConfig.columns, rows: copiesConfig.rows }
                              : suggestOptimalGridForCopies(
                                  preset,
                                  pageConfig.widthPt,
                                  pageConfig.heightPt,
                                  layout.sourceBox,
                                  copiesConfig.outerMarginLeftPt,
                                  copiesConfig.outerMarginRightPt,
                                  copiesConfig.outerMarginTopPt,
                                  copiesConfig.outerMarginBottomPt,
                                  copiesConfig.horizontalSpacingPt,
                                  copiesConfig.verticalSpacingPt
                                ) || presetToGrid(preset);
                          updateCopies({
                            enabled: preset !== 1,
                            copiesPreset: preset,
                            columns: grid.columns,
                            rows: grid.rows,
                          });
                        }}
                        className={`min-h-[40px] desktop:min-h-0 py-1.5 rounded-lg border font-medium tabular-nums touch-manipulation transition-colors ${
                          copiesConfig.copiesPreset === preset
                            ? 'studio-active-surface font-semibold'
                            : 'border-black/15 dark:border-white/15 text-[#555555] dark:text-[#B5B5B5] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                        }`}
                      >
                        {preset === 'custom' ? 'Custom' : `${preset}×`}
                      </motion.button>
                    )
                  )}
                </div>
              </div>

              {/* Grid Columns & Rows */}
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[11px] text-[#555555] dark:text-[#B5B5B5]">Columns</span>
                  <input
                    type="number"
                    min="1"
                    max="12"
                    value={copiesConfig.columns}
                    onChange={(e) =>
                      updateCopies({
                        copiesPreset: 'custom',
                        columns: Math.max(1, Number(e.target.value) || 1),
                      })
                    }
                    className="mt-1 w-full px-2.5 py-1.5 rounded-lg border studio-input tabular-nums"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] text-[#555555] dark:text-[#B5B5B5]">Rows</span>
                  <input
                    type="number"
                    min="1"
                    max="12"
                    value={copiesConfig.rows}
                    onChange={(e) =>
                      updateCopies({
                        copiesPreset: 'custom',
                        rows: Math.max(1, Number(e.target.value) || 1),
                      })
                    }
                    className="mt-1 w-full px-2.5 py-1.5 rounded-lg border studio-input tabular-nums"
                  />
                </label>
              </div>

              {/* Spacing & Outer Margins */}
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[11px] text-[#555555] dark:text-[#B5B5B5]">
                    Horizontal Spacing ({unit})
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={ptToUnit(copiesConfig.horizontalSpacingPt, unit)}
                    onChange={(e) =>
                      updateCopies({
                        horizontalSpacingPt: Math.max(
                          0,
                          unitToPt(Number(e.target.value), unit)
                        ),
                      })
                    }
                    className="mt-1 w-full px-2.5 py-1.5 rounded-lg border studio-input tabular-nums"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] text-[#555555] dark:text-[#B5B5B5]">
                    Vertical Spacing ({unit})
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={ptToUnit(copiesConfig.verticalSpacingPt, unit)}
                    onChange={(e) =>
                      updateCopies({
                        verticalSpacingPt: Math.max(
                          0,
                          unitToPt(Number(e.target.value), unit)
                        ),
                      })
                    }
                    className="mt-1 w-full px-2.5 py-1.5 rounded-lg border studio-input tabular-nums"
                  />
                </label>
              </div>

              <div>
                <div className="text-[11px] font-medium text-[#555555] dark:text-[#B5B5B5] mb-1.5">
                  Outer Page Margins ({unit})
                </div>
                <div className="grid grid-cols-2 tablet:grid-cols-4 gap-2">
                  {(
                    [
                      ['Top', 'outerMarginTopPt'],
                      ['Right', 'outerMarginRightPt'],
                      ['Bottom', 'outerMarginBottomPt'],
                      ['Left', 'outerMarginLeftPt'],
                    ] as const
                  ).map(([lbl, key]) => (
                    <label key={key} className="block">
                      <span className="text-[10px] text-[#888888] dark:text-[#858585]">{lbl}</span>
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        value={ptToUnit(copiesConfig[key], unit)}
                        onChange={(e) =>
                          updateCopies({
                            [key]: Math.max(
                              0,
                              unitToPt(Number(e.target.value), unit)
                            ),
                          })
                        }
                        className="mt-0.5 w-full min-h-[40px] desktop:min-h-0 px-2 py-1.5 rounded-lg border studio-input tabular-nums"
                      />
                    </label>
                  ))}
                </div>
              </div>

              {/* Scaling, Rotation, Source Scope */}
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[11px] text-[#555555] dark:text-[#B5B5B5]">
                    Individual Copy Scale (%)
                  </span>
                  <input
                    type="number"
                    min="10"
                    max="200"
                    disabled={copiesConfig.fitToPage}
                    value={Math.round(copiesConfig.copyScale * 100)}
                    onChange={(e) =>
                      updateCopies({
                        copyScale: Math.max(
                          0.1,
                          (Number(e.target.value) || 100) / 100
                        ),
                      })
                    }
                    className="mt-1 w-full px-2.5 py-1.5 rounded-lg border studio-input disabled:opacity-45 tabular-nums"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] text-[#555555] dark:text-[#B5B5B5]">
                    Copy Rotation
                  </span>
                  <select
                    value={copiesConfig.copyRotation}
                    onChange={(e) =>
                      updateCopies({
                        copyRotation: Number(e.target.value) as
                          | 0
                          | 90
                          | 180
                          | 270,
                      })
                    }
                    className="mt-1 w-full px-2.5 py-1.5 rounded-lg border studio-select"
                  >
                    <option value={0}>0°</option>
                    <option value={90}>90°</option>
                    <option value={180}>180°</option>
                    <option value={270}>270°</option>
                  </select>
                </label>
              </div>

              {availableBlockIds.length > 0 && (
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-[11px] text-[#555555] dark:text-[#B5B5B5]">
                      Copy Source Scope
                    </span>
                    <select
                      value={copiesConfig.sourceScope}
                      onChange={(e) =>
                        updateCopies({
                          sourceScope: e.target.value as
                            | 'full_page'
                            | 'selected_block',
                        })
                      }
                      className="mt-1 w-full px-2.5 py-1.5 rounded-lg border studio-select"
                    >
                      <option value="full_page">Full Template Page</option>
                      <option value="selected_block">Selected Block Only</option>
                    </select>
                  </label>
                  {copiesConfig.sourceScope === 'selected_block' && (
                    <label className="block">
                      <span className="text-[11px] text-[#555555] dark:text-[#B5B5B5]">
                        Target Block
                      </span>
                      <select
                        value={copiesConfig.selectedBlockId || ''}
                        onChange={(e) =>
                          updateCopies({ selectedBlockId: e.target.value })
                        }
                        className="mt-1 w-full px-2.5 py-1.5 rounded-lg border studio-select"
                      >
                        <option value="">Choose block...</option>
                        {availableBlockIds.map((id) => (
                          <option key={id} value={id}>
                            {id}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              )}

              {/* Checkboxes */}
              <div className="grid grid-cols-2 gap-2.5 pt-2 border-t border-black/10 dark:border-white/10">
                {(
                  [
                    ['fitToPage', 'Auto Fit-to-Page'],
                    ['cropMarks', 'Crop Marks'],
                    ['cuttingGuides', 'Cutting Guides'],
                    ['showBorders', 'Cell Borders'],
                    ['allowOverlapOrOverflow', 'Allow Overlap / Overflow'],
                  ] as const
                ).map(([key, label]) => (
                  <label
                    key={key}
                    className="flex items-center gap-2 cursor-pointer text-[#555555] dark:text-[#B5B5B5]"
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(copiesConfig[key])}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        if (key === 'fitToPage' && checked) {
                          updateCopies({ fitToPage: true });
                          if (fitConfig.scalingMode === 'custom_percent') {
                            updateFitConfig({ scalingMode: 'auto_fit_aspect' });
                          }
                        } else {
                          updateCopies({ [key]: checked });
                        }
                      }}
                      className="rounded border-black/30 dark:border-white/30 accent-[#101010] dark:accent-white"
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>

              {/* Source Boundaries & Intelligent Scaling */}
              <div className="pt-3 border-t border-black/10 dark:border-white/10 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-[#101010] dark:text-white">
                    Content Boundaries & Fitting
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const opt = suggestOptimalGridForCopies(
                        copiesPerPage,
                        pageConfig.widthPt,
                        pageConfig.heightPt,
                        layout.sourceBox,
                        copiesConfig.outerMarginLeftPt,
                        copiesConfig.outerMarginRightPt,
                        copiesConfig.outerMarginTopPt,
                        copiesConfig.outerMarginBottomPt,
                        copiesConfig.horizontalSpacingPt,
                        copiesConfig.verticalSpacingPt
                      );
                      updateCopies({
                        columns: opt.columns,
                        rows: opt.rows,
                        fitToPage: true,
                      });
                    }}
                    className="text-[11px] text-[#101010] dark:text-white hover:underline font-medium"
                  >
                    Optimize Grid for Paper
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-[11px] text-[#555555] dark:text-[#B5B5B5]">
                      Source Boundaries
                    </span>
                    <select
                      value={fitConfig.boundaryMode}
                      onChange={(e) =>
                        updateFitConfig({
                          boundaryMode: e.target.value as BoundaryMode,
                        })
                      }
                      className="mt-1 w-full px-2.5 py-1.5 rounded-lg border studio-select"
                    >
                      <option value="original_page">Original Page</option>
                      <option value="auto_content">Auto Content (Trim Margins)</option>
                      <option value="manual_selection">Manual Selection</option>
                      <option value="custom_crop">Custom Crop</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-[11px] text-[#555555] dark:text-[#B5B5B5]">
                      Scaling Mode
                    </span>
                    <select
                      value={fitConfig.scalingMode}
                      onChange={(e) => {
                        const mode = e.target.value as ScalingMode;
                        updateFitConfig({ scalingMode: mode });
                        if (mode !== 'custom_percent' && mode !== 'preserve_original') {
                          updateCopies({ fitToPage: true });
                        }
                      }}
                      className="mt-1 w-full px-2.5 py-1.5 rounded-lg border studio-select"
                    >
                      <option value="auto_fit_aspect">Auto-Fit (Aspect)</option>
                      <option value="fit_to_page">Fit to Page</option>
                      <option value="fit_to_width">Fit to Width</option>
                      <option value="fit_to_height">Fit to Height</option>
                      <option value="fit_to_cell">Fit to Cell</option>
                      <option value="fill_cell">Fill Cell</option>
                      <option value="preserve_original">Preserve Physical (100%)</option>
                      <option value="custom_percent">Custom Percentage</option>
                    </select>
                  </label>
                </div>

                {fitConfig.scalingMode === 'custom_percent' && (
                  <label className="block">
                    <span className="text-[11px] text-[#555555] dark:text-[#B5B5B5]">
                      Custom Scale (%)
                    </span>
                    <input
                      type="number"
                      min="10"
                      max="400"
                      value={fitConfig.customPercent}
                      onChange={(e) =>
                        updateFitConfig({
                          customPercent: Math.max(10, Number(e.target.value) || 100),
                        })
                      }
                      className="mt-1 w-full px-2.5 py-1.5 rounded-lg border studio-input tabular-nums"
                    />
                  </label>
                )}

                <div className="p-2.5 rounded-xl border border-black/10 dark:border-white/10 bg-[#F7F7F7] dark:bg-[#0B0B0B] text-[11px] tabular-nums space-y-1 text-[#555555] dark:text-[#B5B5B5]">
                  <div className="flex justify-between">
                    <span>Source Content Box:</span>
                    <span>
                      {ptToUnit(layout.sourceBox.width, unit)} ×{' '}
                      {ptToUnit(layout.sourceBox.height, unit)} {unit}
                    </span>
                  </div>
                  {layout.slots[0] && (
                    <div className="flex justify-between">
                      <span>Placed Copy #1 Size:</span>
                      <span className="text-[#101010] dark:text-white font-medium">
                        {ptToUnit(layout.slots[0].placedWidthPt, unit)} ×{' '}
                        {ptToUnit(layout.slots[0].placedHeightPt, unit)} {unit} (
                        {Math.round(layout.slots[0].scale * 100)}%)
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Independent Per-Slot Scale, Rotation & Placement Overrides */}
              {layout.slots.length > 0 && (
                <div className="pt-3 border-t border-black/10 dark:border-white/10 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[#101010] dark:text-white">
                      Per-Slot Placement & Overrides
                    </span>
                    {copiesConfig.slotOverrides &&
                      Object.keys(copiesConfig.slotOverrides).length > 0 && (
                        <button
                          type="button"
                          onClick={() => updateCopies({ slotOverrides: {} })}
                          className="text-[11px] text-[#555555] hover:text-[#101010] dark:text-[#B5B5B5] dark:hover:text-white"
                        >
                          Reset All Slots
                        </button>
                      )}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="text-[10px] text-[#888888] dark:text-[#858585]">Target Copy Slot</span>
                      <select
                        value={Math.min(selectedSlotIdx, layout.slots.length - 1)}
                        onChange={(e) => setSelectedSlotIdx(Number(e.target.value))}
                        className="mt-0.5 w-full px-2 py-1 rounded-lg border studio-select"
                      >
                        {layout.slots.map((s) => (
                          <option key={s.slotIndex} value={s.slotIndex}>
                            Copy #{s.slotIndex + 1} (R{s.row + 1} C{s.col + 1})
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-[10px] text-[#888888] dark:text-[#858585]">Slot Rotation</span>
                      <select
                        value={
                          copiesConfig.slotOverrides?.[
                            Math.min(selectedSlotIdx, layout.slots.length - 1)
                          ]?.rotation ?? copiesConfig.copyRotation
                        }
                        onChange={(e) =>
                          updateSlotOverride(
                            Math.min(selectedSlotIdx, layout.slots.length - 1),
                            {
                              rotation: Number(e.target.value) as 0 | 90 | 180 | 270,
                            }
                          )
                        }
                        className="mt-0.5 w-full px-2 py-1 rounded-lg border studio-select"
                      >
                        <option value={0}>0°</option>
                        <option value={90}>90°</option>
                        <option value={180}>180°</option>
                        <option value={270}>270°</option>
                      </select>
                    </label>
                  </div>

                  {(() => {
                    const safeIdx = Math.min(selectedSlotIdx, layout.slots.length - 1);
                    const ov = copiesConfig.slotOverrides?.[safeIdx];
                    const activeSlot = layout.slots[safeIdx];
                    return (
                      <div className="grid grid-cols-3 gap-2">
                        <label className="block">
                          <span className="text-[10px] text-[#888888] dark:text-[#858585]">
                            Scale (%)
                          </span>
                          <input
                            type="number"
                            min="10"
                            max="400"
                            value={Math.round(
                              (ov?.scale ?? activeSlot?.scale ?? 1) * 100
                            )}
                            onChange={(e) =>
                              updateSlotOverride(safeIdx, {
                                scale: Math.max(
                                  0.1,
                                  (Number(e.target.value) || 100) / 100
                                ),
                              })
                            }
                            className="mt-0.5 w-full px-2 py-1 rounded-lg border studio-input tabular-nums"
                          />
                        </label>
                        <label className="block">
                          <span className="text-[10px] text-[#888888] dark:text-[#858585]">
                            X Offset ({unit})
                          </span>
                          <input
                            type="number"
                            step="0.5"
                            value={ptToUnit(ov?.xOffsetPt || 0, unit)}
                            onChange={(e) =>
                              updateSlotOverride(safeIdx, {
                                xOffsetPt: unitToPt(Number(e.target.value) || 0, unit),
                              })
                            }
                            className="mt-0.5 w-full px-2 py-1 rounded-lg border studio-input tabular-nums"
                          />
                        </label>
                        <label className="block">
                          <span className="text-[10px] text-[#888888] dark:text-[#858585]">
                            Y Offset ({unit})
                          </span>
                          <input
                            type="number"
                            step="0.5"
                            value={ptToUnit(ov?.yOffsetPt || 0, unit)}
                            onChange={(e) =>
                              updateSlotOverride(safeIdx, {
                                yOffsetPt: unitToPt(Number(e.target.value) || 0, unit),
                              })
                            }
                            className="mt-0.5 w-full px-2 py-1 rounded-lg border studio-input tabular-nums"
                          />
                        </label>
                      </div>
                    );
                  })()}
                </div>
              )}
            </>
          )}

          {effectiveSubTab === 'bulk' && (
            <div className="space-y-4">
              <label className="flex items-center justify-between p-3 rounded-xl border border-black/10 dark:border-white/12 bg-black/[0.02] dark:bg-white/[0.02] cursor-pointer">
                <div>
                  <div className="font-semibold text-[#101010] dark:text-white">
                    Enable Bulk Multi-Page Generation
                  </div>
                  <div className="text-[11px] text-[#555555] dark:text-[#B5B5B5]">
                    When off, Export Center outputs the exact pages edited in the Editor
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={bulkConfig.enabled}
                  onChange={(e) => updateBulk({ enabled: e.target.checked })}
                  className="rounded border-black/30 dark:border-white/30 accent-[#101010] dark:accent-white"
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[11px] text-[#555555] dark:text-[#B5B5B5]">
                    Total Output Pages
                  </span>
                  <input
                    type="number"
                    min="1"
                    max="2000"
                    value={bulkConfig.totalOutputPages}
                    onChange={(e) =>
                      updateBulk({
                        totalOutputPages: Math.max(
                          1,
                          Number(e.target.value) || 1
                        ),
                      })
                    }
                    className="mt-1 w-full px-2.5 py-1.5 rounded-lg border studio-input tabular-nums"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] text-[#555555] dark:text-[#B5B5B5]">
                    Copies Per Page
                  </span>
                  <input
                    type="number"
                    disabled
                    value={copiesPerPage}
                    className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-[#F7F7F7] dark:bg-[#0B0B0B] text-[#555555] dark:text-[#B5B5B5] tabular-nums"
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[11px] text-[#555555] dark:text-[#B5B5B5]">
                    Starting Page Number
                  </span>
                  <input
                    type="number"
                    min="1"
                    value={bulkConfig.startPageNumber}
                    onChange={(e) =>
                      updateBulk({
                        startPageNumber: Math.max(
                          1,
                          Number(e.target.value) || 1
                        ),
                      })
                    }
                    className="mt-1 w-full px-2.5 py-1.5 rounded-lg border studio-input tabular-nums"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] text-[#555555] dark:text-[#B5B5B5]">
                    Ending Page Number
                  </span>
                  <input
                    type="number"
                    min={bulkConfig.startPageNumber}
                    value={bulkConfig.endPageNumber}
                    onChange={(e) => {
                      const end = Math.max(
                        bulkConfig.startPageNumber,
                        Number(e.target.value) || bulkConfig.startPageNumber
                      );
                      updateBulk({
                        endPageNumber: end,
                        totalOutputPages: end - bulkConfig.startPageNumber + 1,
                      });
                    }}
                    className="mt-1 w-full px-2.5 py-1.5 rounded-lg border studio-input tabular-nums"
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[11px] text-[#555555] dark:text-[#B5B5B5]">
                    Document Blocks Per Sheet
                  </span>
                  <input
                    type="number"
                    min="1"
                    max="24"
                    value={bulkConfig.documentBlocksCount}
                    onChange={(e) =>
                      updateBulk({
                        documentBlocksCount: Math.max(
                          1,
                          Number(e.target.value) || 1
                        ),
                      })
                    }
                    className="mt-1 w-full px-2.5 py-1.5 rounded-lg border studio-input tabular-nums"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] text-[#555555] dark:text-[#B5B5B5]">
                    Copies Per Document
                  </span>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={bulkConfig.copiesPerDocument}
                    onChange={(e) =>
                      updateBulk({
                        copiesPerDocument: Math.max(
                          1,
                          Number(e.target.value) || 1
                        ),
                      })
                    }
                    className="mt-1 w-full px-2.5 py-1.5 rounded-lg border studio-input tabular-nums"
                  />
                </label>
              </div>

              <label className="block">
                <span className="text-[11px] text-[#555555] dark:text-[#B5B5B5]">
                  Dynamic Data Source Mode
                </span>
                <select
                  value={bulkConfig.dataSourceMode}
                  onChange={(e) =>
                    updateBulk({
                      dataSourceMode: e.target.value as BulkConfig['dataSourceMode'],
                    })
                  }
                  className="mt-1 w-full px-2.5 py-1.5 rounded-lg border studio-select"
                >
                  <option value="hybrid">
                    Hybrid (Serial Numbering + Data Manager Rows)
                  </option>
                  <option value="serial_only">Serial Numbering Only</option>
                  <option value="dataset">Data Manager Spreadsheet Only</option>
                </select>
              </label>

              <div className="p-3.5 rounded-xl border border-black/10 dark:border-white/10 bg-[#F7F7F7] dark:bg-[#0B0B0B] space-y-1.5 tabular-nums">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold text-[#101010] dark:text-white">
                    Bulk Output Summary
                  </div>
                  <div>
                    <input
                      ref={csvInputRef}
                      type="file"
                      accept=".csv,.xlsx,.xls"
                      className="hidden"
                      onChange={(e) => void handleImportCsv(e.target.files?.[0])}
                    />
                    <button
                      type="button"
                      onClick={() => csvInputRef.current?.click()}
                      className="min-h-[36px] px-2.5 py-1 rounded-lg border border-black/15 dark:border-white/15 bg-white/80 dark:bg-white/[0.06] text-[#101010] dark:text-white hover:bg-black/[0.04] dark:hover:bg-white/[0.12] font-medium flex items-center gap-1.5 transition-colors"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      Import CSV / Excel
                    </button>
                  </div>
                </div>
                {csvImportStatus && (
                  <div className="text-[11px] text-[#101010] dark:text-white font-medium">
                    {csvImportStatus}
                  </div>
                )}
                <div className="flex justify-between text-[#555555] dark:text-[#B5B5B5]">
                  <span>Pages to Generate:</span>
                  <span className="font-medium text-[#101010] dark:text-white">
                    {bulkConfig.totalOutputPages}
                  </span>
                </div>
                <div className="flex justify-between text-[#555555] dark:text-[#B5B5B5]">
                  <span>Total Individual Receipts / Copies:</span>
                  <span className="font-medium text-[#101010] dark:text-white">
                    {bulkConfig.totalOutputPages * copiesPerPage}
                  </span>
                </div>
                <div className="flex justify-between text-[#555555] dark:text-[#B5B5B5]">
                  <span>Dataset Rows Available:</span>
                  <span className="font-medium text-[#101010] dark:text-white">
                    {dataRows.length}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={onGoToExport}
                className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-[#101010] text-white hover:bg-[#262626] dark:bg-white dark:text-[#050505] dark:hover:bg-[#E6E6E6] font-semibold flex items-center justify-center gap-2 touch-manipulation transition-colors"
              >
                <Download className="w-4 h-4" />
                Generate & Export {bulkConfig.totalOutputPages} Pages
              </button>
            </div>
          )}

          {effectiveSubTab === 'serial' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-semibold text-[#101010] dark:text-white">
                    Independent Serial Sequences
                  </div>
                  <div className="text-[11px] text-[#555555] dark:text-[#B5B5B5]">
                    Configure one rule per field, or separate sequences per Block (e.g. Block A: 0001–0250, Block B: 0251–0500).
                  </div>
                </div>
                <button
                  type="button"
                  onClick={addSerialRule}
                  className="min-h-[40px] desktop:min-h-0 px-3 py-1.5 rounded-lg bg-[#101010] text-white hover:bg-[#262626] dark:bg-white dark:text-[#050505] dark:hover:bg-[#E6E6E6] font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 touch-manipulation transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Rule
                </button>
              </div>

              {serialRules.length === 0 ? (
                <div className="p-6 text-center rounded-xl border border-dashed border-black/15 dark:border-white/15 text-[#888888] dark:text-[#858585]">
                  No serial rules configured. Click "Add Rule" to assign sequential numbering to a detected field.
                </div>
              ) : (
                <div className="space-y-3">
                  {serialRules.map((rule, idx) => (
                    <div
                      key={rule.id}
                      className="p-3.5 rounded-xl border border-black/10 dark:border-white/12 bg-black/[0.015] dark:bg-white/[0.02] space-y-2.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <input
                          type="text"
                          value={rule.name}
                          onChange={(e) => {
                            const copy = [...serialRules];
                            copy[idx] = { ...rule, name: e.target.value };
                            updateRules(copy);
                          }}
                          className="font-semibold text-[#101010] dark:text-white bg-transparent border-b border-transparent focus:border-black/40 dark:focus:border-white/40 focus:outline-none min-h-[36px]"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            updateRules(
                              serialRules.filter((r) => r.id !== rule.id)
                            )
                          }
                          className="p-2 text-[#888888] hover:text-[#101010] dark:text-[#858585] dark:hover:text-white transition-colors touch-manipulation"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="grid grid-cols-1 tablet:grid-cols-3 gap-2">
                        <label className="block">
                          <span className="text-[10px] text-[#888888] dark:text-[#858585]">
                            Target Field
                          </span>
                          <select
                            value={rule.targetFieldKey}
                            onChange={(e) => {
                              const copy = [...serialRules];
                              copy[idx] = {
                                ...rule,
                                targetFieldKey: e.target.value,
                              };
                              updateRules(copy);
                            }}
                            className="mt-0.5 w-full px-2 py-1 rounded-lg border studio-select"
                          >
                            {availableFieldKeys.map((k) => (
                              <option key={k} value={k}>
                                {k}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block">
                          <span className="text-[10px] text-[#888888] dark:text-[#858585]">
                            Copy Slot / Block
                          </span>
                          <select
                            value={rule.blockIndex}
                            onChange={(e) => {
                              const copy = [...serialRules];
                              copy[idx] = {
                                ...rule,
                                blockIndex: Number(e.target.value),
                              };
                              updateRules(copy);
                            }}
                            className="mt-0.5 w-full px-2 py-1 rounded-lg border studio-select"
                          >
                            {Array.from({ length: Math.max(4, copiesPerPage) }).map(
                              (_, bi) => (
                                <option key={bi} value={bi}>
                                  Block {String.fromCharCode(65 + bi)}
                                </option>
                              )
                            )}
                          </select>
                        </label>
                        <label className="block">
                          <span className="text-[10px] text-[#888888] dark:text-[#858585]">
                            Mode
                          </span>
                          <select
                            value={rule.mode}
                            onChange={(e) => {
                              const copy = [...serialRules];
                              copy[idx] = {
                                ...rule,
                                mode: e.target.value as SerialSequenceRule['mode'],
                              };
                              updateRules(copy);
                            }}
                            className="mt-0.5 w-full px-2 py-1 rounded-lg border studio-select"
                          >
                            <option value="auto">Automatic</option>
                            <option value="repeating">Repeating</option>
                            <option value="csv">CSV Column</option>
                            <option value="manual">Manual List</option>
                          </select>
                        </label>
                      </div>

                      {rule.mode === 'csv' ? (
                        <label className="block">
                          <span className="text-[10px] text-[#888888] dark:text-[#858585]">
                            CSV / Data Column
                          </span>
                          <select
                            value={rule.csvColumn || ''}
                            onChange={(e) => {
                              const copy = [...serialRules];
                              copy[idx] = { ...rule, csvColumn: e.target.value };
                              updateRules(copy);
                            }}
                            className="mt-0.5 w-full px-2 py-1 rounded-lg border studio-select"
                          >
                            <option value="">Select column...</option>
                            {project.dataColumns.map((c) => (
                              <option key={c.id} value={c.name}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : rule.mode === 'manual' ? (
                        <label className="block">
                          <span className="text-[10px] text-[#888888] dark:text-[#858585]">
                            Manual Values (comma-separated)
                          </span>
                          <input
                            type="text"
                            value={(rule.manualValues || []).join(', ')}
                            onChange={(e) => {
                              const copy = [...serialRules];
                              copy[idx] = {
                                ...rule,
                                manualValues: e.target.value
                                  .split(',')
                                  .map((s) => s.trim()),
                              };
                              updateRules(copy);
                            }}
                            className="mt-0.5 w-full px-2 py-1 rounded-lg border studio-input"
                          />
                        </label>
                      ) : (
                        <>
                          <div className="grid grid-cols-2 tablet:grid-cols-4 gap-2">
                            <label className="block">
                              <span className="text-[10px] text-[#888888] dark:text-[#858585]">
                                Start
                              </span>
                              <input
                                type="number"
                                value={rule.startNumber}
                                onChange={(e) => {
                                  const copy = [...serialRules];
                                  copy[idx] = {
                                    ...rule,
                                    startNumber: Number(e.target.value) || 0,
                                  };
                                  updateRules(copy);
                                }}
                                className="mt-0.5 w-full px-2 py-1 rounded-lg border studio-input tabular-nums"
                              />
                            </label>
                            <label className="block">
                              <span className="text-[10px] text-[#888888] dark:text-[#858585]">
                                End
                              </span>
                              <input
                                type="number"
                                value={rule.endNumber}
                                onChange={(e) => {
                                  const copy = [...serialRules];
                                  copy[idx] = {
                                    ...rule,
                                    endNumber: Number(e.target.value) || 0,
                                  };
                                  updateRules(copy);
                                }}
                                className="mt-0.5 w-full px-2 py-1 rounded-lg border studio-input tabular-nums"
                              />
                            </label>
                            <label className="block">
                              <span className="text-[10px] text-[#888888] dark:text-[#858585]">
                                Step
                              </span>
                              <input
                                type="number"
                                value={rule.increment}
                                onChange={(e) => {
                                  const copy = [...serialRules];
                                  copy[idx] = {
                                    ...rule,
                                    increment: Number(e.target.value) || 1,
                                  };
                                  updateRules(copy);
                                }}
                                className="mt-0.5 w-full px-2 py-1 rounded-lg border studio-input tabular-nums"
                              />
                            </label>
                            <label className="block">
                              <span className="text-[10px] text-[#888888] dark:text-[#858585]">
                                Digits
                              </span>
                              <input
                                type="number"
                                min="1"
                                max="12"
                                value={rule.digits}
                                onChange={(e) => {
                                  const copy = [...serialRules];
                                  copy[idx] = {
                                    ...rule,
                                    digits: Math.max(
                                      1,
                                      Number(e.target.value) || 1
                                    ),
                                  };
                                  updateRules(copy);
                                }}
                                className="mt-0.5 w-full px-2 py-1 rounded-lg border studio-input tabular-nums"
                              />
                            </label>
                          </div>

                          <div className="grid grid-cols-3 gap-2">
                            <label className="block">
                              <span className="text-[10px] text-[#888888] dark:text-[#858585]">
                                Prefix
                              </span>
                              <input
                                type="text"
                                value={rule.prefix}
                                onChange={(e) => {
                                  const copy = [...serialRules];
                                  copy[idx] = { ...rule, prefix: e.target.value };
                                  updateRules(copy);
                                }}
                                className="mt-0.5 w-full px-2 py-1 rounded-lg border studio-input"
                              />
                            </label>
                            <label className="block">
                              <span className="text-[10px] text-[#888888] dark:text-[#858585]">
                                Suffix
                              </span>
                              <input
                                type="text"
                                value={rule.suffix}
                                onChange={(e) => {
                                  const copy = [...serialRules];
                                  copy[idx] = { ...rule, suffix: e.target.value };
                                  updateRules(copy);
                                }}
                                className="mt-0.5 w-full px-2 py-1 rounded-lg border studio-input"
                              />
                            </label>
                            <label className="flex items-center gap-1.5 pt-4 cursor-pointer text-[#555555] dark:text-[#B5B5B5]">
                              <input
                                type="checkbox"
                                checked={rule.leadingZeros}
                                onChange={(e) => {
                                  const copy = [...serialRules];
                                  copy[idx] = {
                                    ...rule,
                                    leadingZeros: e.target.checked,
                                  };
                                  updateRules(copy);
                                }}
                                className="rounded border-black/30 dark:border-white/30 accent-[#101010] dark:accent-white"
                              />
                              <span className="text-[11px]">Leading Zeros</span>
                            </label>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Numbering Preview Table */}
              {serialRules.length > 0 && (
                <div className="rounded-xl border border-black/10 dark:border-white/12 overflow-hidden">
                  <div className="px-3 py-2 bg-[#F7F7F7] dark:bg-[#0B0B0B] border-b border-black/10 dark:border-white/10 flex items-center justify-between">
                    <span className="font-semibold text-[#101010] dark:text-white">
                      Numbering Preview (First 5 Pages)
                    </span>
                    {serialSimulation.duplicates.length === 0 &&
                    serialSimulation.outOfRangeCount === 0 ? (
                      <span className="text-[11px] text-[#101010] dark:text-white font-medium flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        No overlaps
                      </span>
                    ) : (
                      <span className="text-[11px] text-red-600 dark:text-red-400 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        Check range
                      </span>
                    )}
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    <table className="w-full text-left border-collapse text-[11px] tabular-nums">
                      <thead>
                        <tr className="border-b border-black/10 dark:border-white/10 text-[#888888] dark:text-[#858585]">
                          <th className="py-1.5 px-3">Page</th>
                          <th className="py-1.5 px-3">Block</th>
                          <th className="py-1.5 px-3">Field</th>
                          <th className="py-1.5 px-3 text-right">Generated</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-black/10 dark:divide-white/10">
                        {serialSimulation.previewRows.slice(0, 24).map((row, ri) => (
                          <tr key={ri}>
                            <td className="py-1.5 px-3 text-[#101010] dark:text-white">{row.pageNumber}</td>
                            <td className="py-1.5 px-3 text-[#555555] dark:text-[#B5B5B5]">{row.blockLabel}</td>
                            <td className="py-1.5 px-3 font-mono text-[#888888] dark:text-[#858585]">
                              {row.fieldKey}
                            </td>
                            <td
                              className={`py-1.5 px-3 text-right font-mono font-medium ${
                                row.outOfRange
                                  ? 'text-red-600 dark:text-red-400'
                                  : 'text-[#101010] dark:text-white'
                              }`}
                            >
                              {row.formattedValue}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <SerialIntelligencePanel
                project={project}
                copiesPerPage={copiesPerPage}
                serialBatches={serialBatches}
                onUpdateRules={updateRules}
                onSaveSerialBatch={onSaveSerialBatch}
                onDeleteSerialBatch={onDeleteSerialBatch}
              />
            </div>
          )}

          {effectiveSubTab === 'optimizer' && (
            <PrintOptimizerPanel
              project={project}
              layout={layout}
              onUpdateProject={onUpdateProject}
            />
          )}
            </motion.div>
          </AnimatePresence>
        </div>
        )}
      </div>

      {/* Right Live Imposition Preview */}
      {(viewport.isDesktop || effectiveSubTab === 'preview') && (
      <div className="flex-1 overflow-auto bg-[#EFEFEF] dark:bg-[#0B0B0B] p-4 tablet:p-6 flex flex-col items-center justify-center min-h-[380px]">
        <div className="mb-3 flex flex-wrap items-center justify-center gap-4 text-xs text-[#555555] dark:text-[#B5B5B5]">
          <span className="font-semibold text-[#101010] dark:text-white">
            Live Sheet Imposition Preview (Page 1)
          </span>
          <span className="tabular-nums">
            {layout.columns}×{layout.rows} grid ({copiesPerPage} per sheet ·{' '}
            {layout.boundaryMode.replace('_', ' ')})
          </span>
          {(layout.hasOverlap || layout.hasClipping) &&
            !copiesConfig.allowOverlapOrOverflow && (
              <span className="text-red-600 dark:text-red-400 font-medium flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                {layout.hasOverlap
                  ? 'Overlapping copies detected'
                  : 'Copy dimensions exceed cell or sheet bounds'}
              </span>
            )}
        </div>

        {/* Sheet Canvas */}
        <div
          style={{
            width: layout.outputSheetWidthPt * previewScale,
            height: layout.outputSheetHeightPt * previewScale,
            backgroundColor: pageConfig.backgroundColor || '#FFFFFF',
          }}
          className="relative shadow-2xl border border-black/20 dark:border-white/15 overflow-hidden"
        >
          {layout.slots.map((slot) => {
            const slotIdx = slot.slotIndex;
            const slotSerials = serialRules
              .filter((rule) => {
                const matching = serialRules.filter(
                  (x) => x.targetFieldKey === rule.targetFieldKey
                );
                return matching.length <= 1 || rule.blockIndex === slotIdx;
              })
              .map((rule) => {
                const matching = serialRules.filter(
                  (x) => x.targetFieldKey === rule.targetFieldKey
                );
                return computeSerialValueForSlot(
                  rule,
                  0,
                  slotIdx,
                  copiesPerPage,
                  dataRows,
                  matching.length,
                  rule.blockIndex
                ).value;
              });

            const unrotWpx = slot.unrotatedWidthPt * previewScale;
            const unrotHpx = slot.unrotatedHeightPt * previewScale;
            const boxWpx = slot.placedWidthPt * previewScale;
            const boxHpx = slot.placedHeightPt * previewScale;
            const fullPageWpx = layout.originalPageWidthPt * slot.scale * previewScale;
            const fullPageHpx = layout.originalPageHeightPt * slot.scale * previewScale;
            const cropOffsetXpx = layout.sourceBox.x * slot.scale * previewScale;
            const cropOffsetYpx = layout.sourceBox.y * slot.scale * previewScale;

            return (
              <React.Fragment key={slotIdx}>
                {/* Cell boundary reference when fill_cell or selected slot */}
                {copiesConfig.enabled && (
                  <div
                    style={{
                      left: slot.cellLeftPt * previewScale,
                      top: slot.cellTopPt * previewScale,
                      width: slot.cellWidthPt * previewScale,
                      height: slot.cellHeightPt * previewScale,
                    }}
                    className="pointer-events-none absolute border border-[#404040]/20"
                  />
                )}

                <div
                  onClick={() => setSelectedSlotIdx(slotIdx)}
                  style={{
                    left: slot.drawXPt * previewScale,
                    top: slot.drawTopPt * previewScale,
                    width: boxWpx,
                    height: boxHpx,
                  }}
                  className={`absolute overflow-hidden flex items-center justify-center cursor-pointer ${
                    slot.clipsSheet || (slot.clipsCell && !copiesConfig.allowOverlapOrOverflow)
                      ? 'ring-1 ring-red-500'
                      : selectedSlotIdx === slotIdx && copiesConfig.enabled
                      ? 'ring-2 ring-[#101010]'
                      : ''
                  } ${
                    copiesConfig.cuttingGuides
                      ? 'border border-dashed border-[#404040]/70'
                      : copiesConfig.showBorders
                      ? 'border border-[#404040]/60'
                      : 'border border-black/15'
                  }`}
                >
                  {thumbUrl && (
                    <div
                      style={{
                        width: unrotWpx,
                        height: unrotHpx,
                        transform: slot.rotation
                          ? `rotate(${slot.rotation}deg)`
                          : undefined,
                      }}
                      className="relative overflow-hidden shrink-0"
                    >
                      <img
                        src={thumbUrl}
                        alt={`Copy ${slotIdx + 1}`}
                        referrerPolicy="no-referrer"
                        style={{
                          position: 'absolute',
                          left: -cropOffsetXpx,
                          top: -cropOffsetYpx,
                          width: fullPageWpx,
                          height: fullPageHpx,
                          maxWidth: 'none',
                          maxHeight: 'none',
                        }}
                        className="opacity-90"
                      />
                    </div>
                  )}

                  {/* Crop Marks */}
                  {copiesConfig.cropMarks && (
                    <>
                      <span className="pointer-events-none absolute top-0 left-0 w-2 h-2 border-t border-l border-[#101010]" />
                      <span className="pointer-events-none absolute top-0 right-0 w-2 h-2 border-t border-r border-[#101010]" />
                      <span className="pointer-events-none absolute bottom-0 left-0 w-2 h-2 border-b border-l border-[#101010]" />
                      <span className="pointer-events-none absolute bottom-0 right-0 w-2 h-2 border-b border-r border-[#101010]" />
                    </>
                  )}

                  <div className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-[#101010]/90 text-white font-mono text-[10px] tabular-nums">
                    #{slotIdx + 1}
                    {slotSerials[0] ? ` · ${slotSerials[0]}` : ''}
                  </div>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>
      )}

      <PageConfigurationModal
        isOpen={showPageSetupModal}
        project={project}
        onClose={() => setShowPageSetupModal(false)}
        onApplyConfig={(nextPageConfig: PageConfig, nextSpacing, nextCopiesPatch, nextFitPatch) => {
          const mergedCopies = {
            ...project.copiesConfig,
            ...(nextSpacing || {}),
            ...(nextCopiesPatch || {}),
          };
          const perPage = mergedCopies.enabled
            ? Math.max(1, mergedCopies.columns * mergedCopies.rows)
            : 1;
          onUpdateProject({
            ...project,
            pageConfig: nextPageConfig,
            fitConfig: nextFitPatch
              ? { ...fitConfig, ...nextFitPatch }
              : project.fitConfig,
            exportConfig: {
              ...project.exportConfig,
              bleedPt: nextPageConfig.bleedPt ?? project.exportConfig.bleedPt,
              cropMarks: nextPageConfig.cropMarks ?? project.exportConfig.cropMarks,
              customWidthPt: undefined,
              customHeightPt: undefined,
            },
            copiesConfig: mergedCopies,
            bulkConfig: {
              ...project.bulkConfig,
              enabled: project.bulkConfig.enabled || mergedCopies.enabled,
              copiesPerPage: perPage,
              totalRecords: project.bulkConfig.totalOutputPages * perPage,
            },
            updatedAt: new Date().toISOString(),
          });
        }}
      />
    </div>
  );
};
