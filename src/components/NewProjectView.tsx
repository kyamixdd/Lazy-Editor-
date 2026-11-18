import React, { useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Loader2,
  ScanText,
  Upload,
} from 'lucide-react';
import {
  DocumentElement,
  PDFProject,
  StudioSettings,
} from '../types/pdfStudio';
import {
  renderPdfPagesForStudio,
  uint8ArrayToBase64,
} from '../utils/pdfRenderer';
import {
  createDefaultBulkConfig,
  createDefaultCopiesConfig,
  createDefaultExportConfig,
  createDefaultFitConfig,
  createDefaultPageConfig,
} from '../utils/units';

interface NewProjectViewProps {
  settings: StudioSettings;
  onProjectCreated: (project: PDFProject, openImmediately: boolean) => void;
}

export const NewProjectView: React.FC<NewProjectViewProps> = ({
  settings,
  onProjectCreated,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [enableOcr, setEnableOcr] = useState(true);
  const [runAiAnalysis, setRunAiAnalysis] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressStage, setProgressStage] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [completedProjects, setCompletedProjects] = useState<PDFProject[]>([]);

  const processPdfFile = async (
    fileName: string,
    pdfBytes: Uint8Array
  ): Promise<PDFProject> => {
    setProgressStage(`Rendering ${fileName} with PDF.js`);
    setProgressPercent(15);

    const rendered = await renderPdfPagesForStudio(pdfBytes, {
      renderScale: 1.7,
      enableOcrFallback: enableOcr,
      ocrLanguage: settings.ocrLanguage,
      maxPagesForAi: 15,
      onProgress: (stage, cur, total) => {
        setProgressStage(`${stage} (${cur}/${total}) — ${fileName}`);
        setProgressPercent(15 + Math.round((cur / Math.max(1, total)) * 40));
      },
    });

    const firstPage = rendered.originalPages[0] || {
      pageNumber: 1,
      widthPt: 595.28,
      heightPt: 841.89,
      orientation: 'portrait' as const,
    };

    let detectedElements: DocumentElement[] = [];
    let aiSummary = '';

    if (runAiAnalysis) {
      setProgressStage(`Running Gemini AI layout & element extraction on ${fileName}`);
      setProgressPercent(65);

      const response = await fetch('/api/ai/analyze-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName,
          pages: rendered.pages.map((p) => ({
            pageNumber: p.pageNumber,
            widthPt: p.widthPt,
            heightPt: p.heightPt,
            imageBase64: p.imageBase64,
            extractedTextItems: p.extractedTextItems,
          })),
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Gemini AI PDF analysis failed');
      }
      detectedElements = data.elements || [];
      aiSummary = data.summary || '';
    } else {
      // Direct PDF.js / OCR extraction fallback without Gemini call
      rendered.pages.forEach((p) => {
        p.extractedTextItems.forEach((item, idx) => {
          detectedElements.push({
            id: `raw-p${p.pageNumber}-${idx}`,
            type: 'text',
            pageNumber: p.pageNumber,
            x: item.x,
            y: item.y,
            width: item.width,
            height: item.height,
            rotation: 0,
            text: item.text,
            fontFamily: 'Helvetica',
            fontSize: item.fontSize,
            fontWeight: 'normal',
            fontStyle: 'normal',
            color: '#111827',
            backgroundColor: 'transparent',
            align: 'left',
            opacity: 1,
            editable: true,
            locked: false,
            visible: true,
            confidence: p.usedOcr ? 0.72 : 0.96,
            needsReview: p.usedOcr,
            reviewReason: p.usedOcr ? 'Extracted via OCR' : undefined,
            sourceOriginalRect: {
              x: item.x,
              y: item.y,
              width: item.width,
              height: item.height,
            },
          });
        });
      });
    }

    setProgressStage('Finalizing structured layout JSON');
    setProgressPercent(95);

    const base64 = uint8ArrayToBase64(pdfBytes);
    const now = new Date().toISOString();
    const project: PDFProject = {
      id: `proj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: fileName.replace(/\.pdf$/i, ''),
      description: aiSummary || `Imported from ${fileName}`,
      version: 1,
      createdAt: now,
      updatedAt: now,
      sourcePdfName: fileName,
      sourcePdfBase64: base64,
      pageCount: rendered.pageCount,
      originalPages: rendered.originalPages,
      elements: detectedElements,
      pageConfig: createDefaultPageConfig(
        firstPage.widthPt,
        firstPage.heightPt,
        settings.defaultUnit
      ),
      fitConfig: createDefaultFitConfig(firstPage.widthPt, firstPage.heightPt),
      copiesConfig: createDefaultCopiesConfig(),
      serialRules: [],
      bulkConfig: createDefaultBulkConfig(),
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
      aiSummary,
      isTemplate: false,
      versions: [],
    };

    // Auto-create a default serial rule if invoice/receipt number detected
    const serialCandidate = detectedElements.find(
      (e) =>
        e.type === 'invoice_number' ||
        e.type === 'receipt_number' ||
        (e.fieldKey &&
          (e.fieldKey.includes('invoice') || e.fieldKey.includes('receipt')))
    );
    if (serialCandidate) {
      const fKey = serialCandidate.fieldKey || 'serial_number';
      if (!serialCandidate.fieldKey) {
        serialCandidate.fieldKey = fKey;
      }
      project.serialRules.push({
        id: `seq-${Date.now()}`,
        name: 'Primary Sequence',
        targetFieldKey: fKey,
        blockIndex: 0,
        mode: 'auto',
        startNumber: 1,
        endNumber: 250,
        increment: 1,
        prefix: serialCandidate.type === 'receipt_number' ? 'RCP-' : 'INV-',
        suffix: '',
        digits: 4,
        leadingZeros: true,
        repeatCount: 1,
      });
    }

    return project;
  };

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setErrorMessage(null);
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
        const file = pdfFiles[i];
        const buffer = await file.arrayBuffer();
        const project = await processPdfFile(file.name, new Uint8Array(buffer));
        created.push(project);
        onProjectCreated(project, i === pdfFiles.length - 1 && pdfFiles.length === 1);
      }
      setCompletedProjects(created);
      setProgressPercent(100);
      setProgressStage('Analysis complete');
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Failed to analyze uploaded PDF'
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCreateStarter = async (
    templateKind: 'invoice' | 'dual_receipt' | 'blank'
  ) => {
    setErrorMessage(null);
    setIsProcessing(true);
    setProgressStage('Generating PDF document');
    setProgressPercent(10);

    try {
      const res = await fetch('/api/pdf/create-starter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateKind }),
      });
      const data = await res.json();
      if (!res.ok || !data.base64) {
        throw new Error(data.error || 'Failed to generate starter PDF');
      }
      const binary = atob(data.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

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

  return (
    <div className="flex-1 overflow-y-auto p-4 tablet:p-6 desktop:p-8 max-w-5xl mx-auto w-full">
      <div className="pb-5 tablet:pb-6 border-b border-slate-200 dark:border-slate-800">
        <h1 className="text-xl tablet:text-2xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          New PDF Project
        </h1>
        <p className="mt-1 text-xs tablet:text-sm text-slate-600 dark:text-slate-400">
          Upload one or multiple PDFs (multi-page, text-based, or scanned) to extract structured elements with Gemini AI while preserving the original PDF geometry.
        </p>
      </div>

      {/* Dropzone */}
      <div
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
        className={`mt-5 tablet:mt-6 rounded-lg border-2 border-dashed p-6 tablet:p-10 text-center cursor-pointer transition-colors touch-manipulation ${
          isDragging
            ? 'border-blue-500 bg-blue-500/10'
            : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111827] hover:border-blue-500/60'
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
        <Upload className="w-8 h-8 tablet:w-9 tablet:h-9 text-blue-600 dark:text-blue-400 mx-auto mb-3" />
        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Drop PDF files here or tap to browse
        </div>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Supports multiple PDFs, multi-page documents, scanned/image PDFs, and large templates
        </p>
        <div className="mt-4">
          <span className="inline-flex min-h-[44px] items-center justify-center px-4 py-2 rounded-md bg-blue-600 text-white text-xs font-medium">
            Choose PDF File
          </span>
        </div>
      </div>

      {/* Analysis Options */}
      <div className="mt-4 grid grid-cols-1 tablet:grid-cols-2 gap-3.5 tablet:gap-4">
        <label className="flex items-start gap-3 p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] cursor-pointer">
          <input
            type="checkbox"
            checked={runAiAnalysis}
            onChange={(e) => setRunAiAnalysis(e.target.checked)}
            className="mt-0.5 rounded border-slate-400 text-blue-600 focus:ring-blue-500"
          />
          <div>
            <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              Gemini Multimodal Layout Analysis
            </div>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Detect headings, invoice/receipt numbers, tables, borders, repeated blocks, field relationships, and flag uncertain items for review.
            </p>
          </div>
        </label>

        <label className="flex items-start gap-3 p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] cursor-pointer">
          <input
            type="checkbox"
            checked={enableOcr}
            onChange={(e) => setEnableOcr(e.target.checked)}
            className="mt-0.5 rounded border-slate-400 text-blue-600 focus:ring-blue-500"
          />
          <div>
            <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
              <ScanText className="w-3.5 h-3.5 text-blue-500" />
              Automatic Tesseract OCR for Scanned Pages
            </div>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Automatically runs optical character recognition when a page contains image-only text without embedded PDF fonts.
            </p>
          </div>
        </label>
      </div>

      {/* Progress Bar */}
      {isProcessing && (
        <div className="mt-6 p-4 rounded-lg border border-blue-500/40 bg-blue-500/5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-800 dark:text-slate-200 mb-2">
            <span className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
              {progressStage}
            </span>
            <span className="tabular-nums">{progressPercent}%</span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
            <div
              className="h-full bg-blue-600 transition-all duration-200"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Error Notice */}
      {errorMessage && (
        <div className="mt-6 p-4 rounded-lg border border-red-500/40 bg-red-500/10 text-xs text-red-700 dark:text-red-300 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">PDF Import / Analysis Error</div>
            <div className="mt-0.5">{errorMessage}</div>
          </div>
        </div>
      )}

      {/* Multi-file Results */}
      {completedProjects.length > 0 && !isProcessing && (
        <div className="mt-6 p-4 rounded-lg border border-emerald-500/40 bg-emerald-500/5 space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="w-4 h-4" />
            Processed {completedProjects.length} PDF project(s)
          </div>
          {completedProjects.map((proj) => {
            const reviewCount = proj.elements.filter((e) => e.needsReview).length;
            return (
              <div
                key={proj.id}
                className="flex flex-col tablet:flex-row tablet:items-center justify-between gap-3 p-3 rounded-md bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 text-xs"
              >
                <div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    {proj.name}
                  </div>
                  <div className="mt-0.5 text-slate-500 dark:text-slate-400 tabular-nums">
                    {proj.pageCount} pages · {proj.elements.length} detected elements
                    {reviewCount > 0 ? ` · ${reviewCount} flagged for manual review` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onProjectCreated(proj, true)}
                  className="min-h-[40px] tablet:min-h-0 px-3 py-1.5 rounded bg-blue-600 text-white font-medium hover:bg-blue-700 whitespace-nowrap touch-manipulation"
                >
                  Open in Editor
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Real Starter PDF Documents */}
      <div className="mt-8 pt-6 border-t border-slate-200 dark:border-slate-800">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Or Generate a New Starter PDF Document
        </h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Generates a real vector PDF on the server via pdf-lib and runs it through the studio analyzer.
        </p>
        <div className="mt-4 grid grid-cols-1 tablet:grid-cols-3 gap-3">
          <button
            type="button"
            disabled={isProcessing}
            onClick={() => void handleCreateStarter('dual_receipt')}
            className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] hover:border-blue-500/60 text-left transition-colors disabled:opacity-50"
          >
            <FileText className="w-4 h-4 text-blue-500 mb-2" />
            <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              Dual-Block Receipt Sheet
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              2 repeated receipt blocks for testing independent serial sequences
            </div>
          </button>

          <button
            type="button"
            disabled={isProcessing}
            onClick={() => void handleCreateStarter('invoice')}
            className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] hover:border-blue-500/60 text-left transition-colors disabled:opacity-50"
          >
            <FileText className="w-4 h-4 text-blue-500 mb-2" />
            <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              Standard Invoice PDF
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              Structured header, invoice number, customer block & line table
            </div>
          </button>

          <button
            type="button"
            disabled={isProcessing}
            onClick={() => void handleCreateStarter('blank')}
            className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] hover:border-blue-500/60 text-left transition-colors disabled:opacity-50"
          >
            <FileText className="w-4 h-4 text-blue-500 mb-2" />
            <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              Blank A4 PDF Canvas
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              Empty vector PDF ready for custom text, shapes, tables & logos
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};
