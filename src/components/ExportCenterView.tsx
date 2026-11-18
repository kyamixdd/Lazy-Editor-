import React, { useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FolderOpen,
  Layers,
  Loader2,
  Maximize2,
  ShieldCheck,
  Upload,
  Wrench,
} from 'lucide-react';
import { PDFDocument } from 'pdf-lib';
import {
  bannerVariants,
  BUTTON_TAP,
  MOTION_EASE,
  MOTION_SPRING,
  popoverVariants,
} from '../config/motionSystem';
import {
  AssetFontItem,
  BatchJob,
  ExportConfig,
  ExportMode,
  PageConfig,
  PDFProject,
  ValidationIssue,
} from '../types/pdfStudio';
import { generateExportBytes } from '../utils/pdfExporter';
import {
  renderPdfPagesForStudio,
  renderSinglePagePreview,
  uint8ArrayToBase64,
} from '../utils/pdfRenderer';
import { computeSheetLayout, normalizeFitConfig } from '../utils/geometryEngine';
import {
  createDefaultBulkConfig,
  createDefaultCopiesConfig,
  createDefaultExportConfig,
  createDefaultFitConfig,
  createDefaultPageConfig,
  ptToUnit,
} from '../utils/units';
import { validateProject } from '../utils/validationEngine';
import { GlassButton, GlassCard } from './glass';
import { PageConfigurationModal } from './PageConfigurationModal';

interface ExportCenterViewProps {
  project: PDFProject;
  customFonts?: AssetFontItem[];
  onUpdateProject: (updated: PDFProject) => void;
  onJumpToEditor: () => void;
  onInspectElement?: (pageNumber: number, elementId?: string) => void;
  onReopenAsProject: (proj: PDFProject) => void;
  onEnqueueBatch?: (proj: PDFProject) => void;
  onRecordExportActivity?: (job: BatchJob) => void;
}

const EXPORT_MODES: Array<{ id: ExportMode; label: string; desc: string }> = [
  { id: 'standard', label: 'Standard PDF', desc: 'Balanced vector PDF preserving original layers' },
  { id: 'high_quality', label: 'High-Quality PDF', desc: 'Uncompressed crisp vector & 300+ DPI assets' },
  { id: 'print_ready', label: 'Print-Ready PDF', desc: 'Includes bleed margin and press crop marks' },
  { id: 'flattened', label: 'Flattened PDF', desc: 'Rasterizes pages at selected DPI (non-editable)' },
  { id: 'editable', label: 'Editable PDF', desc: 'Retains uncompressed streams for external editors' },
  { id: 'individual_pages', label: 'Individual Page Exports (ZIP)', desc: 'One standalone PDF file per output page' },
  { id: 'separate_documents', label: 'Separate Document Exports (ZIP)', desc: 'One PDF per receipt/copy record' },
  { id: 'merge', label: 'Merge PDFs', desc: 'Append additional PDF files onto this output' },
  { id: 'compress', label: 'Compress PDF', desc: 'Optimize file size for email and web sharing' },
  { id: 'selected_pages', label: 'Selected-Page Export', desc: 'Export only specified page ranges (e.g. 1-3, 5)' },
];

export const ExportCenterView: React.FC<ExportCenterViewProps> = ({
  project,
  customFonts = [],
  onUpdateProject,
  onJumpToEditor,
  onInspectElement,
  onReopenAsProject,
  onEnqueueBatch,
  onRecordExportActivity,
}) => {
  const shouldReduceMotion = useReducedMotion();
  const { exportConfig } = project;
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState({ stage: '', current: 0, total: 1 });
  const [exportError, setExportError] = useState<string | null>(null);
  const [lastExportUrl, setLastExportUrl] = useState<{
    url: string;
    fileName: string;
    mimeType: string;
    bytes: Uint8Array;
    verifiedPageCount?: number;
    verifiedWidthPt?: number;
    verifiedHeightPt?: number;
  } | null>(null);
  const [previewPageNum, setPreviewPageNum] = useState(1);
  const [previewPageImg, setPreviewPageImg] = useState<string | null>(null);
  const [isReopening, setIsReopening] = useState(false);
  const [showPageSetupModal, setShowPageSetupModal] = useState(false);
  const [mergeFiles, setMergeFiles] = useState<Array<{ name: string; bytes: Uint8Array }>>([]);
  const mergeInputRef = useRef<HTMLInputElement>(null);

  const issues = useMemo(
    () => validateProject(project, customFonts),
    [project, customFonts]
  );
  const layoutSummary = useMemo(() => computeSheetLayout(project, 1), [project]);
  const errorIssues = issues.filter((i) => i.severity === 'error');
  const warningIssues = issues.filter((i) => i.severity === 'warning');

  const updateExport = (patch: Partial<ExportConfig>) => {
    onUpdateProject({
      ...project,
      exportConfig: { ...exportConfig, ...patch },
      updatedAt: new Date().toISOString(),
    });
  };

  const handleAutoFix = (issue: ValidationIssue) => {
    if (issue.category === 'out_of_bounds' && issue.elementId) {
      onUpdateProject({
        ...project,
        elements: project.elements.map((el) => {
          if (el.id !== issue.elementId) return el;
          const meta = project.originalPages.find(
            (p) => p.pageNumber === el.pageNumber
          );
          const tplW = meta?.widthPt || project.pageConfig.widthPt;
          const tplH = meta?.heightPt || project.pageConfig.heightPt;
          return {
            ...el,
            x: Math.max(0, Math.min(el.x, tplW - el.width)),
            y: Math.max(0, Math.min(el.y, tplH - el.height)),
            eraseOriginal: el.isUserAdded ? false : true,
          };
        }),
      });
    } else if (issue.category === 'text_overflow' && issue.elementId) {
      onUpdateProject({
        ...project,
        elements: project.elements.map((el) =>
          el.id === issue.elementId
            ? { ...el, height: el.height + 16 }
            : el
        ),
      });
    } else if (issue.category === 'page_dimensions') {
      const safeMargin = Math.min(
        18,
        Math.floor(
          Math.min(project.pageConfig.widthPt, project.pageConfig.heightPt) * 0.1
        )
      );
      onUpdateProject({
        ...project,
        pageConfig: {
          ...project.pageConfig,
          marginTopPt: safeMargin,
          marginBottomPt: safeMargin,
          marginLeftPt: safeMargin,
          marginRightPt: safeMargin,
        },
      });
    } else if (issue.autoFixLabel === 'Reset Crop') {
      const p1 = project.originalPages[0];
      const w = p1?.widthPt || project.pageConfig.widthPt;
      const h = p1?.heightPt || project.pageConfig.heightPt;
      const currFit = normalizeFitConfig(project);
      onUpdateProject({
        ...project,
        fitConfig: {
          ...currFit,
          boundaryMode: 'original_page',
          customCropRect: { x: 0, y: 0, width: w, height: h },
        },
      });
    } else if (issue.autoFixLabel === 'Enable Fit-to-Page') {
      const currFit = normalizeFitConfig(project);
      onUpdateProject({
        ...project,
        fitConfig: {
          ...currFit,
          scalingMode: 'auto_fit_aspect',
        },
        copiesConfig: {
          ...project.copiesConfig,
          fitToPage: true,
          outerMarginTopPt: 18,
          outerMarginRightPt: 18,
          outerMarginBottomPt: 18,
          outerMarginLeftPt: 18,
          horizontalSpacingPt: Math.min(project.copiesConfig.horizontalSpacingPt, 14),
          verticalSpacingPt: Math.min(project.copiesConfig.verticalSpacingPt, 14),
        },
      });
    } else if (issue.category === 'layout_drift' && issue.elementId) {
      onUpdateProject({
        ...project,
        elements: project.elements.map((el) =>
          el.id === issue.elementId && el.sourceOriginalRect
            ? {
                ...el,
                x: el.sourceOriginalRect.x,
                y: el.sourceOriginalRect.y,
                width: el.sourceOriginalRect.width,
                height: el.sourceOriginalRect.height,
                eraseOriginal: false,
              }
            : el
        ),
      });
    } else if (issue.category === 'font_substitution') {
      updateExport({ embedFonts: true });
    }
  };

  const handleMergeFilesPicked = async (files: FileList | null) => {
    if (!files) return;
    const list: Array<{ name: string; bytes: Uint8Array }> = [];
    for (const f of Array.from(files)) {
      const buf = await f.arrayBuffer();
      list.push({ name: f.name, bytes: new Uint8Array(buf) });
    }
    setMergeFiles((prev) => [...prev, ...list]);
  };

  const loadExportedPreviewPage = async (bytes: Uint8Array, pageNum: number) => {
    const base64 = uint8ArrayToBase64(bytes);
    const img = await renderSinglePagePreview(base64, pageNum, 1.2);
    setPreviewPageImg(img);
    setPreviewPageNum(pageNum);
  };

  const handleExport = async () => {
    if (errorIssues.length > 0) return;
    setExportError(null);
    setIsExporting(true);
    setExportProgress({ stage: 'Preparing PDF export', current: 0, total: 1 });
    const startedAt = new Date().toISOString();

    try {
      const result = await generateExportBytes(project, {
        extraMergePdfBytes: mergeFiles.map((m) => m.bytes),
        customFonts,
        onProgress: (stage, current, total) => {
          setExportProgress({ stage, current, total });
        },
      });

      const blob = new Blob([result.data.slice().buffer], {
        type: result.mimeType,
      });
      if (lastExportUrl) URL.revokeObjectURL(lastExportUrl.url);
      const url = URL.createObjectURL(blob);

      let verifiedPageCount: number | undefined;
      let verifiedWidthPt: number | undefined;
      let verifiedHeightPt: number | undefined;

      if (result.mimeType === 'application/pdf') {
        const parsed = await PDFDocument.load(result.data);
        verifiedPageCount = parsed.getPageCount();
        const firstPg = parsed.getPage(0);
        const sz = firstPg.getSize();
        verifiedWidthPt = Number(sz.width.toFixed(2));
        verifiedHeightPt = Number(sz.height.toFixed(2));
        await loadExportedPreviewPage(result.data, 1);
      } else {
        setPreviewPageImg(null);
      }

      setLastExportUrl({
        url,
        fileName: result.fileName,
        mimeType: result.mimeType,
        bytes: result.data,
        verifiedPageCount,
        verifiedWidthPt,
        verifiedHeightPt,
      });

      onRecordExportActivity?.({
        id: `exp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        projectId: project.id,
        projectName: project.name,
        status: 'completed',
        progressCurrent: verifiedPageCount || 1,
        progressTotal: verifiedPageCount || 1,
        stage: `Exported (${exportConfig.mode.replace(/_/g, ' ')})`,
        outputFileName: result.fileName,
        outputMimeType: result.mimeType,
        outputSizeBytes: result.data.byteLength,
        createdAt: startedAt,
        startedAt,
        completedAt: new Date().toISOString(),
      });

      const a = document.createElement('a');
      a.href = url;
      a.download = result.fileName;
      a.click();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'PDF export failed';
      setExportError(message);
      onRecordExportActivity?.({
        id: `exp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        projectId: project.id,
        projectName: project.name,
        status: 'failed',
        progressCurrent: 0,
        progressTotal: 1,
        stage: `Export failed (${exportConfig.mode.replace(/_/g, ' ')})`,
        error: message,
        createdAt: startedAt,
        startedAt,
        completedAt: new Date().toISOString(),
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleReopenExportedPdf = async () => {
    if (!lastExportUrl || lastExportUrl.mimeType !== 'application/pdf') return;
    setIsReopening(true);
    try {
      const rendered = await renderPdfPagesForStudio(lastExportUrl.bytes, {
        renderScale: 1.5,
        enableOcrFallback: false,
        maxPagesForAi: 10,
      });
      const firstPage = rendered.originalPages[0] || {
        pageNumber: 1,
        widthPt: lastExportUrl.verifiedWidthPt || project.pageConfig.widthPt,
        heightPt: lastExportUrl.verifiedHeightPt || project.pageConfig.heightPt,
        orientation: project.pageConfig.orientation,
      };
      const base64 = uint8ArrayToBase64(lastExportUrl.bytes);
      const now = new Date().toISOString();
      const reopened: PDFProject = {
        id: `proj-exp-${Date.now()}`,
        name: `${project.name} (Exported Validation)`,
        description: `Reopened exported PDF (${rendered.pageCount} pages)`,
        version: 1,
        createdAt: now,
        updatedAt: now,
        sourcePdfName: lastExportUrl.fileName,
        sourcePdfBase64: base64,
        pageCount: rendered.pageCount,
        originalPages: rendered.originalPages,
        elements: rendered.pages.flatMap((p) =>
          p.extractedTextItems.map((item, idx) => ({
            id: `reopen-p${p.pageNumber}-${idx}`,
            type: 'text' as const,
            pageNumber: p.pageNumber,
            x: item.x,
            y: item.y,
            width: item.width,
            height: item.height,
            rotation: 0,
            text: item.text,
            fontFamily: 'Helvetica',
            fontSize: item.fontSize,
            fontWeight: 'normal' as const,
            fontStyle: 'normal' as const,
            color: '#111827',
            backgroundColor: 'transparent',
            align: 'left' as const,
            opacity: 1,
            editable: true,
            locked: false,
            visible: true,
            confidence: 1,
            needsReview: false,
            sourceOriginalRect: {
              x: item.x,
              y: item.y,
              width: item.width,
              height: item.height,
            },
          }))
        ),
        pageConfig: createDefaultPageConfig(
          firstPage.widthPt,
          firstPage.heightPt,
          project.pageConfig.unit
        ),
        fitConfig: createDefaultFitConfig(firstPage.widthPt, firstPage.heightPt),
        copiesConfig: createDefaultCopiesConfig(),
        serialRules: [],
        bulkConfig: createDefaultBulkConfig(),
        dataColumns: [],
        dataRows: [],
        exportConfig: createDefaultExportConfig(),
        isTemplate: false,
        versions: [],
      };
      onReopenAsProject(reopened);
    } catch (err) {
      setExportError(
        err instanceof Error ? err.message : 'Failed to reopen exported PDF'
      );
    } finally {
      setIsReopening(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 tablet:p-6 desktop:p-8 max-w-6xl mx-auto w-full space-y-5 tablet:space-y-6">
      {/* Header */}
      <div className="flex flex-col tablet:flex-row tablet:items-center tablet:justify-between gap-4 pb-5 border-b border-black/10 dark:border-white/12">
        <div>
          <h1 className="text-xl tablet:text-2xl font-display font-semibold tracking-tight text-[#101010] dark:text-white">
            Export Center & Quality Control
          </h1>
          <p className="mt-1 text-xs tablet:text-sm text-[#555555] dark:text-[#B5B5B5]">
            Validate layout geometry, serial sequences, and page boundaries before generating production PDF outputs.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {onEnqueueBatch && (
            <GlassButton
              variant="glass"
              size="md"
              onClick={() => onEnqueueBatch(project)}
            >
              <Layers className="w-3.5 h-3.5" />
              Add to Batch Queue
            </GlassButton>
          )}
          <GlassButton
            variant="glass"
            size="md"
            onClick={() => setShowPageSetupModal(true)}
          >
            <Maximize2 className="w-3.5 h-3.5" />
            Page Setup ({project.pageConfig.customPresetName || project.pageConfig.sizePreset})
          </GlassButton>
          <GlassButton
            variant="primary"
            size="md"
            disabled={isExporting || errorIssues.length > 0}
            onClick={() => void handleExport()}
          >
            {isExporting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            {isExporting ? 'Generating PDF...' : 'Generate & Download'}
          </GlassButton>
        </div>
      </div>

      {/* Quality Control Panel */}
      <GlassCard level={3} padding="none" className="overflow-hidden">
        <div className="px-4 tablet:px-5 py-3.5 border-b border-black/10 dark:border-white/12 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-[#101010] dark:text-white">
            <ShieldCheck className="w-4 h-4 text-[#101010] dark:text-white" />
            Pre-Export Quality Control Check
          </div>
          <div className="text-xs tabular-nums">
            {errorIssues.length === 0 && warningIssues.length === 0 ? (
              <span className="text-[#101010] dark:text-white flex items-center gap-1.5 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" />
                All 10 integrity checks passed
              </span>
            ) : (
              <span className="text-[#555555] dark:text-[#B5B5B5]">
                {errorIssues.length} errors · {warningIssues.length} warnings
              </span>
            )}
          </div>
        </div>

        {issues.length > 0 && (
          <div className="divide-y divide-black/10 dark:divide-white/10 max-h-64 overflow-y-auto">
            {issues.map((issue) => (
              <div
                key={issue.id}
                className="px-4 tablet:px-5 py-3 flex flex-col tablet:flex-row tablet:items-center justify-between gap-2.5 tablet:gap-4 text-xs"
              >
                <div className="flex items-start gap-2.5">
                  <AlertTriangle
                    className={`w-4 h-4 shrink-0 mt-0.5 ${
                      issue.severity === 'error'
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-amber-600 dark:text-amber-400'
                    }`}
                  />
                  <div>
                    <span
                      className={`font-semibold uppercase text-[10px] mr-2 ${
                        issue.severity === 'error'
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-amber-600 dark:text-amber-400'
                      }`}
                    >
                      {issue.severity}
                    </span>
                    <span className="text-[#101010] dark:text-white">
                      {issue.message}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 pl-6 tablet:pl-0">
                  {issue.autoFixLabel && (
                    <button
                      type="button"
                      onClick={() => handleAutoFix(issue)}
                      className="min-h-[36px] tablet:min-h-0 px-2.5 py-1 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/[0.04] dark:hover:bg-white/[0.08] text-[#101010] dark:text-white font-medium flex items-center gap-1"
                    >
                      <Wrench className="w-3 h-3" />
                      {issue.autoFixLabel}
                    </button>
                  )}
                  {(issue.elementId || issue.pageNumber) && (
                    <button
                      type="button"
                      onClick={() =>
                        onInspectElement
                          ? onInspectElement(
                              issue.pageNumber || 1,
                              issue.elementId
                            )
                          : onJumpToEditor()
                      }
                      className="min-h-[36px] tablet:min-h-0 px-2.5 py-1 rounded-lg text-[#101010] dark:text-white hover:bg-black/[0.06] dark:hover:bg-white/[0.08] font-medium"
                    >
                      Inspect
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassCard>

      {/* Progress & Errors */}
      <AnimatePresence>
        {isExporting && (
          <motion.div
            key="export-progress"
            variants={popoverVariants}
            initial={shouldReduceMotion ? false : 'initial'}
            animate="animate"
            exit="exit"
            className="p-4 rounded-2xl border border-black/15 dark:border-white/15 glass-level-2 text-xs"
          >
            <div className="flex justify-between mb-2 font-medium text-[#101010] dark:text-white">
              <span>{exportProgress.stage}</span>
              <span className="tabular-nums">
                {exportProgress.current} / {exportProgress.total}
              </span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
              <motion.div
                className="h-full bg-[#101010] dark:bg-white glass-progress-fill"
                initial={false}
                animate={{
                  width: `${Math.round(
                    (exportProgress.current / Math.max(1, exportProgress.total)) *
                      100
                  )}%`,
                }}
                transition={{ duration: 0.2, ease: MOTION_EASE.liquid }}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {exportError && (
          <motion.div
            key="export-error"
            variants={bannerVariants}
            initial={shouldReduceMotion ? false : 'initial'}
            animate="animate"
            exit="exit"
            className="p-4 rounded-2xl border border-red-500/40 bg-red-500/10 text-xs text-red-700 dark:text-red-300"
          >
            {exportError}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {lastExportUrl && !isExporting && (
          <motion.div
            key="export-complete"
            variants={popoverVariants}
            initial={shouldReduceMotion ? false : 'initial'}
            animate="animate"
            exit="exit"
          >
            <GlassCard level={3} padding="md" className="space-y-4 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[#101010] dark:text-white font-semibold flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>Generated {lastExportUrl.fileName}</span>
                  </div>
                  {lastExportUrl.verifiedPageCount !== undefined && (
                    <div className="mt-0.5 text-[#555555] dark:text-[#B5B5B5] tabular-nums">
                      Verified PDF: {lastExportUrl.verifiedPageCount} pages ·{' '}
                      {lastExportUrl.verifiedWidthPt} × {lastExportUrl.verifiedHeightPt} pt ·{' '}
                      {(lastExportUrl.bytes.byteLength / 1024).toFixed(1)} KB
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {lastExportUrl.mimeType === 'application/pdf' && (
                    <button
                      type="button"
                      disabled={isReopening}
                      onClick={() => void handleReopenExportedPdf()}
                      className="px-3 py-1.5 rounded-xl border border-black/15 dark:border-white/15 bg-white/80 dark:bg-[#1B1B1B] hover:bg-black/[0.04] dark:hover:bg-white/[0.08] text-[#101010] dark:text-white font-medium flex items-center gap-1.5 transition-colors"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      {isReopening ? 'Opening...' : 'Reopen & Validate in Editor'}
                    </button>
                  )}
                  <a
                    href={lastExportUrl.url}
                    download={lastExportUrl.fileName}
                    className="px-3.5 py-1.5 rounded-xl bg-[#101010] text-white hover:bg-[#262626] dark:bg-white dark:text-[#050505] dark:hover:bg-[#E6E6E6] font-medium transition-colors"
                  >
                    Download Again
                  </a>
                </div>
              </div>

              {previewPageImg && lastExportUrl.verifiedPageCount && (
                <div className="pt-3 border-t border-black/10 dark:border-white/10 flex flex-col items-center gap-3">
                  <div className="flex flex-wrap items-center justify-center gap-2.5">
                    <button
                      type="button"
                      disabled={previewPageNum <= 1}
                      onClick={() =>
                        void loadExportedPreviewPage(
                          lastExportUrl.bytes,
                          Math.max(1, previewPageNum - 1)
                        )
                      }
                      className="min-h-[36px] min-w-[36px] flex items-center justify-center p-1 rounded-lg border border-black/15 dark:border-white/15 text-[#101010] dark:text-white disabled:opacity-35"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="tabular-nums font-medium text-[#101010] dark:text-white">
                      Page {previewPageNum} of {lastExportUrl.verifiedPageCount}
                    </span>
                    <button
                      type="button"
                      disabled={previewPageNum >= lastExportUrl.verifiedPageCount}
                      onClick={() =>
                        void loadExportedPreviewPage(
                          lastExportUrl.bytes,
                          Math.min(
                            lastExportUrl.verifiedPageCount!,
                            previewPageNum + 1
                          )
                        )
                      }
                      className="min-h-[36px] min-w-[36px] flex items-center justify-center p-1 rounded-lg border border-black/15 dark:border-white/15 text-[#101010] dark:text-white disabled:opacity-35"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                    {lastExportUrl.verifiedPageCount > 2 && (
                      <button
                        type="button"
                        onClick={() =>
                          void loadExportedPreviewPage(
                            lastExportUrl.bytes,
                            lastExportUrl.verifiedPageCount!
                          )
                        }
                        className="min-h-[36px] px-2.5 py-1 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/[0.04] dark:hover:bg-white/[0.08] text-[#101010] dark:text-white text-[11px]"
                      >
                        Last Page
                      </button>
                    )}
                  </div>
                  <img
                    src={previewPageImg}
                    alt={`Exported page ${previewPageNum}`}
                    referrerPolicy="no-referrer"
                    className="w-full max-w-md max-h-96 object-contain rounded-lg border border-black/15 dark:border-white/15 shadow-lg bg-white"
                  />
                </div>
              )}
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Export Mode Grid & Parameters */}
      <div className="grid grid-cols-1 desktop:grid-cols-3 gap-6">
        <div className="desktop:col-span-2 space-y-3">
          <h2 className="text-sm font-semibold text-[#101010] dark:text-white">
            Export Format & Output Mode
          </h2>
          <div className="grid grid-cols-1 tablet:grid-cols-2 gap-2.5">
            {EXPORT_MODES.map((m) => (
              <motion.button
                key={m.id}
                type="button"
                whileTap={shouldReduceMotion ? undefined : BUTTON_TAP}
                transition={MOTION_SPRING.snappy}
                onClick={() => updateExport({ mode: m.id })}
                className={`p-3.5 rounded-2xl border text-left transition-[border-color,background-color] duration-150 ${
                  exportConfig.mode === m.id
                    ? 'studio-active-surface'
                    : 'glass-level-3 border-black/10 dark:border-white/12 hover:border-black/25 dark:hover:border-white/25'
                }`}
              >
                <div className="text-xs font-semibold text-[#101010] dark:text-white">
                  {m.label}
                </div>
                <div className="mt-0.5 text-[11px] text-[#555555] dark:text-[#B5B5B5]">
                  {m.desc}
                </div>
              </motion.button>
            ))}
          </div>

          <AnimatePresence>
            {exportConfig.mode === 'merge' && (
              <motion.div
                key="export-merge-panel"
                variants={popoverVariants}
                initial={shouldReduceMotion ? false : 'initial'}
                animate="animate"
                exit="exit"
              >
                <GlassCard level={3} padding="md" className="space-y-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[#101010] dark:text-white">Additional PDFs to Append</span>
                    <input
                      ref={mergeInputRef}
                      type="file"
                      accept=".pdf,application/pdf"
                      multiple
                      className="hidden"
                      onChange={(e) => void handleMergeFilesPicked(e.target.files)}
                    />
                    <GlassButton
                      variant="glass"
                      size="sm"
                      onClick={() => mergeInputRef.current?.click()}
                    >
                      <Upload className="w-3.5 h-3.5" />
                      Add PDFs
                    </GlassButton>
                  </div>
                  {mergeFiles.length > 0 && (
                    <ul className="space-y-1 text-[#555555] dark:text-[#B5B5B5]">
                      {mergeFiles.map((f, idx) => (
                        <li key={idx} className="flex justify-between">
                          <span>{f.name}</span>
                          <button
                            type="button"
                            onClick={() =>
                              setMergeFiles((prev) =>
                                prev.filter((_, i) => i !== idx)
                              )
                            }
                            className="text-[#888888] hover:text-[#101010] dark:text-[#858585] dark:hover:text-white font-medium"
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </GlassCard>
              </motion.div>
            )}

            {exportConfig.mode === 'selected_pages' && (
              <motion.div
                key="export-selected-pages-panel"
                variants={popoverVariants}
                initial={shouldReduceMotion ? false : 'initial'}
                animate="animate"
                exit="exit"
              >
                <GlassCard level={3} padding="md" className="text-xs">
                  <label className="block">
                    <span className="font-medium text-[#555555] dark:text-[#B5B5B5]">
                      Page Range (e.g. 1-3, 5)
                    </span>
                    <input
                      type="text"
                      value={exportConfig.selectedPagesRange}
                      onChange={(e) =>
                        updateExport({ selectedPagesRange: e.target.value })
                      }
                      className="mt-1.5 w-full min-h-[40px] px-3 py-1.5 rounded-xl studio-input font-mono"
                    />
                  </label>
                </GlassCard>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Right Options Panel */}
        <GlassCard level={3} padding="md" className="space-y-4 text-xs h-fit">
          <h2 className="text-sm font-semibold text-[#101010] dark:text-white">
            Print & Output Options
          </h2>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] text-[#888888] dark:text-[#858585]">Resolution (DPI)</span>
              <select
                value={exportConfig.dpi}
                onChange={(e) =>
                  updateExport({ dpi: Number(e.target.value) as 72 | 150 | 300 | 600 })
                }
                className="mt-1 w-full min-h-[38px] px-2 py-1.5 rounded-xl studio-select"
              >
                <option value={72}>72 DPI (Screen)</option>
                <option value={150}>150 DPI (Standard)</option>
                <option value={300}>300 DPI (Print)</option>
                <option value={600}>600 DPI (Press)</option>
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] text-[#888888] dark:text-[#858585]">Bleed (pt)</span>
              <input
                type="number"
                min="0"
                max="36"
                value={exportConfig.bleedPt}
                onChange={(e) =>
                  updateExport({ bleedPt: Math.max(0, Number(e.target.value) || 0) })
                }
                className="mt-1 w-full px-2 py-1.5 rounded-xl studio-input tabular-nums"
              />
            </label>
          </div>

          <label className="block">
            <span className="text-[11px] text-[#888888] dark:text-[#858585]">Watermark Text (Optional)</span>
            <input
              type="text"
              placeholder="e.g. CONFIDENTIAL or COPY"
              value={exportConfig.watermarkText}
              onChange={(e) => updateExport({ watermarkText: e.target.value })}
              className="mt-1 w-full px-2.5 py-1.5 rounded-xl studio-input"
            />
          </label>

          <label className="flex items-center gap-2 cursor-pointer text-[#101010] dark:text-white">
            <input
              type="checkbox"
              checked={exportConfig.addPageNumbers}
              onChange={(e) => updateExport({ addPageNumbers: e.target.checked })}
              className="rounded border-black/30 dark:border-white/30 accent-[#101010] dark:accent-white"
            />
            <span>Stamp Page Numbers (Footer)</span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer text-[#101010] dark:text-white">
            <input
              type="checkbox"
              checked={exportConfig.cropMarks}
              onChange={(e) => updateExport({ cropMarks: e.target.checked })}
              className="rounded border-black/30 dark:border-white/30 accent-[#101010] dark:accent-white"
            />
            <span>Include Press Crop Marks</span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer text-[#101010] dark:text-white">
            <input
              type="checkbox"
              checked={exportConfig.embedFonts}
              onChange={(e) => updateExport({ embedFonts: e.target.checked })}
              className="rounded border-black/30 dark:border-white/30 accent-[#101010] dark:accent-white"
            />
            <span>Standardize / Embed PDF Fonts</span>
          </label>

          <div className="pt-3 border-t border-black/10 dark:border-white/10 space-y-1 text-[11px] tabular-nums text-[#555555] dark:text-[#B5B5B5]">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[#101010] dark:text-white">
                Output Geometry Summary
              </span>
              <button
                type="button"
                onClick={() => setShowPageSetupModal(true)}
                className="text-[#101010] dark:text-white hover:underline font-medium"
              >
                Configure Paper...
              </button>
            </div>
            <div className="flex justify-between">
              <span>Output Sheet:</span>
              <span>
                {ptToUnit(layoutSummary.outputSheetWidthPt, project.pageConfig.unit)} ×{' '}
                {ptToUnit(layoutSummary.outputSheetHeightPt, project.pageConfig.unit)}{' '}
                {project.pageConfig.unit}
              </span>
            </div>
            <div className="flex justify-between">
              <span>PDF MediaBox:</span>
              <span className="font-mono">
                [0, 0,{' '}
                {(
                  layoutSummary.outputSheetWidthPt +
                  (exportConfig.bleedPt || project.pageConfig.bleedPt || 0) * 2
                ).toFixed(2)}
                ,{' '}
                {(
                  layoutSummary.outputSheetHeightPt +
                  (exportConfig.bleedPt || project.pageConfig.bleedPt || 0) * 2
                ).toFixed(2)}
                ] pt
              </span>
            </div>
            <div className="flex justify-between">
              <span>Source Box:</span>
              <span>
                {ptToUnit(layoutSummary.sourceBox.width, project.pageConfig.unit)} ×{' '}
                {ptToUnit(layoutSummary.sourceBox.height, project.pageConfig.unit)}{' '}
                {project.pageConfig.unit} ({layoutSummary.boundaryMode.replace('_', ' ')})
              </span>
            </div>
            <div className="flex justify-between">
              <span>Scaling / Slots:</span>
              <span>
                {layoutSummary.scalingMode.replace(/_/g, ' ')} ·{' '}
                {layoutSummary.slots.length}× ({Math.round((layoutSummary.slots[0]?.scale || 1) * 100)}%)
              </span>
            </div>
          </div>
        </GlassCard>
      </div>

      <PageConfigurationModal
        isOpen={showPageSetupModal}
        project={project}
        onClose={() => setShowPageSetupModal(false)}
        onApplyConfig={(nextPageConfig: PageConfig, nextSpacing, nextCopiesPatch, nextFitPatch) => {
          const currFit = normalizeFitConfig(project);
          const mergedCopies = {
            ...project.copiesConfig,
            ...(nextSpacing || {}),
            ...(nextCopiesPatch || {}),
          };
          const perPage = mergedCopies.enabled
            ? Math.max(1, mergedCopies.columns * mergedCopies.rows)
            : 1;
          onUpdateProject({
            ...project,
            pageConfig: nextPageConfig,
            fitConfig: nextFitPatch ? { ...currFit, ...nextFitPatch } : project.fitConfig,
            exportConfig: {
              ...project.exportConfig,
              bleedPt: nextPageConfig.bleedPt ?? project.exportConfig.bleedPt,
              cropMarks: nextPageConfig.cropMarks ?? project.exportConfig.cropMarks,
              customWidthPt: undefined,
              customHeightPt: undefined,
            },
            copiesConfig: mergedCopies,
            bulkConfig: {
              ...project.bulkConfig,
              enabled: project.bulkConfig.enabled || mergedCopies.enabled,
              copiesPerPage: perPage,
              totalRecords: project.bulkConfig.totalOutputPages * perPage,
            },
            updatedAt: new Date().toISOString(),
          });
        }}
      />
    </div>
  );
};
