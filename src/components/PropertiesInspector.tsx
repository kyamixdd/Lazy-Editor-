import React, { useState } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Bold,
  Check,
  ChevronsDown,
  ChevronsUp,
  Copy,
  Cpu,
  Crop,
  Italic,
  Loader2,
  Lock,
  Maximize2,
  Minus,
  Plus,
  RotateCcw,
  Scan,
  Send,
  Sparkles,
  Trash2,
  Unlock,
  X,
} from 'lucide-react';
import {
  AiEditPlan,
  AssetFontItem,
  AssetPaletteItem,
  AssetTextStyleItem,
  BoundaryMode,
  DocumentElement,
  MeasurementUnit,
  OriginalPageMeta,
  PageConfig,
  PageOrientation,
  PageSizePreset,
  RectPt,
  ScalingMode,
  SourceFitConfig,
} from '../types/pdfStudio';
import { useViewport } from '../hooks/useViewport';
import { formatFriendlyAiError } from '../utils/aiEnhancedAnalysis';
import { AlignMode } from '../utils/alignmentEngine';
import { clampRect } from '../utils/geometryEngine';
import {
  applyOrientationChange,
  getPresetDimensions,
  MAX_PAGE_DIM_PT,
  MIN_PAGE_DIM_PT,
  PAGE_PRESETS_PT,
  ptToUnit,
  unitToPt,
  validatePageConfigDimensions,
} from '../utils/units';

interface PropertiesInspectorProps {
  activeTab: 'element' | 'page' | 'ai';
  onTabChange: (tab: 'element' | 'page' | 'ai') => void;
  selectedElements: DocumentElement[];
  allElements: DocumentElement[];
  pageConfig: PageConfig;
  fitConfig: SourceFitConfig;
  originalPageMeta?: OriginalPageMeta;
  activeSourceBox: RectPt;
  cropMode: boolean;
  redetectingBounds: boolean;
  currentPage: number;
  dataColumnNames: string[];
  customFonts?: AssetFontItem[];
  savedTextStyles?: AssetTextStyleItem[];
  savedPalettes?: AssetPaletteItem[];
  panelWidthPx?: number;
  isDrawer?: boolean;
  hideDrawerHeader?: boolean;
  onCloseDrawer?: () => void;
  onReorderElement?: (
    id: string,
    dir: 'front' | 'back' | 'forward' | 'backward'
  ) => void;
  onUpdateElement: (id: string, patch: Partial<DocumentElement>) => void;
  onDeleteSelected: () => void;
  onDuplicateSelected: () => void;
  onAlignSelected?: (mode: AlignMode) => void;
  onDistributeSelected?: (axis: 'horizontal' | 'vertical') => void;
  onEqualSpaceSelected?: (axis: 'horizontal' | 'vertical', gapPt?: number) => void;
  onBatchUpdateSelected?: (patch: Partial<DocumentElement>) => void;
  onGroupToggle?: () => void;
  onSaveAsTextStyle?: (el: DocumentElement) => void;
  onUpdatePageConfig: (patch: Partial<PageConfig>) => void;
  onUpdateFitConfig: (patch: Partial<SourceFitConfig>) => void;
  onToggleCropMode: () => void;
  onRedetectBounds: () => void;
  onApplyAiPlan: (plan: AiEditPlan) => void;
  aiSummary?: string;
  aiEnhancing?: boolean;
  aiEnhanceNotice?: { kind: 'info' | 'warning'; message: string } | null;
  onRunAiEnhancedAnalysis?: () => void;
  onOpenPageSetup?: () => void;
}

const FONT_OPTIONS = [
  'Helvetica',
  'Times-Roman',
  'Courier',
  'Plus Jakarta Sans',
  'DM Sans',
  'JetBrains Mono',
];

const QUICK_AI_PROMPTS = [
  'Change all invoice numbers to a sequential series starting at INV-0001',
  'Make all receipt numbers bold',
  'Increase the font size of the main heading by 3pt',
  'Align all numbers cleanly along the right edge',
];

const QUICK_COLOR_SWATCHES = [
  '#111827',
  '#334155',
  '#2563EB',
  '#059669',
  '#DC2626',
  '#D97706',
];

export const PropertiesInspector: React.FC<PropertiesInspectorProps> = ({
  activeTab,
  onTabChange,
  selectedElements,
  allElements,
  pageConfig,
  fitConfig,
  originalPageMeta,
  activeSourceBox,
  cropMode,
  redetectingBounds,
  currentPage,
  dataColumnNames,
  customFonts = [],
  savedTextStyles = [],
  savedPalettes = [],
  panelWidthPx,
  isDrawer = false,
  hideDrawerHeader = false,
  onCloseDrawer,
  onReorderElement,
  onUpdateElement,
  onDeleteSelected,
  onDuplicateSelected,
  onAlignSelected,
  onDistributeSelected,
  onEqualSpaceSelected,
  onBatchUpdateSelected,
  onGroupToggle,
  onSaveAsTextStyle,
  onUpdatePageConfig,
  onUpdateFitConfig,
  onToggleCropMode,
  onRedetectBounds,
  onApplyAiPlan,
  aiSummary,
  aiEnhancing = false,
  aiEnhanceNotice = null,
  onRunAiEnhancedAnalysis,
  onOpenPageSetup,
}) => {
  const viewport = useViewport();
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [pendingPlan, setPendingPlan] = useState<AiEditPlan | null>(null);
  const [equalGapPt, setEqualGapPt] = useState<number>(12);

  const el = selectedElements.length === 1 ? selectedElements[0] : null;
  const unit = pageConfig.unit;
  const isTouchCompact = isDrawer || viewport.isMobile;
  const inputHeightClass = isTouchCompact ? 'min-h-[44px] py-2' : 'py-1';
  const btnHeightClass = isTouchCompact ? 'min-h-[44px]' : '';

  const scrollOnFocus = (
    e: React.FocusEvent<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >
  ) => {
    if (viewport.isMobile || viewport.isTablet) {
      const target = e.currentTarget;
      window.setTimeout(() => {
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 150);
    }
  };

  const handleRunAiCommand = async (promptToSend?: string) => {
    const instruction = (promptToSend ?? aiPrompt).trim();
    if (!instruction) return;
    setAiLoading(true);
    setAiError(null);
    setPendingPlan(null);

    try {
      const res = await fetch('/api/ai/edit-command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instruction,
          currentElements: allElements,
          selectedElementIds: selectedElements.map((s) => s.id),
          pageConfig,
          currentPage,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const friendly = formatFriendlyAiError(
          data.error || 'AI assistant request failed',
          res.status,
          data.code
        );
        throw new Error(friendly.message);
      }
      const plan = data as AiEditPlan;
      if (!plan.requiresConfirmation && plan.operations.length <= 1) {
        onApplyAiPlan(plan);
        setAiPrompt('');
      } else {
        setPendingPlan(plan);
      }
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'AI command failed');
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <aside
      style={
        isDrawer
          ? { maxHeight: `${viewport.visualHeight}px` }
          : panelWidthPx
          ? { width: `${panelWidthPx}px` }
          : undefined
      }
      className={
        isDrawer
          ? 'w-full h-full bg-transparent flex flex-col overflow-hidden'
          : 'w-80 shrink-0 border-l glass-level-2 flex flex-col h-full overflow-hidden'
      }
    >
      {isDrawer && !hideDrawerHeader && (
        <div className="px-4 py-2 border-b border-slate-200/70 dark:border-white/10 flex items-center justify-between shrink-0">
          <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
            Inspector & AI Controls
          </span>
          {onCloseDrawer && (
            <button
              type="button"
              onClick={onCloseDrawer}
              className="min-w-[44px] min-h-[44px] -mr-2 flex items-center justify-center rounded-xl text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
              aria-label="Close inspector"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* Inspector Tabs */}
      <div className="grid grid-cols-3 border-b border-slate-200/70 dark:border-white/10 text-xs font-medium shrink-0 px-2 pt-1.5 gap-1">
        {(['element', 'page', 'ai'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => onTabChange(tab)}
            className={`min-h-[40px] tablet:min-h-[34px] text-center transition-colors rounded-t-xl border-b-2 ${
              activeTab === tab
                ? 'border-blue-500 text-blue-600 dark:text-blue-400 bg-blue-500/8'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            {tab === 'element' ? 'Properties' : tab === 'page' ? 'Page & Fit' : 'AI Assist'}
          </button>
        ))}
      </div>

      {/* Tab Body */}
      <div
        className={`flex-1 overflow-y-auto p-4 space-y-4 text-xs overscroll-contain ${
          viewport.keyboardOpen ? 'pb-28' : 'pb-safe'
        }`}
      >
        {activeTab === 'element' && (
          <>
            {selectedElements.length === 0 && (
              <div className="py-10 text-center text-slate-500 dark:text-slate-400">
                Select any element on the canvas to inspect or edit its geometry, typography, and data mapping.
              </div>
            )}

            {selectedElements.length > 1 && (
              <div className="space-y-3.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                    {selectedElements.length} Elements Selected
                  </span>
                  {onGroupToggle && (
                    <button
                      type="button"
                      onClick={onGroupToggle}
                      className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-medium"
                    >
                      {selectedElements[0]?.groupId ? 'Ungroup' : 'Group'}
                    </button>
                  )}
                </div>

                {onAlignSelected && (
                  <div>
                    <div className="text-[10px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">
                      Align Selection
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(
                        [
                          ['left', 'Left'],
                          ['center', 'Center'],
                          ['right', 'Right'],
                          ['top', 'Top'],
                          ['middle', 'Middle'],
                          ['bottom', 'Bottom'],
                        ] as const
                      ).map(([mode, label]) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => onAlignSelected(mode)}
                          className="py-1.5 px-2 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-medium"
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {onDistributeSelected && selectedElements.length >= 3 && (
                  <div>
                    <div className="text-[10px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">
                      Distribute Evenly
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        onClick={() => onDistributeSelected('horizontal')}
                        className="py-1.5 px-2 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-medium"
                      >
                        Distribute H
                      </button>
                      <button
                        type="button"
                        onClick={() => onDistributeSelected('vertical')}
                        className="py-1.5 px-2 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-medium"
                      >
                        Distribute V
                      </button>
                    </div>
                  </div>
                )}

                {onEqualSpaceSelected && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
                        Equal Spacing (pt)
                      </span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={equalGapPt}
                        onChange={(e) => setEqualGapPt(Math.max(0, Number(e.target.value) || 0))}
                        className="w-14 px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-700 bg-transparent text-[11px] text-center tabular-nums"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        onClick={() => onEqualSpaceSelected('horizontal', equalGapPt)}
                        className="py-1.5 px-2 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-medium"
                      >
                        Equal Space H
                      </button>
                      <button
                        type="button"
                        onClick={() => onEqualSpaceSelected('vertical', equalGapPt)}
                        className="py-1.5 px-2 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-medium"
                      >
                        Equal Space V
                      </button>
                    </div>
                  </div>
                )}

                {onBatchUpdateSelected && (
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => onBatchUpdateSelected({ locked: true })}
                      className="py-1.5 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-medium"
                    >
                      Lock All
                    </button>
                    <button
                      type="button"
                      onClick={() => onBatchUpdateSelected({ locked: false })}
                      className="py-1.5 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-medium"
                    >
                      Unlock All
                    </button>
                  </div>
                )}

                <div className="flex gap-2 pt-1 border-t border-slate-200 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={onDuplicateSelected}
                    className="flex-1 py-1.5 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium"
                  >
                    Duplicate All
                  </button>
                  <button
                    type="button"
                    onClick={onDeleteSelected}
                    className="flex-1 py-1.5 rounded border border-red-500/40 text-red-600 dark:text-red-400 hover:bg-red-500/10 font-medium"
                  >
                    Delete All
                  </button>
                </div>
              </div>
            )}

            {el && (
              <div className="space-y-4">
                {/* Header & Review Warning */}
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="font-semibold text-slate-900 dark:text-slate-100 capitalize">
                      {el.type.replace('_', ' ')}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                      Confidence: {Math.round(el.confidence * 100)}%
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      title={el.locked ? 'Unlock layer' : 'Lock layer'}
                      onClick={() =>
                        onUpdateElement(el.id, { locked: !el.locked })
                      }
                      className="p-1.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      {el.locked ? (
                        <Lock className="w-3.5 h-3.5 text-amber-500" />
                      ) : (
                        <Unlock className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <button
                      type="button"
                      title="Duplicate element"
                      onClick={onDuplicateSelected}
                      className="p-1.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      title="Delete element"
                      onClick={onDeleteSelected}
                      className="p-1.5 rounded border border-slate-200 dark:border-slate-700 text-red-500 hover:bg-red-500/10"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {el.needsReview && (
                  <div className="p-2.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 space-y-2">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <div className="text-[11px]">
                        {el.reviewReason || 'Uncertain AI extraction. Please verify values.'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateElement(el.id, { needsReview: false })
                      }
                      className="w-full py-1 rounded bg-amber-600 text-white font-medium text-[11px] hover:bg-amber-700 flex items-center justify-center gap-1"
                    >
                      <Check className="w-3 h-3" />
                      Mark Verified
                    </button>
                  </div>
                )}

                {/* Coordinates, Dimensions, Rotation & Scaling */}
                <div>
                  <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">
                    Position & Dimensions ({unit})
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="text-[10px] text-slate-400">X</span>
                      <input
                        type="number"
                        step="0.5"
                        onFocus={scrollOnFocus}
                        value={ptToUnit(el.x, unit)}
                        onChange={(e) =>
                          onUpdateElement(el.id, {
                            x: unitToPt(Number(e.target.value), unit),
                            eraseOriginal: el.isUserAdded ? false : true,
                          })
                        }
                        className={`mt-0.5 w-full px-2 rounded border border-slate-300 dark:border-slate-700 bg-transparent tabular-nums ${inputHeightClass}`}
                      />
                    </label>
                    <label className="block">
                      <span className="text-[10px] text-slate-400">Y</span>
                      <input
                        type="number"
                        step="0.5"
                        onFocus={scrollOnFocus}
                        value={ptToUnit(el.y, unit)}
                        onChange={(e) =>
                          onUpdateElement(el.id, {
                            y: unitToPt(Number(e.target.value), unit),
                            eraseOriginal: el.isUserAdded ? false : true,
                          })
                        }
                        className={`mt-0.5 w-full px-2 rounded border border-slate-300 dark:border-slate-700 bg-transparent tabular-nums ${inputHeightClass}`}
                      />
                    </label>
                    <label className="block">
                      <span className="text-[10px] text-slate-400">Width</span>
                      <input
                        type="number"
                        step="0.5"
                        onFocus={scrollOnFocus}
                        value={ptToUnit(el.width, unit)}
                        onChange={(e) =>
                          onUpdateElement(el.id, {
                            width: Math.max(
                              4,
                              unitToPt(Number(e.target.value), unit)
                            ),
                            eraseOriginal: el.isUserAdded ? false : true,
                          })
                        }
                        className={`mt-0.5 w-full px-2 rounded border border-slate-300 dark:border-slate-700 bg-transparent tabular-nums ${inputHeightClass}`}
                      />
                    </label>
                    <label className="block">
                      <span className="text-[10px] text-slate-400">Height</span>
                      <input
                        type="number"
                        step="0.5"
                        onFocus={scrollOnFocus}
                        value={ptToUnit(el.height, unit)}
                        onChange={(e) =>
                          onUpdateElement(el.id, {
                            height: Math.max(
                              4,
                              unitToPt(Number(e.target.value), unit)
                            ),
                            eraseOriginal: el.isUserAdded ? false : true,
                          })
                        }
                        className={`mt-0.5 w-full px-2 rounded border border-slate-300 dark:border-slate-700 bg-transparent tabular-nums ${inputHeightClass}`}
                      />
                    </label>
                  </div>

                  {/* Quick Proportional Element Scaling */}
                  <div className="mt-2">
                    <span className="text-[10px] text-slate-400 block mb-1">
                      Quick Scale
                    </span>
                    <div className="grid grid-cols-3 gap-1.5">
                      {[
                        ['-10%', 0.9],
                        ['+10%', 1.1],
                        ['+25%', 1.25],
                      ].map(([label, factor]) => (
                        <button
                          key={String(label)}
                          type="button"
                          onClick={() =>
                            onUpdateElement(el.id, {
                              width: Number(
                                Math.max(8, el.width * Number(factor)).toFixed(2)
                              ),
                              height: Number(
                                Math.max(6, el.height * Number(factor)).toFixed(2)
                              ),
                              fontSize: Number(
                                Math.max(6, el.fontSize * Number(factor)).toFixed(1)
                              ),
                              eraseOriginal: el.isUserAdded ? false : true,
                            })
                          }
                          className={`px-2 py-1 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-medium tabular-nums ${btnHeightClass}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Rotation & Opacity */}
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div className="block">
                      <span className="text-[10px] text-slate-400">Rotation (°)</span>
                      <div className="mt-0.5 flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            onUpdateElement(el.id, {
                              rotation: ((el.rotation || 0) - 15) % 360,
                            })
                          }
                          className={`px-2 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 ${btnHeightClass}`}
                        >
                          -15°
                        </button>
                        <input
                          type="number"
                          onFocus={scrollOnFocus}
                          value={el.rotation}
                          onChange={(e) =>
                            onUpdateElement(el.id, {
                              rotation: Number(e.target.value) || 0,
                            })
                          }
                          className={`w-full px-1.5 rounded border border-slate-300 dark:border-slate-700 bg-transparent tabular-nums text-center ${inputHeightClass}`}
                        />
                        <button
                          type="button"
                          onClick={() =>
                            onUpdateElement(el.id, {
                              rotation: ((el.rotation || 0) + 15) % 360,
                            })
                          }
                          className={`px-2 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 ${btnHeightClass}`}
                        >
                          +15°
                        </button>
                      </div>
                    </div>
                    <label className="block">
                      <span className="text-[10px] text-slate-400">Opacity</span>
                      <input
                        type="number"
                        min="0.1"
                        max="1"
                        step="0.05"
                        onFocus={scrollOnFocus}
                        value={el.opacity}
                        onChange={(e) =>
                          onUpdateElement(el.id, {
                            opacity: Math.max(
                              0.05,
                              Math.min(1, Number(e.target.value) || 1)
                            ),
                          })
                        }
                        className={`mt-0.5 w-full px-2 rounded border border-slate-300 dark:border-slate-700 bg-transparent tabular-nums ${inputHeightClass}`}
                      />
                    </label>
                  </div>

                  {/* Layer Ordering */}
                  {onReorderElement && (
                    <div className="mt-2.5">
                      <span className="text-[10px] text-slate-400 block mb-1">
                        Layer Ordering
                      </span>
                      <div className="grid grid-cols-4 gap-1">
                        {(
                          [
                            ['back', 'Back', ChevronsDown],
                            ['backward', 'Down', ArrowDown],
                            ['forward', 'Up', ArrowUp],
                            ['front', 'Front', ChevronsUp],
                          ] as const
                        ).map(([dir, label, Icon]) => (
                          <button
                            key={dir}
                            type="button"
                            title={label}
                            onClick={() => onReorderElement(el.id, dir)}
                            className={`px-1.5 py-1 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center gap-1 text-[10px] font-medium ${btnHeightClass}`}
                          >
                            <Icon className="w-3.5 h-3.5" />
                            <span>{label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Text Content & Typography */}
                {el.type !== 'image' && el.type !== 'line' && (
                  <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
                    <label className="block">
                      <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        Text Content
                      </span>
                      <textarea
                        rows={2}
                        onFocus={scrollOnFocus}
                        value={el.text}
                        onChange={(e) =>
                          onUpdateElement(el.id, {
                            text: e.target.value,
                            eraseOriginal: el.isUserAdded ? false : true,
                            needsReview: false,
                          })
                        }
                        className="mt-1 w-full px-2.5 py-2 rounded border border-slate-300 dark:border-slate-700 bg-transparent text-slate-900 dark:text-slate-100 text-sm tablet:text-xs"
                      />
                    </label>

                    <div className="grid grid-cols-1 tablet:grid-cols-2 gap-2">
                      <label className="block">
                        <span className="text-[10px] text-slate-400">Font</span>
                        <select
                          onFocus={scrollOnFocus}
                          value={el.fontFamily}
                          onChange={(e) =>
                            onUpdateElement(el.id, {
                              fontFamily: e.target.value,
                              eraseOriginal: el.isUserAdded ? false : true,
                            })
                          }
                          className={`mt-0.5 w-full px-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111827] ${inputHeightClass}`}
                        >
                          <optgroup label="Standard PDF Fonts">
                            {FONT_OPTIONS.map((f) => (
                              <option key={f} value={f}>
                                {f}
                              </option>
                            ))}
                          </optgroup>
                          {customFonts.length > 0 && (
                            <optgroup label="Asset Library Fonts">
                              {customFonts.map((cf) => (
                                <option key={cf.id} value={cf.fontFamily}>
                                  {cf.fontFamily}
                                  {!cf.canEmbedInPdf ? ' [No PDF Embed]' : ''}
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                      </label>
                      <div className="block">
                        <span className="text-[10px] text-slate-400">Size (pt)</span>
                        <div className="mt-0.5 flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              onUpdateElement(el.id, {
                                fontSize: Math.max(5, Number((el.fontSize - 1).toFixed(1))),
                                eraseOriginal: el.isUserAdded ? false : true,
                              })
                            }
                            className={`px-2.5 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center ${btnHeightClass}`}
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <input
                            type="number"
                            min="5"
                            max="120"
                            onFocus={scrollOnFocus}
                            value={el.fontSize}
                            onChange={(e) =>
                              onUpdateElement(el.id, {
                                fontSize: Math.max(5, Number(e.target.value) || 11),
                                eraseOriginal: el.isUserAdded ? false : true,
                              })
                            }
                            className={`w-full px-1.5 text-center rounded border border-slate-300 dark:border-slate-700 bg-transparent tabular-nums ${inputHeightClass}`}
                          />
                          <button
                            type="button"
                            onClick={() =>
                              onUpdateElement(el.id, {
                                fontSize: Math.min(120, Number((el.fontSize + 1).toFixed(1))),
                                eraseOriginal: el.isUserAdded ? false : true,
                              })
                            }
                            className={`px-2.5 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center ${btnHeightClass}`}
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            onUpdateElement(el.id, {
                              fontWeight:
                                el.fontWeight === 'bold' ? 'normal' : 'bold',
                              eraseOriginal: el.isUserAdded ? false : true,
                            })
                          }
                          className={`px-3 py-1.5 rounded border flex items-center justify-center ${btnHeightClass} ${
                            el.fontWeight === 'bold'
                              ? 'border-blue-500 bg-blue-500/15 text-blue-500'
                              : 'border-slate-300 dark:border-slate-700'
                          }`}
                        >
                          <Bold className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onUpdateElement(el.id, {
                              fontStyle:
                                el.fontStyle === 'italic' ? 'normal' : 'italic',
                              eraseOriginal: el.isUserAdded ? false : true,
                            })
                          }
                          className={`px-3 py-1.5 rounded border flex items-center justify-center ${btnHeightClass} ${
                            el.fontStyle === 'italic'
                              ? 'border-blue-500 bg-blue-500/15 text-blue-500'
                              : 'border-slate-300 dark:border-slate-700'
                          }`}
                        >
                          <Italic className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {(['left', 'center', 'right'] as const).map((a) => (
                          <button
                            key={a}
                            type="button"
                            onClick={() =>
                              onUpdateElement(el.id, {
                                align: a,
                                eraseOriginal: el.isUserAdded ? false : true,
                              })
                            }
                            className={`px-3 py-1.5 rounded border flex items-center justify-center ${btnHeightClass} ${
                              el.align === a
                                ? 'border-blue-500 bg-blue-500/15 text-blue-500'
                                : 'border-slate-300 dark:border-slate-700'
                            }`}
                          >
                            {a === 'left' ? (
                              <AlignLeft className="w-4 h-4" />
                            ) : a === 'center' ? (
                              <AlignCenter className="w-4 h-4" />
                            ) : (
                              <AlignRight className="w-4 h-4" />
                            )}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div>
                        <span className="text-[10px] text-slate-400 block mb-1">
                          Text Color
                        </span>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <input
                            type="color"
                            value={el.color}
                            onChange={(e) =>
                              onUpdateElement(el.id, {
                                color: e.target.value,
                                eraseOriginal: el.isUserAdded ? false : true,
                              })
                            }
                            className="w-9 h-9 rounded border border-slate-300 dark:border-slate-700 bg-transparent cursor-pointer"
                          />
                          {QUICK_COLOR_SWATCHES.map((hex) => (
                            <button
                              key={hex}
                              type="button"
                              title={hex}
                              onClick={() =>
                                onUpdateElement(el.id, {
                                  color: hex,
                                  eraseOriginal: el.isUserAdded ? false : true,
                                })
                              }
                              style={{ backgroundColor: hex }}
                              className={`w-7 h-7 rounded-md border ${
                                el.color.toLowerCase() === hex.toLowerCase()
                                  ? 'ring-2 ring-blue-500 border-white'
                                  : 'border-slate-300 dark:border-slate-700'
                              }`}
                            />
                          ))}
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] text-slate-400">
                          Background Fill
                        </span>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={
                              el.backgroundColor === 'transparent'
                                ? '#FFFFFF'
                                : el.backgroundColor
                            }
                            onChange={(e) =>
                              onUpdateElement(el.id, {
                                backgroundColor: e.target.value,
                                eraseOriginal: el.isUserAdded ? false : true,
                              })
                            }
                            className="w-9 h-9 rounded border border-slate-300 dark:border-slate-700 bg-transparent cursor-pointer"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              onUpdateElement(el.id, {
                                backgroundColor: 'transparent',
                              })
                            }
                            className={`px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 text-[11px] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 ${btnHeightClass}`}
                          >
                            Transparent
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Saved Asset Text Styles & Brand Palettes */}
                    {(savedTextStyles.length > 0 || savedPalettes.length > 0 || onSaveAsTextStyle) && (
                      <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-medium text-slate-500">
                            Saved Library Styles
                          </span>
                          {onSaveAsTextStyle && (
                            <button
                              type="button"
                              onClick={() => onSaveAsTextStyle(el)}
                              className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline font-medium"
                            >
                              + Save Current Style
                            </button>
                          )}
                        </div>
                        {savedTextStyles.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {savedTextStyles.map((st) => (
                              <button
                                key={st.id}
                                type="button"
                                onClick={() =>
                                  onUpdateElement(el.id, {
                                    fontFamily: st.fontFamily,
                                    fontSize: st.fontSize,
                                    fontWeight: st.fontWeight,
                                    fontStyle: st.fontStyle,
                                    color: st.color,
                                    align: st.align,
                                    eraseOriginal: el.isUserAdded ? false : true,
                                  })
                                }
                                className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 hover:border-blue-500 text-[10px] font-medium"
                              >
                                {st.name}
                              </button>
                            ))}
                          </div>
                        )}
                        {savedPalettes.length > 0 && (
                          <div className="space-y-1">
                            {savedPalettes.map((pal) => (
                              <div key={pal.id} className="flex items-center gap-1.5">
                                <span className="text-[10px] text-slate-400 truncate w-20">
                                  {pal.name}
                                </span>
                                <div className="flex items-center gap-1">
                                  {pal.colors.map((hex) => (
                                    <button
                                      key={hex}
                                      type="button"
                                      title={`Apply ${hex}`}
                                      onClick={() =>
                                        onUpdateElement(el.id, {
                                          color: hex,
                                          eraseOriginal: el.isUserAdded ? false : true,
                                        })
                                      }
                                      style={{ backgroundColor: hex }}
                                      className="w-5 h-5 rounded border border-slate-300 dark:border-slate-700"
                                    />
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Dynamic Field Mapping & Block Grouping */}
                <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
                  <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    Bulk & Data Mapping
                  </div>
                  <label className="block">
                    <span className="text-[10px] text-slate-400">
                      Mapped Field Key (for Serial / CSV)
                    </span>
                    <input
                      type="text"
                      list="studio-field-keys"
                      onFocus={scrollOnFocus}
                      placeholder="e.g. invoice_number"
                      value={el.fieldKey || ''}
                      onChange={(e) =>
                        onUpdateElement(el.id, { fieldKey: e.target.value || undefined })
                      }
                      className={`mt-0.5 w-full px-2 rounded border border-slate-300 dark:border-slate-700 bg-transparent ${inputHeightClass}`}
                    />
                    <datalist id="studio-field-keys">
                      <option value="invoice_number" />
                      <option value="receipt_number" />
                      {dataColumnNames.map((col) => (
                        <option key={col} value={col} />
                      ))}
                    </datalist>
                  </label>
                  <label className="block">
                    <span className="text-[10px] text-slate-400">
                      Document Block ID
                    </span>
                    <input
                      type="text"
                      onFocus={scrollOnFocus}
                      placeholder="e.g. block-A, block-B"
                      value={el.blockId || ''}
                      onChange={(e) =>
                        onUpdateElement(el.id, { blockId: e.target.value || undefined })
                      }
                      className={`mt-0.5 w-full px-2 rounded border border-slate-300 dark:border-slate-700 bg-transparent ${inputHeightClass}`}
                    />
                  </label>
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === 'page' && (
          <div className="space-y-4">
            {onOpenPageSetup && (
              <button
                type="button"
                onClick={onOpenPageSetup}
                className="w-full py-2 px-3 rounded border border-blue-600/40 bg-blue-600/10 text-blue-600 dark:text-blue-400 hover:bg-blue-600/15 font-medium flex items-center justify-center gap-1.5"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                Custom Paper & Presets...
              </button>
            )}

            <label className="block">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Page Size {pageConfig.customPresetName ? `(${pageConfig.customPresetName})` : ''}
              </span>
              <select
                value={pageConfig.sizePreset}
                onChange={(e) => {
                  const preset = e.target.value as PageSizePreset;
                  if (preset === 'Custom') {
                    onUpdatePageConfig({
                      sizePreset: 'Custom',
                      customPresetId: undefined,
                      customPresetName: undefined,
                    });
                    return;
                  }
                  const oriForPreset =
                    pageConfig.orientation === 'custom'
                      ? 'portrait'
                      : pageConfig.orientation;
                  const dims = getPresetDimensions(
                    preset,
                    oriForPreset,
                    pageConfig.widthPt,
                    pageConfig.heightPt
                  );
                  onUpdatePageConfig({
                    sizePreset: preset,
                    orientation: oriForPreset,
                    widthPt: dims.widthPt,
                    heightPt: dims.heightPt,
                    customPresetId: undefined,
                    customPresetName: undefined,
                  });
                }}
                className="mt-1 w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111827]"
              >
                {(Object.keys(PAGE_PRESETS_PT) as Array<Exclude<PageSizePreset, 'Custom'>>).map(
                  (key) => (
                    <option key={key} value={key}>
                      {PAGE_PRESETS_PT[key].label}
                    </option>
                  )
                )}
                <option value="Custom">Custom Dimensions</option>
              </select>
            </label>

            <div>
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Orientation
              </span>
              <div className="mt-1 grid grid-cols-3 gap-1.5">
                {(
                  [
                    ['portrait', 'Portrait'],
                    ['landscape', 'Landscape'],
                    ['custom', 'Custom'],
                  ] as Array<[PageOrientation, string]>
                ).map(([ori, label]) => (
                  <button
                    key={ori}
                    type="button"
                    onClick={() => {
                      const swapped = applyOrientationChange(pageConfig, ori);
                      onUpdatePageConfig({
                        orientation: swapped.orientation,
                        widthPt: Number(swapped.widthPt.toFixed(2)),
                        heightPt: Number(swapped.heightPt.toFixed(2)),
                      });
                    }}
                    className={`py-1.5 rounded border font-medium text-[11px] ${
                      pageConfig.orientation === ori
                        ? 'border-blue-600 bg-blue-600/10 text-blue-600 dark:text-blue-400'
                        : 'border-slate-300 dark:border-slate-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <label className="block">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Measurement Unit
              </span>
              <select
                value={pageConfig.unit}
                onChange={(e) =>
                  onUpdatePageConfig({ unit: e.target.value as MeasurementUnit })
                }
                className="mt-1 w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111827]"
              >
                <option value="mm">Millimeters (mm)</option>
                <option value="cm">Centimeters (cm)</option>
                <option value="in">Inches (in)</option>
                <option value="pt">Points (pt · 72/in)</option>
                <option value="px">Pixels (px · 96 DPI)</option>
              </select>
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[10px] text-slate-400">
                  Width ({unit})
                </span>
                <input
                  type="number"
                  step="0.5"
                  value={ptToUnit(pageConfig.widthPt, unit)}
                  onChange={(e) => {
                    const num = Number(e.target.value);
                    if (!Number.isFinite(num) || num <= 0) return;
                    const clamped = Math.max(
                      MIN_PAGE_DIM_PT,
                      Math.min(MAX_PAGE_DIM_PT, unitToPt(num, unit))
                    );
                    onUpdatePageConfig({
                      sizePreset: 'Custom',
                      customPresetId: undefined,
                      customPresetName: undefined,
                      widthPt: Number(clamped.toFixed(2)),
                    });
                  }}
                  className="mt-0.5 w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-transparent tabular-nums"
                />
              </label>
              <label className="block">
                <span className="text-[10px] text-slate-400">
                  Height ({unit})
                </span>
                <input
                  type="number"
                  step="0.5"
                  value={ptToUnit(pageConfig.heightPt, unit)}
                  onChange={(e) => {
                    const num = Number(e.target.value);
                    if (!Number.isFinite(num) || num <= 0) return;
                    const clamped = Math.max(
                      MIN_PAGE_DIM_PT,
                      Math.min(MAX_PAGE_DIM_PT, unitToPt(num, unit))
                    );
                    onUpdatePageConfig({
                      sizePreset: 'Custom',
                      customPresetId: undefined,
                      customPresetName: undefined,
                      heightPt: Number(clamped.toFixed(2)),
                    });
                  }}
                  className="mt-0.5 w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-transparent tabular-nums"
                />
              </label>
            </div>

            {(() => {
              const dimCheck = validatePageConfigDimensions(pageConfig);
              if (dimCheck.valid && dimCheck.warnings.length === 0) return null;
              return (
                <div className="p-2 rounded border border-amber-500/40 bg-amber-500/10 text-[11px] text-amber-700 dark:text-amber-300 flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>
                    {[...dimCheck.errors, ...dimCheck.warnings].join(' ')}
                  </span>
                </div>
              );
            })()}

            <div>
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">
                Page Margins ({unit})
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ['Top', 'marginTopPt'],
                    ['Bottom', 'marginBottomPt'],
                    ['Left', 'marginLeftPt'],
                    ['Right', 'marginRightPt'],
                  ] as const
                ).map(([label, key]) => (
                  <label key={key} className="block">
                    <span className="text-[10px] text-slate-400">{label}</span>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={ptToUnit(pageConfig[key], unit)}
                      onChange={(e) =>
                        onUpdatePageConfig({
                          [key]: Math.max(0, unitToPt(Number(e.target.value) || 0, unit)),
                        })
                      }
                      className="mt-0.5 w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-transparent tabular-nums"
                    />
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[10px] text-slate-400">Bleed ({unit})</span>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={ptToUnit(pageConfig.bleedPt ?? 0, unit)}
                  onChange={(e) =>
                    onUpdatePageConfig({
                      bleedPt: Math.max(0, unitToPt(Number(e.target.value) || 0, unit)),
                    })
                  }
                  className="mt-0.5 w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-transparent tabular-nums"
                />
              </label>
              <label className="flex items-center gap-2 pt-4 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(pageConfig.cropMarks)}
                  onChange={(e) =>
                    onUpdatePageConfig({ cropMarks: e.target.checked })
                  }
                  className="rounded border-slate-400 text-blue-600"
                />
                <span className="text-[11px] text-slate-700 dark:text-slate-300">
                  Press Crop Marks
                </span>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[10px] text-slate-400">Background</span>
                <div className="mt-0.5 flex items-center gap-2">
                  <input
                    type="color"
                    value={pageConfig.backgroundColor}
                    onChange={(e) =>
                      onUpdatePageConfig({ backgroundColor: e.target.value })
                    }
                    className="w-7 h-6 rounded border border-slate-300 dark:border-slate-700 cursor-pointer"
                  />
                  <span className="font-mono text-[11px]">
                    {pageConfig.backgroundColor}
                  </span>
                </div>
              </label>
              <label className="block">
                <span className="text-[10px] text-slate-400">Page Rotation</span>
                <select
                  value={pageConfig.rotation}
                  onChange={(e) =>
                    onUpdatePageConfig({
                      rotation: Number(e.target.value) as 0 | 90 | 180 | 270,
                    })
                  }
                  className="mt-0.5 w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111827]"
                >
                  <option value={0}>0°</option>
                  <option value={90}>90° CW</option>
                  <option value={180}>180°</option>
                  <option value={270}>270° CW</option>
                </select>
              </label>
            </div>

            {/* Source Content Boundaries, Crop & Proportional Fitting */}
            {(() => {
              const origW = originalPageMeta?.widthPt || pageConfig.widthPt;
              const origH = originalPageMeta?.heightPt || pageConfig.heightPt;
              const detected = originalPageMeta?.contentBBox;
              const insets = originalPageMeta?.detectedBounds?.whitespaceInsetsPt;
              const updateNumericCrop = (patch: Partial<RectPt>) => {
                const next = clampRect(
                  { ...activeSourceBox, ...patch },
                  origW,
                  origH
                );
                const isManual = fitConfig.boundaryMode === 'manual_selection';
                onUpdateFitConfig({
                  boundaryMode: isManual ? 'manual_selection' : 'custom_crop',
                  ...(isManual
                    ? { manualBoundsRect: next }
                    : { customCropRect: next }),
                });
              };

              return (
                <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-3">
                  {/* Independent Geometry Readout */}
                  <div className="p-2.5 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#111827] space-y-1 text-[11px] tabular-nums">
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      Separated Geometry Dimensions
                    </div>
                    <div className="flex justify-between text-slate-600 dark:text-slate-400">
                      <span>Original PDF Page:</span>
                      <span>
                        {ptToUnit(origW, unit)} × {ptToUnit(origH, unit)} {unit}
                      </span>
                    </div>
                    <div className="flex justify-between text-slate-600 dark:text-slate-400">
                      <span>Active Source Region:</span>
                      <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                        {ptToUnit(activeSourceBox.width, unit)} ×{' '}
                        {ptToUnit(activeSourceBox.height, unit)} {unit}
                      </span>
                    </div>
                    <div className="flex justify-between text-slate-600 dark:text-slate-400">
                      <span>Output Sheet Size:</span>
                      <span>
                        {ptToUnit(pageConfig.widthPt, unit)} ×{' '}
                        {ptToUnit(pageConfig.heightPt, unit)} {unit}
                      </span>
                    </div>
                    {insets && (
                      <div className="text-[10px] text-slate-500 pt-0.5">
                        Outer whitespace detected — L:{ptToUnit(insets.left, unit)} R:
                        {ptToUnit(insets.right, unit)} T:{ptToUnit(insets.top, unit)} B:
                        {ptToUnit(insets.bottom, unit)} {unit}
                      </div>
                    )}
                  </div>

                  {/* Source Boundary Mode */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        Source Boundary Mode
                      </span>
                      <button
                        type="button"
                        disabled={redetectingBounds}
                        onClick={onRedetectBounds}
                        className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 disabled:opacity-50"
                      >
                        {redetectingBounds ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Scan className="w-3 h-3" />
                        )}
                        Re-Detect Content
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {(
                        [
                          ['original_page', 'A. Original Page'],
                          ['auto_content', 'B. Auto Content'],
                          ['manual_selection', 'C. Manual Bounds'],
                          ['custom_crop', 'D. Custom Crop'],
                        ] as Array<[BoundaryMode, string]>
                      ).map(([mode, label]) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => {
                            if (mode === 'manual_selection' && !fitConfig.manualBoundsRect) {
                              onUpdateFitConfig({
                                boundaryMode: mode,
                                manualBoundsRect: detected || activeSourceBox,
                              });
                            } else if (mode === 'custom_crop' && !fitConfig.customCropRect) {
                              onUpdateFitConfig({
                                boundaryMode: mode,
                                customCropRect: detected || activeSourceBox,
                              });
                            } else {
                              onUpdateFitConfig({ boundaryMode: mode });
                            }
                          }}
                          className={`py-1.5 px-2 rounded border text-[11px] font-medium text-left truncate ${
                            fitConfig.boundaryMode === mode
                              ? 'border-emerald-600 bg-emerald-600/12 text-emerald-700 dark:text-emerald-400'
                              : 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Visual Crop Handle Toggle + Reset */}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={onToggleCropMode}
                      className={`flex-1 py-1.5 px-2.5 rounded border text-[11px] font-medium flex items-center justify-center gap-1.5 ${
                        cropMode
                          ? 'border-emerald-600 bg-emerald-600 text-white'
                          : 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      <Crop className="w-3.5 h-3.5" />
                      {cropMode ? 'Finish Visual Crop' : 'Visual Crop Handles'}
                    </button>
                    <button
                      type="button"
                      title="Reset crop to original PDF page boundaries"
                      onClick={() =>
                        onUpdateFitConfig({
                          boundaryMode: 'original_page',
                          customCropRect: { x: 0, y: 0, width: origW, height: origH },
                          manualBoundsRect: undefined,
                        })
                      }
                      className="px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] flex items-center gap-1"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Reset
                    </button>
                  </div>

                  {/* Numerical Crop Region Inputs */}
                  <div>
                    <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                      Crop Region ({unit})
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block">
                        <span className="text-[10px] text-slate-400">Crop X</span>
                        <input
                          type="number"
                          step="0.5"
                          value={ptToUnit(activeSourceBox.x, unit)}
                          onChange={(e) =>
                            updateNumericCrop({
                              x: unitToPt(Number(e.target.value) || 0, unit),
                            })
                          }
                          className="mt-0.5 w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-transparent tabular-nums"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[10px] text-slate-400">Crop Y</span>
                        <input
                          type="number"
                          step="0.5"
                          value={ptToUnit(activeSourceBox.y, unit)}
                          onChange={(e) =>
                            updateNumericCrop({
                              y: unitToPt(Number(e.target.value) || 0, unit),
                            })
                          }
                          className="mt-0.5 w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-transparent tabular-nums"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[10px] text-slate-400">Crop Width</span>
                        <input
                          type="number"
                          step="0.5"
                          value={ptToUnit(activeSourceBox.width, unit)}
                          onChange={(e) =>
                            updateNumericCrop({
                              width: Math.max(
                                16,
                                unitToPt(Number(e.target.value) || 16, unit)
                              ),
                            })
                          }
                          className="mt-0.5 w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-transparent tabular-nums"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[10px] text-slate-400">Crop Height</span>
                        <input
                          type="number"
                          step="0.5"
                          value={ptToUnit(activeSourceBox.height, unit)}
                          onChange={(e) =>
                            updateNumericCrop({
                              height: Math.max(
                                16,
                                unitToPt(Number(e.target.value) || 16, unit)
                              ),
                            })
                          }
                          className="mt-0.5 w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-transparent tabular-nums"
                        />
                      </label>
                    </div>
                  </div>

                  {fitConfig.boundaryMode === 'auto_content' && (
                    <label className="block">
                      <span className="text-[10px] text-slate-400">
                        Content Safety Padding ({unit})
                      </span>
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        value={ptToUnit(fitConfig.cropPaddingPt, unit)}
                        onChange={(e) =>
                          onUpdateFitConfig({
                            cropPaddingPt: Math.max(
                              0,
                              unitToPt(Number(e.target.value) || 0, unit)
                            ),
                          })
                        }
                        className="mt-0.5 w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-transparent tabular-nums"
                      />
                    </label>
                  )}

                  {/* Output Scaling & Proportional Fitting */}
                  <div className="space-y-2">
                    <label className="block">
                      <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        Output Scaling Mode (Aspect Locked)
                      </span>
                      <select
                        value={fitConfig.scalingMode}
                        onChange={(e) =>
                          onUpdateFitConfig({
                            scalingMode: e.target.value as ScalingMode,
                          })
                        }
                        className="mt-1 w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111827]"
                      >
                        <option value="auto_fit_aspect">
                          Auto-Fit (Preserve Aspect Ratio)
                        </option>
                        <option value="fit_to_page">Fit to Output Page</option>
                        <option value="fit_to_width">Fit to Width</option>
                        <option value="fit_to_height">Fit to Height</option>
                        <option value="fit_to_cell">Fit to Selected Cell</option>
                        <option value="fill_cell">Fill Selected Cell (Crop Excess)</option>
                        <option value="preserve_original">
                          Preserve Original Physical Size (100%)
                        </option>
                        <option value="custom_percent">Custom Percentage</option>
                      </select>
                    </label>

                    {fitConfig.scalingMode === 'custom_percent' && (
                      <label className="block">
                        <span className="text-[10px] text-slate-400">
                          Custom Scale (%)
                        </span>
                        <input
                          type="number"
                          min="10"
                          max="400"
                          value={fitConfig.customPercent}
                          onChange={(e) =>
                            onUpdateFitConfig({
                              customPercent: Math.max(
                                10,
                                Number(e.target.value) || 100
                              ),
                            })
                          }
                          className="mt-0.5 w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-transparent tabular-nums"
                        />
                      </label>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {activeTab === 'ai' && (
          <div className="space-y-4">
            {/* Scanning Mode Transparency & Optional AI-Enhanced Analysis */}
            <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#111827] space-y-2.5">
              <div className="flex items-start gap-2">
                <Cpu className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <div className="text-[11px] font-semibold text-slate-900 dark:text-slate-100">
                    Local PDF Scan — Active (No AI credits required)
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                    {aiSummary ||
                      'Text, coordinates, fonts, borders, tables, and repeated blocks are extracted locally with PDF.js.'}
                  </p>
                </div>
              </div>

              {onRunAiEnhancedAnalysis && (
                <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                    <span className="font-semibold text-slate-700 dark:text-slate-200">
                      AI-Enhanced Analysis (Optional):
                    </span>{' '}
                    Requires Gemini API access and may consume AI quota to refine semantic field roles and layout relationships.
                  </div>
                  <button
                    type="button"
                    disabled={aiEnhancing}
                    onClick={onRunAiEnhancedAnalysis}
                    className="w-full py-2 px-3 rounded-md border border-blue-500/50 bg-blue-600/10 text-blue-600 dark:text-blue-400 hover:bg-blue-600/20 font-medium flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {aiEnhancing ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                    {aiEnhancing
                      ? 'Running AI-Enhanced Analysis...'
                      : 'AI-Enhanced Analysis'}
                  </button>
                  {aiEnhanceNotice && (
                    <div
                      className={`p-2 rounded border text-[11px] leading-relaxed ${
                        aiEnhanceNotice.kind === 'warning'
                          ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                          : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                      }`}
                    >
                      {aiEnhanceNotice.message}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="pt-1 border-t border-slate-200 dark:border-slate-800 space-y-3">
              <div className="font-semibold text-slate-900 dark:text-slate-100">
                AI Editing Assistant (Optional)
              </div>
              <p className="text-slate-500 dark:text-slate-400 leading-relaxed">
                Issue natural-language instructions to edit document elements directly. Requires Gemini API access; significant changes show an exact preview diff before applying.
              </p>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleRunAiCommand();
              }}
              className="space-y-2"
            >
              <textarea
                rows={3}
                placeholder="e.g. Make all receipt numbers bold, or move the heading 5pt left..."
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                className="w-full p-2.5 rounded-md border border-slate-300 dark:border-slate-700 bg-transparent text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500"
              />
              <button
                type="submit"
                disabled={aiLoading || !aiPrompt.trim()}
                className="w-full py-2 rounded-md bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {aiLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                {aiLoading ? 'Analyzing Edit...' : 'Run AI Command'}
              </button>
            </form>

            {aiError && (
              <div className="p-2.5 rounded border border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-300">
                {aiError}
              </div>
            )}

            {pendingPlan && (
              <div className="p-3 rounded-md border border-blue-500/50 bg-blue-500/5 space-y-2.5">
                <div className="font-semibold text-slate-900 dark:text-slate-100">
                  Preview Proposed Changes
                </div>
                <div className="text-slate-600 dark:text-slate-300">
                  {pendingPlan.summary}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  {pendingPlan.impactDescription}
                </div>
                <div className="max-h-40 overflow-y-auto space-y-1 border-t border-slate-200 dark:border-slate-800 pt-2">
                  {pendingPlan.operations.map((op, i) => (
                    <div
                      key={i}
                      className="text-[11px] text-slate-700 dark:text-slate-300"
                    >
                      <span className="font-mono uppercase text-blue-600 dark:text-blue-400">
                        {op.action}
                      </span>{' '}
                      — {op.reason}
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      onApplyAiPlan(pendingPlan);
                      setPendingPlan(null);
                      setAiPrompt('');
                    }}
                    className="flex-1 py-1.5 rounded bg-blue-600 text-white font-medium hover:bg-blue-700"
                  >
                    Apply Changes
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingPlan(null)}
                    className="px-3 py-1.5 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-1.5">
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Suggested Commands
              </div>
              {QUICK_AI_PROMPTS.map((q) => (
                <button
                  key={q}
                  type="button"
                  disabled={aiLoading}
                  onClick={() => {
                    setAiPrompt(q);
                    void handleRunAiCommand(q);
                  }}
                  className="w-full text-left p-2 rounded border border-slate-200 dark:border-slate-800 hover:border-blue-500/50 text-[11px] text-slate-600 dark:text-slate-300 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
