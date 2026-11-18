import React, { useId, useState } from 'react';
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
  ImagePlus,
  Italic,
  Link2,
  Loader2,
  Lock,
  Maximize2,
  Minus,
  Paintbrush,
  Plus,
  RotateCcw,
  Scan,
  Send,
  ShieldAlert,
  Sparkles,
  Star,
  Strikethrough,
  Trash2,
  Underline,
  Unlock,
  X,
} from 'lucide-react';
import {
  AnimatePresence,
  LayoutGroup,
  motion,
  useReducedMotion,
} from 'motion/react';
import {
  MOTION_DURATION,
  MOTION_SPRING,
  popoverVariants,
} from '../config/motionSystem';
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
import { computeTypographyLayout } from '../utils/typographyEngine';
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
  recentFonts?: string[];
  favoriteFonts?: string[];
  onToggleFavoriteFont?: (fontFamily: string) => void;
  onRecordRecentFont?: (fontFamily: string) => void;
  onCopyFormatting?: (el: DocumentElement) => void;
  onPasteFormatting?: (targetIds: string[]) => void;
  hasCopiedFormatting?: boolean;
  onStartStylePainter?: (
    el: DocumentElement,
    mode: 'appearance' | 'appearance_and_geometry'
  ) => void;
  onOpenRedactionConfirm?: () => void;
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
  recentFonts = [],
  favoriteFonts = [],
  onToggleFavoriteFont,
  onRecordRecentFont,
  onCopyFormatting,
  onPasteFormatting,
  hasCopiedFormatting = false,
  onStartStylePainter,
  onOpenRedactionConfirm,
}) => {
  const viewport = useViewport();
  const prefersReduced = useReducedMotion();
  const tabGroupId = useId();
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [pendingPlan, setPendingPlan] = useState<AiEditPlan | null>(null);
  const [equalGapPt, setEqualGapPt] = useState<number>(12);
  const [copiedDebug, setCopiedDebug] = useState(false);

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
        <div className="px-4 py-2 border-b border-black/10 dark:border-white/12 flex items-center justify-between shrink-0">
          <span className="text-xs font-semibold text-[#101010] dark:text-white">
            Inspector & AI Controls
          </span>
          {onCloseDrawer && (
            <button
              type="button"
              onClick={onCloseDrawer}
              className="min-w-[44px] min-h-[44px] -mr-2 flex items-center justify-center rounded-xl text-[#888888] hover:text-[#101010] dark:text-[#858585] dark:hover:text-white transition-colors"
              aria-label="Close inspector"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* Inspector Tabs */}
      <LayoutGroup id={`inspector-tabs-${tabGroupId}`}>
        <div className="grid grid-cols-3 border-b border-black/10 dark:border-white/12 text-xs font-medium shrink-0 px-2 pt-1.5 gap-1">
          {(['element', 'page', 'ai'] as const).map((tab) => {
            const active = activeTab === tab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => onTabChange(tab)}
                className={`relative min-h-[40px] tablet:min-h-[34px] text-center transition-colors rounded-t-xl ${
                  active
                    ? 'text-[#101010] dark:text-white font-semibold'
                    : 'text-[#888888] dark:text-[#858585] hover:text-[#101010] dark:hover:text-white'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId={`inspector-tab-bg-${tabGroupId}`}
                    transition={
                      prefersReduced
                        ? { duration: MOTION_DURATION.instant }
                        : MOTION_SPRING.nav
                    }
                    className="absolute inset-0 rounded-t-xl bg-black/[0.05] dark:bg-white/[0.08] border-b-2 border-[#101010] dark:border-white"
                    aria-hidden="true"
                  />
                )}
                <span className="relative z-10">
                  {tab === 'element'
                    ? 'Properties'
                    : tab === 'page'
                    ? 'Page & Fit'
                    : 'AI Assist'}
                </span>
              </button>
            );
          })}
        </div>
      </LayoutGroup>

      {/* Tab Body */}
      <div
        className={`flex-1 overflow-y-auto p-4 space-y-4 text-xs overscroll-contain ${
          viewport.keyboardOpen ? 'pb-28' : 'pb-safe'
        }`}
      >
        {activeTab === 'element' && (
          <>
            {selectedElements.length === 0 && (
              <div className="py-10 text-center text-[#888888] dark:text-[#858585]">
                Select any element on the canvas to inspect or edit its geometry, typography, and data mapping.
              </div>
            )}

            {selectedElements.length > 1 && (
              <div className="space-y-3.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-[#101010] dark:text-white tabular-nums">
                    {selectedElements.length} Elements Selected
                  </span>
                  {onGroupToggle && (
                    <button
                      type="button"
                      onClick={onGroupToggle}
                      className="px-2 py-1 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] text-[#101010] dark:text-white text-[11px] font-medium transition-colors"
                    >
                      {selectedElements[0]?.groupId ? 'Ungroup' : 'Group'}
                    </button>
                  )}
                </div>

                {onAlignSelected && (
                  <div>
                    <div className="text-[10px] font-medium text-[#555555] dark:text-[#B5B5B5] mb-1.5">
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
                          className="py-1.5 px-2 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] text-[#101010] dark:text-white text-[11px] font-medium transition-colors"
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {onDistributeSelected && selectedElements.length >= 3 && (
                  <div>
                    <div className="text-[10px] font-medium text-[#555555] dark:text-[#B5B5B5] mb-1.5">
                      Distribute Evenly
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        onClick={() => onDistributeSelected('horizontal')}
                        className="py-1.5 px-2 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] text-[#101010] dark:text-white text-[11px] font-medium transition-colors"
                      >
                        Distribute H
                      </button>
                      <button
                        type="button"
                        onClick={() => onDistributeSelected('vertical')}
                        className="py-1.5 px-2 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] text-[#101010] dark:text-white text-[11px] font-medium transition-colors"
                      >
                        Distribute V
                      </button>
                    </div>
                  </div>
                )}

                {onEqualSpaceSelected && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-medium text-[#555555] dark:text-[#B5B5B5]">
                        Equal Spacing (pt)
                      </span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={equalGapPt}
                        onChange={(e) => setEqualGapPt(Math.max(0, Number(e.target.value) || 0))}
                        className="w-14 px-1.5 py-0.5 rounded-lg border studio-input text-[11px] text-center tabular-nums"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        onClick={() => onEqualSpaceSelected('horizontal', equalGapPt)}
                        className="py-1.5 px-2 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] text-[#101010] dark:text-white text-[11px] font-medium transition-colors"
                      >
                        Equal Space H
                      </button>
                      <button
                        type="button"
                        onClick={() => onEqualSpaceSelected('vertical', equalGapPt)}
                        className="py-1.5 px-2 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] text-[#101010] dark:text-white text-[11px] font-medium transition-colors"
                      >
                        Equal Space V
                      </button>
                    </div>
                  </div>
                )}

                {onBatchUpdateSelected && (
                  <div className="space-y-2 pt-2 border-t border-black/10 dark:border-white/10">
                    <div className="text-[10px] font-medium text-[#555555] dark:text-[#B5B5B5]">
                      Batch Typography & Locking (Preserves Unique Text)
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <select
                        defaultValue=""
                        onChange={(e) => {
                          if (!e.target.value) return;
                          onBatchUpdateSelected({ fontFamily: e.target.value });
                        }}
                        className="px-2 py-1 rounded-lg border studio-select text-[11px]"
                      >
                        <option value="">Set Font...</option>
                        {FONT_OPTIONS.map((f) => (
                          <option key={f} value={f}>{f}</option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min={5}
                        max={120}
                        placeholder="Size (pt)"
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          if (v >= 5 && v <= 120) onBatchUpdateSelected({ fontSize: v });
                        }}
                        className="px-2 py-1 rounded-lg border studio-input text-[11px] tabular-nums"
                      />
                    </div>
                    <div className="grid grid-cols-4 gap-1">
                      <button
                        type="button"
                        onClick={() => onBatchUpdateSelected({ fontWeight: 'bold' })}
                        className="py-1 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] text-[11px] font-bold"
                      >
                        B
                      </button>
                      <button
                        type="button"
                        onClick={() => onBatchUpdateSelected({ fontStyle: 'italic' })}
                        className="py-1 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] text-[11px] italic"
                      >
                        I
                      </button>
                      <button
                        type="button"
                        onClick={() => onBatchUpdateSelected({ underline: true })}
                        className="py-1 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] text-[11px] underline"
                      >
                        U
                      </button>
                      <button
                        type="button"
                        onClick={() => onBatchUpdateSelected({ autofit: true })}
                        className="py-1 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] text-[10px]"
                      >
                        Fit
                      </button>
                    </div>
                    {hasCopiedFormatting && onPasteFormatting && (
                      <button
                        type="button"
                        onClick={() => onPasteFormatting(selectedElements.map((s) => s.id))}
                        className="w-full py-1.5 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] text-[#101010] dark:text-white text-[11px] font-medium"
                      >
                        Paste Copied Formatting to {selectedElements.length} Items
                      </button>
                    )}
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        onClick={() => onBatchUpdateSelected({ locked: true })}
                        className="py-1.5 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] text-[#101010] dark:text-white text-[11px] font-medium transition-colors"
                      >
                        Lock All
                      </button>
                      <button
                        type="button"
                        onClick={() => onBatchUpdateSelected({ locked: false })}
                        className="py-1.5 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] text-[#101010] dark:text-white text-[11px] font-medium transition-colors"
                      >
                        Unlock All
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex gap-2 pt-1 border-t border-black/10 dark:border-white/10">
                  <button
                    type="button"
                    onClick={onDuplicateSelected}
                    className="flex-1 py-1.5 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] text-[#101010] dark:text-white font-medium transition-colors"
                  >
                    Duplicate All
                  </button>
                  <button
                    type="button"
                    onClick={onDeleteSelected}
                    className="flex-1 py-1.5 rounded-lg border border-black/15 dark:border-white/15 text-[#555555] hover:text-[#101010] dark:text-[#B5B5B5] dark:hover:text-white hover:bg-black/[0.05] dark:hover:bg-white/[0.08] font-medium transition-colors"
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
                    <div className="font-semibold text-[#101010] dark:text-white capitalize">
                      {el.type.replace('_', ' ')}
                    </div>
                    <div className="text-[11px] text-[#555555] dark:text-[#B5B5B5] tabular-nums">
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
                      className="p-1.5 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] text-[#101010] dark:text-white transition-colors"
                    >
                      {el.locked ? (
                        <Lock className="w-3.5 h-3.5 text-[#101010] dark:text-white" />
                      ) : (
                        <Unlock className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <button
                      type="button"
                      title="Duplicate element"
                      onClick={onDuplicateSelected}
                      className="p-1.5 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] text-[#101010] dark:text-white transition-colors"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      title="Delete element"
                      onClick={onDeleteSelected}
                      className="p-1.5 rounded-lg border border-black/15 dark:border-white/15 text-[#555555] hover:text-[#101010] dark:text-[#B5B5B5] dark:hover:text-white hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {el.needsReview && (
                  <div className="p-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 space-y-2">
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
                      className="w-full py-1 rounded-lg bg-[#101010] text-white hover:bg-[#262626] dark:bg-white dark:text-[#050505] dark:hover:bg-[#E6E6E6] font-medium text-[11px] flex items-center justify-center gap-1 transition-colors"
                    >
                      <Check className="w-3 h-3" />
                      Mark Verified
                    </button>
                  </div>
                )}

                {/* Provenance, Edit Method & Layer Z-Index Readout */}
                {(() => {
                  const pageEls = allElements.filter((x) => x.pageNumber === el.pageNumber);
                  const zIdx = pageEls.findIndex((x) => x.id === el.id);
                  const originLabel =
                    el.sourceOrigin === 'scanned_ocr'
                      ? 'Scanned OCR'
                      : el.sourceOrigin === 'annotation'
                      ? 'Annotation Layer'
                      : el.sourceOrigin === 'redaction'
                      ? 'Redaction Layer'
                      : el.isUserAdded || el.sourceOrigin === 'user_overlay'
                      ? 'User Overlay'
                      : 'Native Original PDF';
                  const methodLabel =
                    el.type === 'redaction'
                      ? el.redactionApplied
                        ? 'Sanitized True Redaction'
                        : 'Pending Visual Mask'
                      : el.isUserAdded
                      ? 'Direct Overlay Object'
                      : el.eraseOriginal
                      ? 'Controlled Replacement Region'
                      : 'Original PDF Pass-Through';
                  return (
                    <div className="p-2.5 rounded-xl border border-black/10 dark:border-white/12 bg-black/[0.025] dark:bg-white/[0.03] space-y-1.5 text-[10px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-[#101010] dark:text-white">
                          Origin: {originLabel}
                        </span>
                        <span className="font-mono text-[#888888] dark:text-[#858585] tabular-nums">
                          Layer #{zIdx >= 0 ? zIdx + 1 : 1}/{Math.max(1, pageEls.length)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 text-[#555555] dark:text-[#B5B5B5]">
                        <span>Method: {methodLabel}</span>
                        <button
                          type="button"
                          onClick={() => {
                            try {
                              void navigator.clipboard?.writeText(JSON.stringify(el, null, 2));
                              setCopiedDebug(true);
                              window.setTimeout(() => setCopiedDebug(false), 1600);
                            } catch {
                              // Ignore clipboard errors
                            }
                          }}
                          className="underline hover:text-[#101010] dark:hover:text-white"
                        >
                          {copiedDebug ? 'Copied JSON' : 'Copy Debug'}
                        </button>
                      </div>
                    </div>
                  );
                })()}

                {/* Redaction Workflow Quick Action */}
                {el.type === 'redaction' && (
                  <div className="p-2.5 rounded-xl border border-red-500/35 bg-red-500/10 space-y-2">
                    <div className="flex items-start gap-2 text-red-700 dark:text-red-300 text-[11px]">
                      <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-semibold">
                          {el.redactionApplied
                            ? 'True Redaction Applied'
                            : 'Visual Mask Only — Sensitive Text Still Extractable'}
                        </div>
                        <div className="text-[10px] opacity-90">
                          {el.redactionApplied
                            ? 'Underlying glyphs will be permanently scrubbed on PDF export.'
                            : 'Click Apply True Redaction to permanently strip underlying PDF text on export.'}
                        </div>
                      </div>
                    </div>
                    {!el.redactionApplied && onOpenRedactionConfirm && (
                      <button
                        type="button"
                        onClick={onOpenRedactionConfirm}
                        className="w-full py-1.5 rounded-lg bg-[#101010] text-white dark:bg-white dark:text-[#050505] text-[11px] font-semibold"
                      >
                        Apply True Redaction...
                      </button>
                    )}
                  </div>
                )}

                {/* Coordinates, Dimensions, Aspect Lock, Rotation & Scaling */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-medium text-[#555555] dark:text-[#B5B5B5]">
                      Position & Dimensions ({unit})
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateElement(el.id, { lockAspectRatio: !el.lockAspectRatio })
                      }
                      className={`px-2 py-0.5 rounded-md border text-[10px] flex items-center gap-1 transition-colors ${
                        el.lockAspectRatio
                          ? 'studio-active-surface font-semibold'
                          : 'border-black/15 dark:border-white/15 text-[#555555] dark:text-[#B5B5B5]'
                      }`}
                    >
                      <Link2 className="w-3 h-3" />
                      {el.lockAspectRatio ? 'Ratio Locked' : 'Lock Ratio'}
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="text-[10px] text-[#888888] dark:text-[#858585]">X</span>
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
                        className={`mt-0.5 w-full px-2 rounded-lg border studio-input tabular-nums ${inputHeightClass}`}
                      />
                    </label>
                    <label className="block">
                      <span className="text-[10px] text-[#888888] dark:text-[#858585]">Y</span>
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
                        className={`mt-0.5 w-full px-2 rounded-lg border studio-input tabular-nums ${inputHeightClass}`}
                      />
                    </label>
                    <label className="block">
                      <span className="text-[10px] text-[#888888] dark:text-[#858585]">Width</span>
                      <input
                        type="number"
                        step="0.5"
                        onFocus={scrollOnFocus}
                        value={ptToUnit(el.width, unit)}
                        onChange={(e) => {
                          const newW = Math.max(4, unitToPt(Number(e.target.value), unit));
                          const ratio = el.width > 0 ? el.height / el.width : 1;
                          onUpdateElement(el.id, {
                            width: newW,
                            ...(el.lockAspectRatio
                              ? { height: Number(Math.max(4, newW * ratio).toFixed(2)) }
                              : {}),
                            eraseOriginal: el.isUserAdded ? false : true,
                          });
                        }}
                        className={`mt-0.5 w-full px-2 rounded-lg border studio-input tabular-nums ${inputHeightClass}`}
                      />
                    </label>
                    <label className="block">
                      <span className="text-[10px] text-[#888888] dark:text-[#858585]">Height</span>
                      <input
                        type="number"
                        step="0.5"
                        onFocus={scrollOnFocus}
                        value={ptToUnit(el.height, unit)}
                        onChange={(e) => {
                          const newH = Math.max(4, unitToPt(Number(e.target.value), unit));
                          const ratio = el.height > 0 ? el.width / el.height : 1;
                          onUpdateElement(el.id, {
                            height: newH,
                            ...(el.lockAspectRatio
                              ? { width: Number(Math.max(4, newH * ratio).toFixed(2)) }
                              : {}),
                            eraseOriginal: el.isUserAdded ? false : true,
                          });
                        }}
                        className={`mt-0.5 w-full px-2 rounded-lg border studio-input tabular-nums ${inputHeightClass}`}
                      />
                    </label>
                  </div>

                  {/* Quick Proportional Element Scaling */}
                  <div className="mt-2">
                    <span className="text-[10px] text-[#888888] dark:text-[#858585] block mb-1">
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
                          className={`px-2 py-1 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] text-[#101010] dark:text-white text-[11px] font-medium tabular-nums transition-colors ${btnHeightClass}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Rotation & Opacity */}
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div className="block">
                      <span className="text-[10px] text-[#888888] dark:text-[#858585]">Rotation (°)</span>
                      <div className="mt-0.5 flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            onUpdateElement(el.id, {
                              rotation: ((el.rotation || 0) - 15) % 360,
                            })
                          }
                          className={`px-2 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] text-[#101010] dark:text-white transition-colors ${btnHeightClass}`}
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
                          className={`w-full px-1.5 rounded-lg border studio-input tabular-nums text-center ${inputHeightClass}`}
                        />
                        <button
                          type="button"
                          onClick={() =>
                            onUpdateElement(el.id, {
                              rotation: ((el.rotation || 0) + 15) % 360,
                            })
                          }
                          className={`px-2 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] text-[#101010] dark:text-white transition-colors ${btnHeightClass}`}
                        >
                          +15°
                        </button>
                      </div>
                    </div>
                    <label className="block">
                      <span className="text-[10px] text-[#888888] dark:text-[#858585]">Opacity</span>
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
                        className={`mt-0.5 w-full px-2 rounded-lg border studio-input tabular-nums ${inputHeightClass}`}
                      />
                    </label>
                  </div>

                  {/* Layer Ordering */}
                  {onReorderElement && (
                    <div className="mt-2.5">
                      <span className="text-[10px] text-[#888888] dark:text-[#858585] block mb-1">
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
                            className={`px-1.5 py-1 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] text-[#101010] dark:text-white flex items-center justify-center gap-1 text-[10px] font-medium transition-colors ${btnHeightClass}`}
                          >
                            <Icon className="w-3.5 h-3.5" />
                            <span>{label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Object & Image Studio (for images & signatures) */}
                {(el.type === 'image' || el.type === 'signature') && (
                  <div className="pt-3 border-t border-black/10 dark:border-white/10 space-y-2.5">
                    <div className="text-[11px] font-medium text-[#555555] dark:text-[#B5B5B5]">
                      Image & Mask Studio
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="flex-1 py-1.5 px-2.5 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] text-center text-[11px] font-medium cursor-pointer flex items-center justify-center gap-1.5">
                        <ImagePlus className="w-3.5 h-3.5" />
                        Replace Image
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (!f) return;
                            const reader = new FileReader();
                            reader.onload = () => {
                              const dataUrl = String(reader.result || '');
                              const im = new Image();
                              im.onload = () => {
                                onUpdateElement(el.id, {
                                  imageDataUrl: dataUrl,
                                  imageNaturalWidth: im.naturalWidth,
                                  imageNaturalHeight: im.naturalHeight,
                                  imageCropRect: undefined,
                                  isUserAdded: true,
                                });
                              };
                              im.src = dataUrl;
                            };
                            reader.readAsDataURL(f);
                            e.target.value = '';
                          }}
                        />
                      </label>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block">
                        <span className="text-[10px] text-[#888888] dark:text-[#858585]">Mask Shape</span>
                        <select
                          value={el.maskShape || 'none'}
                          onChange={(e) =>
                            onUpdateElement(el.id, {
                              maskShape: e.target.value as 'none' | 'rect' | 'rounded' | 'circle',
                            })
                          }
                          className="mt-0.5 w-full px-2 py-1 rounded-lg border studio-select text-[11px]"
                        >
                          <option value="none">None</option>
                          <option value="rect">Rectangle</option>
                          <option value="rounded">Rounded Corners</option>
                          <option value="circle">Circle / Oval</option>
                        </select>
                      </label>
                      <label className="block">
                        <span className="text-[10px] text-[#888888] dark:text-[#858585]">Compression</span>
                        <select
                          value={el.imageCompressionQuality ?? 1}
                          onChange={(e) =>
                            onUpdateElement(el.id, {
                              imageCompressionQuality: Number(e.target.value),
                            })
                          }
                          className="mt-0.5 w-full px-2 py-1 rounded-lg border studio-select text-[11px]"
                        >
                          <option value={1}>Lossless (100%)</option>
                          <option value={0.85}>Balanced (85%)</option>
                          <option value={0.65}>Compact (65%)</option>
                        </select>
                      </label>
                    </div>
                    {el.imageNaturalWidth && el.imageNaturalHeight && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[10px] text-[#888888] dark:text-[#858585]">
                          <span>Crop (px: {el.imageNaturalWidth}×{el.imageNaturalHeight})</span>
                          {el.imageCropRect && (
                            <button
                              type="button"
                              onClick={() => onUpdateElement(el.id, { imageCropRect: undefined })}
                              className="underline text-[#101010] dark:text-white"
                            >
                              Reset Crop
                            </button>
                          )}
                        </div>
                        <div className="grid grid-cols-4 gap-1">
                          {(['x', 'y', 'width', 'height'] as const).map((k) => {
                            const natW = el.imageNaturalWidth!;
                            const natH = el.imageNaturalHeight!;
                            const cur = el.imageCropRect || { x: 0, y: 0, width: natW, height: natH };
                            return (
                              <label key={k} className="block">
                                <span className="text-[9px] uppercase text-[#888888]">{k}</span>
                                <input
                                  type="number"
                                  min={k === 'x' || k === 'y' ? 0 : 10}
                                  value={Math.round(cur[k])}
                                  onChange={(e) => {
                                    const next = { ...cur, [k]: Math.max(0, Number(e.target.value) || 0) };
                                    next.x = Math.min(natW - 10, next.x);
                                    next.y = Math.min(natH - 10, next.y);
                                    next.width = Math.max(10, Math.min(natW - next.x, next.width));
                                    next.height = Math.max(10, Math.min(natH - next.y, next.height));
                                    onUpdateElement(el.id, { imageCropRect: next });
                                  }}
                                  className="w-full px-1 py-0.5 rounded border studio-input text-[10px] tabular-nums"
                                />
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Annotation / Stamp / Callout Fields */}
                {(el.type === 'annotation' || el.type === 'stamp' || el.type === 'callout') && (
                  <div className="pt-3 border-t border-black/10 dark:border-white/10 space-y-2">
                    <div className="text-[11px] font-medium text-[#555555] dark:text-[#B5B5B5]">
                      {el.type === 'stamp'
                        ? 'Stamp Configuration'
                        : el.type === 'callout'
                        ? 'Callout Target'
                        : 'Annotation Details'}
                    </div>
                    {el.type === 'annotation' && (
                      <textarea
                        rows={2}
                        placeholder="Comment / review note..."
                        value={el.commentText || ''}
                        onChange={(e) => onUpdateElement(el.id, { commentText: e.target.value })}
                        className="w-full px-2 py-1.5 rounded-lg border studio-input text-xs"
                      />
                    )}
                    {el.type === 'stamp' && (
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={el.stampText ?? el.text}
                          onChange={(e) =>
                            onUpdateElement(el.id, {
                              stampText: e.target.value,
                              text: e.target.value,
                            })
                          }
                          placeholder="APPROVED"
                          className="px-2 py-1 rounded-lg border studio-input text-xs"
                        />
                        <input
                          type="text"
                          value={el.stampDate || ''}
                          onChange={(e) => onUpdateElement(el.id, { stampDate: e.target.value })}
                          placeholder="YYYY-MM-DD"
                          className="px-2 py-1 rounded-lg border studio-input text-xs tabular-nums"
                        />
                      </div>
                    )}
                    {el.type === 'callout' && el.calloutTarget && (
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block">
                          <span className="text-[10px] text-[#888888]">Target X (pt)</span>
                          <input
                            type="number"
                            value={Math.round(el.calloutTarget.x)}
                            onChange={(e) =>
                              onUpdateElement(el.id, {
                                calloutTarget: {
                                  ...el.calloutTarget!,
                                  x: Number(e.target.value) || 0,
                                },
                              })
                            }
                            className="w-full px-2 py-1 rounded-lg border studio-input text-xs tabular-nums"
                          />
                        </label>
                        <label className="block">
                          <span className="text-[10px] text-[#888888]">Target Y (pt)</span>
                          <input
                            type="number"
                            value={Math.round(el.calloutTarget.y)}
                            onChange={(e) =>
                              onUpdateElement(el.id, {
                                calloutTarget: {
                                  ...el.calloutTarget!,
                                  y: Number(e.target.value) || 0,
                                },
                              })
                            }
                            className="w-full px-2 py-1 rounded-lg border studio-input text-xs tabular-nums"
                          />
                        </label>
                      </div>
                    )}
                  </div>
                )}

                {/* Advanced Typography Studio & Styling */}
                {el.type !== 'image' && el.type !== 'signature' && el.type !== 'line' && el.type !== 'draw' && (
                  <div className="pt-3 border-t border-black/10 dark:border-white/10 space-y-2.5">
                    {(() => {
                      const typo = computeTypographyLayout(el);
                      return typo.isClipped ? (
                        <div className="p-2 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[10px] flex items-center justify-between gap-2">
                          <span>
                            Text overflows box ({Math.round(typo.totalTextHeightPt)}pt tall).
                          </span>
                          <button
                            type="button"
                            onClick={() => onUpdateElement(el.id, { autofit: true, eraseOriginal: el.isUserAdded ? false : true })}
                            className="underline font-semibold shrink-0"
                          >
                            Autofit
                          </button>
                        </div>
                      ) : null;
                    })()}

                    <label className="block">
                      <span className="text-[11px] font-medium text-[#555555] dark:text-[#B5B5B5]">
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
                        className="mt-1 w-full px-2.5 py-2 rounded-lg border studio-input text-sm tablet:text-xs"
                      />
                    </label>

                    <div className="grid grid-cols-1 tablet:grid-cols-2 gap-2">
                      <div className="block">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-[#888888] dark:text-[#858585]">Font</span>
                          {onToggleFavoriteFont && (
                            <button
                              type="button"
                              title="Favorite font"
                              onClick={() => onToggleFavoriteFont(el.fontFamily)}
                              className="text-[10px] flex items-center gap-0.5 text-[#555555] hover:text-[#101010] dark:text-[#B5B5B5] dark:hover:text-white"
                            >
                              <Star
                                className={`w-3 h-3 ${
                                  favoriteFonts.includes(el.fontFamily) ? 'fill-current' : ''
                                }`}
                              />
                            </button>
                          )}
                        </div>
                        <select
                          onFocus={scrollOnFocus}
                          value={el.fontFamily}
                          onChange={(e) => {
                            onRecordRecentFont?.(e.target.value);
                            onUpdateElement(el.id, {
                              fontFamily: e.target.value,
                              eraseOriginal: el.isUserAdded ? false : true,
                            });
                          }}
                          className={`mt-0.5 w-full px-2 rounded-lg border studio-select ${inputHeightClass}`}
                        >
                          {favoriteFonts.length > 0 && (
                            <optgroup label="Favorite Fonts">
                              {favoriteFonts.map((f) => (
                                <option key={`fav-${f}`} value={f}>
                                  ★ {f}
                                </option>
                              ))}
                            </optgroup>
                          )}
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
                      </div>
                      <div className="block">
                        <span className="text-[10px] text-[#888888] dark:text-[#858585]">Size (pt)</span>
                        <div className="mt-0.5 flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              onUpdateElement(el.id, {
                                fontSize: Math.max(5, Number((el.fontSize - 1).toFixed(1))),
                                eraseOriginal: el.isUserAdded ? false : true,
                              })
                            }
                            className={`px-2 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] text-[#101010] dark:text-white flex items-center justify-center transition-colors ${btnHeightClass}`}
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
                            className={`w-full px-1.5 text-center rounded-lg border studio-input tabular-nums ${inputHeightClass}`}
                          />
                          <button
                            type="button"
                            onClick={() =>
                              onUpdateElement(el.id, {
                                fontSize: Math.min(120, Number((el.fontSize + 1).toFixed(1))),
                                eraseOriginal: el.isUserAdded ? false : true,
                              })
                            }
                            className={`px-2 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] text-[#101010] dark:text-white flex items-center justify-center transition-colors ${btnHeightClass}`}
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Recent Font Chips & Live Preview */}
                    {recentFonts.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1">
                        {recentFonts.slice(0, 4).map((rf) => (
                          <button
                            key={rf}
                            type="button"
                            onClick={() =>
                              onUpdateElement(el.id, {
                                fontFamily: rf,
                                eraseOriginal: el.isUserAdded ? false : true,
                              })
                            }
                            style={{ fontFamily: rf }}
                            className={`px-2 py-0.5 rounded border text-[10px] transition-colors ${
                              el.fontFamily === rf
                                ? 'studio-active-surface font-semibold'
                                : 'border-black/10 dark:border-white/10 text-[#555555] dark:text-[#B5B5B5]'
                            }`}
                          >
                            {rf}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Style Toggles: Bold, Italic, Underline, Strikethrough + Align */}
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          title="Bold"
                          onClick={() =>
                            onUpdateElement(el.id, {
                              fontWeight: el.fontWeight === 'bold' ? 'normal' : 'bold',
                              eraseOriginal: el.isUserAdded ? false : true,
                            })
                          }
                          className={`p-1.5 rounded-lg border flex items-center justify-center transition-colors ${btnHeightClass} ${
                            el.fontWeight === 'bold'
                              ? 'studio-active-surface'
                              : 'border-black/15 dark:border-white/15 text-[#555555] dark:text-[#B5B5B5]'
                          }`}
                        >
                          <Bold className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          title="Italic"
                          onClick={() =>
                            onUpdateElement(el.id, {
                              fontStyle: el.fontStyle === 'italic' ? 'normal' : 'italic',
                              eraseOriginal: el.isUserAdded ? false : true,
                            })
                          }
                          className={`p-1.5 rounded-lg border flex items-center justify-center transition-colors ${btnHeightClass} ${
                            el.fontStyle === 'italic'
                              ? 'studio-active-surface'
                              : 'border-black/15 dark:border-white/15 text-[#555555] dark:text-[#B5B5B5]'
                          }`}
                        >
                          <Italic className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          title="Underline"
                          onClick={() =>
                            onUpdateElement(el.id, {
                              underline: !el.underline,
                              eraseOriginal: el.isUserAdded ? false : true,
                            })
                          }
                          className={`p-1.5 rounded-lg border flex items-center justify-center transition-colors ${btnHeightClass} ${
                            el.underline
                              ? 'studio-active-surface'
                              : 'border-black/15 dark:border-white/15 text-[#555555] dark:text-[#B5B5B5]'
                          }`}
                        >
                          <Underline className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          title="Strikethrough"
                          onClick={() =>
                            onUpdateElement(el.id, {
                              strikethrough: !el.strikethrough,
                              eraseOriginal: el.isUserAdded ? false : true,
                            })
                          }
                          className={`p-1.5 rounded-lg border flex items-center justify-center transition-colors ${btnHeightClass} ${
                            el.strikethrough
                              ? 'studio-active-surface'
                              : 'border-black/15 dark:border-white/15 text-[#555555] dark:text-[#B5B5B5]'
                          }`}
                        >
                          <Strikethrough className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="flex items-center gap-1">
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
                            className={`p-1.5 rounded-lg border flex items-center justify-center transition-colors ${btnHeightClass} ${
                              el.align === a
                                ? 'studio-active-surface'
                                : 'border-black/15 dark:border-white/15 text-[#555555] dark:text-[#B5B5B5]'
                            }`}
                          >
                            {a === 'left' ? (
                              <AlignLeft className="w-3.5 h-3.5" />
                            ) : a === 'center' ? (
                              <AlignCenter className="w-3.5 h-3.5" />
                            ) : (
                              <AlignRight className="w-3.5 h-3.5" />
                            )}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Vertical Align, Wrap & Autofit */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-[10px] text-[#888888] dark:text-[#858585] block mb-0.5">
                          Vertical Align
                        </span>
                        <div className="grid grid-cols-3 gap-1">
                          {(['top', 'middle', 'bottom'] as const).map((va) => (
                            <button
                              key={va}
                              type="button"
                              onClick={() =>
                                onUpdateElement(el.id, {
                                  verticalAlign: va,
                                  eraseOriginal: el.isUserAdded ? false : true,
                                })
                              }
                              className={`py-1 rounded border text-[10px] capitalize ${
                                (el.verticalAlign || 'top') === va
                                  ? 'studio-active-surface font-semibold'
                                  : 'border-black/15 dark:border-white/15 text-[#555555] dark:text-[#B5B5B5]'
                              }`}
                            >
                              {va}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="flex flex-col justify-end gap-1">
                        <label className="flex items-center gap-1.5 cursor-pointer text-[11px]">
                          <input
                            type="checkbox"
                            checked={el.textWrap !== false}
                            onChange={(e) =>
                              onUpdateElement(el.id, {
                                textWrap: e.target.checked,
                                eraseOriginal: el.isUserAdded ? false : true,
                              })
                            }
                          />
                          <span>Wrap Text</span>
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer text-[11px]">
                          <input
                            type="checkbox"
                            checked={Boolean(el.autofit)}
                            onChange={(e) =>
                              onUpdateElement(el.id, {
                                autofit: e.target.checked,
                                eraseOriginal: el.isUserAdded ? false : true,
                              })
                            }
                          />
                          <span>Autofit Box</span>
                        </label>
                      </div>
                    </div>

                    {/* Spacing & Box Padding Controls */}
                    <div className="grid grid-cols-4 gap-1.5">
                      <label className="block">
                        <span className="text-[9px] text-[#888888]">Track</span>
                        <input
                          type="number"
                          step="0.2"
                          value={el.letterSpacing ?? 0}
                          onChange={(e) =>
                            onUpdateElement(el.id, {
                              letterSpacing: Number(e.target.value) || 0,
                              eraseOriginal: el.isUserAdded ? false : true,
                            })
                          }
                          className="w-full px-1.5 py-1 rounded border studio-input text-[10px] tabular-nums"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[9px] text-[#888888]">Line H</span>
                        <input
                          type="number"
                          step="0.05"
                          min="0.8"
                          max="3"
                          value={el.lineHeight ?? 1.2}
                          onChange={(e) =>
                            onUpdateElement(el.id, {
                              lineHeight: Math.max(0.8, Number(e.target.value) || 1.2),
                              eraseOriginal: el.isUserAdded ? false : true,
                            })
                          }
                          className="w-full px-1.5 py-1 rounded border studio-input text-[10px] tabular-nums"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[9px] text-[#888888]">Para pt</span>
                        <input
                          type="number"
                          step="1"
                          min="0"
                          value={el.paragraphSpacing ?? 0}
                          onChange={(e) =>
                            onUpdateElement(el.id, {
                              paragraphSpacing: Math.max(0, Number(e.target.value) || 0),
                              eraseOriginal: el.isUserAdded ? false : true,
                            })
                          }
                          className="w-full px-1.5 py-1 rounded border studio-input text-[10px] tabular-nums"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[9px] text-[#888888]">Pad pt</span>
                        <input
                          type="number"
                          step="0.5"
                          min="0"
                          value={el.paddingPt ?? 1}
                          onChange={(e) =>
                            onUpdateElement(el.id, {
                              paddingPt: Math.max(0, Number(e.target.value) || 0),
                              eraseOriginal: el.isUserAdded ? false : true,
                            })
                          }
                          className="w-full px-1.5 py-1 rounded border studio-input text-[10px] tabular-nums"
                        />
                      </label>
                    </div>

                    {/* Formatting Copy / Paste & Style Painter Actions */}
                    {(onCopyFormatting || onStartStylePainter) && (
                      <div className="grid grid-cols-2 gap-1.5 pt-1">
                        {onCopyFormatting && (
                          <button
                            type="button"
                            onClick={() => onCopyFormatting(el)}
                            className="py-1 px-2 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] text-[10px] font-medium"
                          >
                            Copy Formatting
                          </button>
                        )}
                        {hasCopiedFormatting && onPasteFormatting ? (
                          <button
                            type="button"
                            onClick={() => onPasteFormatting([el.id])}
                            className="py-1 px-2 rounded-lg studio-active-surface border text-[10px] font-semibold"
                          >
                            Paste Formatting
                          </button>
                        ) : onStartStylePainter ? (
                          <button
                            type="button"
                            onClick={() => onStartStylePainter(el, 'appearance')}
                            className="py-1 px-2 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] text-[10px] font-medium flex items-center justify-center gap-1"
                          >
                            <Paintbrush className="w-3 h-3" />
                            Style Painter
                          </button>
                        ) : null}
                      </div>
                    )}

                    <div className="space-y-2">
                      <div>
                        <span className="text-[10px] text-[#888888] dark:text-[#858585] block mb-1">
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
                            className="w-9 h-9 rounded-lg border border-black/15 dark:border-white/15 bg-transparent cursor-pointer"
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
                                  ? 'ring-2 ring-[#101010] dark:ring-white border-white'
                                  : 'border-black/20 dark:border-white/20'
                              }`}
                            />
                          ))}
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] text-[#888888] dark:text-[#858585]">
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
                            className="w-9 h-9 rounded-lg border border-black/15 dark:border-white/15 bg-transparent cursor-pointer"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              onUpdateElement(el.id, {
                                backgroundColor: 'transparent',
                              })
                            }
                            className={`px-2.5 py-1 rounded-lg border border-black/15 dark:border-white/15 text-[11px] text-[#555555] dark:text-[#B5B5B5] hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-colors ${btnHeightClass}`}
                          >
                            Transparent
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Saved Asset Text Styles & Brand Palettes */}
                    {(savedTextStyles.length > 0 || savedPalettes.length > 0 || onSaveAsTextStyle) && (
                      <div className="pt-2 border-t border-black/10 dark:border-white/10 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-medium text-[#555555] dark:text-[#B5B5B5]">
                            Saved Library Styles
                          </span>
                          {onSaveAsTextStyle && (
                            <button
                              type="button"
                              onClick={() => onSaveAsTextStyle(el)}
                              className="text-[10px] text-[#101010] dark:text-white hover:underline font-medium"
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
                                className="px-2 py-1 rounded-lg border border-black/15 dark:border-white/15 hover:border-black/40 dark:hover:border-white/40 text-[10px] font-medium text-[#101010] dark:text-white transition-colors"
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
                                <span className="text-[10px] text-[#888888] dark:text-[#858585] truncate w-20">
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
                                      className="w-5 h-5 rounded border border-black/20 dark:border-white/20"
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
                <div className="pt-3 border-t border-black/10 dark:border-white/10 space-y-2.5">
                  <div className="text-[11px] font-medium text-[#555555] dark:text-[#B5B5B5]">
                    Bulk & Data Mapping
                  </div>
                  <label className="block">
                    <span className="text-[10px] text-[#888888] dark:text-[#858585]">
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
                      className={`mt-0.5 w-full px-2 rounded-lg border studio-input ${inputHeightClass}`}
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
                    <span className="text-[10px] text-[#888888] dark:text-[#858585]">
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
                      className={`mt-0.5 w-full px-2 rounded-lg border studio-input ${inputHeightClass}`}
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
                className="w-full py-2 px-3 rounded-xl border border-black/15 dark:border-white/15 bg-black/[0.04] dark:bg-white/[0.06] text-[#101010] dark:text-white hover:bg-black/[0.08] dark:hover:bg-white/[0.12] font-medium flex items-center justify-center gap-1.5 transition-colors"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                Custom Paper & Presets...
              </button>
            )}

            <label className="block">
              <span className="text-[11px] font-medium text-[#555555] dark:text-[#B5B5B5]">
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
                className="mt-1 w-full px-2.5 py-1.5 rounded-lg border studio-select"
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
              <span className="text-[11px] font-medium text-[#555555] dark:text-[#B5B5B5]">
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
                    className={`py-1.5 rounded-lg border font-medium text-[11px] transition-colors ${
                      pageConfig.orientation === ori
                        ? 'studio-active-surface font-semibold'
                        : 'border-black/15 dark:border-white/15 text-[#555555] dark:text-[#B5B5B5] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <label className="block">
              <span className="text-[11px] font-medium text-[#555555] dark:text-[#B5B5B5]">
                Measurement Unit
              </span>
              <select
                value={pageConfig.unit}
                onChange={(e) =>
                  onUpdatePageConfig({ unit: e.target.value as MeasurementUnit })
                }
                className="mt-1 w-full px-2.5 py-1.5 rounded-lg border studio-select"
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
                <span className="text-[10px] text-[#888888] dark:text-[#858585]">
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
                  className="mt-0.5 w-full px-2 py-1 rounded-lg border studio-input tabular-nums"
                />
              </label>
              <label className="block">
                <span className="text-[10px] text-[#888888] dark:text-[#858585]">
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
                  className="mt-0.5 w-full px-2 py-1 rounded-lg border studio-input tabular-nums"
                />
              </label>
            </div>

            {(() => {
              const dimCheck = validatePageConfigDimensions(pageConfig);
              if (dimCheck.valid && dimCheck.warnings.length === 0) return null;
              return (
                <div className="p-2 rounded-lg border border-amber-500/40 bg-amber-500/10 text-[11px] text-amber-700 dark:text-amber-300 flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>
                    {[...dimCheck.errors, ...dimCheck.warnings].join(' ')}
                  </span>
                </div>
              );
            })()}

            <div>
              <div className="text-[11px] font-medium text-[#555555] dark:text-[#B5B5B5] mb-1.5">
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
                    <span className="text-[10px] text-[#888888] dark:text-[#858585]">{label}</span>
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
                      className="mt-0.5 w-full px-2 py-1 rounded-lg border studio-input tabular-nums"
                    />
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[10px] text-[#888888] dark:text-[#858585]">Bleed ({unit})</span>
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
                  className="mt-0.5 w-full px-2 py-1 rounded-lg border studio-input tabular-nums"
                />
              </label>
              <label className="flex items-center gap-2 pt-4 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(pageConfig.cropMarks)}
                  onChange={(e) =>
                    onUpdatePageConfig({ cropMarks: e.target.checked })
                  }
                  className="rounded border-black/30 dark:border-white/30 accent-[#101010] dark:accent-white"
                />
                <span className="text-[11px] text-[#555555] dark:text-[#B5B5B5]">
                  Press Crop Marks
                </span>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[10px] text-[#888888] dark:text-[#858585]">Background</span>
                <div className="mt-0.5 flex items-center gap-2">
                  <input
                    type="color"
                    value={pageConfig.backgroundColor}
                    onChange={(e) =>
                      onUpdatePageConfig({ backgroundColor: e.target.value })
                    }
                    className="w-7 h-6 rounded border border-black/15 dark:border-white/15 cursor-pointer"
                  />
                  <span className="font-mono text-[11px] text-[#101010] dark:text-white">
                    {pageConfig.backgroundColor}
                  </span>
                </div>
              </label>
              <label className="block">
                <span className="text-[10px] text-[#888888] dark:text-[#858585]">Page Rotation</span>
                <select
                  value={pageConfig.rotation}
                  onChange={(e) =>
                    onUpdatePageConfig({
                      rotation: Number(e.target.value) as 0 | 90 | 180 | 270,
                    })
                  }
                  className="mt-0.5 w-full px-2 py-1 rounded-lg border studio-select"
                >
                  <option value={0}>0°</option>
                  <option value={90}>90° CW</option>
                  <option value={180}>180°</option>
                  <option value={270}>270° CW</option>
                </select>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[10px] text-[#888888] dark:text-[#858585]">
                  Header Text ({'{page}'})
                </span>
                <input
                  type="text"
                  placeholder="Optional header..."
                  value={pageConfig.headerText || ''}
                  onChange={(e) =>
                    onUpdatePageConfig({ headerText: e.target.value })
                  }
                  className="mt-0.5 w-full px-2 py-1 rounded-lg border studio-input text-[11px]"
                />
              </label>
              <label className="block">
                <span className="text-[10px] text-[#888888] dark:text-[#858585]">
                  Footer Text ({'{page}'})
                </span>
                <input
                  type="text"
                  placeholder="Optional footer..."
                  value={pageConfig.footerText || ''}
                  onChange={(e) =>
                    onUpdatePageConfig({ footerText: e.target.value })
                  }
                  className="mt-0.5 w-full px-2 py-1 rounded-lg border studio-input text-[11px]"
                />
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
                <div className="pt-3 border-t border-black/10 dark:border-white/10 space-y-3">
                  {/* Independent Geometry Readout */}
                  <div className="p-2.5 rounded-xl border border-black/10 dark:border-white/10 bg-[#F7F7F7] dark:bg-[#0B0B0B] space-y-1 text-[11px] tabular-nums">
                    <div className="font-semibold text-[#101010] dark:text-white">
                      Separated Geometry Dimensions
                    </div>
                    <div className="flex justify-between text-[#555555] dark:text-[#B5B5B5]">
                      <span>Original PDF Page:</span>
                      <span>
                        {ptToUnit(origW, unit)} × {ptToUnit(origH, unit)} {unit}
                      </span>
                    </div>
                    <div className="flex justify-between text-[#555555] dark:text-[#B5B5B5]">
                      <span>Active Source Region:</span>
                      <span className="text-[#101010] dark:text-white font-semibold">
                        {ptToUnit(activeSourceBox.width, unit)} ×{' '}
                        {ptToUnit(activeSourceBox.height, unit)} {unit}
                      </span>
                    </div>
                    <div className="flex justify-between text-[#555555] dark:text-[#B5B5B5]">
                      <span>Output Sheet Size:</span>
                      <span>
                        {ptToUnit(pageConfig.widthPt, unit)} ×{' '}
                        {ptToUnit(pageConfig.heightPt, unit)} {unit}
                      </span>
                    </div>
                    {insets && (
                      <div className="text-[10px] text-[#888888] dark:text-[#858585] pt-0.5">
                        Outer whitespace detected — L:{ptToUnit(insets.left, unit)} R:
                        {ptToUnit(insets.right, unit)} T:{ptToUnit(insets.top, unit)} B:
                        {ptToUnit(insets.bottom, unit)} {unit}
                      </div>
                    )}
                  </div>

                  {/* Source Boundary Mode */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] font-medium text-[#555555] dark:text-[#B5B5B5]">
                        Source Boundary Mode
                      </span>
                      <button
                        type="button"
                        disabled={redetectingBounds}
                        onClick={onRedetectBounds}
                        className="text-[10px] text-[#101010] dark:text-white hover:underline flex items-center gap-1 disabled:opacity-50 font-medium"
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
                          className={`py-1.5 px-2 rounded-lg border text-[11px] font-medium text-left truncate transition-colors ${
                            fitConfig.boundaryMode === mode
                              ? 'studio-active-surface font-semibold'
                              : 'border-black/15 dark:border-white/15 text-[#555555] dark:text-[#B5B5B5] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
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
                      className={`flex-1 py-1.5 px-2.5 rounded-lg border text-[11px] font-medium flex items-center justify-center gap-1.5 transition-colors ${
                        cropMode
                          ? 'border-[#101010] bg-[#101010] text-white dark:border-white dark:bg-white dark:text-[#050505]'
                          : 'border-black/15 dark:border-white/15 text-[#101010] dark:text-white hover:bg-black/[0.05] dark:hover:bg-white/[0.08]'
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
                      className="px-2.5 py-1.5 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] text-[#101010] dark:text-white text-[11px] flex items-center gap-1 transition-colors"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Reset
                    </button>
                  </div>

                  {/* Numerical Crop Region Inputs */}
                  <div>
                    <div className="text-[11px] font-medium text-[#555555] dark:text-[#B5B5B5] mb-1">
                      Crop Region ({unit})
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block">
                        <span className="text-[10px] text-[#888888] dark:text-[#858585]">Crop X</span>
                        <input
                          type="number"
                          step="0.5"
                          value={ptToUnit(activeSourceBox.x, unit)}
                          onChange={(e) =>
                            updateNumericCrop({
                              x: unitToPt(Number(e.target.value) || 0, unit),
                            })
                          }
                          className="mt-0.5 w-full px-2 py-1 rounded-lg border studio-input tabular-nums"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[10px] text-[#888888] dark:text-[#858585]">Crop Y</span>
                        <input
                          type="number"
                          step="0.5"
                          value={ptToUnit(activeSourceBox.y, unit)}
                          onChange={(e) =>
                            updateNumericCrop({
                              y: unitToPt(Number(e.target.value) || 0, unit),
                            })
                          }
                          className="mt-0.5 w-full px-2 py-1 rounded-lg border studio-input tabular-nums"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[10px] text-[#888888] dark:text-[#858585]">Crop Width</span>
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
                          className="mt-0.5 w-full px-2 py-1 rounded-lg border studio-input tabular-nums"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[10px] text-[#888888] dark:text-[#858585]">Crop Height</span>
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
                          className="mt-0.5 w-full px-2 py-1 rounded-lg border studio-input tabular-nums"
                        />
                      </label>
                    </div>
                  </div>

                  {fitConfig.boundaryMode === 'auto_content' && (
                    <label className="block">
                      <span className="text-[10px] text-[#888888] dark:text-[#858585]">
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
                        className="mt-0.5 w-full px-2 py-1 rounded-lg border studio-input tabular-nums"
                      />
                    </label>
                  )}

                  {/* Output Scaling & Proportional Fitting */}
                  <div className="space-y-2">
                    <label className="block">
                      <span className="text-[11px] font-medium text-[#555555] dark:text-[#B5B5B5]">
                        Output Scaling Mode (Aspect Locked)
                      </span>
                      <select
                        value={fitConfig.scalingMode}
                        onChange={(e) =>
                          onUpdateFitConfig({
                            scalingMode: e.target.value as ScalingMode,
                          })
                        }
                        className="mt-1 w-full px-2.5 py-1.5 rounded-lg border studio-select"
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
                        <span className="text-[10px] text-[#888888] dark:text-[#858585]">
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
                          className="mt-0.5 w-full px-2 py-1 rounded-lg border studio-input tabular-nums"
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
            <div className="p-3 rounded-xl border border-black/10 dark:border-white/12 bg-[#F7F7F7] dark:bg-[#0B0B0B] space-y-2.5">
              <div className="flex items-start gap-2">
                <Cpu className="w-4 h-4 text-[#101010] dark:text-white shrink-0 mt-0.5" />
                <div>
                  <div className="text-[11px] font-semibold text-[#101010] dark:text-white">
                    Local PDF Scan — Active (No AI credits required)
                  </div>
                  <p className="mt-0.5 text-[11px] text-[#555555] dark:text-[#B5B5B5] leading-relaxed">
                    {aiSummary ||
                      'Text, coordinates, fonts, borders, tables, and repeated blocks are extracted locally with PDF.js.'}
                  </p>
                </div>
              </div>

              {onRunAiEnhancedAnalysis && (
                <div className="pt-2 border-t border-black/10 dark:border-white/10 space-y-2">
                  <div className="text-[11px] text-[#555555] dark:text-[#B5B5B5] leading-relaxed">
                    <span className="font-semibold text-[#101010] dark:text-white">
                      AI-Enhanced Analysis (Optional):
                    </span>{' '}
                    Requires Gemini API access and may consume AI quota to refine semantic field roles and layout relationships.
                  </div>
                  <button
                    type="button"
                    disabled={aiEnhancing}
                    onClick={onRunAiEnhancedAnalysis}
                    className="w-full py-2 px-3 rounded-lg border border-black/15 dark:border-white/15 bg-black/[0.04] dark:bg-white/[0.06] text-[#101010] dark:text-white hover:bg-black/[0.08] dark:hover:bg-white/[0.12] font-medium flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
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
                  <AnimatePresence>
                    {aiEnhanceNotice && (
                      <motion.div
                        key="ai-enhance-notice"
                        variants={popoverVariants}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        className={`p-2 rounded-lg border text-[11px] leading-relaxed ${
                          aiEnhanceNotice.kind === 'warning'
                            ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                            : 'border-black/15 dark:border-white/15 bg-black/[0.04] dark:bg-white/[0.06] text-[#101010] dark:text-white'
                        }`}
                      >
                        {aiEnhanceNotice.message}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>

            <div className="pt-1 border-t border-black/10 dark:border-white/10 space-y-3">
              <div className="font-semibold text-[#101010] dark:text-white">
                AI Editing Assistant (Optional)
              </div>
              <p className="text-[#555555] dark:text-[#B5B5B5] leading-relaxed">
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
                className="w-full p-2.5 rounded-lg border studio-input focus:outline-none"
              />
              <button
                type="submit"
                disabled={aiLoading || !aiPrompt.trim()}
                className="w-full py-2 rounded-lg bg-[#101010] text-white hover:bg-[#262626] dark:bg-white dark:text-[#050505] dark:hover:bg-[#E6E6E6] font-semibold disabled:opacity-50 flex items-center justify-center gap-2 transition-colors active:scale-[0.98]"
              >
                {aiLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                {aiLoading ? 'Analyzing Edit...' : 'Run AI Command'}
              </button>
            </form>

            <AnimatePresence>
              {aiError && (
                <motion.div
                  key="ai-error"
                  variants={popoverVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="p-2.5 rounded-lg border border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-300"
                >
                  {aiError}
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {pendingPlan && (
                <motion.div
                  key="ai-pending-plan"
                  variants={popoverVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="p-3 rounded-xl border border-black/25 dark:border-white/25 bg-black/[0.03] dark:bg-white/[0.04] space-y-2.5"
                >
                  <div className="font-semibold text-[#101010] dark:text-white">
                    Preview Proposed Changes
                  </div>
                  <div className="text-[#555555] dark:text-[#B5B5B5]">
                    {pendingPlan.summary}
                  </div>
                  <div className="text-[11px] text-[#888888] dark:text-[#858585]">
                    {pendingPlan.impactDescription}
                  </div>
                  <div className="max-h-40 overflow-y-auto space-y-1 border-t border-black/10 dark:border-white/10 pt-2">
                    {pendingPlan.operations.map((op, i) => (
                      <div
                        key={i}
                        className="text-[11px] text-[#101010] dark:text-white"
                      >
                        <span className="font-mono uppercase font-semibold text-[#101010] dark:text-white">
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
                      className="flex-1 py-1.5 rounded-lg bg-[#101010] text-white hover:bg-[#262626] dark:bg-white dark:text-[#050505] dark:hover:bg-[#E6E6E6] font-semibold transition-colors active:scale-[0.98]"
                    >
                      Apply Changes
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingPlan(null)}
                      className="px-3 py-1.5 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] text-[#101010] dark:text-white transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="pt-2 border-t border-black/10 dark:border-white/10 space-y-1.5">
              <div className="text-[11px] font-medium text-[#555555] dark:text-[#B5B5B5]">
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
                  className="w-full text-left p-2 rounded-lg border border-black/10 dark:border-white/12 hover:border-black/30 dark:hover:border-white/30 hover:bg-black/[0.03] dark:hover:bg-white/[0.04] text-[11px] text-[#555555] dark:text-[#B5B5B5] transition-colors"
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
