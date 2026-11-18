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
  CheckCircle2,
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
  QrCode,
  RotateCcw,
  Scan,
  ScanBarcode,
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
  BarcodeFormat,
  BoundaryMode,
  DocumentElement,
  ElementType,
  MeasurementUnit,
  ObjectCategory,
  ObjectClassification,
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
import { validateBarcodeSpec } from '../utils/barcodeEngine';
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
import { NumericDraftInput } from './NumericDraftInput';

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
  onConvertSelectionToTable?: () => void;
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

const SUBTYPE_RECLASSIFY_OPTIONS: Array<{
  value: ObjectClassification;
  label: string;
  category: ObjectCategory;
  type: ElementType;
}> = [
  { value: 'text', label: 'Text Block', category: 'text', type: 'text' },
  { value: 'text_run', label: 'Text Run', category: 'text', type: 'text' },
  { value: 'text_group', label: 'Text Group', category: 'text', type: 'text' },
  { value: 'paragraph', label: 'Paragraph', category: 'text', type: 'text' },
  { value: 'heading', label: 'Heading', category: 'text', type: 'text' },
  { value: 'label', label: 'Field Label', category: 'text', type: 'text' },
  { value: 'identifier_field', label: 'Invoice / Receipt / ID #', category: 'text', type: 'text' },
  { value: 'date_field', label: 'Date Field', category: 'text', type: 'text' },
  { value: 'numeric_field', label: 'Numeric / Amount', category: 'text', type: 'text' },
  { value: 'horizontal_line', label: 'Horizontal Line', category: 'vector', type: 'line' },
  { value: 'vertical_line', label: 'Vertical Line', category: 'vector', type: 'line' },
  { value: 'diagonal_line', label: 'Diagonal Line', category: 'vector', type: 'line' },
  { value: 'dashed_line', label: 'Dashed Line', category: 'vector', type: 'line' },
  { value: 'divider', label: 'Section Divider', category: 'vector', type: 'line' },
  { value: 'rect', label: 'Rectangle', category: 'vector', type: 'shape' },
  { value: 'rounded_rect', label: 'Rounded Rectangle', category: 'vector', type: 'shape' },
  { value: 'circle', label: 'Circle', category: 'vector', type: 'shape' },
  { value: 'ellipse', label: 'Ellipse', category: 'vector', type: 'shape' },
  { value: 'polygon', label: 'Polygon', category: 'vector', type: 'shape' },
  { value: 'border', label: 'Border Box', category: 'vector', type: 'border' },
  { value: 'logo', label: 'Logo Image', category: 'image', type: 'image' },
  { value: 'photograph', label: 'Photograph', category: 'image', type: 'image' },
  { value: 'signature_image', label: 'Signature Image', category: 'image', type: 'signature' },
  { value: 'stamp_image', label: 'Stamp Image', category: 'image', type: 'image' },
  { value: 'table', label: 'Table', category: 'structural', type: 'table' },
  { value: 'document_block', label: 'Document Block', category: 'structural', type: 'repeated_block' },
  { value: 'receipt_block', label: 'Receipt Block', category: 'structural', type: 'repeated_block' },
  { value: 'invoice_block', label: 'Invoice Block', category: 'structural', type: 'repeated_block' },
  { value: 'header', label: 'Page Header', category: 'structural', type: 'text' },
  { value: 'footer', label: 'Page Footer', category: 'structural', type: 'text' },
  { value: 'text_input', label: 'Form Text Input', category: 'form', type: 'form_field' },
  { value: 'checkbox', label: 'Form Checkbox', category: 'form', type: 'form_field' },
  { value: 'radio_button', label: 'Form Radio', category: 'form', type: 'form_field' },
  { value: 'dropdown', label: 'Form Dropdown', category: 'form', type: 'form_field' },
  { value: 'signature_field', label: 'Form Signature', category: 'form', type: 'form_field' },
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
  onConvertSelectionToTable,
}) => {
  const viewport = useViewport();
  const prefersReduced = useReducedMotion();
  const tabGroupId = useId();
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [pendingPlan, setPendingPlan] = useState<AiEditPlan | null>(null);
  const [equalGapPt, setEqualGapPt] = useState<number>(12);
  const [batchFontSizeDraft, setBatchFontSizeDraft] = useState<string>('');
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
                      <NumericDraftInput
                        value={equalGapPt}
                        commitOptions={{ min: 0, decimals: 1 }}
                        onCommit={(val) => setEqualGapPt(val)}
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
                        type="text"
                        inputMode="decimal"
                        value={batchFontSizeDraft}
                        placeholder="Size (pt)"
                        onChange={(e) => setBatchFontSizeDraft(e.target.value)}
                        onBlur={() => {
                          const v = Number(batchFontSizeDraft.trim());
                          if (Number.isFinite(v) && v >= 5 && v <= 120) {
                            onBatchUpdateSelected({ fontSize: v });
                            setBatchFontSizeDraft('');
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const v = Number(batchFontSizeDraft.trim());
                            if (Number.isFinite(v) && v >= 5 && v <= 120) {
                              onBatchUpdateSelected({ fontSize: v });
                              setBatchFontSizeDraft('');
                              e.currentTarget.blur();
                            }
                          } else if (e.key === 'Escape') {
                            e.stopPropagation();
                            setBatchFontSizeDraft('');
                            e.currentTarget.blur();
                          }
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

                {onConvertSelectionToTable && (
                  <button
                    type="button"
                    onClick={onConvertSelectionToTable}
                    className="w-full py-1.5 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] text-[#101010] dark:text-white text-[11px] font-medium transition-colors"
                  >
                    Convert {selectedElements.length} Items to Table
                  </button>
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
                      <div className="pt-1 border-t border-black/10 dark:border-white/10 space-y-1">
                        <div className="flex items-center justify-between gap-2 text-[#555555] dark:text-[#B5B5B5]">
                          <span>
                            Scan: {el.objectCategory || 'unclassified'} ·{' '}
                            {(el.detectionMethod || 'native').replace('_', ' ')}
                          </span>
                          {el.effectiveDpi ? (
                            <span className="font-mono tabular-nums">
                              {Math.round(el.effectiveDpi)} DPI
                            </span>
                          ) : el.cornerRadiusPt ? (
                            <span className="font-mono tabular-nums">
                              r={el.cornerRadiusPt}pt
                            </span>
                          ) : el.dashArray?.length ? (
                            <span className="font-mono tabular-nums">
                              dash [{el.dashArray.join(',')}]
                            </span>
                          ) : null}
                        </div>
                        <label className="flex items-center justify-between gap-2">
                          <span className="text-[#555555] dark:text-[#B5B5B5]">Subtype</span>
                          <select
                            value={el.objectSubtype || ''}
                            onChange={(e) => {
                              const picked = SUBTYPE_RECLASSIFY_OPTIONS.find(
                                (o) => o.value === e.target.value
                              );
                              if (!picked) return;
                              onUpdateElement(el.id, {
                                objectSubtype: picked.value,
                                objectCategory: picked.category,
                                type: picked.type,
                                needsReview: false,
                              });
                            }}
                            className="flex-1 max-w-[165px] px-1.5 py-0.5 rounded-md border studio-select text-[10px]"
                          >
                            <option value="">Auto ({el.type})</option>
                            {SUBTYPE_RECLASSIFY_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </label>
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
                      <NumericDraftInput
                        onFocus={scrollOnFocus}
                        value={ptToUnit(el.x, unit)}
                        commitOptions={{ decimals: 2 }}
                        onCommit={(val) =>
                          onUpdateElement(el.id, {
                            x: unitToPt(val, unit),
                            eraseOriginal: el.isUserAdded ? false : true,
                          })
                        }
                        className={`mt-0.5 w-full px-2 rounded-lg border studio-input tabular-nums ${inputHeightClass}`}
                      />
                    </label>
                    <label className="block">
                      <span className="text-[10px] text-[#888888] dark:text-[#858585]">Y</span>
                      <NumericDraftInput
                        onFocus={scrollOnFocus}
                        value={ptToUnit(el.y, unit)}
                        commitOptions={{ decimals: 2 }}
                        onCommit={(val) =>
                          onUpdateElement(el.id, {
                            y: unitToPt(val, unit),
                            eraseOriginal: el.isUserAdded ? false : true,
                          })
                        }
                        className={`mt-0.5 w-full px-2 rounded-lg border studio-input tabular-nums ${inputHeightClass}`}
                      />
                    </label>
                    <label className="block">
                      <span className="text-[10px] text-[#888888] dark:text-[#858585]">Width</span>
                      <NumericDraftInput
                        onFocus={scrollOnFocus}
                        value={ptToUnit(el.width, unit)}
                        commitOptions={{ decimals: 2 }}
                        onCommit={(val) => {
                          const newW = Math.max(4, unitToPt(val, unit));
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
                      <NumericDraftInput
                        onFocus={scrollOnFocus}
                        value={ptToUnit(el.height, unit)}
                        commitOptions={{ decimals: 2 }}
                        onCommit={(val) => {
                          const newH = Math.max(4, unitToPt(val, unit));
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
                              eraseOriginal: el.isUserAdded ? false : true,
                            })
                          }
                          className={`px-2 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] text-[#101010] dark:text-white transition-colors ${btnHeightClass}`}
                        >
                          -15°
                        </button>
                        <NumericDraftInput
                          onFocus={scrollOnFocus}
                          value={el.rotation}
                          commitOptions={{ decimals: 1 }}
                          onCommit={(val) =>
                            onUpdateElement(el.id, {
                              rotation: val % 360,
                              eraseOriginal: el.isUserAdded ? false : true,
                            })
                          }
                          className={`w-full px-1.5 rounded-lg border studio-input tabular-nums text-center ${inputHeightClass}`}
                        />
                        <button
                          type="button"
                          onClick={() =>
                            onUpdateElement(el.id, {
                              rotation: ((el.rotation || 0) + 15) % 360,
                              eraseOriginal: el.isUserAdded ? false : true,
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
                      <NumericDraftInput
                        onFocus={scrollOnFocus}
                        value={el.opacity}
                        commitOptions={{ min: 0.05, max: 1, decimals: 2 }}
                        onCommit={(val) =>
                          onUpdateElement(el.id, {
                            opacity: Math.max(0.05, Math.min(1, val)),
                            eraseOriginal: el.isUserAdded ? false : true,
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
                              const rawUrl = String(reader.result || '');
                              const im = new Image();
                              im.onload = () => {
                                const w = im.naturalWidth || 200;
                                const h = im.naturalHeight || 150;
                                const canvas = document.createElement('canvas');
                                canvas.width = w;
                                canvas.height = h;
                                const ctx = canvas.getContext('2d');
                                let normalizedUrl = rawUrl;
                                if (ctx) {
                                  ctx.drawImage(im, 0, 0);
                                  normalizedUrl = canvas.toDataURL('image/png');
                                }
                                canvas.width = 0;
                                canvas.height = 0;
                                onUpdateElement(el.id, {
                                  imageDataUrl: normalizedUrl,
                                  imageNaturalWidth: w,
                                  imageNaturalHeight: h,
                                  imageCropRect: undefined,
                                  isUserAdded: true,
                                });
                              };
                              im.src = rawUrl;
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
                              eraseOriginal: el.isUserAdded ? false : true,
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
                              onClick={() =>
                                onUpdateElement(el.id, {
                                  imageCropRect: undefined,
                                  eraseOriginal: el.isUserAdded ? false : true,
                                })
                              }
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
                                <NumericDraftInput
                                  value={Math.round(cur[k])}
                                  commitOptions={{ min: k === 'x' || k === 'y' ? 0 : 10, decimals: 0 }}
                                  onCommit={(val) => {
                                    const next = { ...cur, [k]: Math.max(0, val) };
                                    next.x = Math.min(natW - 10, next.x);
                                    next.y = Math.min(natH - 10, next.y);
                                    next.width = Math.max(10, Math.min(natW - next.x, next.width));
                                    next.height = Math.max(10, Math.min(natH - next.y, next.height));
                                    onUpdateElement(el.id, {
                                      imageCropRect: next,
                                      eraseOriginal: el.isUserAdded ? false : true,
                                    });
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
                          <NumericDraftInput
                            value={Math.round(el.calloutTarget.x)}
                            commitOptions={{ decimals: 1 }}
                            onCommit={(val) =>
                              onUpdateElement(el.id, {
                                calloutTarget: {
                                  ...el.calloutTarget!,
                                  x: val,
                                },
                              })
                            }
                            className="w-full px-2 py-1 rounded-lg border studio-input text-xs tabular-nums"
                          />
                        </label>
                        <label className="block">
                          <span className="text-[10px] text-[#888888]">Target Y (pt)</span>
                          <NumericDraftInput
                            value={Math.round(el.calloutTarget.y)}
                            commitOptions={{ decimals: 1 }}
                            onCommit={(val) =>
                              onUpdateElement(el.id, {
                                calloutTarget: {
                                  ...el.calloutTarget!,
                                  y: val,
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

                {/* Barcode & QR Code Studio */}
                {(el.type === 'barcode' || el.type === 'qr_code') && (() => {
                  const fmt: BarcodeFormat =
                    el.barcodeFormat || (el.type === 'qr_code' ? 'qr' : 'code128');
                  const val = el.barcodeValue ?? el.text ?? '';
                  const report = validateBarcodeSpec(el);
                  return (
                    <div className="pt-3 border-t border-black/10 dark:border-white/10 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-medium text-[#555555] dark:text-[#B5B5B5] flex items-center gap-1.5">
                          {fmt === 'qr' ? (
                            <QrCode className="w-3.5 h-3.5" />
                          ) : (
                            <ScanBarcode className="w-3.5 h-3.5" />
                          )}
                          Barcode &amp; QR Studio
                        </span>
                        <span className="text-[10px] font-mono tabular-nums text-[#888888] dark:text-[#858585]">
                          {report.moduleSizePt.toFixed(2)}pt mod
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <label className="block">
                          <span className="text-[10px] text-[#888888] dark:text-[#858585]">
                            Symbology
                          </span>
                          <select
                            value={fmt}
                            onChange={(e) => {
                              const nextFmt = e.target.value as BarcodeFormat;
                              onUpdateElement(el.id, {
                                barcodeFormat: nextFmt,
                                type: nextFmt === 'qr' ? 'qr_code' : 'barcode',
                                ...(nextFmt === 'qr' && Math.abs(el.width - el.height) > 20
                                  ? { height: el.width }
                                  : {}),
                              });
                            }}
                            className={`mt-0.5 w-full px-2 rounded-lg border studio-select ${inputHeightClass}`}
                          >
                            <option value="qr">QR Code (ISO 18004)</option>
                            <option value="code128">Code 128 (Set B)</option>
                            <option value="code39">Code 39</option>
                            <option value="ean13">EAN-13 (Mod-10)</option>
                            <option value="upca">UPC-A (Mod-10)</option>
                          </select>
                        </label>

                        {fmt === 'qr' ? (
                          <label className="block">
                            <span className="text-[10px] text-[#888888] dark:text-[#858585]">
                              Error Correction
                            </span>
                            <select
                              value={el.qrErrorCorrection || 'M'}
                              onChange={(e) =>
                                onUpdateElement(el.id, {
                                  qrErrorCorrection: e.target.value as 'L' | 'M' | 'Q' | 'H',
                                })
                              }
                              className={`mt-0.5 w-full px-2 rounded-lg border studio-select ${inputHeightClass}`}
                            >
                              <option value="L">L (~7%)</option>
                              <option value="M">M (~15%)</option>
                              <option value="Q">Q (~25%)</option>
                              <option value="H">H (~30%)</option>
                            </select>
                          </label>
                        ) : (
                          <label className="block">
                            <span className="text-[10px] text-[#888888] dark:text-[#858585]">
                              Quiet Zone (pt)
                            </span>
                            <NumericDraftInput
                              onFocus={scrollOnFocus}
                              value={el.barcodeQuietZonePt ?? 6}
                              commitOptions={{ min: 0, max: 36, decimals: 1 }}
                              onCommit={(val) =>
                                onUpdateElement(el.id, {
                                  barcodeQuietZonePt: Math.max(0, Math.min(36, val)),
                                })
                              }
                              className={`mt-0.5 w-full px-2 rounded-lg border studio-input tabular-nums ${inputHeightClass}`}
                            />
                          </label>
                        )}
                      </div>

                      {fmt === 'qr' && (
                        <label className="block">
                          <span className="text-[10px] text-[#888888] dark:text-[#858585]">
                            Quiet Zone Margin (pt)
                          </span>
                          <NumericDraftInput
                            onFocus={scrollOnFocus}
                            value={el.barcodeQuietZonePt ?? 6}
                            commitOptions={{ min: 0, max: 36, decimals: 1 }}
                            onCommit={(val) =>
                              onUpdateElement(el.id, {
                                barcodeQuietZonePt: Math.max(0, Math.min(36, val)),
                              })
                            }
                            className={`mt-0.5 w-full px-2 rounded-lg border studio-input tabular-nums ${inputHeightClass}`}
                          />
                        </label>
                      )}

                      <label className="block">
                        <span className="text-[10px] text-[#888888] dark:text-[#858585]">
                          Payload / Default Value (overridden by Field Key in Bulk/Data)
                        </span>
                        <input
                          type="text"
                          onFocus={scrollOnFocus}
                          value={val}
                          onChange={(e) =>
                            onUpdateElement(el.id, {
                              barcodeValue: e.target.value,
                              text: e.target.value,
                            })
                          }
                          placeholder={
                            fmt === 'ean13'
                              ? '12 or 13 digits'
                              : fmt === 'upca'
                              ? '11 or 12 digits'
                              : 'INV-0001'
                          }
                          className={`mt-0.5 w-full px-2 rounded-lg border studio-input font-mono ${inputHeightClass}`}
                        />
                      </label>

                      {fmt !== 'qr' && (
                        <label className="flex items-center gap-2 cursor-pointer text-[11px] text-[#101010] dark:text-white">
                          <input
                            type="checkbox"
                            checked={el.barcodeIncludeText !== false}
                            onChange={(e) =>
                              onUpdateElement(el.id, {
                                barcodeIncludeText: e.target.checked,
                              })
                            }
                          />
                          <span>Show human-readable text below bars</span>
                        </label>
                      )}

                      <div className="grid grid-cols-2 gap-2">
                        <label className="flex items-center justify-between gap-2 text-[10px] text-[#888888] dark:text-[#858585]">
                          <span>Bars / Modules</span>
                          <input
                            type="color"
                            value={el.color || '#111827'}
                            onChange={(e) =>
                              onUpdateElement(el.id, { color: e.target.value })
                            }
                            className="w-8 h-7 rounded border border-black/15 dark:border-white/15 bg-transparent cursor-pointer"
                          />
                        </label>
                        <label className="flex items-center justify-between gap-2 text-[10px] text-[#888888] dark:text-[#858585]">
                          <span>Background</span>
                          <input
                            type="color"
                            value={
                              el.backgroundColor === 'transparent'
                                ? '#FFFFFF'
                                : el.backgroundColor || '#FFFFFF'
                            }
                            onChange={(e) =>
                              onUpdateElement(el.id, { backgroundColor: e.target.value })
                            }
                            className="w-8 h-7 rounded border border-black/15 dark:border-white/15 bg-transparent cursor-pointer"
                          />
                        </label>
                      </div>

                      {/* Real-time Scannability & Check-Digit Validation Status */}
                      <div
                        className={`p-2 rounded-lg border text-[10px] space-y-1 ${
                          report.errors.length > 0
                            ? 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300'
                            : report.warnings.length > 0
                            ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                            : 'border-black/12 dark:border-white/15 bg-black/[0.03] dark:bg-white/[0.04] text-[#101010] dark:text-white'
                        }`}
                      >
                        <div className="flex items-center justify-between font-semibold">
                          <span className="flex items-center gap-1">
                            {report.errors.length > 0 ? (
                              <AlertTriangle className="w-3 h-3" />
                            ) : (
                              <CheckCircle2 className="w-3 h-3" />
                            )}
                            {report.errors.length > 0
                              ? 'Invalid Barcode Spec'
                              : report.warnings.length > 0
                              ? 'Scannability Warning'
                              : 'Vector Barcode Verified'}
                          </span>
                          {report.encoded.checkDigitComputed && (
                            <span className="font-mono tabular-nums">
                              Chk: {report.encoded.checkDigitComputed}
                            </span>
                          )}
                        </div>
                        {report.errors.map((err, idx) => (
                          <div key={`berr-${idx}`}>{err}</div>
                        ))}
                        {report.warnings.map((w, idx) => (
                          <div key={`bwarn-${idx}`}>{w}</div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Advanced Typography Studio & Styling */}
                {el.type !== 'image' &&
                  el.type !== 'signature' &&
                  el.type !== 'line' &&
                  el.type !== 'draw' &&
                  el.type !== 'barcode' &&
                  el.type !== 'qr_code' && (
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
                          <NumericDraftInput
                            onFocus={scrollOnFocus}
                            value={el.fontSize}
                            commitOptions={{ min: 5, max: 120, decimals: 1 }}
                            onCommit={(val) =>
                              onUpdateElement(el.id, {
                                fontSize: Math.max(5, Math.min(120, val)),
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
                        <NumericDraftInput
                          value={el.letterSpacing ?? 0}
                          commitOptions={{ decimals: 2 }}
                          onCommit={(val) =>
                            onUpdateElement(el.id, {
                              letterSpacing: val,
                              eraseOriginal: el.isUserAdded ? false : true,
                            })
                          }
                          className="w-full px-1.5 py-1 rounded border studio-input text-[10px] tabular-nums"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[9px] text-[#888888]">Line H</span>
                        <NumericDraftInput
                          value={el.lineHeight ?? 1.2}
                          commitOptions={{ min: 0.8, max: 3, decimals: 2 }}
                          onCommit={(val) =>
                            onUpdateElement(el.id, {
                              lineHeight: Math.max(0.8, Math.min(3, val)),
                              eraseOriginal: el.isUserAdded ? false : true,
                            })
                          }
                          className="w-full px-1.5 py-1 rounded border studio-input text-[10px] tabular-nums"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[9px] text-[#888888]">Para pt</span>
                        <NumericDraftInput
                          value={el.paragraphSpacing ?? 0}
                          commitOptions={{ min: 0, decimals: 1 }}
                          onCommit={(val) =>
                            onUpdateElement(el.id, {
                              paragraphSpacing: Math.max(0, val),
                              eraseOriginal: el.isUserAdded ? false : true,
                            })
                          }
                          className="w-full px-1.5 py-1 rounded border studio-input text-[10px] tabular-nums"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[9px] text-[#888888]">Pad pt</span>
                        <NumericDraftInput
                          value={el.paddingPt ?? 1}
                          commitOptions={{ min: 0, decimals: 1 }}
                          onCommit={(val) =>
                            onUpdateElement(el.id, {
                              paddingPt: Math.max(0, val),
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
                <NumericDraftInput
                  value={ptToUnit(pageConfig.widthPt, unit)}
                  commitOptions={{ allowZero: false, decimals: 2 }}
                  onCommit={(num) => {
                    if (num <= 0) return;
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
                <NumericDraftInput
                  value={ptToUnit(pageConfig.heightPt, unit)}
                  commitOptions={{ allowZero: false, decimals: 2 }}
                  onCommit={(num) => {
                    if (num <= 0) return;
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
                    <NumericDraftInput
                      value={ptToUnit(pageConfig[key], unit)}
                      commitOptions={{ min: 0, decimals: 2 }}
                      onCommit={(val) =>
                        onUpdatePageConfig({
                          [key]: Math.max(0, unitToPt(val, unit)),
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
                <NumericDraftInput
                  value={ptToUnit(pageConfig.bleedPt ?? 0, unit)}
                  commitOptions={{ min: 0, decimals: 2 }}
                  onCommit={(val) =>
                    onUpdatePageConfig({
                      bleedPt: Math.max(0, unitToPt(val, unit)),
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
                        <NumericDraftInput
                          value={ptToUnit(activeSourceBox.x, unit)}
                          commitOptions={{ min: 0, decimals: 2 }}
                          onCommit={(val) =>
                            updateNumericCrop({
                              x: unitToPt(val, unit),
                            })
                          }
                          className="mt-0.5 w-full px-2 py-1 rounded-lg border studio-input tabular-nums"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[10px] text-[#888888] dark:text-[#858585]">Crop Y</span>
                        <NumericDraftInput
                          value={ptToUnit(activeSourceBox.y, unit)}
                          commitOptions={{ min: 0, decimals: 2 }}
                          onCommit={(val) =>
                            updateNumericCrop({
                              y: unitToPt(val, unit),
                            })
                          }
                          className="mt-0.5 w-full px-2 py-1 rounded-lg border studio-input tabular-nums"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[10px] text-[#888888] dark:text-[#858585]">Crop Width</span>
                        <NumericDraftInput
                          value={ptToUnit(activeSourceBox.width, unit)}
                          commitOptions={{ allowZero: false, decimals: 2 }}
                          onCommit={(val) =>
                            updateNumericCrop({
                              width: Math.max(16, unitToPt(val, unit)),
                            })
                          }
                          className="mt-0.5 w-full px-2 py-1 rounded-lg border studio-input tabular-nums"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[10px] text-[#888888] dark:text-[#858585]">Crop Height</span>
                        <NumericDraftInput
                          value={ptToUnit(activeSourceBox.height, unit)}
                          commitOptions={{ allowZero: false, decimals: 2 }}
                          onCommit={(val) =>
                            updateNumericCrop({
                              height: Math.max(16, unitToPt(val, unit)),
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
                      <NumericDraftInput
                        value={ptToUnit(fitConfig.cropPaddingPt, unit)}
                        commitOptions={{ min: 0, decimals: 2 }}
                        onCommit={(val) =>
                          onUpdateFitConfig({
                            cropPaddingPt: Math.max(0, unitToPt(val, unit)),
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
                        <NumericDraftInput
                          value={fitConfig.customPercent}
                          commitOptions={{ min: 10, max: 400, decimals: 0 }}
                          onCommit={(val) =>
                            onUpdateFitConfig({
                              customPercent: Math.max(10, Math.min(400, val)),
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
