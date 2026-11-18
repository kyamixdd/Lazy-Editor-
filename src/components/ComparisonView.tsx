import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AnimatePresence,
  LayoutGroup,
  motion,
  useReducedMotion,
} from 'motion/react';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Columns2,
  FileUp,
  GitCompare,
  Layers,
  Loader2,
} from 'lucide-react';
import {
  MOTION_DURATION,
  MOTION_EASE,
  MOTION_SPRING,
  toastVariants,
} from '../config/motionSystem';
import { AssetFontItem, PDFProject } from '../types/pdfStudio';
import {
  compareExternalPdfBytes,
  compareOriginalVsEdited,
  compareTwoSnapshots,
  ExternalPdfComparisonResult,
} from '../utils/comparisonEngine';
import { generateExportBytes } from '../utils/pdfExporter';
import {
  renderSinglePagePreview,
  uint8ArrayToBase64,
} from '../utils/pdfRenderer';
import { GlassButton, GlassCard, GlassSegmentedControl } from './glass';

interface ComparisonViewProps {
  project: PDFProject;
  customFonts: AssetFontItem[];
  onInspectElement: (pageNumber: number, elementId?: string) => void;
}

type CompareScopeMode = 'original_vs_edited' | 'snapshot_vs_snapshot' | 'two_pdfs';

export const ComparisonView: React.FC<ComparisonViewProps> = ({
  project,
  customFonts,
  onInspectElement,
}) => {
  const shouldReduceMotion = useReducedMotion();
  const modeGroupId = useId();
  const [scopeMode, setScopeMode] =
    useState<CompareScopeMode>('original_vs_edited');
  const [viewMode, setViewMode] = useState<'side_by_side' | 'overlay'>(
    'side_by_side'
  );
  const [currentPage, setCurrentPage] = useState(1);
  const [overlayOpacity, setOverlayOpacity] = useState(0.55);
  const [baselineIdx, setBaselineIdx] = useState<'original' | number>('original');
  const [snapLeftIdx, setSnapLeftIdx] = useState(0);
  const [snapRightIdx, setSnapRightIdx] = useState(0);
  const [statusFilter, setStatusFilter] = useState<
    'changes_only' | 'all' | 'unexpected'
  >('changes_only');

  const [origPreviewUrl, setOrigPreviewUrl] = useState<string | null>(null);
  const [editedPreviewUrl, setEditedPreviewUrl] = useState<string | null>(null);
  const [renderingEdited, setRenderingEdited] = useState(false);

  // Two external PDFs state
  const [extPdfA, setExtPdfA] = useState<{ name: string; b64: string; bytes: Uint8Array } | null>(null);
  const [extPdfB, setExtPdfB] = useState<{ name: string; b64: string; bytes: Uint8Array } | null>(null);
  const [extPreviewA, setExtPreviewA] = useState<string | null>(null);
  const [extPreviewB, setExtPreviewB] = useState<string | null>(null);
  const [extComparison, setExtComparison] =
    useState<ExternalPdfComparisonResult | null>(null);
  const [comparingExt, setComparingExt] = useState(false);
  const [extError, setExtError] = useState<string | null>(null);

  const fileARef = useRef<HTMLInputElement>(null);
  const fileBRef = useRef<HTMLInputElement>(null);

  const versions = project.versions || [];

  useEffect(() => {
    setBaselineIdx('original');
    setSnapLeftIdx(0);
    setSnapRightIdx(0);
    setExtError(null);
  }, [project.id]);

  useEffect(() => {
    const maxIdx = Math.max(0, versions.length - 1);
    setSnapLeftIdx((i) => Math.min(i, maxIdx));
    setSnapRightIdx((i) => Math.min(i, maxIdx));
    setBaselineIdx((b) => (typeof b === 'number' && b > maxIdx ? 'original' : b));
  }, [versions.length]);

  const summary = useMemo(() => {
    if (scopeMode === 'snapshot_vs_snapshot' && versions.length > 0) {
      return compareTwoSnapshots(project, snapLeftIdx, snapRightIdx);
    }
    return compareOriginalVsEdited(
      project,
      baselineIdx === 'original' ? undefined : baselineIdx
    );
  }, [project, baselineIdx, scopeMode, versions.length, snapLeftIdx, snapRightIdx]);

  const maxPageCount =
    scopeMode === 'two_pdfs' && extComparison
      ? Math.max(1, extComparison.leftPageCount, extComparison.rightPageCount)
      : Math.max(1, project.pageCount);

  useEffect(() => {
    setCurrentPage((p) => Math.max(1, Math.min(p, maxPageCount)));
  }, [project.id, maxPageCount]);

  // Render Left/Original or Snapshot A preview
  useEffect(() => {
    if (scopeMode === 'two_pdfs') return;
    let cancelled = false;

    const renderLeft = async () => {
      if (scopeMode === 'snapshot_vs_snapshot' && versions[snapLeftIdx]) {
        const snap = versions[snapLeftIdx];
        const tempLeft: PDFProject = {
          ...project,
          elements: snap.elementsSnapshot,
          pageConfig: snap.pageConfigSnapshot,
          copiesConfig: { ...project.copiesConfig, enabled: false },
          bulkConfig: { ...project.bulkConfig, enabled: false, totalOutputPages: 1 },
          exportConfig: {
            ...project.exportConfig,
            mode: 'selected_pages',
            selectedPagesRange: String(currentPage),
          },
        };
        const out = await generateExportBytes(tempLeft, { customFonts });
        const img = await renderSinglePagePreview(
          uint8ArrayToBase64(out.data),
          1,
          1.35
        );
        if (!cancelled) setOrigPreviewUrl(img);
        return;
      }

      const meta = project.originalPages.find((p) => p.pageNumber === currentPage);
      if (project.sourcePdfBase64) {
        const targetSrc = meta?.sourcePdfPageNumber || currentPage;
        const url = await renderSinglePagePreview(
          project.sourcePdfBase64,
          targetSrc,
          1.35
        );
        if (!cancelled) {
          setOrigPreviewUrl(url || meta?.previewImageDataUrl || null);
        }
      } else {
        setOrigPreviewUrl(meta?.previewImageDataUrl || null);
      }
    };

    void renderLeft();
    return () => {
      cancelled = true;
    };
  }, [
    scopeMode,
    currentPage,
    project.id,
    project.originalPages,
    project.sourcePdfBase64,
    snapLeftIdx,
    versions,
    customFonts,
  ]);

  // Render Right/Edited or Snapshot B preview (debounced to avoid regenerating PDF on every keystroke)
  useEffect(() => {
    if (scopeMode === 'two_pdfs') return;
    let cancelled = false;
    setRenderingEdited(true);
    const timer = window.setTimeout(() => {
      const run = async () => {
        try {
          const targetSnap =
            scopeMode === 'snapshot_vs_snapshot' ? versions[snapRightIdx] : undefined;
          const tempProj: PDFProject = {
            ...project,
            ...(targetSnap
              ? {
                  elements: targetSnap.elementsSnapshot,
                  pageConfig: targetSnap.pageConfigSnapshot,
                }
              : {}),
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
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    scopeMode,
    currentPage,
    project,
    customFonts,
    snapRightIdx,
    versions,
  ]);

  // Compare two external PDFs when both are loaded
  useEffect(() => {
    if (scopeMode !== 'two_pdfs' || !extPdfA || !extPdfB) return;
    let cancelled = false;
    setComparingExt(true);
    void compareExternalPdfBytes(extPdfA.bytes, extPdfB.bytes)
      .then((res) => {
        if (!cancelled) setExtComparison(res);
      })
      .finally(() => {
        if (!cancelled) setComparingExt(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scopeMode, extPdfA, extPdfB]);

  // Render selected page of External PDF A & B
  useEffect(() => {
    if (scopeMode !== 'two_pdfs') return;
    let cancelled = false;
    if (extPdfA) {
      void renderSinglePagePreview(extPdfA.b64, currentPage, 1.35).then((url) => {
        if (!cancelled) setExtPreviewA(url);
      });
    } else {
      setExtPreviewA(null);
    }
    if (extPdfB) {
      void renderSinglePagePreview(extPdfB.b64, currentPage, 1.35).then((url) => {
        if (!cancelled) setExtPreviewB(url);
      });
    } else {
      setExtPreviewB(null);
    }
    return () => {
      cancelled = true;
    };
  }, [scopeMode, currentPage, extPdfA, extPdfB]);

  const handleUploadExternalPdf = async (
    slot: 'A' | 'B',
    file: File | undefined
  ) => {
    if (!file) return;
    setExtError(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const b64 = uint8ArrayToBase64(bytes);
      if (slot === 'A') setExtPdfA({ name: file.name, b64, bytes });
      else setExtPdfB({ name: file.name, b64, bytes });
    } catch (err) {
      setExtError(err instanceof Error ? err.message : `Failed to load PDF ${slot}`);
    } finally {
      if (slot === 'A' && fileARef.current) fileARef.current.value = '';
      if (slot === 'B' && fileBRef.current) fileBRef.current.value = '';
    }
  };

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

  const leftDisplayUrl = scopeMode === 'two_pdfs' ? extPreviewA : origPreviewUrl;
  const rightDisplayUrl = scopeMode === 'two_pdfs' ? extPreviewB : editedPreviewUrl;
  const currentExtPageDiff = extComparison?.pages.find(
    (p) => p.pageNumber === currentPage
  );

  return (
    <div className="flex-1 overflow-y-auto p-4 tablet:p-6 desktop:p-8 max-w-7xl mx-auto w-full space-y-5">
      <input
        ref={fileARef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => void handleUploadExternalPdf('A', e.target.files?.[0])}
      />
      <input
        ref={fileBRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => void handleUploadExternalPdf('B', e.target.files?.[0])}
      />

      {/* Header */}
      <div className="flex flex-col tablet:flex-row tablet:items-center justify-between gap-4 pb-5 border-b border-black/10 dark:border-white/12">
        <div>
          <h1 className="text-xl tablet:text-2xl font-display font-semibold tracking-tight text-[#101010] dark:text-white">
            Document Comparison Studio
          </h1>
          <p className="mt-1 text-xs tablet:text-sm text-[#555555] dark:text-[#B5B5B5]">
            Compare Original vs Edited, any two Snapshot Versions, or two external PDF files side-by-side or overlaid.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <GlassSegmentedControl
            value={scopeMode}
            onChange={setScopeMode}
            options={[
              { value: 'original_vs_edited', label: 'Orig vs Edited' },
              { value: 'snapshot_vs_snapshot', label: 'Snapshots' },
              { value: 'two_pdfs', label: 'Two PDFs' },
            ]}
          />

          <LayoutGroup id={`compare-mode-${modeGroupId}`}>
            <div className="inline-flex rounded-xl glass-level-2 border border-black/12 dark:border-white/12 p-0.5">
              <button
                type="button"
                onClick={() => setViewMode('side_by_side')}
                className={`relative min-h-[36px] px-3 py-1 rounded-lg font-medium flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                  viewMode === 'side_by_side'
                    ? 'text-white dark:text-[#050505]'
                    : 'text-[#555555] dark:text-[#B5B5B5] hover:text-[#101010] dark:hover:text-white'
                }`}
              >
                {viewMode === 'side_by_side' && (
                  <motion.span
                    layoutId={`compare-mode-pill-${modeGroupId}`}
                    transition={shouldReduceMotion ? { duration: 0.08 } : MOTION_SPRING.nav}
                    className="absolute inset-0 rounded-lg bg-[#101010] dark:bg-white shadow-sm"
                  />
                )}
                <Columns2 className="relative z-10 w-3.5 h-3.5" />
                <span className="relative z-10">Side-by-Side</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('overlay')}
                className={`relative min-h-[36px] px-3 py-1 rounded-lg font-medium flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                  viewMode === 'overlay'
                    ? 'text-white dark:text-[#050505]'
                    : 'text-[#555555] dark:text-[#B5B5B5] hover:text-[#101010] dark:hover:text-white'
                }`}
              >
                {viewMode === 'overlay' && (
                  <motion.span
                    layoutId={`compare-mode-pill-${modeGroupId}`}
                    transition={shouldReduceMotion ? { duration: 0.08 } : MOTION_SPRING.nav}
                    className="absolute inset-0 rounded-lg bg-[#101010] dark:bg-white shadow-sm"
                  />
                )}
                <Layers className="relative z-10 w-3.5 h-3.5" />
                <span className="relative z-10">Overlay Diff</span>
              </button>
            </div>
          </LayoutGroup>

          <div className="flex items-center gap-1 border border-black/12 dark:border-white/12 glass-level-2 rounded-xl px-2 py-1 text-[#101010] dark:text-white">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="p-1.5 disabled:opacity-35"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="tabular-nums font-medium px-1">
              Page {currentPage} / {maxPageCount}
            </span>
            <button
              type="button"
              disabled={currentPage >= maxPageCount}
              onClick={() => setCurrentPage((p) => Math.min(maxPageCount, p + 1))}
              className="p-1.5 disabled:opacity-35"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Mode-Specific Controls */}
      {scopeMode === 'original_vs_edited' && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-[#555555] dark:text-[#B5B5B5]">Baseline:</span>
          <select
            value={baselineIdx === 'original' ? 'original' : String(baselineIdx)}
            onChange={(e) =>
              setBaselineIdx(
                e.target.value === 'original' ? 'original' : Number(e.target.value)
              )
            }
            className="min-h-[36px] px-2.5 py-1 rounded-xl studio-select"
          >
            <option value="original">Reference: Original PDF</option>
            {versions.map((v, idx) => (
              <option key={`${v.version}-${idx}`} value={idx}>
                Snapshot v{v.version} ({v.note})
              </option>
            ))}
          </select>
        </div>
      )}

      {scopeMode === 'snapshot_vs_snapshot' && (
        <GlassCard level={2} padding="sm" className="flex flex-wrap items-center gap-3 text-xs">
          {versions.length < 1 ? (
            <span className="text-[#555555] dark:text-[#B5B5B5]">
              Save at least one version snapshot in the Editor to compare historical versions side-by-side.
            </span>
          ) : (
            <>
              <label className="flex items-center gap-2">
                <span className="text-[#555555] dark:text-[#B5B5B5]">Left Snapshot:</span>
                <select
                  value={snapLeftIdx}
                  onChange={(e) => setSnapLeftIdx(Number(e.target.value))}
                  className="min-h-[36px] px-2.5 py-1 rounded-xl studio-select"
                >
                  {versions.map((v, idx) => (
                    <option key={`l-${idx}`} value={idx}>
                      v{v.version} — {v.note}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2">
                <span className="text-[#555555] dark:text-[#B5B5B5]">Right Snapshot:</span>
                <select
                  value={snapRightIdx}
                  onChange={(e) => setSnapRightIdx(Number(e.target.value))}
                  className="min-h-[36px] px-2.5 py-1 rounded-xl studio-select"
                >
                  {versions.map((v, idx) => (
                    <option key={`r-${idx}`} value={idx}>
                      v{v.version} — {v.note}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
        </GlassCard>
      )}

      {scopeMode === 'two_pdfs' && (
        <GlassCard level={2} padding="sm" className="space-y-2 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <GlassButton
                variant="glass"
                size="sm"
                onClick={() => fileARef.current?.click()}
              >
                <FileUp className="w-3.5 h-3.5" />
                {extPdfA ? `PDF A: ${extPdfA.name}` : 'Upload PDF A'}
              </GlassButton>
              <GlassButton
                variant="glass"
                size="sm"
                onClick={() => fileBRef.current?.click()}
              >
                <FileUp className="w-3.5 h-3.5" />
                {extPdfB ? `PDF B: ${extPdfB.name}` : 'Upload PDF B'}
              </GlassButton>
              {comparingExt && (
                <span className="flex items-center gap-1 text-[#888888]">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Comparing PDFs...
                </span>
              )}
            </div>
            {extComparison && (
              <div className="flex items-center gap-3 tabular-nums text-[11px] text-[#555555] dark:text-[#B5B5B5]">
                <span>A: {extComparison.leftPageCount} pg</span>
                <span>B: {extComparison.rightPageCount} pg</span>
                <span className="font-semibold text-[#101010] dark:text-white">
                  +{extComparison.totalAddedLines} added / -{extComparison.totalRemovedLines} removed lines
                </span>
              </div>
            )}
          </div>
          {extError && (
            <div className="p-2 rounded-lg border border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400">
              {extError}
            </div>
          )}
        </GlassCard>
      )}

      {/* Diff Counters */}
      {scopeMode !== 'two_pdfs' ? (
        <div className="grid grid-cols-2 tablet:grid-cols-5 gap-3 text-xs tabular-nums">
          <GlassCard level={3} padding="sm">
            <div className="text-[11px] text-[#888888] dark:text-[#858585]">Modified Elements</div>
            <div className="mt-0.5 text-lg font-semibold text-[#101010] dark:text-white">
              {summary.modifiedCount}
            </div>
          </GlassCard>
          <GlassCard level={3} padding="sm">
            <div className="text-[11px] text-[#888888] dark:text-[#858585]">Added Elements</div>
            <div className="mt-0.5 text-lg font-semibold text-[#101010] dark:text-white">
              {summary.addedCount}
            </div>
          </GlassCard>
          <GlassCard level={3} padding="sm">
            <div className="text-[11px] text-[#888888] dark:text-[#858585]">Removed / Masked</div>
            <div className="mt-0.5 text-lg font-semibold text-[#555555] dark:text-[#B5B5B5]">
              {summary.removedCount}
            </div>
          </GlassCard>
          <GlassCard level={3} padding="sm">
            <div className="text-[11px] text-[#888888] dark:text-[#858585]">Large Visual Shifts</div>
            <div className="mt-0.5 text-lg font-semibold text-[#101010] dark:text-white">
              {summary.unexpectedDiffCount}
            </div>
          </GlassCard>
          <GlassCard level={3} padding="sm">
            <div className="text-[11px] text-[#888888] dark:text-[#858585]">Page Geometry</div>
            <div className="mt-0.5 text-sm font-semibold text-[#101010] dark:text-white">
              {summary.pageSizeChanged ? 'Resized' : 'Original Match'}
            </div>
          </GlassCard>
        </div>
      ) : (
        currentExtPageDiff && (
          <div className="grid grid-cols-2 tablet:grid-cols-4 gap-3 text-xs tabular-nums">
            <GlassCard level={3} padding="sm">
              <div className="text-[11px] text-[#888888]">PDF A Size</div>
              <div className="mt-0.5 text-sm font-semibold text-[#101010] dark:text-white">
                {currentExtPageDiff.leftDimPt
                  ? `${currentExtPageDiff.leftDimPt.width}×${currentExtPageDiff.leftDimPt.height} pt`
                  : 'N/A'}
              </div>
            </GlassCard>
            <GlassCard level={3} padding="sm">
              <div className="text-[11px] text-[#888888]">PDF B Size</div>
              <div className="mt-0.5 text-sm font-semibold text-[#101010] dark:text-white">
                {currentExtPageDiff.rightDimPt
                  ? `${currentExtPageDiff.rightDimPt.width}×${currentExtPageDiff.rightDimPt.height} pt`
                  : 'N/A'}
              </div>
            </GlassCard>
            <GlassCard level={3} padding="sm">
              <div className="text-[11px] text-[#888888]">Added Text Lines</div>
              <div className="mt-0.5 text-lg font-semibold text-[#101010] dark:text-white">
                {currentExtPageDiff.addedLines.length}
              </div>
            </GlassCard>
            <GlassCard level={3} padding="sm">
              <div className="text-[11px] text-[#888888]">Removed Text Lines</div>
              <div className="mt-0.5 text-lg font-semibold text-[#555555] dark:text-[#B5B5B5]">
                {currentExtPageDiff.removedLines.length}
              </div>
            </GlassCard>
          </div>
        )
      )}

      {/* Visual Viewport */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={`${scopeMode}-${viewMode}`}
          initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -3 }}
          transition={{ duration: MOTION_DURATION.fast, ease: MOTION_EASE.liquid }}
        >
          {viewMode === 'side_by_side' ? (
            <div className="grid grid-cols-1 desktop:grid-cols-2 gap-4">
              <GlassCard level={3} padding="none" className="overflow-hidden">
                <div className="px-4 py-2.5 border-b border-black/10 dark:border-white/12 flex items-center justify-between text-xs font-semibold text-[#101010] dark:text-white">
                  <span>
                    {scopeMode === 'two_pdfs'
                      ? `PDF A (${extPdfA?.name || 'Not loaded'})`
                      : scopeMode === 'snapshot_vs_snapshot'
                      ? `Left Snapshot (Page ${currentPage})`
                      : `Original Reference PDF (Page ${currentPage})`}
                  </span>
                  <span className="text-[11px] font-normal text-[#888888] dark:text-[#858585] tabular-nums">
                    {Math.round(refW)}×{Math.round(refH)} pt
                  </span>
                </div>
                <div className="p-4 bg-[#EFEFEF] dark:bg-[#0B0B0B] flex justify-center min-h-[380px]">
                  <div className="relative inline-block shadow-lg border border-black/15 dark:border-white/15 bg-white">
                    {leftDisplayUrl ? (
                      <img
                        src={leftDisplayUrl}
                        alt="Left comparison document"
                        className="max-h-[520px] w-auto object-contain block"
                      />
                    ) : (
                      <div className="w-80 h-[420px] flex items-center justify-center text-xs text-[#888888]">
                        {scopeMode === 'two_pdfs'
                          ? 'Upload PDF A to preview'
                          : 'Blank Reference Document'}
                      </div>
                    )}
                  </div>
                </div>
              </GlassCard>

              <GlassCard level={3} padding="none" className="overflow-hidden">
                <div className="px-4 py-2.5 border-b border-black/10 dark:border-white/12 flex items-center justify-between text-xs font-semibold text-[#101010] dark:text-white">
                  <span>
                    {scopeMode === 'two_pdfs'
                      ? `PDF B (${extPdfB?.name || 'Not loaded'})`
                      : scopeMode === 'snapshot_vs_snapshot'
                      ? `Right Snapshot (Page ${currentPage})`
                      : `Edited Production Output (Page ${currentPage})`}
                  </span>
                  <span className="text-[11px] font-normal text-[#888888] dark:text-[#858585] tabular-nums">
                    {Math.round(project.pageConfig.widthPt)}×
                    {Math.round(project.pageConfig.heightPt)} pt
                  </span>
                </div>
                <div className="p-4 bg-[#EFEFEF] dark:bg-[#0B0B0B] flex justify-center min-h-[380px] relative">
                  <AnimatePresence>
                    {renderingEdited && scopeMode !== 'two_pdfs' && (
                      <motion.div
                        key="rendering-edited-badge"
                        variants={toastVariants}
                        initial={shouldReduceMotion ? false : 'initial'}
                        animate="animate"
                        exit="exit"
                        className="absolute top-3 right-3 z-10 flex items-center gap-1.5 text-[11px] text-[#101010] dark:text-white glass-level-4 px-2.5 py-1 rounded-xl border border-black/15 dark:border-white/15"
                      >
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Rendering PDF...
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <div className="relative inline-block shadow-lg border border-black/15 dark:border-white/15 bg-white">
                    {rightDisplayUrl ? (
                      <img
                        src={rightDisplayUrl}
                        alt="Right comparison document"
                        className="max-h-[520px] w-auto object-contain block"
                      />
                    ) : (
                      <div className="w-80 h-[420px] flex items-center justify-center text-xs text-[#888888]">
                        {scopeMode === 'two_pdfs'
                          ? 'Upload PDF B to preview'
                          : 'Preview unavailable'}
                      </div>
                    )}
                  </div>
                </div>
              </GlassCard>
            </div>
          ) : (
            <GlassCard level={3} padding="none" className="overflow-hidden">
              <div className="px-4 py-2.5 border-b border-black/10 dark:border-white/12 flex flex-wrap items-center justify-between gap-3 text-xs">
                <span className="font-semibold text-[#101010] dark:text-white">
                  Normalized Overlay Comparison
                </span>
                <label className="flex items-center gap-2">
                  <span className="text-[#888888] dark:text-[#858585]">
                    Top Layer Opacity:
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={overlayOpacity}
                    onChange={(e) => setOverlayOpacity(Number(e.target.value))}
                    className="w-32 accent-[#101010] dark:accent-white"
                  />
                  <span className="tabular-nums font-mono w-10 text-right text-[#101010] dark:text-white">
                    {Math.round(overlayOpacity * 100)}%
                  </span>
                </label>
              </div>
              <div className="p-6 bg-[#EFEFEF] dark:bg-[#0B0B0B] flex justify-center">
                <div className="relative inline-block shadow-xl border border-black/15 dark:border-white/15 bg-white">
                  {leftDisplayUrl && (
                    <img
                      src={leftDisplayUrl}
                      alt="Base reference layer"
                      className="max-h-[560px] w-auto object-contain block"
                    />
                  )}
                  {rightDisplayUrl && (
                    <img
                      src={rightDisplayUrl}
                      alt="Comparison overlay layer"
                      style={{ opacity: overlayOpacity }}
                      className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                    />
                  )}
                  {scopeMode !== 'two_pdfs' &&
                    visibleDiffs
                      .filter((d) => d.status !== 'unchanged')
                      .map((d) => {
                        const box = d.editedElement || d.originalElement;
                        if (!box || refW <= 0 || refH <= 0) return null;
                        const borderClass =
                          d.status === 'added'
                            ? 'border-[#101010] bg-black/10'
                            : d.status === 'removed'
                            ? 'border-dotted border-[#858585] bg-black/10'
                            : 'border-dashed border-[#404040] bg-black/15';
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
                            className={`absolute border-2 ${borderClass} hover:ring-2 hover:ring-[#101010] transition-all`}
                          />
                        );
                      })}
                </div>
              </div>
            </GlassCard>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Diff Breakdown Table */}
      {scopeMode !== 'two_pdfs' ? (
        <GlassCard level={3} padding="none" className="overflow-hidden">
          <div className="px-4 py-3 border-b border-black/10 dark:border-white/12 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 font-semibold text-[#101010] dark:text-white">
              <GitCompare className="w-4 h-4 text-[#101010] dark:text-white" />
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

          <div className="divide-y divide-black/10 dark:divide-white/10 max-h-72 overflow-y-auto text-xs">
            {visibleDiffs.length === 0 ? (
              <div className="p-6 text-center text-[#555555] dark:text-[#B5B5B5]">
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
                            ? 'text-[#101010] dark:text-white'
                            : d.status === 'removed'
                            ? 'text-[#888888] dark:text-[#858585] line-through'
                            : d.status === 'modified'
                            ? 'text-[#555555] dark:text-[#B5B5B5]'
                            : 'text-[#888888] dark:text-[#858585]'
                        }`}
                      >
                        {d.status}
                      </span>
                      <span className="font-medium text-[#101010] dark:text-white truncate max-w-md">
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
                      <div className="text-[11px] text-[#555555] dark:text-[#B5B5B5] mt-0.5">
                        {d.reasons.join(' · ')}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onInspectElement(d.pageNumber, d.id)}
                    className="px-2.5 py-1 rounded-lg border border-black/15 dark:border-white/15 text-[#101010] dark:text-white hover:bg-black/[0.05] dark:hover:bg-white/[0.08] font-medium shrink-0 transition-colors"
                  >
                    Open in Editor
                  </button>
                </div>
              ))
            )}
          </div>
        </GlassCard>
      ) : (
        currentExtPageDiff && (
          <GlassCard level={3} padding="none" className="overflow-hidden text-xs">
            <div className="px-4 py-3 border-b border-black/10 dark:border-white/12 font-semibold text-[#101010] dark:text-white">
              Page {currentPage} Text Content Differences
            </div>
            <div className="grid grid-cols-1 tablet:grid-cols-2 divide-y tablet:divide-y-0 tablet:divide-x divide-black/10 dark:divide-white/10 max-h-64 overflow-y-auto">
              <div className="p-3 space-y-1">
                <div className="text-[11px] font-semibold text-[#888888]">
                  Removed from PDF A ({currentExtPageDiff.removedLines.length})
                </div>
                {currentExtPageDiff.removedLines.length === 0 ? (
                  <div className="text-[#888888]">None</div>
                ) : (
                  currentExtPageDiff.removedLines.map((line, i) => (
                    <div
                      key={i}
                      className="px-2 py-1 rounded bg-black/5 dark:bg-white/5 text-[#555555] dark:text-[#B5B5B5] line-through"
                    >
                      {line}
                    </div>
                  ))
                )}
              </div>
              <div className="p-3 space-y-1">
                <div className="text-[11px] font-semibold text-[#888888]">
                  Added in PDF B ({currentExtPageDiff.addedLines.length})
                </div>
                {currentExtPageDiff.addedLines.length === 0 ? (
                  <div className="text-[#888888]">None</div>
                ) : (
                  currentExtPageDiff.addedLines.map((line, i) => (
                    <div
                      key={i}
                      className="px-2 py-1 rounded bg-black/10 dark:bg-white/12 text-[#101010] dark:text-white font-medium"
                    >
                      {line}
                    </div>
                  ))
                )}
              </div>
            </div>
          </GlassCard>
        )
      )}
    </div>
  );
};
