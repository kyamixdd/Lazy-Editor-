import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Columns2,
  ScanSearch,
  Sparkles,
} from 'lucide-react';
import { DocumentElement, PDFProject } from '../types/pdfStudio';
import {
  EDGE_CASE_PRESETS,
  EdgeCaseId,
  runBatchDataStressScan,
  simulateRecordLayout,
} from '../utils/dataSimulatorEngine';
import { GlassButton, GlassCard } from './glass';

interface DataSimulatorPanelProps {
  project: PDFProject;
  onUpdateProject: (updated: PDFProject) => void;
}

export const DataSimulatorPanel: React.FC<DataSimulatorPanelProps> = ({
  project,
  onUpdateProject,
}) => {
  const totalRows = project.dataRows.length;
  const [recordIdx, setRecordIdx] = useState<number>(0);
  const [jumpInput, setJumpInput] = useState<string>('1');
  const [compareMode, setCompareMode] = useState<boolean>(false);
  const [activeEdgeCases, setActiveEdgeCases] = useState<EdgeCaseId[]>([]);
  const [scanResult, setScanResult] = useState<ReturnType<
    typeof runBatchDataStressScan
  > | null>(null);

  const safeIdx = totalRows > 0 ? Math.max(0, Math.min(recordIdx, totalRows - 1)) : 0;

  const toggleEdgeCase = (id: EdgeCaseId) => {
    setActiveEdgeCases((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const navigateTo = (idx: number) => {
    const clamped =
      totalRows > 0 ? Math.max(0, Math.min(idx, totalRows - 1)) : 0;
    setRecordIdx(clamped);
    setJumpInput(String(clamped + 1));
  };

  const primarySim = useMemo(
    () => simulateRecordLayout(project, safeIdx, activeEdgeCases),
    [project, safeIdx, activeEdgeCases]
  );

  const comparisonSims = useMemo(() => {
    if (!compareMode) return [primarySim];
    const indices = [safeIdx];
    if (totalRows > 1) {
      const mid = Math.floor((totalRows - 1) / 2);
      const last = totalRows - 1;
      if (mid !== safeIdx) indices.push(mid);
      if (last !== safeIdx && last !== mid) indices.push(last);
    } else {
      // Compare baseline vs stress-test when only 0–1 rows exist
      return [
        simulateRecordLayout(project, 0, []),
        simulateRecordLayout(project, 0, ['long_text', 'large_currency']),
      ];
    }
    return indices.map((idx) =>
      simulateRecordLayout(project, idx, idx === safeIdx ? activeEdgeCases : [])
    );
  }, [compareMode, primarySim, safeIdx, totalRows, project, activeEdgeCases]);

  const handlePatchElement = (
    elementId: string,
    patch: Partial<DocumentElement>
  ) => {
    onUpdateProject({
      ...project,
      elements: project.elements.map((e) =>
        e.id === elementId ? { ...e, ...patch } : e
      ),
      updatedAt: new Date().toISOString(),
    });
  };

  const pageMeta = project.originalPages[0];
  const pageW = pageMeta?.widthPt || project.pageConfig.widthPt || 595;
  const pageH = pageMeta?.heightPt || project.pageConfig.heightPt || 842;
  const thumbUrl = pageMeta?.previewImageDataUrl;
  const previewWidthPx = compareMode ? 280 : 380;
  const previewScale = previewWidthPx / Math.max(1, pageW);

  return (
    <div className="space-y-4 text-xs">
      {/* Record Navigation & Compare Controls */}
      <GlassCard level={3} padding="sm" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <GlassButton
              variant="glass"
              size="sm"
              disabled={totalRows === 0}
              onClick={() => navigateTo(0)}
            >
              First
            </GlassButton>
            <GlassButton
              variant="glass"
              size="sm"
              disabled={totalRows === 0 || safeIdx <= 0}
              onClick={() => navigateTo(safeIdx - 1)}
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </GlassButton>
            <GlassButton
              variant="glass"
              size="sm"
              disabled={totalRows === 0}
              onClick={() => navigateTo(Math.floor(Math.max(0, totalRows - 1) / 2))}
            >
              Middle
            </GlassButton>
            <GlassButton
              variant="glass"
              size="sm"
              disabled={totalRows === 0 || safeIdx >= totalRows - 1}
              onClick={() => navigateTo(safeIdx + 1)}
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </GlassButton>
            <GlassButton
              variant="glass"
              size="sm"
              disabled={totalRows === 0}
              onClick={() => navigateTo(Math.max(0, totalRows - 1))}
            >
              Last
            </GlassButton>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                navigateTo((Number(jumpInput) || 1) - 1);
              }}
              className="flex items-center gap-1 ml-1"
            >
              <span className="text-[#888888] dark:text-[#858585]">#</span>
              <input
                type="number"
                min="1"
                max={Math.max(1, totalRows)}
                value={jumpInput}
                onChange={(e) => setJumpInput(e.target.value)}
                className="w-16 px-2 py-1 rounded-lg studio-input tabular-nums"
              />
              <button
                type="submit"
                className="px-2 py-1 rounded-lg border border-black/15 dark:border-white/15 font-medium"
              >
                Go
              </button>
            </form>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <GlassButton
              variant="glass"
              size="sm"
              active={compareMode}
              onClick={() => setCompareMode((v) => !v)}
            >
              <Columns2 className="w-3.5 h-3.5" />
              Side-by-Side Compare
            </GlassButton>
            <GlassButton
              variant="primary"
              size="sm"
              onClick={() => setScanResult(runBatchDataStressScan(project, 250))}
            >
              <ScanSearch className="w-3.5 h-3.5" />
              Run Layout Stress-Test
            </GlassButton>
          </div>
        </div>

        {/* Synthetic Edge-Case Toggles */}
        <div className="pt-2 border-t border-black/10 dark:border-white/10">
          <div className="text-[11px] font-medium text-[#555555] dark:text-[#B5B5B5] mb-1.5">
            Synthetic Stress-Test Edge Cases (Non-destructive preview)
          </div>
          <div className="flex flex-wrap gap-1.5">
            {EDGE_CASE_PRESETS.map((preset) => {
              const active = activeEdgeCases.includes(preset.id);
              return (
                <button
                  key={preset.id}
                  type="button"
                  title={preset.description}
                  onClick={() => toggleEdgeCase(preset.id)}
                  className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-colors ${
                    active
                      ? 'studio-active-surface'
                      : 'border-black/15 dark:border-white/15 text-[#555555] dark:text-[#B5B5B5] hover:text-[#101010] dark:hover:text-white'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
            {activeEdgeCases.length > 0 && (
              <button
                type="button"
                onClick={() => setActiveEdgeCases([])}
                className="px-2 py-1 text-[11px] text-[#888888] hover:text-[#101010] dark:hover:text-white"
              >
                Clear Stress Cases
              </button>
            )}
          </div>
        </div>
      </GlassCard>

      {/* Batch Stress Scan Summary */}
      {scanResult && (
        <GlassCard level={3} padding="sm" className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-semibold text-[#101010] dark:text-white flex items-center gap-1.5 tabular-nums">
              {scanResult.failingRecordIndices.length === 0 ? (
                <CheckCircle2 className="w-4 h-4" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-red-500" />
              )}
              Scanned {scanResult.scannedCount} / {scanResult.totalDatasetRows} dataset rows ·{' '}
              {scanResult.failingRecordIndices.length} overflow error(s) ·{' '}
              {scanResult.warningRecordIndices.length} warning(s)
            </div>
          </div>

          <div className="grid grid-cols-2 tablet:grid-cols-3 desktop:grid-cols-6 gap-2">
            {scanResult.edgeCaseResults.map((er) => (
              <button
                key={er.preset.id}
                type="button"
                onClick={() => setActiveEdgeCases([er.preset.id])}
                className="p-2 rounded-xl border border-black/10 dark:border-white/10 text-left hover:border-black/30 dark:hover:border-white/30"
              >
                <div className="font-medium text-[#101010] dark:text-white truncate">
                  {er.preset.label}
                </div>
                <div
                  className={`text-[10px] tabular-nums ${
                    er.errorCount > 0
                      ? 'text-red-600 dark:text-red-400 font-semibold'
                      : er.warningCount > 0
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-[#555555] dark:text-[#B5B5B5]'
                  }`}
                >
                  {er.errorCount} err · {er.warningCount} warn
                </div>
              </button>
            ))}
          </div>

          {scanResult.worstFieldKeys.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] tabular-nums">
              <span className="text-[#888888] dark:text-[#858585]">Flagged fields:</span>
              {scanResult.worstFieldKeys.map((wf) => (
                <button
                  key={wf.fieldKey}
                  type="button"
                  onClick={() => navigateTo(wf.sampleRecordIndex)}
                  className="px-2 py-0.5 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/[0.04] dark:hover:bg-white/[0.08]"
                >
                  {wf.fieldKey} ({wf.issueCount}) · Row #{wf.sampleRecordIndex + 1}
                </button>
              ))}
            </div>
          )}
        </GlassCard>
      )}

      {/* Visual Template Simulation Viewports */}
      <div
        className={`grid gap-4 ${
          comparisonSims.length >= 3
            ? 'grid-cols-1 desktop:grid-cols-3'
            : comparisonSims.length === 2
            ? 'grid-cols-1 tablet:grid-cols-2'
            : 'grid-cols-1 desktop:grid-cols-2'
        }`}
      >
        {comparisonSims.map((sim, idx) => (
          <GlassCard key={`${sim.recordIndex}-${idx}`} level={3} padding="sm" className="space-y-3">
            <div className="flex items-center justify-between border-b border-black/10 dark:border-white/10 pb-2 tabular-nums">
              <span className="font-semibold text-[#101010] dark:text-white">
                {sim.recordLabel}
                {sim.activeEdgeCases.length > 0
                  ? ` + ${sim.activeEdgeCases.join(', ')}`
                  : ''}
              </span>
              <span
                className={`text-[11px] font-medium ${
                  sim.errorCount > 0
                    ? 'text-red-600 dark:text-red-400'
                    : sim.warningCount > 0
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-[#101010] dark:text-white'
                }`}
              >
                {sim.errorCount === 0 && sim.warningCount === 0
                  ? 'Pass'
                  : `${sim.errorCount} error(s) · ${sim.warningCount} warning(s)`}
              </span>
            </div>

            <div className="overflow-auto flex justify-center bg-[#EFEFEF] dark:bg-[#0B0B0B] rounded-xl p-3">
              <div
                style={{
                  width: pageW * previewScale,
                  height: pageH * previewScale,
                  backgroundColor: project.pageConfig.backgroundColor || '#FFFFFF',
                }}
                className="relative shadow-lg border border-black/20 overflow-hidden shrink-0"
              >
                {thumbUrl && (
                  <img
                    src={thumbUrl}
                    alt="Template Page"
                    className="absolute inset-0 w-full h-full object-contain opacity-60 pointer-events-none"
                  />
                )}
                {project.elements
                  .filter((e) => e.visible && e.pageNumber === 1)
                  .map((el) => {
                    const diag = sim.diagnostics.find((d) => d.elementId === el.id);
                    const boxBorder =
                      diag?.severity === 'error'
                        ? 'border-red-500 bg-red-500/15'
                        : diag?.severity === 'warning'
                        ? 'border-amber-500 bg-amber-500/15'
                        : diag
                        ? 'border-black/40 bg-white/85'
                        : 'border-black/15';
                    return (
                      <div
                        key={el.id}
                        style={{
                          left: el.x * previewScale,
                          top: el.y * previewScale,
                          width: el.width * previewScale,
                          height: el.height * previewScale,
                          fontSize: Math.max(
                            6,
                            (diag?.effectiveFontSize || el.fontSize) * previewScale
                          ),
                          color: el.color || '#101010',
                        }}
                        className={`absolute border px-0.5 leading-tight overflow-hidden ${boxBorder}`}
                      >
                        <span className="block break-words">
                          {diag ? diag.effectiveText : el.text}
                        </span>
                      </div>
                    );
                  })}
              </div>
            </div>
          </GlassCard>
        ))}

        {/* Field Diagnostics & One-Click Template Fixes (shown beside single preview) */}
        {!compareMode && (
          <GlassCard level={3} padding="sm" className="space-y-2.5">
            <div className="flex items-center justify-between pb-2 border-b border-black/10 dark:border-white/10">
              <span className="font-semibold text-[#101010] dark:text-white">
                Element Stress Diagnostics ({primarySim.diagnostics.length})
              </span>
              <span className="text-[11px] text-[#888888] dark:text-[#858585] tabular-nums">
                {primarySim.errorCount} err · {primarySim.warningCount} warn
              </span>
            </div>

            {primarySim.diagnostics.length === 0 ? (
              <div className="p-6 text-center text-[#888888] dark:text-[#858585]">
                No text or mapped fields found on Page 1. Add fields in the PDF Editor to simulate dataset layout stress.
              </div>
            ) : (
              <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
                {primarySim.diagnostics.map((d) => {
                  const sourceEl = project.elements.find((e) => e.id === d.elementId);
                  return (
                    <div
                      key={d.elementId}
                      className={`p-2.5 rounded-xl border space-y-1.5 ${
                        d.severity === 'error'
                          ? 'border-red-500/45 bg-red-500/5'
                          : d.severity === 'warning'
                          ? 'border-amber-500/45 bg-amber-500/5'
                          : 'border-black/10 dark:border-white/10'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-[#101010] dark:text-white truncate">
                          {d.elementLabel}
                        </span>
                        <span className="text-[10px] font-mono tabular-nums text-[#888888] dark:text-[#858585]">
                          {d.effectiveFontSize}pt · {d.linesCount}L
                        </span>
                      </div>
                      <div className="text-[11px] font-mono text-[#555555] dark:text-[#B5B5B5] truncate">
                        {d.effectiveText || '(empty)'}
                      </div>
                      {d.issues.length > 0 && (
                        <div className="text-[10px] text-red-600 dark:text-red-400">
                          {d.issues.join(' · ')}
                        </div>
                      )}
                      {d.severity !== 'ok' && sourceEl && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {!sourceEl.autofit && (
                            <button
                              type="button"
                              onClick={() =>
                                handlePatchElement(sourceEl.id, { autofit: true })
                              }
                              className="px-2 py-0.5 rounded-md border border-black/15 dark:border-white/15 text-[10px] font-medium flex items-center gap-1"
                            >
                              <Sparkles className="w-2.5 h-2.5" />
                              Enable Autofit
                            </button>
                          )}
                          {sourceEl.textWrap === false && (
                            <button
                              type="button"
                              onClick={() =>
                                handlePatchElement(sourceEl.id, { textWrap: true })
                              }
                              className="px-2 py-0.5 rounded-md border border-black/15 dark:border-white/15 text-[10px] font-medium"
                            >
                              Enable Wrap
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              handlePatchElement(sourceEl.id, {
                                width: Number((sourceEl.width + 28).toFixed(1)),
                                height: Number((sourceEl.height + 10).toFixed(1)),
                              })
                            }
                            className="px-2 py-0.5 rounded-md border border-black/15 dark:border-white/15 text-[10px] font-medium"
                          >
                            Expand Box (+28×10pt)
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </GlassCard>
        )}
      </div>
    </div>
  );
};
