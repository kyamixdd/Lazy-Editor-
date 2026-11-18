import {
  BlueprintBlock,
  PDFProject,
  ProductionBlueprint,
  RectPt,
} from '../types/pdfStudio';
import { computeSheetLayout, normalizeFitConfig, resolveSourceBox } from './geometryEngine';
import { PAGE_PRESETS_PT } from './units';

export interface BlueprintBlockAnalysis {
  blockId: string;
  outOfSheetBounds: boolean;
  outOfMarginBounds: boolean;
  overlapsWithIds: string[];
  sourceBox: RectPt;
  effectiveScale: number;
}

export interface BlueprintAnalysis {
  utilizationPercent: number;
  overlapPairs: Array<[string, string]>;
  outOfBoundsBlockIds: string[];
  marginWarningBlockIds: string[];
  perBlock: Record<string, BlueprintBlockAnalysis>;
  hasBlockingIssues: boolean;
}

export function snapBlueprintValue(
  valuePt: number,
  gridSizePt: number,
  enabled: boolean
): number {
  const safeGrid = Math.max(1, gridSizePt || 10);
  if (!enabled) return Number(valuePt.toFixed(2));
  return Number((Math.round(valuePt / safeGrid) * safeGrid).toFixed(2));
}

export function createDefaultBlueprint(
  project?: PDFProject | null,
  name = 'Production Sheet Blueprint'
): ProductionBlueprint {
  const now = new Date().toISOString();
  const baseW = project?.pageConfig.widthPt || PAGE_PRESETS_PT.A4.widthPt;
  const baseH = project?.pageConfig.heightPt || PAGE_PRESETS_PT.A4.heightPt;
  const unit = project?.pageConfig.unit || 'mm';
  const margin = 24;
  const gutter = 12;

  const usableW = Math.max(120, baseW - margin * 2 - gutter);
  const blockW = Number((usableW / 2).toFixed(1));
  const blockH = Number(Math.max(120, (baseH - margin * 2 - gutter) / 2).toFixed(1));

  const ruleA = project?.serialRules[0]?.id;
  const ruleB = project?.serialRules[1]?.id || ruleA;

  return {
    id: `bp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    description: project
      ? `Visual production blueprint linked to ${project.name}`
      : 'Custom multi-block production sheet layout',
    createdAt: now,
    updatedAt: now,
    sheetWidthPt: baseW,
    sheetHeightPt: baseH,
    unit,
    orientation: baseW > baseH ? 'landscape' : 'portrait',
    sizePreset: project?.pageConfig.sizePreset || 'A4',
    marginTopPt: margin,
    marginRightPt: margin,
    marginBottomPt: margin,
    marginLeftPt: margin,
    gutterXPt: gutter,
    gutterYPt: gutter,
    snapToGrid: true,
    gridSizePt: 8,
    bleedPt: project?.pageConfig.bleedPt || 0,
    cropMarks: project?.copiesConfig.cropMarks ?? true,
    cuttingGuides: project?.copiesConfig.cuttingGuides ?? true,
    backgroundColor: project?.pageConfig.backgroundColor || '#FFFFFF',
    sourceProjectId: project?.id,
    sourcePdfName: project?.sourcePdfName,
    tags: ['production'],
    blocks: [
      {
        id: `blk-${Date.now()}-1`,
        label: 'Block A',
        blockIndex: 0,
        xPt: margin,
        yPt: margin,
        widthPt: blockW,
        heightPt: blockH,
        rotation: 0,
        locked: false,
        visible: true,
        sourcePageNumber: 1,
        sourceScope: 'full_page',
        scalingMode: 'auto_fit_aspect',
        serialRuleId: ruleA,
        dataSource: { mode: 'sequential', rowOffset: 0 },
        showBorder: true,
        cropMarks: true,
      },
      {
        id: `blk-${Date.now()}-2`,
        label: 'Block B',
        blockIndex: 1,
        xPt: Number((margin + blockW + gutter).toFixed(1)),
        yPt: margin,
        widthPt: blockW,
        heightPt: blockH,
        rotation: 0,
        locked: false,
        visible: true,
        sourcePageNumber: 1,
        sourceScope: 'full_page',
        scalingMode: 'auto_fit_aspect',
        serialRuleId: ruleB,
        dataSource: { mode: 'sequential', rowOffset: 0 },
        showBorder: true,
        cropMarks: true,
      },
    ],
  };
}

export function createBlueprintFromProjectImposition(
  project: PDFProject,
  name?: string
): ProductionBlueprint {
  const now = new Date().toISOString();
  const layout = computeSheetLayout(project, 1);
  const { pageConfig, copiesConfig } = project;
  const blocks: BlueprintBlock[] = layout.slots.map((slot, idx) => {
    const matchingRule =
      project.serialRules.find((r) => r.blockIndex === idx) ||
      project.serialRules[0];
    return {
      id: `blk-${Date.now()}-${idx + 1}`,
      label: `Block ${String.fromCharCode(65 + (idx % 26))}`,
      blockIndex: idx,
      xPt: Number(slot.drawXPt.toFixed(2)),
      yPt: Number(slot.drawTopPt.toFixed(2)),
      widthPt: Number(slot.placedWidthPt.toFixed(2)),
      heightPt: Number(slot.placedHeightPt.toFixed(2)),
      rotation: slot.rotation,
      locked: false,
      visible: true,
      sourcePageNumber: 1,
      sourceScope: copiesConfig.sourceScope,
      selectedSourceBlockId: copiesConfig.selectedBlockId,
      scalingMode: layout.scalingMode,
      serialRuleId: matchingRule?.id,
      dataSource: {
        mode: 'sequential',
        rowOffset: 0,
      },
      showBorder: copiesConfig.showBorders,
      cropMarks: copiesConfig.cropMarks,
    };
  });

  return {
    id: `bp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: name || `${project.name} Blueprint`,
    description: `Imported ${layout.columns}×${layout.rows} imposition layout from ${project.name}`,
    createdAt: now,
    updatedAt: now,
    sheetWidthPt: layout.outputSheetWidthPt,
    sheetHeightPt: layout.outputSheetHeightPt,
    unit: pageConfig.unit,
    orientation:
      layout.outputSheetWidthPt > layout.outputSheetHeightPt
        ? 'landscape'
        : 'portrait',
    sizePreset: pageConfig.sizePreset,
    marginTopPt: copiesConfig.enabled
      ? copiesConfig.outerMarginTopPt
      : pageConfig.marginTopPt,
    marginRightPt: copiesConfig.enabled
      ? copiesConfig.outerMarginRightPt
      : pageConfig.marginRightPt,
    marginBottomPt: copiesConfig.enabled
      ? copiesConfig.outerMarginBottomPt
      : pageConfig.marginBottomPt,
    marginLeftPt: copiesConfig.enabled
      ? copiesConfig.outerMarginLeftPt
      : pageConfig.marginLeftPt,
    gutterXPt: copiesConfig.enabled ? copiesConfig.horizontalSpacingPt : 12,
    gutterYPt: copiesConfig.enabled ? copiesConfig.verticalSpacingPt : 12,
    snapToGrid: true,
    gridSizePt: 8,
    bleedPt: pageConfig.bleedPt || 0,
    cropMarks: copiesConfig.cropMarks,
    cuttingGuides: copiesConfig.cuttingGuides,
    backgroundColor: pageConfig.backgroundColor || '#FFFFFF',
    blocks,
    sourceProjectId: project.id,
    sourcePdfName: project.sourcePdfName,
    tags: ['imported-grid'],
  };
}

export function resolveBlockSourceBox(
  block: BlueprintBlock,
  project?: PDFProject | null
): RectPt {
  if (!project) {
    return { x: 0, y: 0, width: Math.max(40, block.widthPt), height: Math.max(40, block.heightPt) };
  }
  const pageNum = Math.max(1, Math.min(block.sourcePageNumber || 1, project.pageCount || 1));
  const pageMeta =
    project.originalPages.find((p) => p.pageNumber === pageNum) ||
    project.originalPages[0];
  const fitConfig = normalizeFitConfig(project);

  return resolveSourceBox(
    pageMeta,
    project.elements,
    fitConfig,
    {
      ...project.copiesConfig,
      enabled: true,
      sourceScope: block.sourceScope,
      selectedBlockId: block.selectedSourceBlockId,
    },
    pageNum,
    pageMeta?.widthPt || project.pageConfig.widthPt,
    pageMeta?.heightPt || project.pageConfig.heightPt
  );
}

export function computeBlueprintAnalysis(
  blueprint: ProductionBlueprint,
  project?: PDFProject | null
): BlueprintAnalysis {
  const visibleBlocks = blueprint.blocks.filter((b) => b.visible);
  const sheetArea = Math.max(1, blueprint.sheetWidthPt * blueprint.sheetHeightPt);
  let coveredArea = 0;

  const perBlock: Record<string, BlueprintBlockAnalysis> = {};
  const overlapPairs: Array<[string, string]> = [];
  const outOfBoundsBlockIds: string[] = [];
  const marginWarningBlockIds: string[] = [];

  for (const b of visibleBlocks) {
    coveredArea += Math.max(0, b.widthPt * b.heightPt);
    const outOfSheet =
      b.xPt < -0.5 ||
      b.yPt < -0.5 ||
      b.xPt + b.widthPt > blueprint.sheetWidthPt + 0.5 ||
      b.yPt + b.heightPt > blueprint.sheetHeightPt + 0.5;

    const outOfMargin =
      !outOfSheet &&
      (b.xPt < blueprint.marginLeftPt - 0.5 ||
        b.yPt < blueprint.marginTopPt - 0.5 ||
        b.xPt + b.widthPt > blueprint.sheetWidthPt - blueprint.marginRightPt + 0.5 ||
        b.yPt + b.heightPt > blueprint.sheetHeightPt - blueprint.marginBottomPt + 0.5);

    if (outOfSheet) outOfBoundsBlockIds.push(b.id);
    if (outOfMargin) marginWarningBlockIds.push(b.id);

    const srcBox = resolveBlockSourceBox(b, project);
    const normRot = ((b.rotation % 360) + 360) % 360;
    const isQuarter = normRot === 90 || normRot === 270;
    const effW = isQuarter ? srcBox.height : srcBox.width;
    const effH = isQuarter ? srcBox.width : srcBox.height;
    const scale =
      b.scalingMode === 'preserve_original'
        ? 1
        : b.scalingMode === 'fit_to_width'
        ? b.widthPt / Math.max(1, effW)
        : b.scalingMode === 'fit_to_height'
        ? b.heightPt / Math.max(1, effH)
        : b.scalingMode === 'fill_cell'
        ? Math.max(b.widthPt / Math.max(1, effW), b.heightPt / Math.max(1, effH))
        : Math.min(b.widthPt / Math.max(1, effW), b.heightPt / Math.max(1, effH));

    perBlock[b.id] = {
      blockId: b.id,
      outOfSheetBounds: outOfSheet,
      outOfMarginBounds: outOfMargin,
      overlapsWithIds: [],
      sourceBox: srcBox,
      effectiveScale: Number(scale.toFixed(4)),
    };
  }

  for (let i = 0; i < visibleBlocks.length; i++) {
    for (let j = i + 1; j < visibleBlocks.length; j++) {
      const a = visibleBlocks[i];
      const b = visibleBlocks[j];
      const ix = Math.min(a.xPt + a.widthPt, b.xPt + b.widthPt) - Math.max(a.xPt, b.xPt);
      const iy = Math.min(a.yPt + a.heightPt, b.yPt + b.heightPt) - Math.max(a.yPt, b.yPt);
      if (ix > 0.75 && iy > 0.75) {
        overlapPairs.push([a.id, b.id]);
        perBlock[a.id].overlapsWithIds.push(b.id);
        perBlock[b.id].overlapsWithIds.push(a.id);
      }
    }
  }

  const utilizationPercent = Number(
    Math.min(100, (coveredArea / sheetArea) * 100).toFixed(1)
  );

  return {
    utilizationPercent,
    overlapPairs,
    outOfBoundsBlockIds,
    marginWarningBlockIds,
    perBlock,
    hasBlockingIssues: overlapPairs.length > 0 || outOfBoundsBlockIds.length > 0,
  };
}

export function autoPackBlueprintBlocks(
  blueprint: ProductionBlueprint
): ProductionBlueprint {
  const unlocked = blueprint.blocks.filter((b) => b.visible && !b.locked);
  if (unlocked.length === 0) return blueprint;

  const availW = Math.max(
    40,
    blueprint.sheetWidthPt - blueprint.marginLeftPt - blueprint.marginRightPt
  );
  const availH = Math.max(
    40,
    blueprint.sheetHeightPt - blueprint.marginTopPt - blueprint.marginBottomPt
  );
  const cols = Math.max(1, Math.ceil(Math.sqrt(unlocked.length)));
  const rows = Math.max(1, Math.ceil(unlocked.length / cols));

  const cellW = Math.max(
    24,
    (availW - blueprint.gutterXPt * Math.max(0, cols - 1)) / cols
  );
  const cellH = Math.max(
    24,
    (availH - blueprint.gutterYPt * Math.max(0, rows - 1)) / rows
  );

  let uIdx = 0;
  const nextBlocks = blueprint.blocks.map((blk) => {
    if (!blk.visible || blk.locked) return blk;
    const r = Math.floor(uIdx / cols);
    const c = uIdx % cols;
    uIdx++;
    return {
      ...blk,
      xPt: Number((blueprint.marginLeftPt + c * (cellW + blueprint.gutterXPt)).toFixed(2)),
      yPt: Number((blueprint.marginTopPt + r * (cellH + blueprint.gutterYPt)).toFixed(2)),
      widthPt: Number(cellW.toFixed(2)),
      heightPt: Number(cellH.toFixed(2)),
    };
  });

  return {
    ...blueprint,
    blocks: nextBlocks,
    updatedAt: new Date().toISOString(),
  };
}

export function applyBlueprintToProject(
  project: PDFProject,
  blueprint: ProductionBlueprint
): PDFProject {
  const visibleCount = Math.max(1, blueprint.blocks.filter((b) => b.visible).length);
  const pages = Math.max(1, project.bulkConfig.totalOutputPages);
  return {
    ...project,
    activeBlueprint: structuredClone(blueprint),
    useBlueprintLayout: true,
    pageConfig: {
      ...project.pageConfig,
      sizePreset: blueprint.sizePreset,
      orientation: blueprint.orientation,
      widthPt: blueprint.sheetWidthPt,
      heightPt: blueprint.sheetHeightPt,
      unit: blueprint.unit,
      marginTopPt: blueprint.marginTopPt,
      marginRightPt: blueprint.marginRightPt,
      marginBottomPt: blueprint.marginBottomPt,
      marginLeftPt: blueprint.marginLeftPt,
      bleedPt: blueprint.bleedPt,
      cropMarks: blueprint.cropMarks,
      backgroundColor: blueprint.backgroundColor,
    },
    bulkConfig: {
      ...project.bulkConfig,
      enabled: true,
      copiesPerPage: visibleCount,
      documentBlocksCount: visibleCount,
      totalRecords: pages * visibleCount,
    },
    updatedAt: new Date().toISOString(),
  };
}
