import { DuplexFlipEdge, PDFProject, PrintOptimizationConfig } from '../types/pdfStudio';
import { computeSheetLayout, normalizeFitConfig, SheetLayoutPlan } from './geometryEngine';

export interface LayoutCandidateEvaluation {
  id: string;
  label: string;
  columns: number;
  rows: number;
  copiesPerSheet: number;
  copyRotation: 0 | 90;
  scale: number;
  sheetUtilizationPct: number;
  paperWastePct: number;
  totalSheetsNeeded: number;
  minOriginalFontPt: number;
  minScaledFontPt: number;
  isReadabilityBlocked: boolean;
  hasClipping: boolean;
  hasOverlap: boolean;
  recommended: boolean;
  reason: string;
  score: number;
}

export interface DuplexSlotPlacement {
  slotIndex: number;
  frontRow: number;
  frontCol: number;
  backXPt: number;
  backTopPt: number;
  backWidthPt: number;
  backHeightPt: number;
  backRotationDeg: number;
}

export function getDefaultPrintOptimization(): PrintOptimizationConfig {
  return {
    minReadableFontPt: 6,
    duplexEnabled: false,
    duplexFlipEdge: 'long_edge',
    backSideOffsetXPt: 0,
    backSideOffsetYPt: 0,
  };
}

export function getMinTemplateFontPt(project: PDFProject): number {
  const textEls = project.elements.filter(
    (e) =>
      e.visible &&
      (e.type === 'text' ||
        e.type === 'heading' ||
        e.type === 'invoice_number' ||
        e.type === 'receipt_number' ||
        e.type === 'table' ||
        e.type === 'callout') &&
      e.fontSize > 0
  );
  if (textEls.length === 0) return 9;
  return Math.min(...textEls.map((e) => e.fontSize));
}

export function evaluateNupLayouts(
  project: PDFProject,
  options: {
    minReadableFontPt?: number;
    targetRecords?: number;
    includeRotatedCandidates?: boolean;
  } = {}
): {
  candidates: LayoutCandidateEvaluation[];
  recommended: LayoutCandidateEvaluation | null;
  minOriginalFontPt: number;
  minReadableFontPt: number;
} {
  const minReadableFontPt = Math.max(
    3,
    options.minReadableFontPt ?? project.printOptimization?.minReadableFontPt ?? 6
  );
  const minOriginalFontPt = getMinTemplateFontPt(project);
  const targetDocs = Math.max(
    1,
    options.targetRecords ??
      (project.dataRows.length > 0
        ? project.dataRows.length
        : project.bulkConfig.totalRecords || project.bulkConfig.totalOutputPages)
  );
  const fitConfig = normalizeFitConfig(project);

  const gridPairs: Array<{ cols: number; rows: number; label: string }> = [
    { cols: 1, rows: 1, label: '1-up (1×1)' },
    { cols: 2, rows: 1, label: '2-up (2×1)' },
    { cols: 1, rows: 2, label: '2-up (1×2)' },
    { cols: 3, rows: 1, label: '3-up (3×1)' },
    { cols: 1, rows: 3, label: '3-up (1×3)' },
    { cols: 2, rows: 2, label: '4-up (2×2)' },
    { cols: 2, rows: 3, label: '6-up (2×3)' },
    { cols: 3, rows: 2, label: '6-up (3×2)' },
    { cols: 2, rows: 4, label: '8-up (2×4)' },
    { cols: 4, rows: 2, label: '8-up (4×2)' },
    { cols: 3, rows: 3, label: '9-up (3×3)' },
    { cols: 3, rows: 4, label: '12-up (3×4)' },
    { cols: 4, rows: 3, label: '12-up (4×3)' },
  ];

  const rotations: Array<0 | 90> =
    options.includeRotatedCandidates === false ? [0] : [0, 90];

  const sheetArea = Math.max(
    1,
    project.pageConfig.widthPt * project.pageConfig.heightPt
  );
  const evaluations: LayoutCandidateEvaluation[] = [];

  for (const g of gridPairs) {
    for (const rot of rotations) {
      if (g.cols === 1 && g.rows === 1 && rot === 90) {
        // Still allow 1-up rotated when aspect ratio matches better
      }
      const probe: PDFProject = {
        ...project,
        fitConfig: {
          ...fitConfig,
          scalingMode:
            fitConfig.scalingMode === 'preserve_original' ||
            fitConfig.scalingMode === 'custom_percent'
              ? 'auto_fit_aspect'
              : fitConfig.scalingMode,
        },
        copiesConfig: {
          ...project.copiesConfig,
          enabled: g.cols * g.rows > 1,
          copiesPreset: 'custom',
          columns: g.cols,
          rows: g.rows,
          copyRotation: rot,
          fitToPage: true,
          slotOverrides: undefined,
        },
      };

      const plan = computeSheetLayout(probe, 1);
      const copiesPerSheet = g.cols * g.rows;
      const scale = plan.slots[0]?.scale ?? 1;
      const usedArea = plan.slots.reduce(
        (sum, s) => sum + s.placedWidthPt * s.placedHeightPt,
        0
      );
      const sheetUtilizationPct = Number(
        Math.min(100, (usedArea / sheetArea) * 100).toFixed(1)
      );
      const paperWastePct = Number(
        Math.max(0, 100 - sheetUtilizationPct).toFixed(1)
      );
      const totalSheetsNeeded = Math.ceil(targetDocs / copiesPerSheet);
      const minScaledFontPt = Number((minOriginalFontPt * scale).toFixed(2));
      const isReadabilityBlocked = minScaledFontPt < minReadableFontPt;

      // Score maximizes utilization & sheets saved while strongly penalizing readability/clipping failures
      let score = sheetUtilizationPct * 1.4 + Math.min(40, (1 - 1 / copiesPerSheet) * 28);
      if (rot === 0) score += 2; // Slight tie-breaker for upright orientation
      if (plan.hasClipping || plan.hasOverlap) score -= 500;
      if (isReadabilityBlocked) score -= 350;

      let reason = `${sheetUtilizationPct}% sheet coverage · ${totalSheetsNeeded} sheet(s)`;
      if (isReadabilityBlocked) {
        reason = `Blocked: smallest font scales to ${minScaledFontPt}pt (< ${minReadableFontPt}pt limit)`;
      } else if (plan.hasOverlap || plan.hasClipping) {
        reason = 'Blocked: margins/gutters leave insufficient cell bounds';
      }

      evaluations.push({
        id: `cand-${g.cols}x${g.rows}-r${rot}`,
        label: rot ? `${g.label} · 90°` : g.label,
        columns: g.cols,
        rows: g.rows,
        copiesPerSheet,
        copyRotation: rot,
        scale: Number(scale.toFixed(4)),
        sheetUtilizationPct,
        paperWastePct,
        totalSheetsNeeded,
        minOriginalFontPt: Number(minOriginalFontPt.toFixed(1)),
        minScaledFontPt,
        isReadabilityBlocked,
        hasClipping: plan.hasClipping,
        hasOverlap: plan.hasOverlap,
        recommended: false,
        reason,
        score: Number(score.toFixed(2)),
      });
    }
  }

  evaluations.sort((a, b) => b.score - a.score);
  const viable = evaluations.find(
    (c) => !c.isReadabilityBlocked && !c.hasClipping && !c.hasOverlap
  );
  if (viable) {
    viable.recommended = true;
    viable.reason = `Optimal readable yield (${viable.sheetUtilizationPct}% sheet use, min font ${viable.minScaledFontPt}pt)`;
  }

  return {
    candidates: evaluations,
    recommended: viable || evaluations[0] || null,
    minOriginalFontPt,
    minReadableFontPt,
  };
}

export function applyRecommendedLayoutToProject(
  project: PDFProject,
  candidate: LayoutCandidateEvaluation
): PDFProject {
  const fit = normalizeFitConfig(project);
  const copiesPerPage = Math.max(1, candidate.columns * candidate.rows);
  const targetDocs = Math.max(
    1,
    project.dataRows.length > 0
      ? project.dataRows.length
      : project.bulkConfig.totalRecords || project.bulkConfig.totalOutputPages
  );
  const totalOutputPages = Math.max(1, Math.ceil(targetDocs / copiesPerPage));

  const preset: PDFProject['copiesConfig']['copiesPreset'] =
    copiesPerPage === 1 ||
    copiesPerPage === 2 ||
    copiesPerPage === 3 ||
    copiesPerPage === 4 ||
    copiesPerPage === 6 ||
    copiesPerPage === 8 ||
    copiesPerPage === 9 ||
    copiesPerPage === 12
      ? (copiesPerPage as 1 | 2 | 3 | 4 | 6 | 8 | 9 | 12)
      : 'custom';

  return {
    ...project,
    fitConfig: {
      ...fit,
      scalingMode: 'auto_fit_aspect',
    },
    copiesConfig: {
      ...project.copiesConfig,
      enabled: copiesPerPage > 1,
      copiesPreset: preset,
      columns: candidate.columns,
      rows: candidate.rows,
      copyRotation: candidate.copyRotation,
      fitToPage: true,
      slotOverrides: undefined,
    },
    bulkConfig: {
      ...project.bulkConfig,
      enabled: copiesPerPage > 1 || totalOutputPages > 1,
      copiesPerPage,
      totalOutputPages,
      endPageNumber: project.bulkConfig.startPageNumber + totalOutputPages - 1,
      totalRecords: totalOutputPages * copiesPerPage,
    },
    updatedAt: new Date().toISOString(),
  };
}

export function computeDuplexBackSlotOffsets(
  layout: SheetLayoutPlan,
  flipEdge: DuplexFlipEdge,
  backOffsetXPt = 0,
  backOffsetYPt = 0
): DuplexSlotPlacement[] {
  const sheetW = layout.outputSheetWidthPt;
  const sheetH = layout.outputSheetHeightPt;

  return layout.slots.map((slot) => {
    if (flipEdge === 'long_edge') {
      // Long-edge binding flips horizontally across vertical centerline
      const mirroredX = sheetW - (slot.drawXPt + slot.placedWidthPt) + backOffsetXPt;
      const mirroredTop = slot.drawTopPt + backOffsetYPt;
      return {
        slotIndex: slot.slotIndex,
        frontRow: slot.row,
        frontCol: slot.col,
        backXPt: Number(mirroredX.toFixed(2)),
        backTopPt: Number(mirroredTop.toFixed(2)),
        backWidthPt: slot.placedWidthPt,
        backHeightPt: slot.placedHeightPt,
        backRotationDeg: slot.rotation,
      };
    }

    // Short-edge binding flips vertically across horizontal centerline + 180 deg turn
    const mirroredX = slot.drawXPt + backOffsetXPt;
    const mirroredTop = sheetH - (slot.drawTopPt + slot.placedHeightPt) + backOffsetYPt;
    return {
      slotIndex: slot.slotIndex,
      frontRow: slot.row,
      frontCol: slot.col,
      backXPt: Number(mirroredX.toFixed(2)),
      backTopPt: Number(mirroredTop.toFixed(2)),
      backWidthPt: slot.placedWidthPt,
      backHeightPt: slot.placedHeightPt,
      backRotationDeg: (slot.rotation + 180) % 360,
    };
  });
}
