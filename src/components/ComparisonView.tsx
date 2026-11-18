import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Columns2,
  GitCompare,
  Layers,
  Loader2,
} from 'lucide-react';
import { AssetFontItem, PDFProject } from '../types/pdfStudio';
import { compareOriginalVsEdited } from '../utils/comparisonEngine';
import { generateExportBytes } from '../utils/pdfExporter';
import {
  renderSinglePagePreview,
  uint8ArrayToBase64,
} from '../utils/pdfRenderer';
import { GlassCard, GlassSegmentedControl } from './glass';

interface ComparisonViewProps {
  project: PDFProject;
  customFonts: AssetFontItem[];
  onInspectElement: (pageNumber: number, elementId?: string) => void;
}

export const ComparisonView: React.FC<ComparisonViewProps> = ({
  project,
  customFonts,
  onInspectElement,
}) => {
  const [viewMode, setViewMode] = useState<'side_by_side' | 'overlay'>(
    'side_by_side'
  );
  const [currentPage, setCurrentPage] = useState(1);
  const [overlayOpacity, setOverlayOpacity] = useState(0.55);
  const [baselineIdx, setBaselineIdx] = useState<'original' | number>('original');
  const [statusFilter, setStatusFilter] = useState<
    'changes_only' | 'all' | 'unexpected'
  >('changes_only');

  const [origPreviewUrl, setOrigPreviewUrl] = useState<string | null>(null);
  const [editedPreviewUrl, setEditedPreviewUrl] = useState<string | null>(null);
  const [renderingEdited, setRenderingEdited] = useState(false);

  const summary = useMemo(
    () =>
      compareOriginalVsEdited(
        project,
        baselineIdx === 'original' ? undefined : baselineIdx
      ),
    [project, baselineIdx]
  );

  // Clamp page
  useEffect(() => {
    setCurrentPage((p) =>
      Math.max(1, Math.min(p, Math.max(1, project.pageCount)))
    );
  }, [project.id, project.pageCount]);

  // Render original PDF page reference image
  useEffect(() => {
    let cancelled = false;
    const meta = project.originalPages.find((p) => p.pageNumber === currentPage);
    if (project.sourcePdfBase64) {
      const targetSrc = meta?.sourcePdfPageNumber || currentPage;
      void renderSinglePagePreview(project.sourcePdfBase64, targetSrc, 1.35).then(
        (url) => {
          if (!cancelled) setOrigPreviewUrl(url || meta?.previewImageDataUrl || null);
        }
      );
    } else {
      setOrigPreviewUrl(meta?.previewImageDataUrl || null);
    }
    return () => {
      cancelled = true;
    };
  }, [currentPage, project.id, project.originalPages, project.sourcePdfBase64]);

  // Render live compiled edited PDF preview for the selected page (real PDF bytes parity!)
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setRenderingEdited(true);
      try {
        const tempProj: PDFProject = {
          ...project,
          copiesConfig: { ...project.copiesConfig, enabled: false },
          bulkConfig: { ...project.bulkConfig, enabled: false, totalOutputPages: 1 },
          exportConfig: {
            ...project.exportConfig,
            mode: 'selected_pages',
            selectedPagesRange: String(currentPage),
          },
        };
        const out = await generateExportBytes(tempProj, { customFonts });
        const b64 = uint8ArrayToBase64(out.data);
        const img = await renderSinglePagePreview(b64, 1, 1.35);
        if (!cancelled) setEditedPreviewUrl(img);
      } catch {
        if (!cancelled) setEditedPreviewUrl(null);
      } finally {
        if (!cancelled) setRenderingEdited(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [currentPage, project, customFonts]);

  const pageMeta =
    project.originalPages.find((p) => p.pageNumber === currentPage) ||
    project.originalPages[0];
  const refW = pageMeta?.widthPt || project.pageConfig.widthPt;
  const refH = pageMeta?.heightPt || project.pageConfig.heightPt;

  const visibleDiffs = summary.diffs.filter((d) => {
    if (d.pageNumber !== currentPage) return false;
    if (statusFilter === 'unexpected') return Boolean(d.unexpectedVisualDiff);
    if (statusFilter === 'changes_only') return d.status !== 'unchanged';
    return true;
  });

  return (
    <div className="flex-1 overflow-y-auto p-4 tablet:p-6 desktop:p-8 max-w-7xl mx-auto w-full space-y-5">
      {/* Header */}
      <div className="flex flex-col tablet:flex-row tablet:items-center justify-between gap-4 pb-5 border-b border-slate-200/80 dark:border-white/10">
        <div>
          <h1 className="text-xl tablet:text-2xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Original vs Edited Comparison
          </h1>
          <p className="mt-1 text-xs tablet:text-sm text-slate-600 dark:text-slate-400">
            Inspect side-by-side or translucent overlay differences against the unmodified original PDF reference.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="inline-flex rounded-xl glass-level-2 border p-0.5">
            <button
              type="button"
              onClick={() => setViewMode('side_by_side')}
              className={`min-h-[36px] px-3 py-1 rounded-lg font-medium flex items-center gap-1.5 whitespace-nowrap ${
                viewMode === 'side_by_side'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              <Columns2 className="w-3.5 h-3.5" />
              Side-by-Side
            </button>
            <button
              type="button"
              onClick={() => setViewMode('overlay')}
              className={`min-h-[36px] px-3 py-1 rounded-lg font-medium flex items-center gap-1.5 whitespace-nowrap ${
                viewMode === 'overlay'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              Overlay Diff
            </button>
          </div>

          <select
            value={baselineIdx === 'original' ? 'original' : String(baselineIdx)}
            onChange={(e) =>
              setBaselineIdx(
                e.target.value === 'original'
                  ? 'original'
                  : Number(e.target.value)
              )
            }
            className="min-h-[38px] px-2.5 py-1.5 rounded-xl border border-slate-300/80 dark:border-white/15 glass-level-2 text-slate-900 dark:text-slate-100"
          >
            <option value="original">Reference: Original PDF</option>
            {(project.versions || []).map((v, idx) => (
              <option key={`${v.version}-${idx}`} value={idx}>
                Snapshot v{v.version} ({v.note})
              </option>
            ))}
          </select>

          <div className="flex items-center gap-1 border glass-level-2 rounded-xl px-2 py-1">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="p-1.5 disabled:opacity-35"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="tabular-nums font-medium px-1">
              Page {currentPage} / {project.pageCount}
            </span>
            <button
              type="button"
              disabled={currentPage >= project.pageCount}
              onClick={() =>
                setCurrentPage((p) => Math.min(project.pageCount, p + 1))
              }
              className="p-1.5 disabled:opacity-35"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Diff Counters */}
      <div className="grid grid-cols-2 tablet:grid-cols-5 gap-3 text-xs tabular-nums">
        <GlassCard level={3} padding="sm">
          <div className="text-[11px] text-slate-500">Modified Elements</div>
          <div className="mt-0.5 text-lg font-semibold text-amber-600 dark:text-amber-400">
            {summary.modifiedCount}
          </div>
        </GlassCard>
        <GlassCard level={3} padding="sm">
          <div className="text-[11px] text-slate-500">Added Elements</div>
          <div className="mt-0.5 text-lg font-semibold text-emerald-600 dark:text-emerald-400">
            {summary.addedCount}
          </div>
        </GlassCard>
        <GlassCard level={3} padding="sm">
          <div className="text-[11px] text-slate-500">Removed / Masked</div>
          <div className="mt-0.5 text-lg font-semibold text-red-600 dark:text-red-400">
            {summary.removedCount}
          </div>
        </GlassCard>
        <GlassCard level={3} padding="sm">
          <div className="text-[11px] text-slate-500">Large Visual Shifts</div>
          <div className="mt-0.5 text-lg font-semibold text-slate-900 dark:text-slate-100">
            {summary.unexpectedDiffCount}
          </div>
        </GlassCard>
        <GlassCard level={3} padding="sm">
          <div className="text-[11px] text-slate-500">Page Geometry</div>
          <div className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
            {summary.pageSizeChanged ? 'Resized' : 'Original Match'}
          </div>
        </GlassCard>
      </div>

      {/* Visual Viewport */}
      {viewMode === 'side_by_side' ? (
        <div className="grid grid-cols-1 desktop:grid-cols-2 gap-4">
          <GlassCard level={3} padding="none" className="overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-200/75 dark:border-white/10 flex items-center justify-between text-xs font-semibold">
              <span>Original Reference PDF (Page {currentPage})</span>
              <span className="text-[11px] font-normal text-slate-500 tabular-nums">
                {Math.round(refW)}×{Math.round(refH)} pt
              </span>
            </div>
            <div className="p-4 glass-level-1 flex justify-center min-h-[380px]">
              <div className="relative inline-block shadow-lg border border-slate-300 dark:border-slate-700 bg-white">
                {origPreviewUrl ? (
                  <img
                    src={origPreviewUrl}
                    alt="Original PDF reference"
                    className="max-h-[520px] w-auto object-contain block"
                  />
                ) : (
                  <div className="w-80 h-[420px] flex items-center justify-center text-xs text-slate-400">
                    Blank Reference Document
                  </div>
                )}
              </div>
            </div>
          </GlassCard>

          <GlassCard level={3} padding="none" className="overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-200/75 dark:border-white/10 flex items-center justify-between text-xs font-semibold">
              <span>Edited Production Output (Page {currentPage})</span>
              <span className="text-[11px] font-normal text-slate-500 tabular-nums">
                {Math.round(project.pageConfig.widthPt)}×
                {Math.round(project.pageConfig.heightPt)} pt
              </span>
            </div>
            <div className="p-4 glass-level-1 flex justify-center min-h-[380px] relative">
              {renderingEdited && (
                <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5 text-[11px] text-slate-700 dark:text-slate-200 glass-level-4 px-2.5 py-1 rounded-xl border">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Rendering PDF...
                </div>
              )}
              <div className="relative inline-block shadow-lg border border-slate-300 dark:border-slate-700 bg-white">
                {editedPreviewUrl ? (
                  <img
                    src={editedPreviewUrl}
                    alt="Edited PDF output"
                    className="max-h-[520px] w-auto object-contain block"
                  />
                ) : (
                  <div className="w-80 h-[420px] flex items-center justify-center text-xs text-slate-400">
                    Preview unavailable
                  </div>
                )}
              </div>
            </div>
          </GlassCard>
        </div>
      ) : (
        <GlassCard level={3} padding="none" className="overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-200/75 dark:border-white/10 flex flex-wrap items-center justify-between gap-3 text-xs">
            <span className="font-semibold">
              Overlay Comparison (Original Underlay + Edited Top Layer + Change Highlights)
            </span>
            <label className="flex items-center gap-2">
              <span className="text-slate-500">Edited Layer Opacity:</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={overlayOpacity}
                onChange={(e) => setOverlayOpacity(Number(e.target.value))}
                className="w-32"
              />
              <span className="tabular-nums font-mono w-10 text-right">
                {Math.round(overlayOpacity * 100)}%
              </span>
            </label>
          </div>
          <div className="p-6 bg-slate-100 dark:bg-[#080B11] flex justify-center">
            <div className="relative inline-block shadow-xl border border-slate-300 dark:border-slate-700 bg-white">
              {origPreviewUrl && (
                <img
                  src={origPreviewUrl}
                  alt="Original reference layer"
                  className="max-h-[560px] w-auto object-contain block"
                />
              )}
              {editedPreviewUrl && (
                <img
                  src={editedPreviewUrl}
                  alt="Edited overlay layer"
                  style={{ opacity: overlayOpacity }}
                  className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                />
              )}
              {/* Highlight bounding boxes of modified/added/removed elements */}
              {visibleDiffs
                .filter((d) => d.status !== 'unchanged')
                .map((d) => {
                  const box = d.editedElement || d.originalElement;
                  if (!box || refW <= 0 || refH <= 0) return null;
                  const borderClass =
                    d.status === 'added'
                      ? 'border-emerald-500 bg-emerald-500/15'
                      : d.status === 'removed'
                      ? 'border-red-500 bg-red-500/15'
                      : 'border-amber-500 bg-amber-500/15';
                  return (
                    <button
                      key={d.id}
                      type="button"
                      title={`${d.status.toUpperCase()}: ${d.label} (${d.reasons.join(', ')})`}
                      onClick={() => onInspectElement(d.pageNumber, d.id)}
                      style={{
                        left: `${(box.x / refW) * 100}%`,
                        top: `${(box.y / refH) * 100}%`,
                        width: `${Math.max(1.5, (box.width / refW) * 100)}%`,
                        height: `${Math.max(1.5, (box.height / refH) * 100)}%`,
                      }}
                      className={`absolute border-2 ${borderClass} hover:ring-2 hover:ring-blue-500 transition-all`}
                    />
                  );
                })}
            </div>
          </div>
        </GlassCard>
      )}

      {/* Element Diff List */}
      <GlassCard level={3} padding="none" className="overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200/75 dark:border-white/10 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 font-semibold">
            <GitCompare className="w-4 h-4 text-blue-500" />
            Page {currentPage} Change Breakdown
          </div>
          <GlassSegmentedControl
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: 'changes_only', label: 'Changed / Added / Removed' },
              { value: 'unexpected', label: 'Large Shifts Only' },
              { value: 'all', label: 'All Elements' },
            ]}
          />
        </div>

        <div className="divide-y divide-slate-200 dark:divide-slate-800 max-h-72 overflow-y-auto text-xs">
          {visibleDiffs.length === 0 ? (
            <div className="p-6 text-center text-slate-500 dark:text-slate-400">
              No changes match the selected filter on Page {currentPage}.
            </div>
          ) : (
            visibleDiffs.map((d) => (
              <div
                key={d.id}
                className="px-4 py-2.5 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`font-semibold uppercase text-[10px] ${
                        d.status === 'added'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : d.status === 'removed'
                          ? 'text-red-600 dark:text-red-400'
                          : d.status === 'modified'
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-slate-400'
                      }`}
                    >
                      {d.status}
                    </span>
                    <span className="font-medium text-slate-900 dark:text-slate-100 truncate max-w-md">
                      {d.label}
                    </span>
                    {d.unexpectedVisualDiff && (
                      <span className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        Unexpected Geometry Shift
                      </span>
                    )}
                  </div>
                  {d.reasons.length > 0 && (
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {d.reasons.join(' · ')}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => onInspectElement(d.pageNumber, d.id)}
                  className="px-2.5 py-1 rounded text-blue-600 dark:text-blue-400 hover:bg-blue-500/10 font-medium shrink-0"
                >
                  Open in Editor
                </button>
              </div>
            ))
          )}
        </div>
      </GlassCard>
    </div>
  );
};
