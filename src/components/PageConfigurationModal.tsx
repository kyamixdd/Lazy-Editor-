import React, { useEffect, useMemo, useState } from 'react';
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

  if (!isOpen) return null;

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
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-0 tablet:p-4">
      <div className="w-full h-[100dvh] tablet:h-auto tablet:max-w-5xl tablet:max-h-[92dvh] rounded-none tablet:rounded-xl border-0 tablet:border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0E131D] shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 tablet:px-5 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0 pt-safe">
          <div className="flex items-center gap-2.5 min-w-0">
            <Maximize2 className="w-4 h-4 text-blue-500 shrink-0" />
            <div className="min-w-0">
              <h2 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-100 truncate">
                Page Setup & Imposition
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                Physical PDF MediaBox (1 in = 72 pt) · Copies, Margins & Scaling
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-w-[44px] min-h-[44px] -mr-2 flex items-center justify-center rounded text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Close page setup"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mobile Tab Switcher */}
        {viewport.isMobile && (
          <div className="grid grid-cols-3 border-b border-slate-200 dark:border-slate-800 text-xs font-medium shrink-0 bg-slate-50 dark:bg-[#0B0F17]">
            {(
              [
                ['paper', 'Paper & Size'],
                ['copies', 'Copies & Grid'],
                ['preview', 'Live Preview'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setMobileTab(id)}
                className={`min-h-[44px] border-b-2 transition-colors ${
                  mobileTab === id
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400 bg-white dark:bg-[#0E131D]'
                    : 'border-transparent text-slate-500 dark:text-slate-400'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Two-column Body (tabbed on mobile) */}
        <div className="flex-1 overflow-hidden flex flex-col tablet:flex-row">
          {/* Left Configuration Controls */}
          <div
            className={`w-full tablet:w-[400px] desktop:w-[520px] shrink-0 overflow-y-auto p-4 tablet:p-5 border-b tablet:border-b-0 tablet:border-r border-slate-200 dark:border-slate-800 space-y-5 text-xs ${
              !showPaperSection && !showCopiesSection ? 'hidden' : ''
            }`}
          >
            {showPaperSection && (
              <>
            {/* Standard Paper Sizes */}
            <div>
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-2">
                Standard Paper Sizes
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {STANDARD_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => handleSelectStandardPreset(preset)}
                    className={`py-1.5 px-2 rounded border text-[11px] font-medium truncate ${
                      draftPage.sizePreset === preset
                        ? 'border-blue-600 bg-blue-600/15 text-blue-600 dark:text-blue-400'
                        : 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => handleSelectStandardPreset('Custom')}
                  className={`py-1.5 px-2 rounded border text-[11px] font-medium truncate ${
                    draftPage.sizePreset === 'Custom'
                      ? 'border-emerald-600 bg-emerald-600/15 text-emerald-700 dark:text-emerald-400'
                      : 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                  }`}
                >
                  Custom
                </button>
              </div>
            </div>

            {/* Units & Custom Dimensions */}
            <div className="space-y-3 pt-3 border-t border-slate-200 dark:border-slate-800">
              <div className="grid grid-cols-3 gap-3">
                <label className="block">
                  <span className="text-[11px] text-slate-500">Unit</span>
                  <select
                    value={unit}
                    onChange={(e) =>
                      handleUnitChange(e.target.value as MeasurementUnit)
                    }
                    className="mt-1 w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111827]"
                  >
                    {UNIT_OPTIONS.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="text-[11px] text-slate-500">
                    Width ({unit})
                  </span>
                  <input
                    type="number"
                    step="any"
                    value={widthText}
                    onChange={(e) => handleWidthTextChange(e.target.value)}
                    className={`mt-1 w-full px-2.5 py-1.5 rounded border bg-transparent tabular-nums ${
                      !Number.isFinite(rawWidthPt) ||
                      rawWidthPt < MIN_PAGE_DIM_PT ||
                      rawWidthPt > MAX_PAGE_DIM_PT
                        ? 'border-red-500'
                        : 'border-slate-300 dark:border-slate-700'
                    }`}
                  />
                </label>

                <label className="block">
                  <span className="text-[11px] text-slate-500">
                    Height ({unit})
                  </span>
                  <input
                    type="number"
                    step="any"
                    value={heightText}
                    onChange={(e) => handleHeightTextChange(e.target.value)}
                    className={`mt-1 w-full px-2.5 py-1.5 rounded border bg-transparent tabular-nums ${
                      !Number.isFinite(rawHeightPt) ||
                      rawHeightPt < MIN_PAGE_DIM_PT ||
                      rawHeightPt > MAX_PAGE_DIM_PT
                        ? 'border-red-500'
                        : 'border-slate-300 dark:border-slate-700'
                    }`}
                  />
                </label>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 rounded bg-slate-50 dark:bg-[#111827] border border-slate-200 dark:border-slate-800 text-[11px] tabular-nums text-slate-600 dark:text-slate-400">
                <span>
                  PDF Points:{' '}
                  <strong className="text-slate-900 dark:text-slate-100">
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
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">
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
                    className={`py-1.5 rounded border font-medium ${
                      draftPage.orientation === ori
                        ? 'border-blue-600 bg-blue-600/12 text-blue-600 dark:text-blue-400'
                        : 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Margins */}
            <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
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
                  className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline"
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
                    <span className="text-[10px] text-slate-400">{label}</span>
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
                      className="mt-0.5 w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-transparent tabular-nums"
                    />
                  </label>
                ))}
              </div>
            </div>

            {/* Spacing, Bleed, Crop Marks, Background & Rotation */}
            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <label className="block">
                  <span className="text-[10px] text-slate-400">
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
                    className="mt-0.5 w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-transparent tabular-nums"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] text-slate-400">
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
                    className="mt-0.5 w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-transparent tabular-nums"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] text-slate-400">
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
                    className="mt-0.5 w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-transparent tabular-nums"
                  />
                </label>
              </div>

              <div className="grid grid-cols-3 gap-2 items-end">
                <label className="block">
                  <span className="text-[10px] text-slate-400">Background</span>
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
                      className="w-7 h-7 rounded border border-slate-300 dark:border-slate-700 cursor-pointer"
                    />
                    <span className="font-mono text-[10px]">
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
                        className="text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
                      >
                        <RotateCcw className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </label>

                <label className="block">
                  <span className="text-[10px] text-slate-400">Page Rotation</span>
                  <select
                    value={draftPage.rotation}
                    onChange={(e) =>
                      setDraftPage((prev) => ({
                        ...prev,
                        rotation: Number(e.target.value) as 0 | 90 | 180 | 270,
                      }))
                    }
                    className="mt-0.5 w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111827]"
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
                    className="rounded border-slate-400 text-blue-600"
                  />
                  <span className="text-slate-700 dark:text-slate-300">
                    Crop Marks
                  </span>
                </label>
              </div>
            </div>

            {/* Custom Paper Presets Manager */}
            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
              <div className="font-semibold text-slate-900 dark:text-slate-100">
                Saved Custom Paper Presets
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Preset name (e.g. 80mm Receipt Roll, Business Card)"
                  value={newPresetName}
                  onChange={(e) => setNewPresetName(e.target.value)}
                  className="flex-1 px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-transparent"
                />
                <button
                  type="button"
                  disabled={!dimValidation.valid}
                  onClick={handleSaveCustomPreset}
                  className="px-3 py-1.5 rounded bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-45 flex items-center gap-1 whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Save Preset
                </button>
              </div>

              {presets.length === 0 ? (
                <div className="p-3 rounded border border-dashed border-slate-300 dark:border-slate-700 text-[11px] text-slate-500 text-center">
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
                        className={`px-2.5 py-2 rounded border flex items-center justify-between gap-2 ${
                          isActive
                            ? 'border-emerald-600 bg-emerald-600/10'
                            : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40'
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
                              className="flex-1 px-2 py-0.5 rounded border border-blue-500 bg-transparent text-xs"
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
                              className="p-1 text-emerald-600 hover:bg-emerald-500/10 rounded"
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
                            <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                              {preset.name}
                            </div>
                            <div className="text-[10px] text-slate-500 tabular-nums">
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
                              className="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              title="Duplicate preset"
                              onClick={() =>
                                setPresets(duplicateCustomPaperPreset(preset.id))
                              }
                              className="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              title="Delete preset"
                              onClick={() =>
                                setPresets(deleteCustomPaperPreset(preset.id))
                              }
                              className="p-1 text-slate-400 hover:text-red-500"
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
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  Copies per Page & Grid Layout
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {COPY_COUNTS.map((cnt) => (
                    <button
                      key={cnt}
                      type="button"
                      onClick={() => handleSelectCopiesPreset(cnt)}
                      className={`min-h-[40px] px-2 rounded border text-xs font-medium tabular-nums ${
                        draftCopiesCount === cnt
                          ? 'border-blue-600 bg-blue-600/15 text-blue-600 dark:text-blue-400'
                          : 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {cnt}×
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-2 tablet:grid-cols-3 gap-2">
                  <label className="block">
                    <span className="text-[10px] text-slate-400">Columns</span>
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
                      className="mt-0.5 w-full min-h-[40px] px-2 rounded border border-slate-300 dark:border-slate-700 bg-transparent tabular-nums"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] text-slate-400">Rows</span>
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
                      className="mt-0.5 w-full min-h-[40px] px-2 rounded border border-slate-300 dark:border-slate-700 bg-transparent tabular-nums"
                    />
                  </label>
                  <label className="col-span-2 tablet:col-span-1 block">
                    <span className="text-[10px] text-slate-400">Scaling</span>
                    <select
                      value={draftFit.scalingMode}
                      onChange={(e) =>
                        setDraftFit((prev) => ({
                          ...prev,
                          scalingMode: e.target.value as ScalingMode,
                        }))
                      }
                      className="mt-0.5 w-full min-h-[40px] px-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111827]"
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
                    <span className="text-[10px] text-slate-400">Custom Scale (%)</span>
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
                      className="mt-0.5 w-full min-h-[40px] px-2 rounded border border-slate-300 dark:border-slate-700 bg-transparent tabular-nums"
                    />
                  </label>
                )}

                {viewport.isMobile && (
                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                    <label className="block">
                      <span className="text-[10px] text-slate-400">Horiz. Spacing ({unit})</span>
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        value={ptToUnit(hSpacingPt, unit)}
                        onChange={(e) =>
                          setHSpacingPt(Math.max(0, unitToPt(Number(e.target.value) || 0, unit)))
                        }
                        className="mt-0.5 w-full min-h-[40px] px-2 rounded border border-slate-300 dark:border-slate-700 bg-transparent tabular-nums"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[10px] text-slate-400">Vert. Spacing ({unit})</span>
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        value={ptToUnit(vSpacingPt, unit)}
                        onChange={(e) =>
                          setVSpacingPt(Math.max(0, unitToPt(Number(e.target.value) || 0, unit)))
                        }
                        className="mt-0.5 w-full min-h-[40px] px-2 rounded border border-slate-300 dark:border-slate-700 bg-transparent tabular-nums"
                      />
                    </label>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right Live Scaled Page Preview & Validation */}
          <div
            className={`flex-1 bg-slate-100 dark:bg-[#080B11] p-4 tablet:p-6 flex flex-col items-center justify-between overflow-y-auto ${
              !showPreviewSection ? 'hidden' : ''
            }`}
          >
            <div className="w-full flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="font-semibold text-slate-900 dark:text-slate-100">
                Live Scaled Page Preview ({draftCopies.columns}×{draftCopies.rows} · {draftCopiesCount} copies)
              </div>
              <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                MediaBox: [0, 0, {totalW.toFixed(2)}, {totalH.toFixed(2)}] pt
              </div>
            </div>

            {/* Scaled Page Canvas Container */}
            <div className="my-4 flex flex-col items-center justify-center flex-1">
              {/* Top width dimension label */}
              <div className="mb-1.5 text-[11px] font-mono text-slate-600 dark:text-slate-300 tabular-nums">
                {ptToUnit(trimW, unit)} {unit} ({trimW.toFixed(1)} pt)
                {bleedPt > 0 ? ` + ${ptToUnit(bleedPt * 2, unit)} bleed` : ''}
              </div>

              <div className="flex items-center">
                {/* Left height dimension label */}
                <div
                  style={{ writingMode: 'vertical-rl' }}
                  className="mr-1.5 rotate-180 text-[11px] font-mono text-slate-600 dark:text-slate-300 tabular-nums"
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
                  className="relative shadow-2xl border border-slate-400 dark:border-slate-600 overflow-hidden"
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
                      className="pointer-events-none absolute border border-amber-500/80"
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
                      <span className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 border-slate-900" />
                      <span className="absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 border-slate-900" />
                      <span className="absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 border-slate-900" />
                      <span className="absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 border-slate-900" />
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
                      className="pointer-events-none absolute border border-dashed border-blue-500/70 bg-blue-500/[0.03]"
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
                          : 'border-emerald-500/70 bg-emerald-500/[0.06]'
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

              <div className="mt-2 flex flex-wrap items-center justify-center gap-3 text-[10px] text-slate-500">
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-0.5 bg-blue-500 inline-block" /> Printable Area
                </span>
                {bleedPt > 0 && (
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-0.5 bg-amber-500 inline-block" /> Trim / Bleed Box
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-0.5 bg-emerald-500 inline-block" /> Placed Content
                </span>
              </div>
            </div>

            {/* Live Validation & Printable Area Status */}
            <div className="w-full space-y-2 text-xs">
              {!dimValidation.valid && (
                <div className="p-2.5 rounded border border-red-500/50 bg-red-500/10 text-red-600 dark:text-red-300 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>{dimValidation.errors.join(' ')}</div>
                </div>
              )}
              {dimValidation.warnings.map((w, i) => (
                <div
                  key={i}
                  className="p-2.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 flex items-start gap-2"
                >
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>{w}</div>
                </div>
              ))}
              {printableAreaWarning && (
                <div className="p-2.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>{printableAreaWarning}</div>
                </div>
              )}
              {dimValidation.valid &&
                dimValidation.warnings.length === 0 &&
                !printableAreaWarning && (
                  <div className="p-2.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
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
        <div className="px-4 tablet:px-5 py-3 border-t border-slate-200 dark:border-slate-800 flex flex-col tablet:flex-row tablet:items-center justify-between gap-2.5 shrink-0 bg-slate-50 dark:bg-[#0B0F17] text-xs pb-safe">
          <div className="text-slate-500 dark:text-slate-400 tabular-nums truncate">
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
              className="flex-1 tablet:flex-none min-h-[44px] tablet:min-h-0 px-3.5 py-2 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!dimValidation.valid}
              onClick={handleApplyAndClose}
              className="flex-1 tablet:flex-none min-h-[44px] tablet:min-h-0 px-4 py-2 rounded bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-45 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
            >
              <Save className="w-3.5 h-3.5" />
              Apply Configuration
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
