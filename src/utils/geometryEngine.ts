import {
  BoundaryMode,
  CopiesPerPageConfig,
  DocumentElement,
  OriginalPageMeta,
  PageConfig,
  PDFProject,
  RectPt,
  ScalingMode,
  SourceFitConfig,
} from '../types/pdfStudio';
import { createDefaultFitConfig } from './units';

export interface SlotGeometry {
  slotIndex: number;
  row: number;
  col: number;
  cellLeftPt: number;
  cellTopPt: number;
  cellWidthPt: number;
  cellHeightPt: number;
  drawXPt: number;
  drawTopPt: number;
  placedWidthPt: number;
  placedHeightPt: number;
  unrotatedWidthPt: number;
  unrotatedHeightPt: number;
  scale: number;
  rotation: 0 | 90 | 180 | 270;
  clipsCell: boolean;
  clipsSheet: boolean;
}

export interface SheetLayoutPlan {
  pageNumber: number;
  originalPageWidthPt: number;
  originalPageHeightPt: number;
  sourceBox: RectPt;
  boundaryMode: BoundaryMode;
  scalingMode: ScalingMode;
  outputSheetWidthPt: number;
  outputSheetHeightPt: number;
  columns: number;
  rows: number;
  availableWidthPt: number;
  availableHeightPt: number;
  slots: SlotGeometry[];
  hasOverlap: boolean;
  hasClipping: boolean;
  overlapPairs: Array<[number, number]>;
  isPassThroughOriginal1to1: boolean;
}

export function clampRect(rect: RectPt, maxW: number, maxH: number): RectPt {
  const safeMaxW = Math.max(16, maxW);
  const safeMaxH = Math.max(16, maxH);
  const x = Math.max(0, Math.min(rect.x, safeMaxW - 16));
  const y = Math.max(0, Math.min(rect.y, safeMaxH - 16));
  const width = Math.max(16, Math.min(rect.width, safeMaxW - x));
  const height = Math.max(16, Math.min(rect.height, safeMaxH - y));
  return {
    x: Number(x.toFixed(2)),
    y: Number(y.toFixed(2)),
    width: Number(width.toFixed(2)),
    height: Number(height.toFixed(2)),
  };
}

export function normalizeFitConfig(
  project: Pick<PDFProject, 'fitConfig' | 'originalPages' | 'pageConfig'>
): SourceFitConfig {
  const page1 = project.originalPages[0];
  const origW = page1?.widthPt || project.pageConfig.widthPt;
  const origH = page1?.heightPt || project.pageConfig.heightPt;
  const fallback = createDefaultFitConfig(origW, origH);
  if (!project.fitConfig) return fallback;
  return {
    ...fallback,
    ...project.fitConfig,
  };
}

export function computeElementsUnionRect(
  elements: DocumentElement[],
  pageNumber: number,
  origW: number,
  origH: number,
  paddingPt = 4
): RectPt | null {
  const visible = elements.filter(
    (e) => e.pageNumber === pageNumber && e.visible && e.type !== 'repeated_block'
  );
  if (visible.length === 0) return null;
  const minX = Math.min(...visible.map((e) => e.x)) - paddingPt;
  const minY = Math.min(...visible.map((e) => e.y)) - paddingPt;
  const maxX = Math.max(...visible.map((e) => e.x + e.width)) + paddingPt;
  const maxY = Math.max(...visible.map((e) => e.y + e.height)) + paddingPt;
  return clampRect(
    { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    origW,
    origH
  );
}

export function resolveSourceBox(
  pageMeta: OriginalPageMeta | undefined,
  elements: DocumentElement[],
  fitConfig: SourceFitConfig,
  copiesConfig: CopiesPerPageConfig,
  pageNumber: number,
  fallbackW: number,
  fallbackH: number
): RectPt {
  const origW = pageMeta?.widthPt || fallbackW;
  const origH = pageMeta?.heightPt || fallbackH;

  // Block-scoped imposition overrides full-page boundary mode
  if (
    copiesConfig.enabled &&
    copiesConfig.sourceScope === 'selected_block' &&
    copiesConfig.selectedBlockId
  ) {
    const blockEls = elements.filter(
      (e) =>
        e.blockId === copiesConfig.selectedBlockId &&
        e.pageNumber === pageNumber &&
        e.visible
    );
    const anyBlockEls =
      blockEls.length > 0
        ? blockEls
        : elements.filter(
            (e) => e.blockId === copiesConfig.selectedBlockId && e.visible
          );
    if (anyBlockEls.length > 0) {
      const minX = Math.min(...anyBlockEls.map((e) => e.x)) - 6;
      const minY = Math.min(...anyBlockEls.map((e) => e.y)) - 6;
      const maxX = Math.max(...anyBlockEls.map((e) => e.x + e.width)) + 6;
      const maxY = Math.max(...anyBlockEls.map((e) => e.y + e.height)) + 6;
      return clampRect(
        { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
        origW,
        origH
      );
    }
  }

  const pad = Math.max(0, fitConfig.cropPaddingPt ?? 2);

  switch (fitConfig.boundaryMode) {
    case 'auto_content': {
      const detected =
        pageMeta?.contentBBox ||
        pageMeta?.detectedBounds?.contentBBox ||
        computeElementsUnionRect(elements, pageNumber, origW, origH, pad);
      if (detected) {
        return clampRect(
          {
            x: detected.x - pad,
            y: detected.y - pad,
            width: detected.width + pad * 2,
            height: detected.height + pad * 2,
          },
          origW,
          origH
        );
      }
      return { x: 0, y: 0, width: origW, height: origH };
    }

    case 'manual_selection': {
      const manual =
        fitConfig.manualBoundsRect ||
        pageMeta?.contentBBox ||
        computeElementsUnionRect(elements, pageNumber, origW, origH, pad);
      if (manual) {
        return clampRect(manual, origW, origH);
      }
      return { x: 0, y: 0, width: origW, height: origH };
    }

    case 'custom_crop': {
      if (fitConfig.customCropRect) {
        return clampRect(fitConfig.customCropRect, origW, origH);
      }
      return { x: 0, y: 0, width: origW, height: origH };
    }

    case 'original_page':
    default:
      return { x: 0, y: 0, width: origW, height: origH };
  }
}

export function suggestOptimalGridForCopies(
  targetCount: number,
  sheetW: number,
  sheetH: number,
  sourceBox: RectPt,
  marginL = 18,
  marginR = 18,
  marginT = 18,
  marginB = 18,
  spacingH = 14,
  spacingV = 14
): { columns: number; rows: number } {
  const count = Math.max(1, Math.round(targetCount));
  let bestCols = 1;
  let bestRows = count;
  let bestArea = -1;

  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const availW = sheetW - marginL - marginR - spacingH * (cols - 1);
    const availH = sheetH - marginT - marginB - spacingV * (rows - 1);
    if (availW <= 10 || availH <= 10) continue;
    const cellW = availW / cols;
    const cellH = availH / rows;
    const s = Math.min(cellW / sourceBox.width, cellH / sourceBox.height);
    const area = sourceBox.width * s * (sourceBox.height * s);
    if (area > bestArea) {
      bestArea = area;
      bestCols = cols;
      bestRows = rows;
    }
  }

  return { columns: bestCols, rows: bestRows };
}

function computeProportionalScale(
  scalingMode: ScalingMode,
  effSrcW: number,
  effSrcH: number,
  cellW: number,
  cellH: number,
  customPercent: number,
  overrideScale?: number
): number {
  if (overrideScale && overrideScale > 0) {
    return overrideScale;
  }
  const safeW = Math.max(1, effSrcW);
  const safeH = Math.max(1, effSrcH);
  switch (scalingMode) {
    case 'fit_to_width':
      return Math.max(0.05, cellW / safeW);
    case 'fit_to_height':
      return Math.max(0.05, cellH / safeH);
    case 'fill_cell':
      return Math.max(0.05, Math.max(cellW / safeW, cellH / safeH));
    case 'preserve_original':
      return 1;
    case 'custom_percent':
      return Math.max(0.05, (customPercent || 100) / 100);
    case 'fit_to_page':
    case 'fit_to_cell':
    case 'auto_fit_aspect':
    default:
      return Math.max(0.05, Math.min(cellW / safeW, cellH / safeH));
  }
}

/**
 * Single authoritative geometry & imposition solver shared by:
 * - Editor & Inspector previews
 * - Bulk Generator live sheet preview
 * - Quality Control geometry validator
 * - pdf-lib PDF export engine
 *
 * Editor viewport zoom is NEVER an input to this function.
 */
export function computeSheetLayout(
  project: Pick<
    PDFProject,
    'originalPages' | 'elements' | 'pageConfig' | 'fitConfig' | 'copiesConfig'
  >,
  sourcePageNumber = 1
): SheetLayoutPlan {
  const { pageConfig, copiesConfig } = project;
  const fitConfig = normalizeFitConfig(project);
  const pageMeta =
    project.originalPages.find((p) => p.pageNumber === sourcePageNumber) ||
    project.originalPages[0];

  const origW = pageMeta?.widthPt || pageConfig.widthPt;
  const origH = pageMeta?.heightPt || pageConfig.heightPt;
  const outW = Math.max(14, pageConfig.widthPt);
  const outH = Math.max(14, pageConfig.heightPt);

  const sourceBox = resolveSourceBox(
    pageMeta,
    project.elements,
    fitConfig,
    copiesConfig,
    sourcePageNumber,
    origW,
    origH
  );

  // Determine effective scaling mode while keeping backward-compatibility with copiesConfig.fitToPage
  let effectiveScalingMode: ScalingMode = fitConfig.scalingMode;
  if (copiesConfig.enabled && !copiesConfig.fitToPage && fitConfig.scalingMode === 'auto_fit_aspect') {
    effectiveScalingMode = 'custom_percent';
  }

  // Exact 1:1 unmodified pass-through when single-page mode uses original boundaries at exact original dimensions
  const isSameDims =
    Math.abs(origW - outW) < 0.75 && Math.abs(origH - outH) < 0.75;
  const isPassThroughOriginal1to1 =
    !copiesConfig.enabled &&
    fitConfig.boundaryMode === 'original_page' &&
    isSameDims &&
    (effectiveScalingMode === 'auto_fit_aspect' ||
      effectiveScalingMode === 'fit_to_page' ||
      effectiveScalingMode === 'preserve_original');

  const cols = copiesConfig.enabled ? Math.max(1, copiesConfig.columns) : 1;
  const rows = copiesConfig.enabled ? Math.max(1, copiesConfig.rows) : 1;

  const marginL = copiesConfig.enabled
    ? copiesConfig.outerMarginLeftPt
    : isPassThroughOriginal1to1
    ? 0
    : pageConfig.marginLeftPt;
  const marginR = copiesConfig.enabled
    ? copiesConfig.outerMarginRightPt
    : isPassThroughOriginal1to1
    ? 0
    : pageConfig.marginRightPt;
  const marginT = copiesConfig.enabled
    ? copiesConfig.outerMarginTopPt
    : isPassThroughOriginal1to1
    ? 0
    : pageConfig.marginTopPt;
  const marginB = copiesConfig.enabled
    ? copiesConfig.outerMarginBottomPt
    : isPassThroughOriginal1to1
    ? 0
    : pageConfig.marginBottomPt;

  const spacingH = copiesConfig.enabled ? copiesConfig.horizontalSpacingPt : 0;
  const spacingV = copiesConfig.enabled ? copiesConfig.verticalSpacingPt : 0;

  const availW = outW - marginL - marginR - spacingH * (cols - 1);
  const availH = outH - marginT - marginB - spacingV * (rows - 1);
  const cellW = Math.max(1, availW / cols);
  const cellH = Math.max(1, availH / rows);

  const slots: SlotGeometry[] = [];
  let hasClipping = availW <= 10 || availH <= 10;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const slotIndex = r * cols + c;
      const slotOverride = copiesConfig.slotOverrides?.[slotIndex];
      const manual =
        copiesConfig.positioningMode === 'manual'
          ? copiesConfig.manualOffsets[slotIndex]
          : undefined;

      const rot = (slotOverride?.rotation ??
        copiesConfig.copyRotation ??
        0) as 0 | 90 | 180 | 270;
      const isQuarterTurn = rot === 90 || rot === 270;
      const effSrcW = isQuarterTurn ? sourceBox.height : sourceBox.width;
      const effSrcH = isQuarterTurn ? sourceBox.width : sourceBox.height;

      const customPct =
        copiesConfig.enabled && !copiesConfig.fitToPage && effectiveScalingMode === 'custom_percent'
          ? copiesConfig.copyScale * 100
          : fitConfig.customPercent;

      const scale = isPassThroughOriginal1to1
        ? 1
        : computeProportionalScale(
            effectiveScalingMode,
            effSrcW,
            effSrcH,
            cellW,
            cellH,
            customPct,
            slotOverride?.scale
          );

      const unrotatedWidthPt = sourceBox.width * scale;
      const unrotatedHeightPt = sourceBox.height * scale;
      const placedWidthPt = effSrcW * scale;
      const placedHeightPt = effSrcH * scale;

      const cellLeftPt = marginL + c * (cellW + spacingH);
      const cellTopPt = marginT + r * (cellH + spacingV);

      const offsetX = (manual?.xPt || 0) + (slotOverride?.xOffsetPt || 0);
      const offsetY = (manual?.yPt || 0) + (slotOverride?.yOffsetPt || 0);

      const drawXPt = isPassThroughOriginal1to1
        ? 0
        : cellLeftPt + (cellW - placedWidthPt) / 2 + offsetX;
      const drawTopPt = isPassThroughOriginal1to1
        ? 0
        : cellTopPt + (cellH - placedHeightPt) / 2 + offsetY;

      const clipsCell =
        !isPassThroughOriginal1to1 &&
        (placedWidthPt > cellW + 0.75 ||
          placedHeightPt > cellH + 0.75 ||
          drawXPt < cellLeftPt - 0.75 ||
          drawTopPt < cellTopPt - 0.75 ||
          drawXPt + placedWidthPt > cellLeftPt + cellW + 0.75 ||
          drawTopPt + placedHeightPt > cellTopPt + cellH + 0.75);

      const clipsSheet =
        drawXPt < -0.75 ||
        drawTopPt < -0.75 ||
        drawXPt + placedWidthPt > outW + 0.75 ||
        drawTopPt + placedHeightPt > outH + 0.75;

      if (clipsCell || clipsSheet) {
        hasClipping = true;
      }

      slots.push({
        slotIndex,
        row: r,
        col: c,
        cellLeftPt,
        cellTopPt,
        cellWidthPt: cellW,
        cellHeightPt: cellH,
        drawXPt,
        drawTopPt,
        placedWidthPt,
        placedHeightPt,
        unrotatedWidthPt,
        unrotatedHeightPt,
        scale,
        rotation: rot,
        clipsCell,
        clipsSheet,
      });
    }
  }

  // Pairwise slot overlap check
  const overlapPairs: Array<[number, number]> = [];
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const a = slots[i];
      const b = slots[j];
      const ix =
        Math.min(a.drawXPt + a.placedWidthPt, b.drawXPt + b.placedWidthPt) -
        Math.max(a.drawXPt, b.drawXPt);
      const iy =
        Math.min(a.drawTopPt + a.placedHeightPt, b.drawTopPt + b.placedHeightPt) -
        Math.max(a.drawTopPt, b.drawTopPt);
      if (ix > 0.75 && iy > 0.75) {
        overlapPairs.push([a.slotIndex, b.slotIndex]);
      }
    }
  }

  return {
    pageNumber: sourcePageNumber,
    originalPageWidthPt: origW,
    originalPageHeightPt: origH,
    sourceBox,
    boundaryMode: fitConfig.boundaryMode,
    scalingMode: effectiveScalingMode,
    outputSheetWidthPt: outW,
    outputSheetHeightPt: outH,
    columns: cols,
    rows,
    availableWidthPt: availW,
    availableHeightPt: availH,
    slots,
    hasOverlap: overlapPairs.length > 0,
    hasClipping,
    overlapPairs,
    isPassThroughOriginal1to1,
  };
}
