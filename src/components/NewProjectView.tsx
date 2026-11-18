import React, { useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  FileText,
  Loader2,
  ScanSearch,
  ScanText,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import {
  bannerVariants,
  CARD_HOVER,
  CARD_TAP,
  MOTION_EASE,
  MOTION_SPRING,
  popoverVariants,
} from '../config/motionSystem';
import { PDFProject, StudioSettings } from '../types/pdfStudio';
import { runOptionalAiEnhancedAnalysis } from '../utils/aiEnhancedAnalysis';
import { scanPdfLocally } from '../utils/localPdfScanner';
import { uint8ArrayToBase64 } from '../utils/pdfRenderer';
import {
  createDefaultBulkConfig,
  createDefaultCopiesConfig,
  createDefaultExportConfig,
  createDefaultFitConfig,
  createDefaultPageConfig,
} from '../utils/units';
import { GlassButton, GlassCard } from './glass';

interface NewProjectViewProps {
  settings: StudioSettings;
  onProjectCreated: (project: PDFProject, openImmediately: boolean) => void;
  onUpdateProject?: (updated: PDFProject) => void;
  onInspectScan?: (project: PDFProject) => void;
}

async function createStarterPdfLocally(
  templateKind: 'invoice' | 'dual_receipt' | 'blank',
  widthPt = 595.28,
  heightPt = 841.89
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([widthPt, heightPt]);
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  if (templateKind === 'dual_receipt') {
    const drawReceiptBlock = (
      yTop: number,
      title: string,
      receiptNo: string
    ) => {
      const boxH = heightPt / 2 - 48;
      const boxY = heightPt - yTop - boxH;
      page.drawRectangle({
        x: 36,
        y: boxY,
        width: widthPt - 72,
        height: boxH,
        borderColor: rgb(0.2, 0.25, 0.35),
        borderWidth: 1.2,
        color: rgb(0.99, 0.99, 1),
      });
      page.drawText(title, {
        x: 54,
        y: boxY + boxH - 36,
        size: 16,
        font: helveticaBold,
        color: rgb(0.08, 0.12, 0.2),
      });
      page.drawText(`Receipt No: ${receiptNo}`, {
        x: widthPt - 210,
        y: boxY + boxH - 36,
        size: 12,
        font: helveticaBold,
        color: rgb(0.15, 0.35, 0.72),
      });
      page.drawText('Customer Name: ___________________________', {
        x: 54,
        y: boxY + boxH - 74,
        size: 11,
        font: helvetica,
        color: rgb(0.2, 0.2, 0.25),
      });
      page.drawText('Date: 2026-11-18', {
        x: widthPt - 210,
        y: boxY + boxH - 74,
        size: 11,
        font: helvetica,
        color: rgb(0.2, 0.2, 0.25),
      });
      page.drawLine({
        start: { x: 54, y: boxY + boxH - 96 },
        end: { x: widthPt - 54, y: boxY + boxH - 96 },
        thickness: 0.8,
        color: rgb(0.8, 0.84, 0.9),
      });
      page.drawText('Description', {
        x: 54,
        y: boxY + boxH - 118,
        size: 10,
        font: helveticaBold,
        color: rgb(0.3, 0.35, 0.45),
      });
      page.drawText('Amount', {
        x: widthPt - 130,
        y: boxY + boxH - 118,
        size: 10,
        font: helveticaBold,
        color: rgb(0.3, 0.35, 0.45),
      });
      page.drawText('Standard Service Package', {
        x: 54,
        y: boxY + boxH - 144,
        size: 10.5,
        font: helvetica,
        color: rgb(0.15, 0.15, 0.2),
      });
      page.drawText('$250.00', {
        x: widthPt - 130,
        y: boxY + boxH - 144,
        size: 10.5,
        font: helvetica,
        color: rgb(0.15, 0.15, 0.2),
      });
      page.drawText('Total Paid: $250.00', {
        x: widthPt - 180,
        y: boxY + 34,
        size: 12,
        font: helveticaBold,
        color: rgb(0.08, 0.12, 0.2),
      });
    };
    drawReceiptBlock(28, 'OFFICIAL PAYMENT RECEIPT', 'RCP-0001');
    drawReceiptBlock(heightPt / 2 + 12, 'OFFICIAL PAYMENT RECEIPT', 'RCP-0002');
  } else if (templateKind === 'invoice') {
    page.drawRectangle({
      x: 36,
      y: heightPt - 120,
      width: widthPt - 72,
      height: 84,
      color: rgb(0.95, 0.96, 0.98),
      borderColor: rgb(0.82, 0.85, 0.9),
      borderWidth: 1,
    });
    page.drawText('NORTHSTAR LOGISTICS INC.', {
      x: 54,
      y: heightPt - 68,
      size: 18,
      font: helveticaBold,
      color: rgb(0.07, 0.1, 0.18),
    });
    page.drawText('INVOICE', {
      x: widthPt - 160,
      y: heightPt - 68,
      size: 18,
      font: helveticaBold,
      color: rgb(0.15, 0.38, 0.78),
    });
    page.drawText('Invoice #: INV-0001', {
      x: widthPt - 180,
      y: heightPt - 94,
      size: 11,
      font: helveticaBold,
      color: rgb(0.2, 0.25, 0.32),
    });
    page.drawText('Bill To: Meridian Retail Group', {
      x: 54,
      y: heightPt - 160,
      size: 11.5,
      font: helveticaBold,
      color: rgb(0.15, 0.18, 0.24),
    });
    page.drawText('Issue Date: 2026-11-18', {
      x: 54,
      y: heightPt - 180,
      size: 10.5,
      font: helvetica,
      color: rgb(0.3, 0.34, 0.42),
    });
    page.drawRectangle({
      x: 36,
      y: heightPt - 340,
      width: widthPt - 72,
      height: 120,
      borderColor: rgb(0.75, 0.78, 0.84),
      borderWidth: 0.8,
    });
    page.drawText('Item Description', {
      x: 50,
      y: heightPt - 245,
      size: 10,
      font: helveticaBold,
      color: rgb(0.2, 0.24, 0.3),
    });
    page.drawText('Qty', {
      x: 330,
      y: heightPt - 245,
      size: 10,
      font: helveticaBold,
      color: rgb(0.2, 0.24, 0.3),
    });
    page.drawText('Total', {
      x: 470,
      y: heightPt - 245,
      size: 10,
      font: helveticaBold,
      color: rgb(0.2, 0.24, 0.3),
    });
    page.drawText('Freight & Fulfillment Services', {
      x: 50,
      y: heightPt - 275,
      size: 10.5,
      font: helvetica,
      color: rgb(0.15, 0.15, 0.2),
    });
    page.drawText('1', {
      x: 335,
      y: heightPt - 275,
      size: 10.5,
      font: helvetica,
      color: rgb(0.15, 0.15, 0.2),
    });
    page.drawText('$1,240.00', {
      x: 465,
      y: heightPt - 275,
      size: 10.5,
      font: helvetica,
      color: rgb(0.15, 0.15, 0.2),
    });
    page.drawText('Amount Due: $1,240.00', {
      x: widthPt - 210,
      y: heightPt - 380,
      size: 13,
      font: helveticaBold,
      color: rgb(0.07, 0.1, 0.18),
    });
  } else {
    page.drawText('Untitled Document', {
      x: 48,
      y: heightPt - 64,
      size: 18,
      font: helveticaBold,
      color: rgb(0.1, 0.12, 0.18),
    });
  }

  return pdfDoc.save();
}

export const NewProjectView: React.FC<NewProjectViewProps> = ({
  settings,
  onProjectCreated,
  onUpdateProject,
  onInspectScan,
}) => {
  const shouldReduceMotion = useReducedMotion();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cancelScanRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const [enableOcr, setEnableOcr] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressStage, setProgressStage] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [aiNotice, setAiNotice] = useState<{
    kind: 'info' | 'warning';
    message: string;
  } | null>(null);
  const [aiEnhancingId, setAiEnhancingId] = useState<string | null>(null);
  const [completedProjects, setCompletedProjects] = useState<PDFProject[]>([]);

  const processPdfFile = async (
    fileName: string,
    pdfBytes: Uint8Array
  ): Promise<PDFProject> => {
    setProgressStage(`Reading ${fileName} locally (PDF.js)`);
    setProgressPercent(10);

    // 100% Local deterministic PDF scan — never invokes Gemini API automatically
    const scanResult = await scanPdfLocally(pdfBytes, {
      enableOcr,
      ocrLanguage: settings.ocrLanguage,
      renderScale: 1.7,
      maxPages: 25,
      isCancelled: () => cancelScanRef.current,
      onProgress: (stage, pct) => {
        setProgressStage(`${stage} — ${fileName}`);
        setProgressPercent(pct);
      },
    });

    const firstPage = scanResult.originalPages[0] || {
      pageNumber: 1,
      widthPt: 595.28,
      heightPt: 841.89,
      orientation: 'portrait' as const,
    };

    // Preserve original PDF bytes verbatim
    const base64 = uint8ArrayToBase64(pdfBytes);
    const now = new Date().toISOString();
    const project: PDFProject = {
      id: `proj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: fileName.replace(/\.pdf$/i, ''),
      description: scanResult.summary || `Imported locally from ${fileName}`,
      version: 1,
      createdAt: now,
      updatedAt: now,
      sourcePdfName: fileName,
      sourcePdfBase64: base64,
      pageCount: scanResult.pageCount,
      originalPages: scanResult.originalPages,
      elements: scanResult.elements,
      pageConfig: createDefaultPageConfig(
        firstPage.widthPt,
        firstPage.heightPt,
        settings.defaultUnit
      ),
      fitConfig: createDefaultFitConfig(firstPage.widthPt, firstPage.heightPt),
      copiesConfig: createDefaultCopiesConfig(),
      serialRules: scanResult.serialRules,
      bulkConfig: {
        ...createDefaultBulkConfig(),
        documentBlocksCount: Math.max(
          1,
          scanResult.stats.repeatedBlockCount || 1
        ),
      },
      dataColumns: [
        { id: 'col-1', name: 'customer_name', type: 'text', required: false },
        { id: 'col-2', name: 'date', type: 'date', dateFormat: 'YYYY-MM-DD' },
        { id: 'col-3', name: 'amount', type: 'currency', currencySymbol: '$' },
      ],
      dataRows: [
        {
          _rowId: 'row-1',
          customer_name: 'Meridian Retail Group',
          date: '2026-11-18',
          amount: 250,
        },
        {
          _rowId: 'row-2',
          customer_name: 'Harbor Logistics LLC',
          date: '2026-11-18',
          amount: 480,
        },
      ],
      exportConfig: createDefaultExportConfig(),
      aiSummary: scanResult.summary,
      imageResources: scanResult.imageResources,
      scanReport: scanResult.scanReport,
      documentMetadata: scanResult.documentMetadata,
      scanCorrectionRules: [],
      isTemplate: false,
      versions: [],
    };

    return project;
  };

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    cancelScanRef.current = false;
    setErrorMessage(null);
    setAiNotice(null);
    setIsProcessing(true);
    setCompletedProjects([]);

    const created: PDFProject[] = [];
    try {
      const pdfFiles = Array.from(files).filter(
        (f) =>
          f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
      );
      if (pdfFiles.length === 0) {
        throw new Error('Please select one or more valid PDF files (.pdf).');
      }

      for (let i = 0; i < pdfFiles.length; i++) {
        if (cancelScanRef.current) break;
        const file = pdfFiles[i];
        const buffer = await file.arrayBuffer();
        const project = await processPdfFile(file.name, new Uint8Array(buffer));
        created.push(project);
        onProjectCreated(
          project,
          i === pdfFiles.length - 1 && pdfFiles.length === 1
        );
      }
      setCompletedProjects(created);
      setProgressPercent(100);
      setProgressStage('Local PDF Scan complete');
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Failed to scan uploaded PDF'
      );
    } finally {
      setIsProcessing(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleCreateStarter = async (
    templateKind: 'invoice' | 'dual_receipt' | 'blank'
  ) => {
    cancelScanRef.current = false;
    setErrorMessage(null);
    setAiNotice(null);
    setIsProcessing(true);
    setProgressStage('Creating vector PDF document');
    setProgressPercent(8);

    try {
      let bytes: Uint8Array | null = null;
      try {
        const res = await fetch('/api/pdf/create-starter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ templateKind }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.base64) {
            const binary = atob(data.base64);
            const buf = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
            bytes = buf;
          }
        }
      } catch {
        // Offline / server unavailable -> fall back to client-side pdf-lib generator
      }

      if (!bytes) {
        bytes = await createStarterPdfLocally(templateKind);
      }

      const labelMap = {
        invoice: 'Commercial_Invoice.pdf',
        dual_receipt: 'Dual_Receipt_Sheet.pdf',
        blank: 'Blank_Document.pdf',
      };
      const project = await processPdfFile(labelMap[templateKind], bytes);
      setCompletedProjects([project]);
      onProjectCreated(project, true);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Could not create starter PDF'
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRunExplicitAiEnhance = async (proj: PDFProject) => {
    setAiNotice(null);
    setAiEnhancingId(proj.id);
    const result = await runOptionalAiEnhancedAnalysis(proj);
    setAiEnhancingId(null);

    if (!result.ok || !result.updatedProject) {
      setAiNotice({
        kind: 'warning',
        message: result.message,
      });
      return;
    }

    const updated = result.updatedProject;
    setCompletedProjects((prev) =>
      prev.map((p) => (p.id === updated.id ? updated : p))
    );
    onUpdateProject?.(updated);
    setAiNotice({
      kind: 'info',
      message: result.message,
    });
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 tablet:p-6 desktop:p-8 max-w-5xl mx-auto w-full">
      <div className="pb-5 tablet:pb-6 border-b border-black/10 dark:border-white/12">
        <h1 className="text-xl tablet:text-2xl font-display font-semibold tracking-tight text-[#101010] dark:text-white">
          New PDF Project
        </h1>
        <p className="mt-1 text-xs tablet:text-sm text-[#555555] dark:text-[#B5B5B5]">
          Upload one or multiple PDFs (multi-page, native text, or scanned) to run a fast, 100% local scan with PDF.js and Tesseract OCR while preserving the original PDF bytes and geometry.
        </p>
      </div>

      {/* Dropzone */}
      <motion.div
        animate={shouldReduceMotion ? undefined : { scale: isDragging ? 1.01 : 1 }}
        transition={MOTION_SPRING.snappy}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          void handleFilesSelected(e.dataTransfer.files);
        }}
        onClick={() => !isProcessing && fileInputRef.current?.click()}
        className={`mt-5 tablet:mt-6 rounded-2xl border-2 border-dashed p-6 tablet:p-10 text-center cursor-pointer transition-colors touch-manipulation ${
          isDragging
            ? 'border-[#101010] bg-black/[0.06] dark:border-white dark:bg-white/[0.08]'
            : 'glass-level-3 border-black/20 dark:border-white/20 hover:border-black/45 dark:hover:border-white/45'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,application/pdf"
          multiple
          className="hidden"
          onChange={(e) => void handleFilesSelected(e.target.files)}
        />
        <Upload className="w-8 h-8 tablet:w-9 tablet:h-9 text-[#101010] dark:text-white mx-auto mb-3" />
        <div className="text-sm font-semibold text-[#101010] dark:text-white">
          Drop PDF files here or tap to browse
        </div>
        <p className="mt-1 text-xs text-[#555555] dark:text-[#B5B5B5]">
          Supports multiple PDFs, multi-page documents, scanned/image PDFs, and offline local scanning
        </p>
        <div className="mt-4">
          <span className="inline-flex min-h-[44px] items-center justify-center px-5 py-2 rounded-xl bg-[#101010] text-white dark:bg-white dark:text-[#050505] text-xs font-medium shadow-[0_8px_20px_-8px_rgba(0,0,0,0.45)]">
            Choose PDF File
          </span>
        </div>
      </motion.div>

      {/* Scanning Modes & Options */}
      <div className="mt-4 grid grid-cols-1 tablet:grid-cols-2 gap-3.5 tablet:gap-4">
        <GlassCard level={3} padding="md" className="flex items-start gap-3 border-black/15 dark:border-white/18">
          <Cpu className="w-4 h-4 text-[#101010] dark:text-white shrink-0 mt-0.5" />
          <div>
            <div className="text-xs font-semibold text-[#101010] dark:text-white">
              Local PDF Scan — Active Default (No AI credits required)
            </div>
            <p className="mt-0.5 text-xs text-[#555555] dark:text-[#B5B5B5]">
              Extracts text, exact coordinates, fonts, colors, vector lines/borders, images, tables, and repeated receipt blocks locally via PDF.js without calling Gemini API.
            </p>
          </div>
        </GlassCard>

        <GlassCard level={3} padding="md">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={enableOcr}
              onChange={(e) => setEnableOcr(e.target.checked)}
              className="mt-0.5 rounded border-black/25 dark:border-white/25"
            />
            <div>
              <div className="text-xs font-semibold text-[#101010] dark:text-white flex items-center gap-1.5">
                <ScanText className="w-3.5 h-3.5 text-[#101010] dark:text-white" />
                Local Tesseract OCR for Scanned Pages
              </div>
              <p className="mt-0.5 text-xs text-[#555555] dark:text-[#B5B5B5]">
                Runs local browser-based OCR strictly on image-only pages that have minimal embedded PDF text. No AI credits consumed.
              </p>
            </div>
          </label>
        </GlassCard>
      </div>

      <GlassCard level={2} padding="sm" className="mt-3 flex items-start gap-2.5 text-xs text-[#555555] dark:text-[#B5B5B5]">
        <Sparkles className="w-4 h-4 text-[#101010] dark:text-white shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold text-[#101010] dark:text-white">
            Optional AI-Enhanced Analysis:
          </span>{' '}
          Never executed automatically on upload. After scanning locally, you can explicitly click{' '}
          <span className="font-medium text-[#101010] dark:text-white">
            AI-Enhanced Analysis
          </span>{' '}
          in the Editor&apos;s AI Assist tab or on scanned cards below (requires Gemini API access and may consume AI quota).
        </div>
      </GlassCard>

      {/* Progress Bar */}
      <AnimatePresence>
        {isProcessing && (
          <motion.div
            key="scan-progress"
            variants={popoverVariants}
            initial={shouldReduceMotion ? false : 'initial'}
            animate="animate"
            exit="exit"
          >
            <GlassCard level={3} padding="md" className="mt-6 border-black/25 dark:border-white/25">
              <div className="flex items-center justify-between gap-2 text-xs font-medium text-[#101010] dark:text-white mb-2">
                <span className="flex items-center gap-2 min-w-0">
                  <Loader2 className="w-4 h-4 animate-spin text-[#101010] dark:text-white shrink-0" />
                  <span className="truncate">{progressStage}</span>
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="tabular-nums">{progressPercent}%</span>
                  <GlassButton
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      cancelScanRef.current = true;
                    }}
                  >
                    <X className="w-3.5 h-3.5" />
                    Cancel
                  </GlassButton>
                </div>
              </div>
              <div className="w-full h-1.5 rounded-full bg-black/10 dark:bg-white/12 overflow-hidden">
                <motion.div
                  className="h-full bg-[#101010] dark:bg-white glass-progress-fill"
                  initial={false}
                  animate={{ width: `${progressPercent}%` }}
                  transition={{ duration: 0.22, ease: MOTION_EASE.liquid }}
                />
              </div>
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error Notice */}
      <AnimatePresence>
        {errorMessage && (
          <motion.div
            key="scan-error"
            variants={bannerVariants}
            initial={shouldReduceMotion ? false : 'initial'}
            animate="animate"
            exit="exit"
            className="mt-6 p-4 rounded-xl border border-red-500/40 bg-red-500/8 text-xs text-red-700 dark:text-red-300 flex items-start gap-2.5"
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold">Local PDF Scan Error</div>
              <div className="mt-0.5">{errorMessage}</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Optional AI Notice (non-blocking) */}
      <AnimatePresence>
        {aiNotice && (
          <motion.div
            key="ai-notice"
            variants={bannerVariants}
            initial={shouldReduceMotion ? false : 'initial'}
            animate="animate"
            exit="exit"
            className={`mt-4 p-4 rounded-xl border text-xs flex items-start gap-2.5 glass-level-3 ${
              aiNotice.kind === 'warning'
                ? 'border-amber-500/40 text-amber-800 dark:text-amber-300'
                : 'border-black/20 dark:border-white/20 text-[#101010] dark:text-white'
            }`}
          >
            {aiNotice.kind === 'warning' ? (
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            ) : (
              <Sparkles className="w-4 h-4 shrink-0 mt-0.5" />
            )}
            <div>
              <div className="font-semibold">
                {aiNotice.kind === 'warning'
                  ? 'Optional AI-Enhanced Analysis Unavailable'
                  : 'AI-Enhanced Analysis Applied'}
              </div>
              <div className="mt-0.5 text-[#555555] dark:text-[#B5B5B5]">{aiNotice.message}</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Multi-file Results */}
      <AnimatePresence>
        {completedProjects.length > 0 && !isProcessing && (
          <motion.div
            key="scan-results"
            variants={popoverVariants}
            initial={shouldReduceMotion ? false : 'initial'}
            animate="animate"
            exit="exit"
          >
            <GlassCard level={3} padding="md" className="mt-6 border-black/20 dark:border-white/20 space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#101010] dark:text-white">
                <CheckCircle2 className="w-4 h-4" />
                Locally Scanned {completedProjects.length} PDF project(s) — Ready for Editing
              </div>
              {completedProjects.map((proj) => {
                const report = proj.scanReport;
                const reviewCount = report?.needsReviewObjects ?? proj.elements.filter((e) => e.needsReview).length;
                const enhancingThis = aiEnhancingId === proj.id;
                return (
                  <div
                    key={proj.id}
                    className="flex flex-col gap-3 p-3 rounded-xl bg-[#F7F7F7] dark:bg-[#0B0B0B] border border-black/10 dark:border-white/12 text-xs"
                  >
                    <div className="flex flex-col tablet:flex-row tablet:items-center justify-between gap-3">
                      <div>
                        <div className="font-semibold text-[#101010] dark:text-white">
                          {proj.name}
                        </div>
                        <div className="mt-0.5 text-[#555555] dark:text-[#B5B5B5] tabular-nums">
                          {proj.pageCount} pages · {report?.totalElements ?? proj.elements.length} detected elements
                          {reviewCount > 0 ? ` · ${reviewCount} flagged for manual review` : ''}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {onInspectScan && (
                          <button
                            type="button"
                            onClick={() => onInspectScan(proj)}
                            className="min-h-[40px] tablet:min-h-0 px-3 py-1.5 rounded-lg glass-level-2 border border-black/15 dark:border-white/15 text-[#101010] dark:text-white hover:bg-black/[0.04] dark:hover:bg-white/[0.08] font-medium flex items-center gap-1.5 whitespace-nowrap touch-manipulation"
                          >
                            <ScanSearch className="w-3.5 h-3.5" />
                            Inspect Scan
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={Boolean(aiEnhancingId)}
                          onClick={() => void handleRunExplicitAiEnhance(proj)}
                          title="Optional Gemini semantic analysis (requires Gemini API access & quota)"
                          className="min-h-[40px] tablet:min-h-0 px-3 py-1.5 rounded-lg glass-level-2 border border-black/15 dark:border-white/15 text-[#101010] dark:text-white hover:bg-black/[0.04] dark:hover:bg-white/[0.08] font-medium flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50 touch-manipulation"
                        >
                          {enhancingThis ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Sparkles className="w-3.5 h-3.5" />
                          )}
                          {enhancingThis ? 'Enhancing...' : 'AI-Enhanced Analysis'}
                        </button>
                        <button
                          type="button"
                          onClick={() => onProjectCreated(proj, true)}
                          className="min-h-[40px] tablet:min-h-0 px-3.5 py-1.5 rounded-lg bg-[#101010] text-white hover:bg-[#262626] dark:bg-white dark:text-[#050505] dark:hover:bg-[#E6E6E6] font-medium whitespace-nowrap touch-manipulation"
                        >
                          Open in Editor
                        </button>
                      </div>
                    </div>

                    {report && (
                      <div className="grid grid-cols-3 tablet:grid-cols-7 gap-2 pt-2 border-t border-black/10 dark:border-white/10 text-[11px] tabular-nums">
                        <div className="px-2 py-1 rounded-lg bg-black/[0.03] dark:bg-white/[0.04]">
                          <div className="text-[#888888] dark:text-[#858585]">Text</div>
                          <div className="font-semibold text-[#101010] dark:text-white">{report.textObjects}</div>
                        </div>
                        <div className="px-2 py-1 rounded-lg bg-black/[0.03] dark:bg-white/[0.04]">
                          <div className="text-[#888888] dark:text-[#858585]">Images</div>
                          <div className="font-semibold text-[#101010] dark:text-white">{report.imageObjects}</div>
                        </div>
                        <div className="px-2 py-1 rounded-lg bg-black/[0.03] dark:bg-white/[0.04]">
                          <div className="text-[#888888] dark:text-[#858585]">Rectangles</div>
                          <div className="font-semibold text-[#101010] dark:text-white">{report.rectangles}</div>
                        </div>
                        <div className="px-2 py-1 rounded-lg bg-black/[0.03] dark:bg-white/[0.04]">
                          <div className="text-[#888888] dark:text-[#858585]">Lines</div>
                          <div className="font-semibold text-[#101010] dark:text-white">{report.lines}</div>
                        </div>
                        <div className="px-2 py-1 rounded-lg bg-black/[0.03] dark:bg-white/[0.04]">
                          <div className="text-[#888888] dark:text-[#858585]">Tables</div>
                          <div className="font-semibold text-[#101010] dark:text-white">{report.tables} ({report.tableCells} cells)</div>
                        </div>
                        <div className="px-2 py-1 rounded-lg bg-black/[0.03] dark:bg-white/[0.04]">
                          <div className="text-[#888888] dark:text-[#858585]">Forms</div>
                          <div className="font-semibold text-[#101010] dark:text-white">{report.formFields}</div>
                        </div>
                        <div className="px-2 py-1 rounded-lg bg-black/[0.03] dark:bg-white/[0.04]">
                          <div className="text-[#888888] dark:text-[#858585]">Review</div>
                          <div className={`font-semibold ${reviewCount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-[#101010] dark:text-white'}`}>
                            {reviewCount}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create Sample or Blank PDF Documents */}
      <div className="mt-8 pt-6 border-t border-black/10 dark:border-white/12">
        <h2 className="text-sm font-semibold text-[#101010] dark:text-white">
          Or Create a Sample or Blank PDF Document
        </h2>
        <p className="mt-1 text-xs text-[#555555] dark:text-[#B5B5B5]">
          Creates a vector PDF locally via pdf-lib and scans its layout structure with 0 AI credits used.
        </p>
        <div className="mt-4 grid grid-cols-1 tablet:grid-cols-3 gap-3">
          <motion.button
            type="button"
            disabled={isProcessing}
            whileHover={shouldReduceMotion || isProcessing ? undefined : CARD_HOVER}
            whileTap={shouldReduceMotion || isProcessing ? undefined : CARD_TAP}
            transition={MOTION_SPRING.snappy}
            onClick={() => void handleCreateStarter('dual_receipt')}
            className="p-4 rounded-2xl border glass-level-3 glass-interactive text-left disabled:opacity-50"
          >
            <FileText className="w-4 h-4 text-[#101010] dark:text-white mb-2" />
            <div className="text-xs font-semibold text-[#101010] dark:text-white">
              Dual-Block Receipt Sheet
            </div>
            <div className="mt-0.5 text-[11px] text-[#555555] dark:text-[#B5B5B5]">
              2 repeated receipt blocks for testing independent serial sequences
            </div>
          </motion.button>

          <motion.button
            type="button"
            disabled={isProcessing}
            whileHover={shouldReduceMotion || isProcessing ? undefined : CARD_HOVER}
            whileTap={shouldReduceMotion || isProcessing ? undefined : CARD_TAP}
            transition={MOTION_SPRING.snappy}
            onClick={() => void handleCreateStarter('invoice')}
            className="p-4 rounded-2xl border glass-level-3 glass-interactive text-left disabled:opacity-50"
          >
            <FileText className="w-4 h-4 text-[#101010] dark:text-white mb-2" />
            <div className="text-xs font-semibold text-[#101010] dark:text-white">
              Standard Invoice PDF
            </div>
            <div className="mt-0.5 text-[11px] text-[#555555] dark:text-[#B5B5B5]">
              Structured header, invoice number, customer block & line table
            </div>
          </motion.button>

          <motion.button
            type="button"
            disabled={isProcessing}
            whileHover={shouldReduceMotion || isProcessing ? undefined : CARD_HOVER}
            whileTap={shouldReduceMotion || isProcessing ? undefined : CARD_TAP}
            transition={MOTION_SPRING.snappy}
            onClick={() => void handleCreateStarter('blank')}
            className="p-4 rounded-2xl border glass-level-3 glass-interactive text-left disabled:opacity-50"
          >
            <FileText className="w-4 h-4 text-[#101010] dark:text-white mb-2" />
            <div className="text-xs font-semibold text-[#101010] dark:text-white">
              Blank A4 PDF Canvas
            </div>
            <div className="mt-0.5 text-[11px] text-[#555555] dark:text-[#B5B5B5]">
              Empty vector PDF ready for custom text, shapes, tables & logos
            </div>
          </motion.button>
        </div>
      </div>
    </div>
  );
};
