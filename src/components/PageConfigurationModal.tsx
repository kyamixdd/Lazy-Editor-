import React, { useEffect, useId, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Maximize2,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Trash2,
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
  modalBackdropVariants,
  modalPanelVariants,
} from '../config/motionSystem';
import {
  CopiesPerPageConfig,
  CustomPaperPreset,
  MeasurementUnit,
  PageConfig,
  PageOrientation,
  PageSizePreset,
  PDFProject,
  ScalingMode,
  SourceFitConfig,
} from '../types/pdfStudio';
import { useViewport } from '../hooks/useViewport';
import { computeSheetLayout, normalizeFitConfig } from '../utils/geometryEngine';
import {
  deleteCustomPaperPreset,
  duplicateCustomPaperPreset,
  loadCustomPaperPresets,
  renameCustomPaperPreset,
  upsertCustomPaperPreset,
} from '../utils/projectStorage';
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

interface PageConfigurationModalProps {
  isOpen: boolean;
  project: PDFProject;
  onClose: () => void;
  onApplyConfig: (
    nextPageConfig: PageConfig,
    nextCopiesSpacing?: { horizontalSpacingPt: number; verticalSpacingPt: number },
    nextCopiesPatch?: Partial<CopiesPerPageConfig>,
    nextFitPatch?: Partial<SourceFitConfig>
  ) => void;
}

const STANDARD_PRESETS = Object.keys(PAGE_PRESETS_PT) as Array<
  Exclude<PageSizePreset, 'Custom'>
>;

const UNIT_OPTIONS: Array<{ id: MeasurementUnit; label: string }> = [
  { id: 'mm', label: 'Millimeters (mm)' },
  { id: 'cm', label: 'Centimeters (cm)' },
  { id: 'in', label: 'Inches (in)' },
  { id: 'pt', label: 'Points (pt · 72/in)' },
  { id: 'px', label: 'Pixels (px · 96 DPI)' },
];

const COPY_COUNTS: Array<1 | 2 | 3 | 4 | 6 | 8 | 9 | 12> = [1, 2, 3, 4, 6, 8, 9, 12];

export const PageConfigurationModal: React.FC<PageConfigurationModalProps> = ({
  isOpen,
  project,
  onClose,
  onApplyConfig,
}) => {
  const viewport = useViewport();
  const prefersReduced = useReducedMotion();
  const tabGroupId = useId();
  const [mobileTab, setMobileTab] = useState<'paper' | 'copies' | 'preview'>(
    'paper'
  );
  const [draftPage, setDraftPage] = useState<PageConfig>(() => ({
    ...project.pageConfig,
    bleedPt: project.pageConfig.bleedPt ?? project.exportConfig.bleedPt ?? 0,
    cropMarks:
      project.pageConfig.cropMarks ?? project.exportConfig.cropMarks ?? false,
  }));
  const [draftCopies, setDraftCopies] = useState<CopiesPerPageConfig>(
    () => project.copiesConfig
  );
  const [draftFit, setDraftFit] = useState<SourceFitConfig>(() =>
    normalizeFitConfig(project)
  );
  const [hSpacingPt, setHSpacingPt] = useState<number>(
    project.copiesConfig.horizontalSpacingPt
  );
  const [vSpacingPt, setVSpacingPt] = useState<number>(
    project.copiesConfig.verticalSpacingPt
  );
  const [widthText, setWidthText] = useState<string>(() =>
    String(ptToUnit(project.pageConfig.widthPt, project.pageConfig.unit))
  );
  const [heightText, setHeightText] = useState<string>(() =>
    String(ptToUnit(project.pageConfig.heightPt, project.pageConfig.unit))
  );

  const [presets, setPresets] = useState<CustomPaperPreset[]>(() =>
    loadCustomPaperPresets()
  );
  const [newPresetName, setNewPresetName] = useState('');
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [editingPresetName, setEditingPresetName] = useState('');

  // Reset drafts whenever modal opens
  useEffect(() => {
    if (!isOpen) return;
    const initPage: PageConfig = {
      ...project.pageConfig,
      bleedPt: project.pageConfig.bleedPt ?? project.exportConfig.bleedPt ?? 0,
      cropMarks:
        project.pageConfig.cropMarks ?? project.exportConfig.cropMarks ?? false,
    };
    setDraftPage(initPage);
    setDraftCopies(project.copiesConfig);
    setDraftFit(normalizeFitConfig(project));
    setHSpacingPt(project.copiesConfig.horizontalSpacingPt);
    setVSpacingPt(project.copiesConfig.verticalSpacingPt);
    setWidthText(String(ptToUnit(initPage.widthPt, initPage.unit)));
    setHeightText(String(ptToUnit(initPage.heightPt, initPage.unit)));
    setPresets(loadCustomPaperPresets());
    setEditingPresetId(null);
    setMobileTab('paper');
  }, [isOpen, project.id]);

  // Parse live draft input dimensions before clamping so invalid input shows validation errors cleanly
  const rawWidthNum = Number(widthText);
  const rawHeightNum = Number(heightText);
  const rawWidthPt = Number.isFinite(rawWidthNum)
    ? unitToPt(rawWidthNum, draftPage.unit)
    : NaN;
  const rawHeightPt = Number.isFinite(rawHeightNum)
    ? unitToPt(rawHeightNum, draftPage.unit)
    : NaN;

  const effectiveCheckPage: PageConfig = {
    ...draftPage,
    widthPt: rawWidthPt,
    heightPt: rawHeightPt,
  };

  const dimValidation = useMemo(
    () =>
      validatePageConfigDimensions({
        widthPt: effectiveCheckPage.widthPt,
        heightPt: effectiveCheckPage.heightPt,
        marginTopPt: effectiveCheckPage.marginTopPt,
        marginBottomPt: effectiveCheckPage.marginBottomPt,
        marginLeftPt: effectiveCheckPage.marginLeftPt,
        marginRightPt: effectiveCheckPage.marginRightPt,
        bleedPt: effectiveCheckPage.bleedPt,
      }),
    [effectiveCheckPage]
  );

  const previewLayout = useMemo(() => {
    const safePage: PageConfig = {
      ...draftPage,
      widthPt:
        Number.isFinite(rawWidthPt) && rawWidthPt >= MIN_PAGE_DIM_PT
          ? Math.min(MAX_PAGE_DIM_PT, rawWidthPt)
          : draftPage.widthPt,
      heightPt:
        Number.isFinite(rawHeightPt) && rawHeightPt >= MIN_PAGE_DIM_PT
          ? Math.min(MAX_PAGE_DIM_PT, rawHeightPt)
          : draftPage.heightPt,
    };
    const nextCopies: CopiesPerPageConfig = {
      ...draftCopies,
      horizontalSpacingPt: hSpacingPt,
      verticalSpacingPt: vSpacingPt,
    };
    return computeSheetLayout(
      {
        originalPages: project.originalPages,
        elements: project.elements,
        pageConfig: safePage,
        fitConfig: draftFit,
        copiesConfig: nextCopies,
      },
      1
    );
  }, [
    draftPage,
    draftCopies,
    draftFit,
    rawWidthPt,
    rawHeightPt,
    hSpacingPt,
    vSpacingPt,
    project.originalPages,
    project.elements,
  ]);

  // Printable area warning check
  const printableAreaWarning = useMemo(() => {
    if (!dimValidation.valid) return null;
    const printLeft = draftPage.marginLeftPt;
    const printTop = draftPage.marginTopPt;
    const printRight = previewLayout.outputSheetWidthPt - draftPage.marginRightPt;
    const printBottom = previewLayout.outputSheetHeightPt - draftPage.marginBottomPt;

    for (const slot of previewLayout.slots) {
      if (
        slot.drawXPt < printLeft - 1 ||
        slot.drawTopPt < printTop - 1 ||
        slot.drawXPt + slot.placedWidthPt > printRight + 1 ||
        slot.drawTopPt + slot.placedHeightPt > printBottom + 1
      ) {
        return `Placed content (${ptToUnit(slot.placedWidthPt, draftPage.unit)} × ${ptToUnit(slot.placedHeightPt, draftPage.unit)} ${draftPage.unit}) exceeds printable area inside page margins.`;
      }
    }

    if (previewLayout.isPassThroughOriginal1to1) {
      const exceeds = project.elements.some(
        (el) =>
          el.visible &&
          el.pageNumber === 1 &&
          el.type !== 'border' &&
          el.type !== 'repeated_block' &&
          (el.x < printLeft - 1 ||
            el.y < printTop - 1 ||
            el.x + el.width > printRight + 1 ||
            el.y + el.height > printBottom + 1)
      );
      if (exceeds) {
        return 'One or more document elements lie outside the printable margin area.';
      }
    }
    return null;
  }, [dimValidation.valid, draftPage, previewLayout, project.elements]);

  const syncInputsFromPt = (wPt: number, hPt: number, unit: MeasurementUnit) => {
    setWidthText(String(ptToUnit(wPt, unit)));
    setHeightText(String(ptToUnit(hPt, unit)));
  };

  const handleSelectStandardPreset = (preset: PageSizePreset) => {
    if (preset === 'Custom') {
      setDraftPage((prev) => ({
        ...prev,
        sizePreset: 'Custom',
        customPresetId: undefined,
        customPresetName: undefined,
      }));
      return;
    }
    const targetOri =
      draftPage.orientation === 'custom' ? 'portrait' : draftPage.orientation;
    const dims = getPresetDimensions(preset, targetOri);
    setDraftPage((prev) => ({
      ...prev,
      sizePreset: preset,
      orientation: targetOri,
      widthPt: dims.widthPt,
      heightPt: dims.heightPt,
      customPresetId: undefined,
      customPresetName: undefined,
    }));
    syncInputsFromPt(dims.widthPt, dims.heightPt, draftPage.unit);
  };

  const handleOrientationChange = (nextOri: PageOrientation) => {
    const baseW =
      Number.isFinite(rawWidthPt) && rawWidthPt >= MIN_PAGE_DIM_PT
        ? rawWidthPt
        : draftPage.widthPt;
    const baseH =
      Number.isFinite(rawHeightPt) && rawHeightPt >= MIN_PAGE_DIM_PT
        ? rawHeightPt
        : draftPage.heightPt;
    const swapped = applyOrientationChange(
      { widthPt: baseW, heightPt: baseH, orientation: draftPage.orientation },
      nextOri
    );
    setDraftPage((prev) => ({
      ...prev,
      orientation: swapped.orientation,
      widthPt: Number(swapped.widthPt.toFixed(2)),
      heightPt: Number(swapped.heightPt.toFixed(2)),
    }));
    syncInputsFromPt(swapped.widthPt, swapped.heightPt, draftPage.unit);
  };

  const handleUnitChange = (nextUnit: MeasurementUnit) => {
    const curW =
      Number.isFinite(rawWidthPt) && rawWidthPt > 0 ? rawWidthPt : draftPage.widthPt;
    const curH =
      Number.isFinite(rawHeightPt) && rawHeightPt > 0 ? rawHeightPt : draftPage.heightPt;
    setDraftPage((prev) => ({
      ...prev,
      unit: nextUnit,
      widthPt: Number(curW.toFixed(2)),
      heightPt: Number(curH.toFixed(2)),
    }));
    syncInputsFromPt(curW, curH, nextUnit);
  };

  const handleWidthTextChange = (val: string) => {
    setWidthText(val);
    const num = Number(val);
    if (Number.isFinite(num) && num > 0) {
      const pt = unitToPt(num, draftPage.unit);
      if (pt >= MIN_PAGE_DIM_PT && pt <= MAX_PAGE_DIM_PT) {
        setDraftPage((prev) => ({
          ...prev,
          sizePreset: 'Custom',
          customPresetId: undefined,
          customPresetName: undefined,
          widthPt: Number(pt.toFixed(2)),
        }));
      }
    }
  };

  const handleHeightTextChange = (val: string) => {
    setHeightText(val);
    const num = Number(val);
    if (Number.isFinite(num) && num > 0) {
      const pt = unitToPt(num, draftPage.unit);
      if (pt >= MIN_PAGE_DIM_PT && pt <= MAX_PAGE_DIM_PT) {
        setDraftPage((prev) => ({
          ...prev,
          sizePreset: 'Custom',
          customPresetId: undefined,
          customPresetName: undefined,
          heightPt: Number(pt.toFixed(2)),
        }));
      }
    }
  };

  const handleSaveCustomPreset = () => {
    if (!dimValidation.valid) return;
    const trimmed = newPresetName.trim();
    const fallbackName = `Custom ${ptToUnit(rawWidthPt, draftPage.unit)}×${ptToUnit(
      rawHeightPt,
      draftPage.unit
    )} ${draftPage.unit}`;
    const now = new Date().toISOString();
    const newPreset: CustomPaperPreset = {
      id: `paper-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: trimmed || fallbackName,
      widthPt: Number(rawWidthPt.toFixed(2)),
      heightPt: Number(rawHeightPt.toFixed(2)),
      unit: draftPage.unit,
      orientation: draftPage.orientation,
      marginTopPt: draftPage.marginTopPt,
      marginRightPt: draftPage.marginRightPt,
      marginBottomPt: draftPage.marginBottomPt,
      marginLeftPt: draftPage.marginLeftPt,
      horizontalSpacingPt: hSpacingPt,
      verticalSpacingPt: vSpacingPt,
      bleedPt: draftPage.bleedPt ?? 0,
      cropMarks: draftPage.cropMarks ?? false,
      backgroundColor: draftPage.backgroundColor,
      createdAt: now,
      updatedAt: now,
    };
    const next = upsertCustomPaperPreset(newPreset);
    setPresets(next);
    setNewPresetName('');
    setDraftPage((prev) => ({
      ...prev,
      sizePreset: 'Custom',
      customPresetId: newPreset.id,
      customPresetName: newPreset.name,
    }));
  };

  const handleApplySavedPreset = (preset: CustomPaperPreset) => {
    const nextPage: PageConfig = {
      ...draftPage,
      sizePreset: 'Custom',
      orientation: preset.orientation,
      widthPt: preset.widthPt,
      heightPt: preset.heightPt,
      unit: preset.unit,
      marginTopPt: preset.marginTopPt ?? draftPage.marginTopPt,
      marginRightPt: preset.marginRightPt ?? draftPage.marginRightPt,
      marginBottomPt: preset.marginBottomPt ?? draftPage.marginBottomPt,
      marginLeftPt: preset.marginLeftPt ?? draftPage.marginLeftPt,
      bleedPt: preset.bleedPt ?? draftPage.bleedPt ?? 0,
      cropMarks: preset.cropMarks ?? draftPage.cropMarks ?? false,
      backgroundColor: preset.backgroundColor ?? draftPage.backgroundColor,
      customPresetId: preset.id,
      customPresetName: preset.name,
    };
    setDraftPage(nextPage);
    if (preset.horizontalSpacingPt !== undefined) {
      setHSpacingPt(preset.horizontalSpacingPt);
    }
    if (preset.verticalSpacingPt !== undefined) {
      setVSpacingPt(preset.verticalSpacingPt);
    }
    syncInputsFromPt(preset.widthPt, preset.heightPt, preset.unit);
  };

  const handleSelectCopiesPreset = (count: 1 | 2 | 3 | 4 | 6 | 8 | 9 | 12) => {
    const isLandscape =
      (Number.isFinite(rawWidthPt) ? rawWidthPt : draftPage.widthPt) >
      (Number.isFinite(rawHeightPt) ? rawHeightPt : draftPage.heightPt);
    let cols = 1;
    let rows = 1;
    if (count === 2) {
      cols = isLandscape ? 2 : 1;
      rows = isLandscape ? 1 : 2;
    } else if (count === 3) {
      cols = isLandscape ? 3 : 1;
      rows = isLandscape ? 1 : 3;
    } else if (count === 4) {
      cols = 2;
      rows = 2;
    } else if (count === 6) {
      cols = isLandscape ? 3 : 2;
      rows = isLandscape ? 2 : 3;
    } else if (count === 8) {
      cols = isLandscape ? 4 : 2;
      rows = isLandscape ? 2 : 4;
    } else if (count === 9) {
      cols = 3;
      rows = 3;
    } else if (count === 12) {
      cols = isLandscape ? 4 : 3;
      rows = isLandscape ? 3 : 4;
    }
    setDraftCopies((prev) => ({
      ...prev,
      enabled: count !== 1,
      copiesPreset: count,
      columns: cols,
      rows,
    }));
  };

  const handleApplyAndClose = () => {
    if (!dimValidation.valid) return;
    const finalized: PageConfig = {
      ...draftPage,
      widthPt: Number(rawWidthPt.toFixed(2)),
      heightPt: Number(rawHeightPt.toFixed(2)),
    };
    onApplyConfig(
      finalized,
      {
        horizontalSpacingPt: Math.max(0, hSpacingPt),
        verticalSpacingPt: Math.max(0, vSpacingPt),
      },
      {
        ...draftCopies,
        horizontalSpacingPt: Math.max(0, hSpacingPt),
        verticalSpacingPt: Math.max(0, vSpacingPt),
      },
      {
        scalingMode: draftFit.scalingMode,
        customPercent: draftFit.customPercent,
      }
    );
    onClose();
  };

  // Compute live scaled visual preview dimensions (including bleed)
  const bleedPt = Math.max(0, draftPage.bleedPt ?? 0);
  const trimW = previewLayout.outputSheetWidthPt;
  const trimH = previewLayout.outputSheetHeightPt;
  const totalW = trimW + bleedPt * 2;
  const totalH = trimH + bleedPt * 2;
  const maxBoxW = viewport.isMobile
    ? Math.max(200, Math.min(300, viewport.width - 72))
    : 360;
  const maxBoxH = viewport.isMobile ? 290 : 390;
  const previewScale = Math.min(
    maxBoxW / Math.max(1, totalW),
    maxBoxH / Math.max(1, totalH)
  );

  const unit = draftPage.unit;
  const origMeta = project.originalPages[0];
  const thumbUrl = origMeta?.previewImageDataUrl;
  const showPaperSection = !viewport.isMobile || mobileTab === 'paper';
  const showCopiesSection = !viewport.isMobile || mobileTab === 'copies';
  const showPreviewSection = !viewport.isMobile || mobileTab === 'preview';
  const draftCopiesCount = draftCopies.enabled
    ? Math.max(1, draftCopies.columns * draftCopies.rows)
    : 1;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="page-cfg-backdrop"
          variants={modalBackdropVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          onClick={onClose}
          className="fixed inset-0 z-50 bg-black/45 dark:bg-black/70 backdrop-blur-sm flex items-center justify-center p-0 tablet:p-4"
        >
          <motion.div
            key="page-cfg-panel"
            role="dialog"
            aria-modal="true"
            variants={
              prefersReduced
                ? {
                    initial: { opacity: 0 },
                    animate: { opacity: 1, transition: { duration: 0.14 } },
                    exit: { opacity: 0, pointerEvents: 'none', transition: { duration: 0.12 } },
                  }
                : modalPanelVariants
            }
            initial="initial"
            animate="animate"
            exit="exit"
            onClick={(e) => e.stopPropagation()}
            className="w-full h-[100dvh] tablet:h-auto tablet:max-w-5xl tablet:max-h-[92dvh] rounded-none tablet:rounded-2xl border-0 tablet:border glass-level-4 flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="px-4 tablet:px-5 py-3 border-b border-black/10 dark:border-white/12 flex items-center justify-between gap-3 shrink-0 pt-safe">
              <div className="flex items-center gap-2.5 min-w-0">
                <Maximize2 className="w-4 h-4 text-[#101010] dark:text-white shrink-0" />
                <div className="min-w-0">
                  <h2 className="text-sm font-display font-semibold text-[#101010] dark:text-white truncate">
                    Page Setup & Imposition
                  </h2>
                  <p className="text-[11px] text-[#555555] dark:text-[#B5B5B5] truncate">
                    Physical PDF MediaBox (1 in = 72 pt) · Copies, Margins & Scaling
                  </p>
                </div>
              </div>
              <motion.button
                type="button"
                whileTap={!prefersReduced ? { scale: 0.92 } : undefined}
                onClick={onClose}
                className="min-w-[44px] min-h-[44px] -mr-2 flex items-center justify-center rounded-xl text-[#888888] hover:text-[#101010] dark:text-[#858585] dark:hover:text-white hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-colors"
                aria-label="Close page setup"
              >
                <X className="w-4 h-4" />
              </motion.button>
            </div>

            {/* Mobile Tab Switcher */}
            {viewport.isMobile && (
              <LayoutGroup id={`page-cfg-${tabGroupId}`}>
                <div className="grid grid-cols-3 border-b border-black/10 dark:border-white/12 text-xs font-medium shrink-0 glass-level-2">
                  {(
                    [
                      ['paper', 'Paper & Size'],
                      ['copies', 'Copies & Grid'],
                      ['preview', 'Live Preview'],
                    ] as const
                  ).map(([id, label]) => {
                    const active = mobileTab === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setMobileTab(id)}
                        className={`relative min-h-[44px] transition-colors whitespace-nowrap ${
                          active
                            ? 'text-[#101010] dark:text-white font-semibold'
                            : 'text-[#888888] dark:text-[#858585]'
                        }`}
                      >
                        <span className="relative z-10">{label}</span>
                        {active && (
                          <motion.span
                            layoutId={`page-cfg-tab-${tabGroupId}`}
                            transition={
                              prefersReduced
                                ? { duration: MOTION_DURATION.instant }
                                : MOTION_SPRING.nav
                            }
                            className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[#101010] dark:bg-white"
                            aria-hidden="true"
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              </LayoutGroup>
            )}

        {/* Two-column Body (tabbed on mobile) */}
        <div className="flex-1 overflow-hidden flex flex-col tablet:flex-row">
          {/* Left Configuration Controls */}
          <div
            className={`w-full tablet:w-[400px] desktop:w-[520px] shrink-0 overflow-y-auto p-4 tablet:p-5 border-b tablet:border-b-0 tablet:border-r border-black/10 dark:border-white/12 space-y-5 text-xs ${
              !showPaperSection && !showCopiesSection ? 'hidden' : ''
            }`}
          >
            {showPaperSection && (
              <>
            {/* Standard Paper Sizes */}
            <div>
              <div className="text-[11px] font-medium text-[#555555] dark:text-[#B5B5B5] mb-2">
                Standard Paper Sizes
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {STANDARD_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => handleSelectStandardPreset(preset)}
                    className={`py-1.5 px-2 rounded-lg border text-[11px] font-medium truncate transition-colors ${
                      draftPage.sizePreset === preset
                        ? 'studio-active-surface font-semibold'
                        : 'border-black/15 dark:border-white/15 text-[#555555] dark:text-[#B5B5B5] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => handleSelectStandardPreset('Custom')}
                  className={`py-1.5 px-2 rounded-lg border text-[11px] font-medium truncate transition-colors ${
                    draftPage.sizePreset === 'Custom'
                      ? 'studio-active-surface font-semibold'
                      : 'border-black/15 dark:border-white/15 text-[#555555] dark:text-[#B5B5B5] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                  }`}
                >
                  Custom
                </button>
              </div>
            </div>

            {/* Units & Custom Dimensions */}
            <div className="space-y-3 pt-3 border-t border-black/10 dark:border-white/10">
              <div className="grid grid-cols-3 gap-3">
                <label className="block">
                  <span className="text-[11px] text-[#888888] dark:text-[#858585]">Unit</span>
                  <select
                    value={unit}
                    onChange={(e) =>
                      handleUnitChange(e.target.value as MeasurementUnit)
                    }
                    className="mt-1 w-full px-2 py-1.5 rounded-xl studio-select"
                  >
                    {UNIT_OPTIONS.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="text-[11px] text-[#888888] dark:text-[#858585]">
                    Width ({unit})
                  </span>
                  <input
                    type="number"
                    step="any"
                    value={widthText}
                    onChange={(e) => handleWidthTextChange(e.target.value)}
                    className={`mt-1 w-full px-2.5 py-1.5 rounded-xl studio-input tabular-nums ${
                      !Number.isFinite(rawWidthPt) ||
                      rawWidthPt < MIN_PAGE_DIM_PT ||
                      rawWidthPt > MAX_PAGE_DIM_PT
                        ? '!border-red-500'
                        : ''
                    }`}
                  />
                </label>

                <label className="block">
                  <span className="text-[11px] text-[#888888] dark:text-[#858585]">
                    Height ({unit})
                  </span>
                  <input
                    type="number"
                    step="any"
                    value={heightText}
                    onChange={(e) => handleHeightTextChange(e.target.value)}
                    className={`mt-1 w-full px-2.5 py-1.5 rounded-xl studio-input tabular-nums ${
                      !Number.isFinite(rawHeightPt) ||
                      rawHeightPt < MIN_PAGE_DIM_PT ||
                      rawHeightPt > MAX_PAGE_DIM_PT
                        ? '!border-red-500'
                        : ''
                    }`}
                  />
                </label>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-[#F7F7F7] dark:bg-[#0B0B0B] border border-black/10 dark:border-white/10 text-[11px] tabular-nums text-[#555555] dark:text-[#B5B5B5]">
                <span>
                  PDF Points:{' '}
                  <strong className="text-[#101010] dark:text-white">
                    {Number.isFinite(rawWidthPt) ? rawWidthPt.toFixed(2) : '—'} ×{' '}
                    {Number.isFinite(rawHeightPt) ? rawHeightPt.toFixed(2) : '—'} pt
                  </strong>
                </span>
                <span>
                  {Number.isFinite(rawWidthPt)
                    ? `${ptToUnit(rawWidthPt, 'mm')} × ${ptToUnit(
                        rawHeightPt,
                        'mm'
                      )} mm · ${ptToUnit(rawWidthPt, 'in')} × ${ptToUnit(
                        rawHeightPt,
                        'in'
                      )} in`
                    : 'Invalid numeric size'}
                </span>
              </div>
            </div>

            {/* Orientation */}
            <div>
              <div className="text-[11px] font-medium text-[#555555] dark:text-[#B5B5B5] mb-1.5">
                Orientation (swaps width/height while preserving custom dimensions)
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    ['portrait', 'Portrait'],
                    ['landscape', 'Landscape'],
                    ['custom', 'Custom Free'],
                  ] as const
                ).map(([ori, label]) => (
                  <button
                    key={ori}
                    type="button"
                    onClick={() => handleOrientationChange(ori)}
                    className={`py-1.5 rounded-lg border font-medium transition-colors ${
                      draftPage.orientation === ori
                        ? 'studio-active-surface'
                        : 'border-black/15 dark:border-white/15 text-[#555555] dark:text-[#B5B5B5] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Margins */}
            <div className="pt-3 border-t border-black/10 dark:border-white/10">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-medium text-[#555555] dark:text-[#B5B5B5]">
                  Page Margins ({unit})
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setDraftPage((prev) => ({
                      ...prev,
                      marginRightPt: prev.marginTopPt,
                      marginBottomPt: prev.marginTopPt,
                      marginLeftPt: prev.marginTopPt,
                    }))
                  }
                  className="text-[10px] text-[#101010] dark:text-white hover:underline font-medium"
                >
                  Apply Top Margin to All
                </button>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {(
                  [
                    ['Top', 'marginTopPt'],
                    ['Right', 'marginRightPt'],
                    ['Bottom', 'marginBottomPt'],
                    ['Left', 'marginLeftPt'],
                  ] as const
                ).map(([label, key]) => (
                  <label key={key} className="block">
                    <span className="text-[10px] text-[#888888] dark:text-[#858585]">{label}</span>
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      value={ptToUnit(draftPage[key], unit)}
                      onChange={(e) =>
                        setDraftPage((prev) => ({
                          ...prev,
                          [key]: Math.max(
                            0,
                            unitToPt(Number(e.target.value) || 0, unit)
                          ),
                        }))
                      }
                      className="mt-0.5 w-full px-2 py-1 rounded-lg studio-input tabular-nums"
                    />
                  </label>
                ))}
              </div>
            </div>

            {/* Spacing, Bleed, Crop Marks, Background & Rotation */}
            <div className="pt-3 border-t border-black/10 dark:border-white/10 space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <label className="block">
                  <span className="text-[10px] text-[#888888] dark:text-[#858585]">
                    Horiz. Spacing ({unit})
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={ptToUnit(hSpacingPt, unit)}
                    onChange={(e) =>
                      setHSpacingPt(
                        Math.max(0, unitToPt(Number(e.target.value) || 0, unit))
                      )
                    }
                    className="mt-0.5 w-full px-2 py-1 rounded-lg studio-input tabular-nums"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] text-[#888888] dark:text-[#858585]">
                    Vert. Spacing ({unit})
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={ptToUnit(vSpacingPt, unit)}
                    onChange={(e) =>
                      setVSpacingPt(
                        Math.max(0, unitToPt(Number(e.target.value) || 0, unit))
                      )
                    }
                    className="mt-0.5 w-full px-2 py-1 rounded-lg studio-input tabular-nums"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] text-[#888888] dark:text-[#858585]">
                    Bleed ({unit})
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={ptToUnit(bleedPt, unit)}
                    onChange={(e) =>
                      setDraftPage((prev) => ({
                        ...prev,
                        bleedPt: Math.max(
                          0,
                          unitToPt(Number(e.target.value) || 0, unit)
                        ),
                      }))
                    }
                    className="mt-0.5 w-full px-2 py-1 rounded-lg studio-input tabular-nums"
                  />
                </label>
              </div>

              <div className="grid grid-cols-3 gap-2 items-end">
                <label className="block">
                  <span className="text-[10px] text-[#888888] dark:text-[#858585]">Background</span>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <input
                      type="color"
                      value={draftPage.backgroundColor}
                      onChange={(e) =>
                        setDraftPage((prev) => ({
                          ...prev,
                          backgroundColor: e.target.value,
                        }))
                      }
                      className="w-7 h-7 rounded-lg border border-black/15 dark:border-white/15 cursor-pointer"
                    />
                    <span className="font-mono text-[10px] text-[#555555] dark:text-[#B5B5B5]">
                      {draftPage.backgroundColor}
                    </span>
                    {draftPage.backgroundColor !== '#FFFFFF' && (
                      <button
                        type="button"
                        title="Reset background to white"
                        onClick={() =>
                          setDraftPage((prev) => ({
                            ...prev,
                            backgroundColor: '#FFFFFF',
                          }))
                        }
                        className="text-[#888888] hover:text-[#101010] dark:hover:text-white"
                      >
                        <RotateCcw className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </label>

                <label className="block">
                  <span className="text-[10px] text-[#888888] dark:text-[#858585]">Page Rotation</span>
                  <select
                    value={draftPage.rotation}
                    onChange={(e) =>
                      setDraftPage((prev) => ({
                        ...prev,
                        rotation: Number(e.target.value) as 0 | 90 | 180 | 270,
                      }))
                    }
                    className="mt-0.5 w-full px-2 py-1 rounded-lg studio-select"
                  >
                    <option value={0}>0°</option>
                    <option value={90}>90° CW</option>
                    <option value={180}>180°</option>
                    <option value={270}>270° CW</option>
                  </select>
                </label>

                <label className="flex items-center gap-2 pb-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(draftPage.cropMarks)}
                    onChange={(e) =>
                      setDraftPage((prev) => ({
                        ...prev,
                        cropMarks: e.target.checked,
                      }))
                    }
                    className="rounded border-black/30 dark:border-white/30 accent-[#101010] dark:accent-white"
                  />
                  <span className="text-[#101010] dark:text-white">
                    Crop Marks
                  </span>
                </label>
              </div>
            </div>

            {/* Custom Paper Presets Manager */}
            <div className="pt-3 border-t border-black/10 dark:border-white/10 space-y-2.5">
              <div className="font-semibold text-[#101010] dark:text-white">
                Saved Custom Paper Presets
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Preset name (e.g. 80mm Receipt Roll, Business Card)"
                  value={newPresetName}
                  onChange={(e) => setNewPresetName(e.target.value)}
                  className="flex-1 px-2.5 py-1.5 rounded-xl studio-input"
                />
                <button
                  type="button"
                  disabled={!dimValidation.valid}
                  onClick={handleSaveCustomPreset}
                  className="px-3 py-1.5 rounded-xl bg-[#101010] text-white hover:bg-[#262626] dark:bg-white dark:text-[#050505] dark:hover:bg-[#E6E6E6] font-medium disabled:opacity-45 flex items-center gap-1 whitespace-nowrap transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Save Preset
                </button>
              </div>

              {presets.length === 0 ? (
                <div className="p-3 rounded-xl border border-dashed border-black/15 dark:border-white/15 text-[11px] text-[#888888] dark:text-[#858585] text-center">
                  No custom paper presets saved yet. Enter custom dimensions above and click Save Preset.
                </div>
              ) : (
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {presets.map((preset) => {
                    const isActive = draftPage.customPresetId === preset.id;
                    const isEditing = editingPresetId === preset.id;
                    return (
                      <div
                        key={preset.id}
                        className={`px-2.5 py-2 rounded-xl border flex items-center justify-between gap-2 transition-colors ${
                          isActive
                            ? 'studio-active-surface'
                            : 'border-black/10 dark:border-white/12 hover:bg-black/[0.03] dark:hover:bg-white/[0.04]'
                        }`}
                      >
                        {isEditing ? (
                          <div className="flex-1 flex items-center gap-1.5">
                            <input
                              type="text"
                              autoFocus
                              value={editingPresetName}
                              onChange={(e) => setEditingPresetName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  setPresets(
                                    renameCustomPaperPreset(
                                      preset.id,
                                      editingPresetName
                                    )
                                  );
                                  setEditingPresetId(null);
                                }
                              }}
                              className="flex-1 px-2 py-0.5 rounded-lg border border-black/30 dark:border-white/30 bg-transparent text-xs text-[#101010] dark:text-white"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                setPresets(
                                  renameCustomPaperPreset(
                                    preset.id,
                                    editingPresetName
                                  )
                                );
                                setEditingPresetId(null);
                              }}
                              className="p-1 text-[#101010] dark:text-white hover:bg-black/[0.06] dark:hover:bg-white/[0.08] rounded-lg"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleApplySavedPreset(preset)}
                            className="flex-1 text-left min-w-0"
                          >
                            <div className="font-medium text-[#101010] dark:text-white truncate">
                              {preset.name}
                            </div>
                            <div className="text-[10px] text-[#888888] dark:text-[#858585] tabular-nums">
                              {ptToUnit(preset.widthPt, preset.unit)} ×{' '}
                              {ptToUnit(preset.heightPt, preset.unit)} {preset.unit}{' '}
                              ({preset.widthPt.toFixed(1)}×{preset.heightPt.toFixed(1)} pt ·{' '}
                              {preset.orientation})
                            </div>
                          </button>
                        )}

                        {!isEditing && (
                          <div className="flex items-center gap-0.5 shrink-0">
                            <button
                              type="button"
                              title="Rename preset"
                              onClick={() => {
                                setEditingPresetId(preset.id);
                                setEditingPresetName(preset.name);
                              }}
                              className="p-1 text-[#888888] hover:text-[#101010] dark:hover:text-white"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              title="Duplicate preset"
                              onClick={() =>
                                setPresets(duplicateCustomPaperPreset(preset.id))
                              }
                              className="p-1 text-[#888888] hover:text-[#101010] dark:hover:text-white"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              title="Delete preset"
                              onClick={() =>
                                setPresets(deleteCustomPaperPreset(preset.id))
                              }
                              className="p-1 text-[#888888] hover:text-[#101010] dark:hover:text-white"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
              </>
            )}

            {showCopiesSection && (
              <div className="space-y-4">
                <div className="text-[11px] font-medium text-[#555555] dark:text-[#B5B5B5]">
                  Copies per Page & Grid Layout
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {COPY_COUNTS.map((cnt) => (
                    <button
                      key={cnt}
                      type="button"
                      onClick={() => handleSelectCopiesPreset(cnt)}
                      className={`min-h-[40px] px-2 rounded-lg border text-xs font-medium tabular-nums transition-colors ${
                        draftCopiesCount === cnt
                          ? 'studio-active-surface font-semibold'
                          : 'border-black/15 dark:border-white/15 text-[#555555] dark:text-[#B5B5B5] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                      }`}
                    >
                      {cnt}×
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-2 tablet:grid-cols-3 gap-2">
                  <label className="block">
                    <span className="text-[10px] text-[#888888] dark:text-[#858585]">Columns</span>
                    <input
                      type="number"
                      min="1"
                      max="12"
                      value={draftCopies.columns}
                      onChange={(e) => {
                        const cols = Math.max(1, Number(e.target.value) || 1);
                        setDraftCopies((prev) => ({
                          ...prev,
                          enabled: cols * prev.rows > 1,
                          columns: cols,
                          copiesPreset: 'custom',
                        }));
                      }}
                      className="mt-0.5 w-full min-h-[40px] px-2 rounded-lg studio-input tabular-nums"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] text-[#888888] dark:text-[#858585]">Rows</span>
                    <input
                      type="number"
                      min="1"
                      max="12"
                      value={draftCopies.rows}
                      onChange={(e) => {
                        const rows = Math.max(1, Number(e.target.value) || 1);
                        setDraftCopies((prev) => ({
                          ...prev,
                          enabled: prev.columns * rows > 1,
                          rows,
                          copiesPreset: 'custom',
                        }));
                      }}
                      className="mt-0.5 w-full min-h-[40px] px-2 rounded-lg studio-input tabular-nums"
                    />
                  </label>
                  <label className="col-span-2 tablet:col-span-1 block">
                    <span className="text-[10px] text-[#888888] dark:text-[#858585]">Scaling</span>
                    <select
                      value={draftFit.scalingMode}
                      onChange={(e) =>
                        setDraftFit((prev) => ({
                          ...prev,
                          scalingMode: e.target.value as ScalingMode,
                        }))
                      }
                      className="mt-0.5 w-full min-h-[40px] px-2 rounded-lg studio-select"
                    >
                      <option value="auto_fit_aspect">Auto-Fit</option>
                      <option value="fit_to_cell">Fit Cell</option>
                      <option value="fill_cell">Fill Cell</option>
                      <option value="fit_to_page">Fit Page</option>
                      <option value="preserve_original">100% Orig</option>
                      <option value="custom_percent">Custom %</option>
                    </select>
                  </label>
                </div>

                {draftFit.scalingMode === 'custom_percent' && (
                  <label className="block">
                    <span className="text-[10px] text-[#888888] dark:text-[#858585]">Custom Scale (%)</span>
                    <input
                      type="number"
                      min="10"
                      max="400"
                      value={draftFit.customPercent}
                      onChange={(e) =>
                        setDraftFit((prev) => ({
                          ...prev,
                          customPercent: Math.max(10, Number(e.target.value) || 100),
                        }))
                      }
                      className="mt-0.5 w-full min-h-[40px] px-2 rounded-lg studio-input tabular-nums"
                    />
                  </label>
                )}

                {viewport.isMobile && (
                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-black/10 dark:border-white/10">
                    <label className="block">
                      <span className="text-[10px] text-[#888888] dark:text-[#858585]">Horiz. Spacing ({unit})</span>
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        value={ptToUnit(hSpacingPt, unit)}
                        onChange={(e) =>
                          setHSpacingPt(Math.max(0, unitToPt(Number(e.target.value) || 0, unit)))
                        }
                        className="mt-0.5 w-full min-h-[40px] px-2 rounded-lg studio-input tabular-nums"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[10px] text-[#888888] dark:text-[#858585]">Vert. Spacing ({unit})</span>
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        value={ptToUnit(vSpacingPt, unit)}
                        onChange={(e) =>
                          setVSpacingPt(Math.max(0, unitToPt(Number(e.target.value) || 0, unit)))
                        }
                        className="mt-0.5 w-full min-h-[40px] px-2 rounded-lg studio-input tabular-nums"
                      />
                    </label>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right Live Scaled Page Preview & Validation */}
          <div
            className={`flex-1 bg-[#EFEFEF] dark:bg-[#0B0B0B] p-4 tablet:p-6 flex flex-col items-center justify-between overflow-y-auto ${
              !showPreviewSection ? 'hidden' : ''
            }`}
          >
            <div className="w-full flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="font-semibold text-[#101010] dark:text-white">
                Live Scaled Page Preview ({draftCopies.columns}×{draftCopies.rows} · {draftCopiesCount} copies)
              </div>
              <div className="font-mono text-[11px] text-[#555555] dark:text-[#B5B5B5] tabular-nums">
                MediaBox: [0, 0, {totalW.toFixed(2)}, {totalH.toFixed(2)}] pt
              </div>
            </div>

            {/* Scaled Page Canvas Container */}
            <div className="my-4 flex flex-col items-center justify-center flex-1">
              {/* Top width dimension label */}
              <div className="mb-1.5 text-[11px] font-mono text-[#555555] dark:text-[#B5B5B5] tabular-nums">
                {ptToUnit(trimW, unit)} {unit} ({trimW.toFixed(1)} pt)
                {bleedPt > 0 ? ` + ${ptToUnit(bleedPt * 2, unit)} bleed` : ''}
              </div>

              <div className="flex items-center">
                {/* Left height dimension label */}
                <div
                  style={{ writingMode: 'vertical-rl' }}
                  className="mr-1.5 rotate-180 text-[11px] font-mono text-[#555555] dark:text-[#B5B5B5] tabular-nums"
                >
                  {ptToUnit(trimH, unit)} {unit} ({trimH.toFixed(1)} pt)
                </div>

                {/* Outer MediaBox (Bleed + Trim) */}
                <div
                  style={{
                    width: Math.max(24, totalW * previewScale),
                    height: Math.max(24, totalH * previewScale),
                    backgroundColor: draftPage.backgroundColor || '#FFFFFF',
                  }}
                  className="relative shadow-2xl border border-black/25 dark:border-white/25 overflow-hidden"
                >
                  {/* Bleed zone indicator */}
                  {bleedPt > 0 && (
                    <div
                      style={{
                        left: bleedPt * previewScale,
                        top: bleedPt * previewScale,
                        width: trimW * previewScale,
                        height: trimH * previewScale,
                      }}
                      className="pointer-events-none absolute border border-dashed border-[#858585]/80"
                    />
                  )}

                  {/* Crop Marks at TrimBox corners */}
                  {draftPage.cropMarks && (
                    <div
                      style={{
                        left: bleedPt * previewScale,
                        top: bleedPt * previewScale,
                        width: trimW * previewScale,
                        height: trimH * previewScale,
                      }}
                      className="pointer-events-none absolute"
                    >
                      <span className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 border-[#101010]" />
                      <span className="absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 border-[#101010]" />
                      <span className="absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 border-[#101010]" />
                      <span className="absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 border-[#101010]" />
                    </div>
                  )}

                  {/* Printable Area Margin Guide */}
                  {dimValidation.valid && (
                    <div
                      style={{
                        left: (bleedPt + draftPage.marginLeftPt) * previewScale,
                        top: (bleedPt + draftPage.marginTopPt) * previewScale,
                        width: Math.max(
                          2,
                          (trimW - draftPage.marginLeftPt - draftPage.marginRightPt) *
                            previewScale
                        ),
                        height: Math.max(
                          2,
                          (trimH - draftPage.marginTopPt - draftPage.marginBottomPt) *
                            previewScale
                        ),
                      }}
                      className="pointer-events-none absolute border border-dashed border-[#101010]/60 bg-black/[0.02]"
                    />
                  )}

                  {/* Placed Content / Copy Slots Silhouette */}
                  {previewLayout.slots.map((slot) => (
                    <div
                      key={slot.slotIndex}
                      style={{
                        left: (bleedPt + slot.drawXPt) * previewScale,
                        top: (bleedPt + slot.drawTopPt) * previewScale,
                        width: Math.max(4, slot.placedWidthPt * previewScale),
                        height: Math.max(4, slot.placedHeightPt * previewScale),
                      }}
                      className={`pointer-events-none absolute overflow-hidden border ${
                        slot.clipsSheet
                          ? 'border-red-500 bg-red-500/10'
                          : 'border-[#101010]/65 bg-black/[0.04]'
                      }`}
                    >
                      {thumbUrl && (
                        <img
                          src={thumbUrl}
                          alt="Content preview"
                          referrerPolicy="no-referrer"
                          style={{
                            position: 'absolute',
                            left:
                              -previewLayout.sourceBox.x *
                              slot.scale *
                              previewScale,
                            top:
                              -previewLayout.sourceBox.y *
                              slot.scale *
                              previewScale,
                            width:
                              previewLayout.originalPageWidthPt *
                              slot.scale *
                              previewScale,
                            height:
                              previewLayout.originalPageHeightPt *
                              slot.scale *
                              previewScale,
                            maxWidth: 'none',
                            maxHeight: 'none',
                          }}
                          className="opacity-70"
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center justify-center gap-3 text-[10px] text-[#555555] dark:text-[#B5B5B5]">
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-0.5 bg-[#101010]/70 dark:bg-white/70 inline-block" /> Printable Area
                </span>
                {bleedPt > 0 && (
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-0.5 bg-[#858585] inline-block" /> Trim / Bleed Box
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-0.5 bg-[#101010] dark:bg-white inline-block" /> Placed Content
                </span>
              </div>
            </div>

            {/* Live Validation & Printable Area Status */}
            <div className="w-full space-y-2 text-xs">
              {!dimValidation.valid && (
                <div className="p-2.5 rounded-xl border border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>{dimValidation.errors.join(' ')}</div>
                </div>
              )}
              {dimValidation.warnings.map((w, i) => (
                <div
                  key={i}
                  className="p-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 flex items-start gap-2"
                >
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>{w}</div>
                </div>
              ))}
              {printableAreaWarning && (
                <div className="p-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>{printableAreaWarning}</div>
                </div>
              )}
              {dimValidation.valid &&
                dimValidation.warnings.length === 0 &&
                !printableAreaWarning && (
                  <div className="p-2.5 rounded-xl border border-black/15 dark:border-white/15 glass-level-2 text-[#101010] dark:text-white flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>
                      Valid custom MediaBox ({trimW.toFixed(1)} × {trimH.toFixed(1)} pt) · Content fits inside printable area
                    </span>
                  </div>
                )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 tablet:px-5 py-3 border-t border-black/10 dark:border-white/12 flex flex-col tablet:flex-row tablet:items-center justify-between gap-2.5 shrink-0 glass-level-2 text-xs pb-safe">
          <div className="text-[#555555] dark:text-[#B5B5B5] tabular-nums truncate">
            {draftPage.customPresetName
              ? `Preset: ${draftPage.customPresetName}`
              : `Size: ${draftPage.sizePreset}`}
            {' · '}
            {ptToUnit(trimW, unit)} × {ptToUnit(trimH, unit)} {unit} ({draftPage.orientation}) · {draftCopiesCount}×/pg
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 tablet:flex-none min-h-[44px] tablet:min-h-[38px] px-3.5 py-2 rounded-xl border border-black/15 dark:border-white/15 hover:bg-black/[0.04] dark:hover:bg-white/[0.08] text-[#101010] dark:text-white font-medium whitespace-nowrap transition-colors"
            >
              Cancel
            </button>
              <button
                type="button"
                disabled={!dimValidation.valid}
                onClick={handleApplyAndClose}
                className="flex-1 tablet:flex-none min-h-[44px] tablet:min-h-[38px] px-4 py-2 rounded-xl bg-[#101010] text-white hover:bg-[#262626] dark:bg-white dark:text-[#050505] dark:hover:bg-[#E6E6E6] font-medium shadow-sm disabled:opacity-45 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors active:scale-[0.98]"
              >
                <Save className="w-3.5 h-3.5" />
                Apply Configuration
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
      )}
    </AnimatePresence>
  );
};
