import React, { useEffect, useRef, useState } from 'react';
import { Loader2, RotateCcw, ScanText, Sparkles } from 'lucide-react';
import {
  DocumentElement,
  PageRestorationConfig,
  PDFProject,
} from '../types/pdfStudio';
import { renderSinglePagePreview } from '../utils/pdfRenderer';
import {
  applyRestorationToDataUrl,
  DEFAULT_RESTORATION_CONFIG,
  runLocalOcrOnPageDataUrl,
} from '../utils/restorationEngine';
import { GlassButton, GlassCard, GlassModal } from './glass';

interface RestorationStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: PDFProject;
  currentPage: number;
  sourceImageUrl?: string;
  ocrLanguage?: string;
  onApplyPageRestoration: (
    pageNumbers: number[],
    config: PageRestorationConfig,
    previewsByPage: Record<number, string>
  ) => void;
  onAppendOcrElements: (newElements: DocumentElement[]) => void;
}

export const RestorationStudioModal: React.FC<RestorationStudioModalProps> = ({
  isOpen,
  onClose,
  project,
  currentPage,
  sourceImageUrl,
  ocrLanguage = 'eng',
  onApplyPageRestoration,
  onAppendOcrElements,
}) => {
  const pageMeta = project.originalPages.find((p) => p.pageNumber === currentPage);
  const [config, setConfig] = useState<PageRestorationConfig>(() =>
    pageMeta?.restoration
      ? { ...pageMeta.restoration }
      : { ...DEFAULT_RESTORATION_CONFIG, enabled: true }
  );
  const [beforeUrl, setBeforeUrl] = useState<string | null>(sourceImageUrl || null);
  const [afterUrl, setAfterUrl] = useState<string | null>(null);
  const [showBefore, setShowBefore] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [applyingAll, setApplyingAll] = useState(false);
  const [runningOcr, setRunningOcr] = useState(false);
  const [ocrStatus, setOcrStatus] = useState<string | null>(null);
  const activeSessionRef = useRef(true);

  useEffect(() => {
    activeSessionRef.current = isOpen;
    if (!isOpen) {
      setAfterUrl(null);
      setShowBefore(false);
      setProcessing(false);
      setApplyingAll(false);
      setRunningOcr(false);
      return;
    }
    setConfig(
      pageMeta?.restoration
        ? { ...pageMeta.restoration, enabled: true }
        : { ...DEFAULT_RESTORATION_CONFIG, enabled: true }
    );
    setAfterUrl(null);
    setShowBefore(false);
    setOcrStatus(null);
  }, [isOpen, currentPage, project.id, pageMeta?.restoration]);

  // Load original crisp preview
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const loadSource = async () => {
      if (pageMeta?.previewImageDataUrl) {
        if (!cancelled) setBeforeUrl(pageMeta.previewImageDataUrl);
        return;
      }
      if (project.sourcePdfBase64) {
        const url = await renderSinglePagePreview(
          project.sourcePdfBase64,
          pageMeta?.sourcePdfPageNumber || currentPage,
          1.4
        );
        if (!cancelled && url) setBeforeUrl(url);
        return;
      }
      if (!cancelled) setBeforeUrl(sourceImageUrl || null);
    };
    void loadSource();
    return () => {
      cancelled = true;
    };
  }, [isOpen, currentPage, project.id, pageMeta?.previewImageDataUrl, project.sourcePdfBase64, sourceImageUrl]);

  // Debounced live worker preview
  useEffect(() => {
    if (!isOpen || !beforeUrl) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setProcessing(true);
      try {
        const result = await applyRestorationToDataUrl(beforeUrl, {
          ...config,
          enabled: true,
        });
        if (!cancelled) setAfterUrl(result);
      } finally {
        if (!cancelled) setProcessing(false);
      }
    }, 140);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isOpen, beforeUrl, config]);

  const handleApplyCurrent = async () => {
    if (!beforeUrl) return;
    setProcessing(true);
    try {
      const nextCfg: PageRestorationConfig = { ...config, enabled: true };
      const restored = await applyRestorationToDataUrl(beforeUrl, nextCfg);
      if (!activeSessionRef.current) return;
      onApplyPageRestoration([currentPage], nextCfg, { [currentPage]: restored });
      onClose();
    } catch (err) {
      if (activeSessionRef.current) {
        setOcrStatus(err instanceof Error ? err.message : 'Restoration failed on this page.');
      }
    } finally {
      if (activeSessionRef.current) setProcessing(false);
    }
  };

  const handleApplyAll = async () => {
    setApplyingAll(true);
    try {
      const nextCfg: PageRestorationConfig = { ...config, enabled: true };
      const previewsByPage: Record<number, string> = {};
      const allPageNums = Array.from(
        { length: Math.max(1, project.pageCount) },
        (_, i) => i + 1
      );
      for (const p of allPageNums) {
        if (!activeSessionRef.current) return;
        const meta = project.originalPages.find((m) => m.pageNumber === p);
        let src = meta?.previewImageDataUrl;
        if (!src && project.sourcePdfBase64) {
          src =
            (await renderSinglePagePreview(
              project.sourcePdfBase64,
              meta?.sourcePdfPageNumber || p,
              1.4
            )) || undefined;
        }
        if (!activeSessionRef.current) return;
        if (src) {
          previewsByPage[p] = await applyRestorationToDataUrl(src, nextCfg);
        }
      }
      if (!activeSessionRef.current) return;
      onApplyPageRestoration(allPageNums, nextCfg, previewsByPage);
      onClose();
    } catch (err) {
      if (activeSessionRef.current) {
        setOcrStatus(err instanceof Error ? err.message : 'Batch restoration failed.');
      }
    } finally {
      if (activeSessionRef.current) setApplyingAll(false);
    }
  };

  const handleRevert = () => {
    onApplyPageRestoration(
      [currentPage],
      { ...DEFAULT_RESTORATION_CONFIG, enabled: false },
      {}
    );
    onClose();
  };

  const handleRunOcr = async () => {
    const imgTarget = afterUrl || beforeUrl;
    if (!imgTarget) return;
    setRunningOcr(true);
    setOcrStatus('Running local Tesseract OCR...');
    try {
      const wPt = pageMeta?.widthPt || project.pageConfig.widthPt;
      const hPt = pageMeta?.heightPt || project.pageConfig.heightPt;
      const detected = await runLocalOcrOnPageDataUrl(
        imgTarget,
        currentPage,
        wPt,
        hPt,
        ocrLanguage
      );
      if (detected.length > 0) {
        onAppendOcrElements(detected);
        setOcrStatus(`Added ${detected.length} inspectable OCR text block(s) to Page ${currentPage}.`);
      } else {
        setOcrStatus('No readable text lines detected on this page.');
      }
    } catch (err) {
      setOcrStatus(err instanceof Error ? err.message : 'OCR failed on this page.');
    } finally {
      setRunningOcr(false);
    }
  };

  return (
    <GlassModal
      isOpen={isOpen}
      onClose={onClose}
      title={`Scan Restoration & OCR Studio · Page ${currentPage}`}
      subtitle="Non-destructive background enhancement processed locally via Web Worker"
      maxWidthClass="max-w-4xl"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <GlassButton variant="glass" size="md" onClick={handleRevert}>
            <RotateCcw className="w-3.5 h-3.5" />
            Revert Original
          </GlassButton>
          <div className="flex flex-wrap items-center gap-2">
            <GlassButton
              variant="glass"
              size="md"
              disabled={applyingAll || processing}
              onClick={() => void handleApplyAll()}
            >
              {applyingAll && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Apply to All Pages
            </GlassButton>
            <GlassButton
              variant="primary"
              size="md"
              disabled={processing || applyingAll}
              onClick={() => void handleApplyCurrent()}
            >
              <Sparkles className="w-3.5 h-3.5" />
              Apply to Page {currentPage}
            </GlassButton>
          </div>
        </div>
      }
    >
      <div className="p-4 tablet:p-5 grid grid-cols-1 desktop:grid-cols-12 gap-4 text-xs">
        {/* Preview Pane */}
        <div className="desktop:col-span-7 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-[#101010] dark:text-white">
              {showBefore ? 'Original Source' : 'Restored Live Preview'}
            </span>
            <div className="flex items-center gap-2">
              {processing && (
                <span className="text-[11px] text-[#888888] flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Processing...
                </span>
              )}
              <button
                type="button"
                onClick={() => setShowBefore((v) => !v)}
                className="px-2.5 py-1 rounded-lg border border-black/15 dark:border-white/15 text-[11px] font-medium hover:bg-black/5 dark:hover:bg-white/10"
              >
                {showBefore ? 'Show Restored' : 'Compare Original'}
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-black/12 dark:border-white/12 bg-[#EFEFEF] dark:bg-[#0B0B0B] p-3 flex items-center justify-center min-h-[340px]">
            {(showBefore ? beforeUrl : afterUrl || beforeUrl) ? (
              <img
                src={(showBefore ? beforeUrl : afterUrl || beforeUrl)!}
                alt="Page restoration preview"
                className="max-h-[420px] w-auto object-contain rounded shadow border border-black/10 bg-white"
              />
            ) : (
              <span className="text-[#888888]">
                No raster source available on this blank page.
              </span>
            )}
          </div>
        </div>

        {/* Sliders & Local OCR */}
        <div className="desktop:col-span-5 space-y-3">
          <GlassCard level={2} padding="sm" className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[#101010] dark:text-white">
                Image Cleanup Filters
              </span>
              <button
                type="button"
                onClick={() =>
                  setConfig({ ...DEFAULT_RESTORATION_CONFIG, enabled: true })
                }
                className="text-[11px] text-[#555555] dark:text-[#B5B5B5] hover:underline"
              >
                Reset Sliders
              </button>
            </div>

            {(
              [
                ['Brightness', 'brightness', -100, 100, 1],
                ['Contrast', 'contrast', -100, 100, 1],
                ['Noise Reduction', 'denoise', 0, 100, 5],
                ['Background Cleanup', 'backgroundCleanup', 0, 100, 5],
                ['Deskew (degrees)', 'deskewDeg', -10, 10, 0.2],
              ] as const
            ).map(([label, key, min, max, step]) => (
              <label key={key} className="block space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-[#555555] dark:text-[#B5B5B5]">{label}</span>
                  <span className="font-mono tabular-nums text-[#101010] dark:text-white">
                    {config[key]}
                  </span>
                </div>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={config[key]}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, [key]: Number(e.target.value) }))
                  }
                  className="w-full accent-[#101010] dark:accent-white"
                />
              </label>
            ))}

            <label className="flex items-center justify-between pt-1 cursor-pointer">
              <span className="text-[#101010] dark:text-white font-medium">
                Paper White-Point Normalization
              </span>
              <input
                type="checkbox"
                checked={config.whiteNormalize}
                onChange={(e) =>
                  setConfig((c) => ({ ...c, whiteNormalize: e.target.checked }))
                }
                className="accent-[#101010] dark:accent-white"
              />
            </label>
          </GlassCard>

          <GlassCard level={2} padding="sm" className="space-y-2.5">
            <div className="font-semibold text-[#101010] dark:text-white">
              Local Scan OCR (Tesseract.js)
            </div>
            <p className="text-[11px] text-[#555555] dark:text-[#B5B5B5] leading-relaxed">
              Extracts editable text blocks directly from the restored image. Detections below 78% confidence are automatically flagged for review.
            </p>
            <GlassButton
              variant="glass"
              size="md"
              className="w-full"
              disabled={runningOcr || (!afterUrl && !beforeUrl)}
              onClick={() => void handleRunOcr()}
            >
              {runningOcr ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ScanText className="w-3.5 h-3.5" />
              )}
              {runningOcr ? 'Running OCR...' : `Extract OCR Text on Page ${currentPage}`}
            </GlassButton>
            {ocrStatus && (
              <div className="text-[11px] text-[#101010] dark:text-white bg-black/5 dark:bg-white/10 px-2.5 py-1.5 rounded-lg">
                {ocrStatus}
              </div>
            )}
          </GlassCard>
        </div>
      </div>
    </GlassModal>
  );
};
