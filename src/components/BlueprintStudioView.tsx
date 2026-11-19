import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  Grid,
  Layers,
  Lock,
  Plus,
  RotateCw,
  Save,
  Sparkles,
  Trash2,
  Unlock,
} from 'lucide-react';
import {
  BlueprintBlock,
  MeasurementUnit,
  PageSizePreset,
  PDFProject,
  ProductionBlueprint,
  ScalingMode,
} from '../types/pdfStudio';
import { useViewport } from '../hooks/useViewport';
import {
  applyBlueprintToProject,
  autoPackBlueprintBlocks,
  computeBlueprintAnalysis,
  createBlueprintFromProjectImposition,
  createDefaultBlueprint,
  snapBlueprintValue,
} from '../utils/blueprintEngine';
import { generateExportBytes } from '../utils/pdfExporter';
import { computeSerialValueForSlot } from '../utils/serialEngine';
import { PAGE_PRESETS_PT, ptToUnit, unitToPt } from '../utils/units';
import { triggerBytesDownload } from '../utils/downloadHelper';
import { GlassButton, GlassCard } from './glass';
import { NumericDraftInput } from './NumericDraftInput';

interface BlueprintStudioViewProps {
  project: PDFProject | null;
  blueprints: ProductionBlueprint[];
  initialBlueprintId?: string | null;
  onSaveBlueprint: (bp: ProductionBlueprint) => void;
  onDeleteBlueprint: (id: string) => void;
  onUpdateProject: (updated: PDFProject) => void;
  onGoToExport: () => void;
}

type DragState =
  | {
      kind: 'move';
      blockId: string;
      startClientX: number;
      startClientY: number;
      origXPt: number;
      origYPt: number;
    }
  | {
      kind: 'resize';
      blockId: string;
      startClientX: number;
      startClientY: number;
      origWPt: number;
      origHPt: number;
    };

export const BlueprintStudioView: React.FC<BlueprintStudioViewProps> = ({
  project,
  blueprints,
  initialBlueprintId,
  onSaveBlueprint,
  onDeleteBlueprint,
  onUpdateProject,
  onGoToExport,
}) => {
  const viewport = useViewport();
  const [draftBlueprint, setDraftBlueprint] = useState<ProductionBlueprint>(() => {
    if (project?.activeBlueprint) return structuredClone(project.activeBlueprint);
    if (blueprints[0]) return structuredClone(blueprints[0]);
    return createDefaultBlueprint(project);
  });
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(
    () => draftBlueprint.blocks[0]?.id || null
  );
  const [inspectorTab, setInspectorTab] = useState<'block' | 'sheet'>('block');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    const nextBp = project?.activeBlueprint
      ? structuredClone(project.activeBlueprint)
      : blueprints[0]
      ? structuredClone(blueprints[0])
      : createDefaultBlueprint(project);
    setDraftBlueprint(nextBp);
    setSelectedBlockId(nextBp.blocks[0]?.id || null);
    setStatusMessage(null);
  }, [project?.id]);

  useEffect(() => {
    if (!initialBlueprintId) return;
    const selected = blueprints.find((bp) => bp.id === initialBlueprintId);
    if (!selected) return;
    const next = structuredClone(selected);
    setDraftBlueprint(next);
    setSelectedBlockId(next.blocks[0]?.id || null);
    setStatusMessage(`Opened blueprint: ${selected.name}`);
  }, [initialBlueprintId, blueprints]);

  useEffect(() => {
    const clearDrag = () => {
      dragRef.current = null;
    };
    window.addEventListener('pointerup', clearDrag);
    window.addEventListener('blur', clearDrag);
    return () => {
      window.removeEventListener('pointerup', clearDrag);
      window.removeEventListener('blur', clearDrag);
    };
  }, []);

  const unit = draftBlueprint.unit;
  const selectedBlock =
    draftBlueprint.blocks.find((b) => b.id === selectedBlockId) || null;

  const analysis = useMemo(
    () => computeBlueprintAnalysis(draftBlueprint, project),
    [draftBlueprint, project]
  );

  const canvasScale = useMemo(() => {
    const maxW = viewport.isMobile
      ? Math.max(260, viewport.width - 40)
      : viewport.isTablet
      ? Math.max(360, viewport.width - 420)
      : 540;
    const maxH = viewport.isMobile ? 420 : 620;
    return Math.min(
      maxW / Math.max(1, draftBlueprint.sheetWidthPt),
      maxH / Math.max(1, draftBlueprint.sheetHeightPt)
    );
  }, [
    viewport.isMobile,
    viewport.isTablet,
    viewport.width,
    draftBlueprint.sheetWidthPt,
    draftBlueprint.sheetHeightPt,
  ]);

  const mutateBlueprint = (updater: (bp: ProductionBlueprint) => ProductionBlueprint) => {
    setDraftBlueprint((prev) => ({
      ...updater(prev),
      updatedAt: new Date().toISOString(),
    }));
  };

  const updateBlock = (blockId: string, patch: Partial<BlueprintBlock>) => {
    mutateBlueprint((bp) => ({
      ...bp,
      blocks: bp.blocks.map((b) => (b.id === blockId ? { ...b, ...patch } : b)),
    }));
  };

  const handleAddBlock = () => {
    const idx = draftBlueprint.blocks.length;
    const label = `Block ${String.fromCharCode(65 + (idx % 26))}`;
    const newBlock: BlueprintBlock = {
      id: `blk-${Date.now()}-${idx + 1}`,
      label,
      blockIndex: idx,
      xPt: draftBlueprint.marginLeftPt + (idx % 3) * 18,
      yPt: draftBlueprint.marginTopPt + (idx % 3) * 18,
      widthPt: Math.min(220, Math.max(90, draftBlueprint.sheetWidthPt * 0.36)),
      heightPt: Math.min(260, Math.max(90, draftBlueprint.sheetHeightPt * 0.36)),
      rotation: 0,
      locked: false,
      visible: true,
      sourcePageNumber: 1,
      sourceScope: 'full_page',
      scalingMode: 'auto_fit_aspect',
      serialRuleId: project?.serialRules[idx]?.id || project?.serialRules[0]?.id,
      dataSource: { mode: 'sequential', rowOffset: 0 },
      showBorder: true,
      cropMarks: draftBlueprint.cropMarks,
    };
    mutateBlueprint((bp) => ({
      ...bp,
      blocks: [...bp.blocks, newBlock],
    }));
    setSelectedBlockId(newBlock.id);
    setInspectorTab('block');
  };

  const handleDuplicateBlock = (blk: BlueprintBlock) => {
    const idx = draftBlueprint.blocks.length;
    const dup: BlueprintBlock = {
      ...structuredClone(blk),
      id: `blk-${Date.now()}-${idx + 1}`,
      label: `${blk.label} Copy`,
      blockIndex: idx,
      locked: false,
      xPt: Math.min(
        draftBlueprint.sheetWidthPt - blk.widthPt,
        blk.xPt + blk.widthPt + draftBlueprint.gutterXPt
      ),
      yPt: blk.yPt,
    };
    mutateBlueprint((bp) => ({
      ...bp,
      blocks: [...bp.blocks, dup],
    }));
    setSelectedBlockId(dup.id);
  };

  const handleDeleteBlock = (blockId: string) => {
    mutateBlueprint((bp) => {
      const remaining = bp.blocks
        .filter((b) => b.id !== blockId)
        .map((b, i) => ({ ...b, blockIndex: i }));
      return { ...bp, blocks: remaining };
    });
    if (selectedBlockId === blockId) {
      setSelectedBlockId(
        draftBlueprint.blocks.find((b) => b.id !== blockId)?.id || null
      );
    }
  };

  const handleSaveCurrentBlueprint = () => {
    const saved = {
      ...draftBlueprint,
      updatedAt: new Date().toISOString(),
    };
    onSaveBlueprint(saved);
    setDraftBlueprint(saved);
    setStatusMessage(`Saved blueprint "${saved.name}"`);
  };

  const handleNewBlueprint = () => {
    const fresh = createDefaultBlueprint(
      project,
      `Blueprint ${blueprints.length + 1}`
    );
    setDraftBlueprint(fresh);
    setSelectedBlockId(fresh.blocks[0]?.id || null);
    setStatusMessage('Created new blank production blueprint');
  };

  const handleImportFromProject = () => {
    if (!project) return;
    const imported = createBlueprintFromProjectImposition(
      project,
      `${project.name} Grid Blueprint`
    );
    setDraftBlueprint(imported);
    setSelectedBlockId(imported.blocks[0]?.id || null);
    setStatusMessage(`Imported ${imported.blocks.length} slots from ${project.name}`);
  };

  const handleApplyToProject = (goToExport = false) => {
    if (!project) return;
    onSaveBlueprint(draftBlueprint);
    const updated = applyBlueprintToProject(project, draftBlueprint);
    onUpdateProject(updated);
    setStatusMessage('Applied blueprint layout to active project');
    if (goToExport) {
      onGoToExport();
    }
  };

  const handleQuickExportBlueprint = async () => {
    if (!project) return;
    setIsExporting(true);
    setStatusMessage(null);
    try {
      const bpProject = applyBlueprintToProject(project, draftBlueprint);
      onSaveBlueprint(draftBlueprint);
      onUpdateProject(bpProject);
      const res = await generateExportBytes(bpProject);
      triggerBytesDownload(
        res.data,
        `${draftBlueprint.name.replace(/\s+/g, '_')}_production.pdf`,
        res.mimeType
      );
      setStatusMessage(`Exported ${res.fileName} (${bpProject.bulkConfig.totalOutputPages} page(s))`);
    } catch (err) {
      setStatusMessage(
        err instanceof Error ? err.message : 'Failed to export blueprint PDF'
      );
    } finally {
      setIsExporting(false);
    }
  };

  const handlePointerDownBlock = (
    e: React.PointerEvent,
    blk: BlueprintBlock,
    kind: 'move' | 'resize'
  ) => {
    e.stopPropagation();
    setSelectedBlockId(blk.id);
    setInspectorTab('block');
    if (blk.locked) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current =
      kind === 'move'
        ? {
            kind: 'move',
            blockId: blk.id,
            startClientX: e.clientX,
            startClientY: e.clientY,
            origXPt: blk.xPt,
            origYPt: blk.yPt,
          }
        : {
            kind: 'resize',
            blockId: blk.id,
            startClientX: e.clientX,
            startClientY: e.clientY,
            origWPt: blk.widthPt,
            origHPt: blk.heightPt,
          };
  };

  const handlePointerMoveSheet = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dxPt = (e.clientX - drag.startClientX) / canvasScale;
    const dyPt = (e.clientY - drag.startClientY) / canvasScale;

    if (drag.kind === 'move') {
      const nx = snapBlueprintValue(
        drag.origXPt + dxPt,
        draftBlueprint.gridSizePt,
        draftBlueprint.snapToGrid
      );
      const ny = snapBlueprintValue(
        drag.origYPt + dyPt,
        draftBlueprint.gridSizePt,
        draftBlueprint.snapToGrid
      );
      updateBlock(drag.blockId, {
        xPt: Math.max(0, nx),
        yPt: Math.max(0, ny),
      });
    } else {
      const nw = snapBlueprintValue(
        Math.max(24, drag.origWPt + dxPt),
        draftBlueprint.gridSizePt,
        draftBlueprint.snapToGrid
      );
      const nh = snapBlueprintValue(
        Math.max(24, drag.origHPt + dyPt),
        draftBlueprint.gridSizePt,
        draftBlueprint.snapToGrid
      );
      updateBlock(drag.blockId, { widthPt: nw, heightPt: nh });
    }
  };

  const handlePointerUpSheet = () => {
    dragRef.current = null;
  };

  const thumbUrl = project?.originalPages[0]?.previewImageDataUrl;

  return (
    <div className="flex-1 flex flex-col desktop:h-screen desktop:overflow-hidden">
      {/* Top Bar */}
      <div className="px-4 tablet:px-6 py-3 border-b border-black/10 dark:border-white/12 glass-level-2 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex flex-wrap items-center gap-2.5 min-w-0">
          <h1 className="text-base tablet:text-lg font-display font-semibold text-[#101010] dark:text-white whitespace-nowrap">
            Production Blueprint Studio
          </h1>
          <select
            aria-label="Select saved blueprint"
            value={
              blueprints.some((b) => b.id === draftBlueprint.id)
                ? draftBlueprint.id
                : '__draft__'
            }
            onChange={(e) => {
              const found = blueprints.find((b) => b.id === e.target.value);
              if (found) {
                setDraftBlueprint(structuredClone(found));
                setSelectedBlockId(found.blocks[0]?.id || null);
              }
            }}
            className="px-2.5 py-1.5 rounded-xl studio-select text-xs max-w-[210px]"
          >
            {!blueprints.some((b) => b.id === draftBlueprint.id) && (
              <option value="__draft__">{draftBlueprint.name} (Unsaved)</option>
            )}
            {blueprints.map((bp) => (
              <option key={bp.id} value={bp.id}>
                {bp.name} ({bp.blocks.length} blk)
              </option>
            ))}
          </select>
          <input
            type="text"
            aria-label="Blueprint name"
            value={draftBlueprint.name}
            onChange={(e) =>
              mutateBlueprint((bp) => ({ ...bp, name: e.target.value }))
            }
            className="px-2.5 py-1.5 rounded-xl studio-input text-xs w-44"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <GlassButton variant="glass" size="sm" onClick={handleNewBlueprint}>
            <Plus className="w-3.5 h-3.5" />
            New
          </GlassButton>
          {project && (
            <GlassButton variant="glass" size="sm" onClick={handleImportFromProject}>
              <Layers className="w-3.5 h-3.5" />
              Import Grid
            </GlassButton>
          )}
          <GlassButton
            variant="glass"
            size="sm"
            onClick={() => mutateBlueprint(autoPackBlueprintBlocks)}
          >
            <Sparkles className="w-3.5 h-3.5" />
            Auto-Arrange
          </GlassButton>
          <GlassButton variant="glass" size="sm" onClick={handleSaveCurrentBlueprint}>
            <Save className="w-3.5 h-3.5" />
            Save
          </GlassButton>
          {blueprints.some((b) => b.id === draftBlueprint.id) && (
            <GlassButton
              variant="glass"
              size="sm"
              onClick={() => {
                onDeleteBlueprint(draftBlueprint.id);
                handleNewBlueprint();
              }}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </GlassButton>
          )}
          {project && (
            <>
              <GlassButton
                variant="glass"
                size="sm"
                onClick={() => handleApplyToProject(false)}
              >
                Apply to Project
              </GlassButton>
              <GlassButton
                variant="primary"
                size="sm"
                disabled={isExporting}
                onClick={() => void handleQuickExportBlueprint()}
              >
                <Download className="w-3.5 h-3.5" />
                {isExporting ? 'Exporting...' : 'Export Blueprint PDF'}
              </GlassButton>
            </>
          )}
        </div>
      </div>

      {/* Main Split Area */}
      <div className="flex-1 flex flex-col desktop:flex-row min-h-0 desktop:overflow-hidden">
        {/* Left/Center Visual Production Canvas */}
        <div
          className="flex-1 overflow-auto bg-[#EFEFEF] dark:bg-[#0B0B0B] p-4 tablet:p-6 flex flex-col items-center justify-start gap-4"
          onPointerMove={handlePointerMoveSheet}
          onPointerUp={handlePointerUpSheet}
          onPointerCancel={handlePointerUpSheet}
        >
          {/* Sheet Metrics & Quick Actions */}
          <div className="w-full max-w-3xl flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-3 text-[#555555] dark:text-[#B5B5B5] tabular-nums">
              <span className="font-semibold text-[#101010] dark:text-white">
                {draftBlueprint.sizePreset} · {ptToUnit(draftBlueprint.sheetWidthPt, unit)} ×{' '}
                {ptToUnit(draftBlueprint.sheetHeightPt, unit)} {unit}
              </span>
              <span>·</span>
              <span>{draftBlueprint.blocks.filter((b) => b.visible).length} blocks</span>
              <span>·</span>
              <span>Sheet Usage: {analysis.utilizationPercent}%</span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  mutateBlueprint((bp) => ({ ...bp, snapToGrid: !bp.snapToGrid }))
                }
                className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium flex items-center gap-1 transition-colors ${
                  draftBlueprint.snapToGrid
                    ? 'studio-active-surface'
                    : 'border-black/15 dark:border-white/15 text-[#555555] dark:text-[#B5B5B5]'
                }`}
              >
                <Grid className="w-3 h-3" />
                Snap Grid ({ptToUnit(draftBlueprint.gridSizePt, unit)} {unit})
              </button>
              <GlassButton variant="primary" size="sm" onClick={handleAddBlock}>
                <Plus className="w-3.5 h-3.5" />
                Add Block
              </GlassButton>
            </div>
          </div>

          {(statusMessage || analysis.hasBlockingIssues) && (
            <div className="w-full max-w-3xl flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl border border-black/10 dark:border-white/12 glass-level-2 text-xs">
              {analysis.hasBlockingIssues ? (
                <span className="text-red-600 dark:text-red-400 font-medium flex items-center gap-1.5 tabular-nums">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {analysis.overlapPairs.length > 0 &&
                    `${analysis.overlapPairs.length} block overlap(s)`}
                  {analysis.overlapPairs.length > 0 &&
                    analysis.outOfBoundsBlockIds.length > 0 &&
                    ' · '}
                  {analysis.outOfBoundsBlockIds.length > 0 &&
                    `${analysis.outOfBoundsBlockIds.length} block(s) outside sheet`}
                </span>
              ) : (
                <span className="text-[#101010] dark:text-white font-medium flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  {statusMessage || 'All production blocks aligned inside sheet bounds'}
                </span>
              )}
              {project?.useBlueprintLayout && (
                <span className="text-[11px] font-mono text-[#555555] dark:text-[#B5B5B5]">
                  Active Export Mode: Blueprint
                </span>
              )}
            </div>
          )}

          {/* Interactive Sheet Surface */}
          <div
            onClick={() => setSelectedBlockId(null)}
            style={{
              width: draftBlueprint.sheetWidthPt * canvasScale,
              height: draftBlueprint.sheetHeightPt * canvasScale,
              backgroundColor: draftBlueprint.backgroundColor || '#FFFFFF',
            }}
            className="relative shadow-2xl border border-black/25 dark:border-white/20 select-none overflow-hidden shrink-0"
          >
            {/* Grid Overlay */}
            {draftBlueprint.snapToGrid && draftBlueprint.gridSizePt * canvasScale >= 6 && (
              <div
                className="pointer-events-none absolute inset-0 opacity-20"
                style={{
                  backgroundImage:
                    'linear-gradient(to right, rgba(0,0,0,0.22) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,0.22) 1px, transparent 1px)',
                  backgroundSize: `${draftBlueprint.gridSizePt * canvasScale}px ${
                    draftBlueprint.gridSizePt * canvasScale
                  }px`,
                }}
              />
            )}

            {/* Printable Margin Boundary Guide */}
            <div
              style={{
                left: draftBlueprint.marginLeftPt * canvasScale,
                top: draftBlueprint.marginTopPt * canvasScale,
                width: Math.max(
                  0,
                  (draftBlueprint.sheetWidthPt -
                    draftBlueprint.marginLeftPt -
                    draftBlueprint.marginRightPt) *
                    canvasScale
                ),
                height: Math.max(
                  0,
                  (draftBlueprint.sheetHeightPt -
                    draftBlueprint.marginTopPt -
                    draftBlueprint.marginBottomPt) *
                    canvasScale
                ),
              }}
              className="pointer-events-none absolute border border-dashed border-black/25"
            />

            {/* Blocks */}
            {draftBlueprint.blocks
              .filter((b) => b.visible)
              .map((blk) => {
                const isSelected = blk.id === selectedBlockId;
                const blkInfo = analysis.perBlock[blk.id];
                const hasError =
                  blkInfo?.outOfSheetBounds || (blkInfo?.overlapsWithIds.length || 0) > 0;
                const linkedRule =
                  project?.serialRules.find((r) => r.id === blk.serialRuleId) ||
                  project?.serialRules.find((r) => r.blockIndex === blk.blockIndex);
                const serialSample =
                  linkedRule && project
                    ? computeSerialValueForSlot(
                        linkedRule,
                        0,
                        blk.blockIndex,
                        Math.max(1, draftBlueprint.blocks.length),
                        project.dataRows,
                        project.serialRules.length,
                        linkedRule.blockIndex
                      ).value
                    : null;

                return (
                  <div
                    key={blk.id}
                    onPointerDown={(e) => handlePointerDownBlock(e, blk, 'move')}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedBlockId(blk.id);
                    }}
                    style={{
                      left: blk.xPt * canvasScale,
                      top: blk.yPt * canvasScale,
                      width: blk.widthPt * canvasScale,
                      height: blk.heightPt * canvasScale,
                      touchAction: 'none',
                    }}
                    className={`absolute group ${
                      blk.locked ? 'cursor-default' : 'cursor-move'
                    } ${
                      hasError
                        ? 'ring-2 ring-red-500 bg-red-500/10'
                        : isSelected
                        ? 'ring-2 ring-[#101010] bg-black/[0.04]'
                        : 'border border-black/35 bg-black/[0.02] hover:bg-black/[0.05]'
                    }`}
                  >
                    {/* Live Document Thumbnail Preview inside Block */}
                    {thumbUrl && (
                      <div className="absolute inset-0 overflow-hidden flex items-center justify-center pointer-events-none opacity-80">
                        <img
                          src={thumbUrl}
                          alt={blk.label}
                          draggable={false}
                          style={{
                            transform: blk.rotation ? `rotate(${blk.rotation}deg)` : undefined,
                          }}
                          className="max-w-full max-h-full object-contain"
                        />
                      </div>
                    )}

                    {/* Cutting guides & crop marks */}
                    {(blk.cropMarks ?? draftBlueprint.cropMarks) && (
                      <>
                        <span className="pointer-events-none absolute top-0 left-0 w-2 h-2 border-t-2 border-l-2 border-[#101010]" />
                        <span className="pointer-events-none absolute top-0 right-0 w-2 h-2 border-t-2 border-r-2 border-[#101010]" />
                        <span className="pointer-events-none absolute bottom-0 left-0 w-2 h-2 border-b-2 border-l-2 border-[#101010]" />
                        <span className="pointer-events-none absolute bottom-0 right-0 w-2 h-2 border-b-2 border-r-2 border-[#101010]" />
                      </>
                    )}

                    {/* Block Header Tag */}
                    <div className="relative z-10 flex items-center justify-between px-1.5 py-1 bg-[#101010]/85 text-white text-[10px] font-mono tabular-nums pointer-events-none">
                      <span className="truncate font-semibold">
                        {blk.label}
                        {blk.rotation ? ` · ${blk.rotation}°` : ''}
                      </span>
                      <span className="flex items-center gap-1 shrink-0">
                        {blk.locked && <Lock className="w-2.5 h-2.5" />}
                        {serialSample && <span>{serialSample}</span>}
                      </span>
                    </div>

                    {/* Resize Handle */}
                    {!blk.locked && (
                      <div
                        onPointerDown={(e) => handlePointerDownBlock(e, blk, 'resize')}
                        onClick={(e) => e.stopPropagation()}
                        title="Drag to resize block"
                        style={{ touchAction: 'none' }}
                        className="absolute -bottom-1 -right-1 w-9 h-9 flex items-end justify-end p-1 cursor-nwse-resize z-20"
                      >
                        <span className="w-3.5 h-3.5 bg-[#101010] border border-white rounded-[2px] shadow" />
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>

        {/* Right Inspector Column */}
        <aside className="w-full desktop:w-[370px] shrink-0 border-t desktop:border-t-0 desktop:border-l border-black/10 dark:border-white/12 glass-level-2 flex flex-col desktop:overflow-hidden">
          <div className="grid grid-cols-2 border-b border-black/10 dark:border-white/12 text-xs font-medium shrink-0">
            <button
              type="button"
              onClick={() => setInspectorTab('block')}
              className={`min-h-[42px] py-2 text-center border-b-2 transition-colors ${
                inspectorTab === 'block'
                  ? 'border-[#101010] dark:border-white text-[#101010] dark:text-white font-semibold'
                  : 'border-transparent text-[#888888] dark:text-[#858585]'
              }`}
            >
              Block Inspector
            </button>
            <button
              type="button"
              onClick={() => setInspectorTab('sheet')}
              className={`min-h-[42px] py-2 text-center border-b-2 transition-colors ${
                inspectorTab === 'sheet'
                  ? 'border-[#101010] dark:border-white text-[#101010] dark:text-white font-semibold'
                  : 'border-transparent text-[#888888] dark:text-[#858585]'
              }`}
            >
              Sheet & Margins
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
            {inspectorTab === 'block' ? (
              <>
                {/* Block List Strip */}
                <div className="space-y-1.5">
                  <div className="text-[11px] font-medium text-[#555555] dark:text-[#B5B5B5]">
                    Blocks on Sheet ({draftBlueprint.blocks.length})
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {draftBlueprint.blocks.map((blk) => (
                      <button
                        key={blk.id}
                        type="button"
                        onClick={() => setSelectedBlockId(blk.id)}
                        className={`px-2.5 py-1.5 rounded-lg border text-left flex items-center justify-between gap-1 text-[11px] transition-colors ${
                          selectedBlockId === blk.id
                            ? 'studio-active-surface font-semibold'
                            : 'border-black/15 dark:border-white/15 text-[#555555] dark:text-[#B5B5B5]'
                        }`}
                      >
                        <span className="truncate">{blk.label}</span>
                        {blk.locked && <Lock className="w-3 h-3 shrink-0" />}
                      </button>
                    ))}
                  </div>
                </div>

                {selectedBlock ? (
                  <GlassCard level={3} padding="sm" className="space-y-3">
                    <div className="flex items-center justify-between gap-2 pb-2 border-b border-black/10 dark:border-white/10">
                      <input
                        type="text"
                        value={selectedBlock.label}
                        onChange={(e) =>
                          updateBlock(selectedBlock.id, { label: e.target.value })
                        }
                        className="font-semibold text-[#101010] dark:text-white bg-transparent border-b border-transparent focus:border-black/30 dark:focus:border-white/30 focus:outline-none min-w-0"
                      />
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            updateBlock(selectedBlock.id, {
                              locked: !selectedBlock.locked,
                            })
                          }
                          title={selectedBlock.locked ? 'Unlock block' : 'Lock block'}
                          className="p-1.5 rounded-lg hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
                        >
                          {selectedBlock.locked ? (
                            <Lock className="w-3.5 h-3.5" />
                          ) : (
                            <Unlock className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDuplicateBlock(selectedBlock)}
                          title="Duplicate block"
                          className="p-1.5 rounded-lg hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteBlock(selectedBlock.id)}
                          title="Delete block"
                          className="p-1.5 rounded-lg hover:bg-black/[0.05] dark:hover:bg-white/[0.08] text-red-500"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Geometry X, Y, W, H */}
                    <div className="grid grid-cols-2 gap-2">
                      {(
                        [
                          ['X', 'xPt'],
                          ['Y', 'yPt'],
                          ['Width', 'widthPt'],
                          ['Height', 'heightPt'],
                        ] as const
                      ).map(([lbl, key]) => (
                        <label key={key} className="block">
                          <span className="text-[10px] text-[#888888] dark:text-[#858585]">
                            {lbl} ({unit})
                          </span>
                          <NumericDraftInput
                            step={0.5}
                            disabled={selectedBlock.locked}
                            value={ptToUnit(selectedBlock[key], unit)}
                            fallback={key === 'widthPt' || key === 'heightPt' ? ptToUnit(16, unit) : 0}
                            onCommit={(val) => {
                              const pt = unitToPt(val, unit);
                              updateBlock(selectedBlock.id, {
                                [key]:
                                  key === 'widthPt' || key === 'heightPt'
                                    ? Math.max(16, pt)
                                    : Math.max(0, pt),
                              });
                            }}
                            className="mt-0.5 w-full px-2 py-1 rounded-lg studio-input tabular-nums disabled:opacity-50"
                          />
                        </label>
                      ))}
                    </div>

                    {/* Rotation */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-[#888888] dark:text-[#858585]">
                          Block Rotation (deg)
                        </span>
                        <span className="font-mono text-[11px] tabular-nums">
                          {selectedBlock.rotation}°
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <NumericDraftInput
                          step={1}
                          disabled={selectedBlock.locked}
                          value={selectedBlock.rotation}
                          fallback={0}
                          onCommit={(val) =>
                            updateBlock(selectedBlock.id, {
                              rotation: val,
                            })
                          }
                          className="w-20 px-2 py-1 rounded-lg studio-input tabular-nums"
                        />
                        {([0, 90, 180, 270] as const).map((deg) => (
                          <button
                            key={deg}
                            type="button"
                            disabled={selectedBlock.locked}
                            onClick={() =>
                              updateBlock(selectedBlock.id, { rotation: deg })
                            }
                            className={`flex-1 py-1 rounded-lg border text-[11px] tabular-nums ${
                              selectedBlock.rotation === deg
                                ? 'studio-active-surface font-semibold'
                                : 'border-black/15 dark:border-white/15 text-[#555555] dark:text-[#B5B5B5]'
                            }`}
                          >
                            {deg}°
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Source & Scaling */}
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block">
                        <span className="text-[10px] text-[#888888] dark:text-[#858585]">
                          Source Page
                        </span>
                        <NumericDraftInput
                          min={1}
                          max={Math.max(1, project?.pageCount || 1)}
                          fallback={1}
                          value={selectedBlock.sourcePageNumber}
                          onCommit={(val) =>
                            updateBlock(selectedBlock.id, {
                              sourcePageNumber: Math.max(
                                1,
                                Math.min(Math.max(1, project?.pageCount || 1), Math.round(val))
                              ),
                            })
                          }
                          className="mt-0.5 w-full px-2 py-1 rounded-lg studio-input tabular-nums"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[10px] text-[#888888] dark:text-[#858585]">
                          Scaling Mode
                        </span>
                        <select
                          value={selectedBlock.scalingMode}
                          onChange={(e) =>
                            updateBlock(selectedBlock.id, {
                              scalingMode: e.target.value as ScalingMode,
                            })
                          }
                          className="mt-0.5 w-full px-2 py-1 rounded-lg studio-select"
                        >
                          <option value="auto_fit_aspect">Auto Fit (Aspect)</option>
                          <option value="fit_to_width">Fit Width</option>
                          <option value="fit_to_height">Fit Height</option>
                          <option value="fill_cell">Fill Block</option>
                          <option value="preserve_original">Original 100%</option>
                        </select>
                      </label>
                    </div>

                    {/* Independent Serial Rule & Data Source */}
                    {project && (
                      <div className="pt-2 border-t border-black/10 dark:border-white/10 space-y-2.5">
                        <label className="block">
                          <span className="text-[10px] text-[#888888] dark:text-[#858585]">
                            Independent Serial Sequence
                          </span>
                          <select
                            value={selectedBlock.serialRuleId || ''}
                            onChange={(e) =>
                              updateBlock(selectedBlock.id, {
                                serialRuleId: e.target.value || undefined,
                              })
                            }
                            className="mt-0.5 w-full px-2 py-1 rounded-lg studio-select"
                          >
                            <option value="">Auto by Block Index</option>
                            {project.serialRules.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.name} ({r.targetFieldKey})
                              </option>
                            ))}
                          </select>
                        </label>

                        <div className="grid grid-cols-2 gap-2">
                          <label className="block">
                            <span className="text-[10px] text-[#888888] dark:text-[#858585]">
                              Data Source Mode
                            </span>
                            <select
                              value={selectedBlock.dataSource.mode}
                              onChange={(e) =>
                                updateBlock(selectedBlock.id, {
                                  dataSource: {
                                    ...selectedBlock.dataSource,
                                    mode: e.target.value as
                                      | 'sequential'
                                      | 'offset'
                                      | 'static_row',
                                  },
                                })
                              }
                              className="mt-0.5 w-full px-2 py-1 rounded-lg studio-select"
                            >
                              <option value="sequential">Sequential</option>
                              <option value="offset">Row Offset</option>
                              <option value="static_row">Fixed Row #</option>
                            </select>
                          </label>

                          {selectedBlock.dataSource.mode === 'offset' ? (
                            <label className="block">
                              <span className="text-[10px] text-[#888888] dark:text-[#858585]">
                                Row Offset
                              </span>
                              <NumericDraftInput
                                value={selectedBlock.dataSource.rowOffset}
                                fallback={0}
                                onCommit={(val) =>
                                  updateBlock(selectedBlock.id, {
                                    dataSource: {
                                      ...selectedBlock.dataSource,
                                      rowOffset: Math.round(val),
                                    },
                                  })
                                }
                                className="mt-0.5 w-full px-2 py-1 rounded-lg studio-input tabular-nums"
                              />
                            </label>
                          ) : selectedBlock.dataSource.mode === 'static_row' ? (
                            <label className="block">
                              <span className="text-[10px] text-[#888888] dark:text-[#858585]">
                                Fixed Row (1-based)
                              </span>
                              <NumericDraftInput
                                min={1}
                                value={(selectedBlock.dataSource.fixedRowIndex ?? 0) + 1}
                                fallback={1}
                                onCommit={(val) =>
                                  updateBlock(selectedBlock.id, {
                                    dataSource: {
                                      ...selectedBlock.dataSource,
                                      fixedRowIndex: Math.max(0, Math.round(val) - 1),
                                    },
                                  })
                                }
                                className="mt-0.5 w-full px-2 py-1 rounded-lg studio-input tabular-nums"
                              />
                            </label>
                          ) : (
                            <div className="flex items-end pb-1 text-[10px] text-[#888888] dark:text-[#858585]">
                              Slot #{selectedBlock.blockIndex + 1} per sheet
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="flex items-center gap-4 pt-1 text-[11px] text-[#555555] dark:text-[#B5B5B5]">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean(selectedBlock.showBorder)}
                          onChange={(e) =>
                            updateBlock(selectedBlock.id, {
                              showBorder: e.target.checked,
                            })
                          }
                          className="accent-[#101010] dark:accent-white"
                        />
                        Border
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedBlock.cropMarks ?? draftBlueprint.cropMarks}
                          onChange={(e) =>
                            updateBlock(selectedBlock.id, {
                              cropMarks: e.target.checked,
                            })
                          }
                          className="accent-[#101010] dark:accent-white"
                        />
                        Crop Marks
                      </label>
                    </div>
                  </GlassCard>
                ) : (
                  <div className="p-5 rounded-2xl border border-dashed border-black/15 dark:border-white/15 text-center text-[#888888] dark:text-[#858585]">
                    Select a block on the production canvas or click "Add Block" to configure position, rotation, serial rule, and data source.
                  </div>
                )}
              </>
            ) : (
              <div className="space-y-4">
                {/* Sheet Size Preset */}
                <div className="grid grid-cols-2 gap-2.5">
                  <label className="block">
                    <span className="text-[10px] text-[#888888] dark:text-[#858585]">
                      Paper Size
                    </span>
                    <select
                      value={draftBlueprint.sizePreset}
                      onChange={(e) => {
                        const preset = e.target.value as PageSizePreset;
                        const dims =
                          preset === 'Custom'
                            ? undefined
                            : PAGE_PRESETS_PT[preset];
                        mutateBlueprint((bp) => ({
                          ...bp,
                          sizePreset: preset,
                          sheetWidthPt: dims
                            ? bp.orientation === 'landscape'
                              ? Math.max(dims.widthPt, dims.heightPt)
                              : Math.min(dims.widthPt, dims.heightPt)
                            : bp.sheetWidthPt,
                          sheetHeightPt: dims
                            ? bp.orientation === 'landscape'
                              ? Math.min(dims.widthPt, dims.heightPt)
                              : Math.max(dims.widthPt, dims.heightPt)
                            : bp.sheetHeightPt,
                        }));
                      }}
                      className="mt-0.5 w-full px-2 py-1.5 rounded-lg studio-select"
                    >
                      {Object.keys(PAGE_PRESETS_PT).map((k) => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                      <option value="Custom">Custom</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-[10px] text-[#888888] dark:text-[#858585]">
                      Unit
                    </span>
                    <select
                      value={unit}
                      onChange={(e) =>
                        mutateBlueprint((bp) => ({
                          ...bp,
                          unit: e.target.value as MeasurementUnit,
                        }))
                      }
                      className="mt-0.5 w-full px-2 py-1.5 rounded-lg studio-select"
                    >
                      <option value="mm">mm</option>
                      <option value="cm">cm</option>
                      <option value="in">in</option>
                      <option value="pt">pt</option>
                    </select>
                  </label>
                </div>

                {/* Sheet Dimensions & Orientation */}
                <div className="grid grid-cols-2 gap-2.5">
                  <label className="block">
                    <span className="text-[10px] text-[#888888] dark:text-[#858585]">
                      Sheet Width ({unit})
                    </span>
                    <NumericDraftInput
                      step={0.5}
                      min={ptToUnit(72, unit)}
                      value={ptToUnit(draftBlueprint.sheetWidthPt, unit)}
                      fallback={ptToUnit(72, unit)}
                      onCommit={(val) =>
                        mutateBlueprint((bp) => ({
                          ...bp,
                          sizePreset: 'Custom',
                          sheetWidthPt: Math.max(72, unitToPt(val, unit)),
                        }))
                      }
                      className="mt-0.5 w-full px-2 py-1.5 rounded-lg studio-input tabular-nums"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] text-[#888888] dark:text-[#858585]">
                      Sheet Height ({unit})
                    </span>
                    <NumericDraftInput
                      step={0.5}
                      min={ptToUnit(72, unit)}
                      value={ptToUnit(draftBlueprint.sheetHeightPt, unit)}
                      fallback={ptToUnit(72, unit)}
                      onCommit={(val) =>
                        mutateBlueprint((bp) => ({
                          ...bp,
                          sizePreset: 'Custom',
                          sheetHeightPt: Math.max(72, unitToPt(val, unit)),
                        }))
                      }
                      className="mt-0.5 w-full px-2 py-1.5 rounded-lg studio-input tabular-nums"
                    />
                  </label>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    mutateBlueprint((bp) => ({
                      ...bp,
                      orientation:
                        bp.sheetWidthPt > bp.sheetHeightPt ? 'portrait' : 'landscape',
                      sheetWidthPt: bp.sheetHeightPt,
                      sheetHeightPt: bp.sheetWidthPt,
                    }))
                  }
                  className="w-full py-1.5 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] flex items-center justify-center gap-1.5 text-[11px] font-medium"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                  Swap Portrait / Landscape
                </button>

                {/* Margins */}
                <div>
                  <div className="text-[10px] text-[#888888] dark:text-[#858585] mb-1">
                    Sheet Margins ({unit})
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {(
                      [
                        ['Top', 'marginTopPt'],
                        ['Right', 'marginRightPt'],
                        ['Bottom', 'marginBottomPt'],
                        ['Left', 'marginLeftPt'],
                      ] as const
                    ).map(([lbl, key]) => (
                      <label key={key} className="block">
                        <span className="text-[10px] text-[#888888] dark:text-[#858585]">
                          {lbl}
                        </span>
                        <NumericDraftInput
                          min={0}
                          step={0.5}
                          value={ptToUnit(draftBlueprint[key], unit)}
                          fallback={0}
                          onCommit={(val) =>
                            mutateBlueprint((bp) => ({
                              ...bp,
                              [key]: Math.max(0, unitToPt(val, unit)),
                            }))
                          }
                          className="mt-0.5 w-full px-1.5 py-1 rounded-lg studio-input tabular-nums"
                        />
                      </label>
                    ))}
                  </div>
                </div>

                {/* Gutters & Bleed */}
                <div className="grid grid-cols-3 gap-2">
                  <label className="block">
                    <span className="text-[10px] text-[#888888] dark:text-[#858585]">
                      Gutter X ({unit})
                    </span>
                    <NumericDraftInput
                      min={0}
                      step={0.5}
                      value={ptToUnit(draftBlueprint.gutterXPt, unit)}
                      fallback={0}
                      onCommit={(val) =>
                        mutateBlueprint((bp) => ({
                          ...bp,
                          gutterXPt: Math.max(0, unitToPt(val, unit)),
                        }))
                      }
                      className="mt-0.5 w-full px-2 py-1 rounded-lg studio-input tabular-nums"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] text-[#888888] dark:text-[#858585]">
                      Gutter Y ({unit})
                    </span>
                    <NumericDraftInput
                      min={0}
                      step={0.5}
                      value={ptToUnit(draftBlueprint.gutterYPt, unit)}
                      fallback={0}
                      onCommit={(val) =>
                        mutateBlueprint((bp) => ({
                          ...bp,
                          gutterYPt: Math.max(0, unitToPt(val, unit)),
                        }))
                      }
                      className="mt-0.5 w-full px-2 py-1 rounded-lg studio-input tabular-nums"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] text-[#888888] dark:text-[#858585]">
                      Bleed ({unit})
                    </span>
                    <NumericDraftInput
                      min={0}
                      step={0.5}
                      value={ptToUnit(draftBlueprint.bleedPt, unit)}
                      fallback={0}
                      onCommit={(val) =>
                        mutateBlueprint((bp) => ({
                          ...bp,
                          bleedPt: Math.max(0, unitToPt(val, unit)),
                        }))
                      }
                      className="mt-0.5 w-full px-2 py-1 rounded-lg studio-input tabular-nums"
                    />
                  </label>
                </div>

                {/* Guides & Sheet Background */}
                <div className="space-y-2 pt-2 border-t border-black/10 dark:border-white/10 text-[11px] text-[#555555] dark:text-[#B5B5B5]">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draftBlueprint.cropMarks}
                      onChange={(e) =>
                        mutateBlueprint((bp) => ({ ...bp, cropMarks: e.target.checked }))
                      }
                      className="accent-[#101010] dark:accent-white"
                    />
                    <span>Show Crop Marks</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draftBlueprint.cuttingGuides}
                      onChange={(e) =>
                        mutateBlueprint((bp) => ({
                          ...bp,
                          cuttingGuides: e.target.checked,
                        }))
                      }
                      className="accent-[#101010] dark:accent-white"
                    />
                    <span>Show Cutting Guides</span>
                  </label>
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
};
