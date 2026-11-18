import React, { useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import {
  ArrowDown,
  ArrowUp,
  CopyPlus,
  Download,
  FilePlus2,
  FolderInput,
  Loader2,
  RotateCw,
  Scissors,
  Trash2,
} from 'lucide-react';
import {
  DocumentElement,
  OriginalPageMeta,
  PDFProject,
} from '../types/pdfStudio';
import { triggerBytesDownload } from '../utils/downloadHelper';
import {
  base64ToUint8Array,
  renderSinglePagePreview,
  uint8ArrayToBase64,
} from '../utils/pdfRenderer';
import { GlassButton, GlassCard, GlassModal } from './glass';

interface PageEngineeringModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: PDFProject;
  currentPage: number;
  onApplyPageStructure: (
    nextProject: PDFProject,
    nextCurrentPage: number,
    historyLabel: string
  ) => void;
}

/**
 * Ensures we always have a real PDF byte buffer matching project.originalPages so
 * page-engineering mutations (insert blank, reorder, duplicate, delete, merge) remain
 * 100% consistent across Canvas Preview and Export Center.
 */
async function ensureSourcePdfDocument(project: PDFProject): Promise<PDFDocument> {
  if (project.sourcePdfBase64) {
    const doc = await PDFDocument.load(base64ToUint8Array(project.sourcePdfBase64));
    while (doc.getPageCount() < project.pageCount) {
      doc.addPage([project.pageConfig.widthPt, project.pageConfig.heightPt]);
    }
    return doc;
  }
  const blankDoc = await PDFDocument.create();
  for (let i = 0; i < Math.max(1, project.pageCount); i++) {
    const meta = project.originalPages[i];
    blankDoc.addPage([
      meta?.widthPt || project.pageConfig.widthPt,
      meta?.heightPt || project.pageConfig.heightPt,
    ]);
  }
  return blankDoc;
}

export const PageEngineeringModal: React.FC<PageEngineeringModalProps> = ({
  isOpen,
  onClose,
  project,
  currentPage,
  onApplyPageStructure,
}) => {
  const [selectedPages, setSelectedPages] = useState<number[]>([currentPage]);
  const [busy, setBusy] = useState(false);
  const [splitRanges, setSplitRanges] = useState('1-1');
  const [batchHeader, setBatchHeader] = useState(project.pageConfig.headerText || '');
  const [batchFooter, setBatchFooter] = useState(project.pageConfig.footerText || '');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const mergeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setSelectedPages([currentPage]);
    setBatchHeader(project.pageConfig.headerText || '');
    setBatchFooter(project.pageConfig.footerText || '');
    setStatusMsg(null);
  }, [isOpen, project.id]);

  const pageList = useMemo(() => {
    const arr: OriginalPageMeta[] = [];
    for (let p = 1; p <= Math.max(1, project.pageCount); p++) {
      const existing = project.originalPages.find((m) => m.pageNumber === p);
      arr.push(
        existing || {
          pageNumber: p,
          sourcePdfPageNumber: p,
          widthPt: project.pageConfig.widthPt,
          heightPt: project.pageConfig.heightPt,
          orientation:
            project.pageConfig.widthPt > project.pageConfig.heightPt
              ? 'landscape'
              : 'portrait',
        }
      );
    }
    return arr;
  }, [project.originalPages, project.pageCount, project.pageConfig]);

  const toggleSelectPage = (p: number) => {
    setSelectedPages((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p].sort((a, b) => a - b)
    );
  };

  const handleInsertBlankPage = async (where: 'before' | 'after') => {
    setBusy(true);
    setStatusMsg(null);
    try {
      const targetAnchor = selectedPages[0] || currentPage;
      const insertAtIndex = where === 'before' ? targetAnchor - 1 : targetAnchor;
      const newPageNumber = insertAtIndex + 1;
      const wPt = project.pageConfig.widthPt;
      const hPt = project.pageConfig.heightPt;

      const doc = await ensureSourcePdfDocument(project);
      doc.insertPage(insertAtIndex, [wPt, hPt]);
      const nextBytes = await doc.save();
      const nextB64 = uint8ArrayToBase64(nextBytes);

      const newMeta: OriginalPageMeta = {
        pageNumber: newPageNumber,
        sourcePdfPageNumber: newPageNumber,
        widthPt: wPt,
        heightPt: hPt,
        orientation: wPt > hPt ? 'landscape' : 'portrait',
        isBlankInserted: true,
      };

      const nextPages: OriginalPageMeta[] = [
        ...pageList
          .filter((p) => p.pageNumber < newPageNumber)
          .map((p, i) => ({ ...p, pageNumber: i + 1, sourcePdfPageNumber: i + 1 })),
        newMeta,
        ...pageList
          .filter((p) => p.pageNumber >= newPageNumber)
          .map((p) => ({
            ...p,
            pageNumber: p.pageNumber + 1,
            sourcePdfPageNumber: p.pageNumber + 1,
          })),
      ];

      const nextElements = project.elements.map((el) =>
        el.pageNumber >= newPageNumber
          ? { ...el, pageNumber: el.pageNumber + 1 }
          : el
      );

      onApplyPageStructure(
        {
          ...project,
          sourcePdfBase64: nextB64,
          pageCount: nextPages.length,
          originalPages: nextPages,
          elements: nextElements,
          updatedAt: new Date().toISOString(),
        },
        newPageNumber,
        `Insert Blank Page (${where} Page ${targetAnchor})`
      );
      setSelectedPages([newPageNumber]);
      setStatusMsg(`Inserted blank page at Page ${newPageNumber}.`);
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Failed to insert blank page.');
    } finally {
      setBusy(false);
    }
  };

  const handleDuplicateSelected = async () => {
    const targets = selectedPages.length > 0 ? selectedPages : [currentPage];
    setBusy(true);
    setStatusMsg(null);
    try {
      const srcDoc = await ensureSourcePdfDocument(project);
      const outDoc = await PDFDocument.create();
      const nextPages: OriginalPageMeta[] = [];
      const nextElements: DocumentElement[] = [];

      let outPageNum = 1;
      for (const pg of pageList) {
        const [copiedOrig] = await outDoc.copyPages(srcDoc, [pg.pageNumber - 1]);
        outDoc.addPage(copiedOrig);
        nextPages.push({
          ...structuredClone(pg),
          pageNumber: outPageNum,
          sourcePdfPageNumber: outPageNum,
        });
        for (const el of project.elements.filter((e) => e.pageNumber === pg.pageNumber)) {
          nextElements.push({ ...structuredClone(el), pageNumber: outPageNum });
        }
        outPageNum++;

        if (targets.includes(pg.pageNumber)) {
          const [copiedDup] = await outDoc.copyPages(srcDoc, [pg.pageNumber - 1]);
          outDoc.addPage(copiedDup);
          nextPages.push({
            ...structuredClone(pg),
            pageNumber: outPageNum,
            sourcePdfPageNumber: outPageNum,
          });
          for (const el of project.elements.filter((e) => e.pageNumber === pg.pageNumber)) {
            nextElements.push({
              ...structuredClone(el),
              id: `el-dup-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              pageNumber: outPageNum,
            });
          }
          outPageNum++;
        }
      }

      const bytes = await outDoc.save();
      onApplyPageStructure(
        {
          ...project,
          sourcePdfBase64: uint8ArrayToBase64(bytes),
          pageCount: nextPages.length,
          originalPages: nextPages,
          elements: nextElements,
          updatedAt: new Date().toISOString(),
        },
        Math.min(nextPages.length, currentPage),
        `Duplicate Page(s) ${targets.join(', ')}`
      );
      setStatusMsg(`Duplicated ${targets.length} page(s).`);
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Failed to duplicate page(s).');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteSelected = async () => {
    const targets = new Set(selectedPages.length > 0 ? selectedPages : [currentPage]);
    if (targets.size >= pageList.length) {
      setStatusMsg('Cannot delete all pages — at least 1 page must remain.');
      return;
    }
    setBusy(true);
    setStatusMsg(null);
    try {
      const srcDoc = await ensureSourcePdfDocument(project);
      const outDoc = await PDFDocument.create();
      const nextPages: OriginalPageMeta[] = [];
      const nextElements: DocumentElement[] = [];

      let outPageNum = 1;
      for (const pg of pageList) {
        if (targets.has(pg.pageNumber)) continue;
        const [copied] = await outDoc.copyPages(srcDoc, [pg.pageNumber - 1]);
        outDoc.addPage(copied);
        nextPages.push({
          ...structuredClone(pg),
          pageNumber: outPageNum,
          sourcePdfPageNumber: outPageNum,
        });
        for (const el of project.elements.filter((e) => e.pageNumber === pg.pageNumber)) {
          nextElements.push({ ...structuredClone(el), pageNumber: outPageNum });
        }
        outPageNum++;
      }

      const bytes = await outDoc.save();
      const nextPage = Math.max(1, Math.min(currentPage, nextPages.length));
      setSelectedPages([nextPage]);
      onApplyPageStructure(
        {
          ...project,
          sourcePdfBase64: uint8ArrayToBase64(bytes),
          pageCount: nextPages.length,
          originalPages: nextPages,
          elements: nextElements,
          updatedAt: new Date().toISOString(),
        },
        nextPage,
        `Delete Page(s) ${Array.from(targets).join(', ')}`
      );
      setStatusMsg(`Deleted ${targets.size} page(s).`);
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Failed to delete selected page(s).');
    } finally {
      setBusy(false);
    }
  };

  const handleMovePage = async (pageNum: number, delta: -1 | 1) => {
    const idx = pageNum - 1;
    const swapIdx = idx + delta;
    if (swapIdx < 0 || swapIdx >= pageList.length) return;

    setBusy(true);
    setStatusMsg(null);
    try {
      const order = pageList.map((p) => p.pageNumber);
      [order[idx], order[swapIdx]] = [order[swapIdx], order[idx]];

      const srcDoc = await ensureSourcePdfDocument(project);
      const outDoc = await PDFDocument.create();
      const copiedPages = await outDoc.copyPages(
        srcDoc,
        order.map((n) => n - 1)
      );
      copiedPages.forEach((cp) => outDoc.addPage(cp));

      const nextPages: OriginalPageMeta[] = [];
      const nextElements: DocumentElement[] = [];

      order.forEach((oldPageNum, newIdx) => {
        const newPageNum = newIdx + 1;
        const oldMeta = pageList.find((p) => p.pageNumber === oldPageNum)!;
        nextPages.push({
          ...structuredClone(oldMeta),
          pageNumber: newPageNum,
          sourcePdfPageNumber: newPageNum,
        });
        for (const el of project.elements.filter((e) => e.pageNumber === oldPageNum)) {
          nextElements.push({ ...structuredClone(el), pageNumber: newPageNum });
        }
      });

      const bytes = await outDoc.save();
      const movedTarget = swapIdx + 1;
      setSelectedPages([movedTarget]);
      onApplyPageStructure(
        {
          ...project,
          sourcePdfBase64: uint8ArrayToBase64(bytes),
          pageCount: nextPages.length,
          originalPages: nextPages,
          elements: nextElements,
          updatedAt: new Date().toISOString(),
        },
        movedTarget,
        `Reorder Page ${pageNum} -> ${movedTarget}`
      );
      setStatusMsg(`Moved Page ${pageNum} to Page ${movedTarget}.`);
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Failed to reorder page.');
    } finally {
      setBusy(false);
    }
  };

  const handleRotateSelected = () => {
    const targets = new Set(selectedPages.length > 0 ? selectedPages : [currentPage]);
    const nextPages = pageList.map((p) => {
      if (!targets.has(p.pageNumber)) return p;
      const nextRot = (((p.rotation || 0) + 90) % 360) as 0 | 90 | 180 | 270;
      return { ...p, rotation: nextRot };
    });
    onApplyPageStructure(
      {
        ...project,
        originalPages: nextPages,
        updatedAt: new Date().toISOString(),
      },
      currentPage,
      `Rotate Page(s) ${Array.from(targets).join(', ')} +90°`
    );
    setStatusMsg(`Rotated ${targets.size} page(s) by 90°.`);
  };

  const handleApplyBatchHeadersFooters = () => {
    const targets = new Set(selectedPages.length > 0 ? selectedPages : [currentPage]);
    const nextPages = pageList.map((p) =>
      targets.has(p.pageNumber)
        ? {
            ...p,
            headerText: batchHeader,
            footerText: batchFooter,
          }
        : p
    );
    onApplyPageStructure(
      {
        ...project,
        originalPages: nextPages,
        updatedAt: new Date().toISOString(),
      },
      currentPage,
      `Update Header/Footer on ${targets.size} page(s)`
    );
    setStatusMsg(`Updated header/footer on ${targets.size} page(s).`);
  };

  const handleExtractSelected = async () => {
    const targets = (selectedPages.length > 0 ? selectedPages : [currentPage]).filter(
      (p) => p >= 1 && p <= pageList.length
    );
    if (targets.length === 0) return;
    setBusy(true);
    try {
      const srcDoc = await ensureSourcePdfDocument(project);
      const outDoc = await PDFDocument.create();
      const copied = await outDoc.copyPages(
        srcDoc,
        targets.map((n) => n - 1)
      );
      copied.forEach((p) => outDoc.addPage(p));
      const bytes = await outDoc.save();
      triggerBytesDownload(
        bytes,
        `${project.name.replace(/\s+/g, '_')}_pages_${targets.join('-')}.pdf`,
        'application/pdf'
      );
      setStatusMsg(`Extracted ${targets.length} page(s) as PDF.`);
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Failed to extract selected pages.');
    } finally {
      setBusy(false);
    }
  };

  const handleSplitRangesZip = async () => {
    const tokens = splitRanges
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (tokens.length === 0) return;
    setBusy(true);
    try {
      const srcDoc = await ensureSourcePdfDocument(project);
      const zip = new JSZip();
      let partIndex = 1;
      for (const tok of tokens) {
        const m = /^(\d+)(?:-(\d+))?$/.exec(tok);
        if (!m) continue;
        const start = Math.max(1, Number(m[1]));
        const end = Math.min(pageList.length, Number(m[2] || m[1]));
        if (start > end) continue;
        const indices: number[] = [];
        for (let p = start; p <= end; p++) indices.push(p - 1);
        const subDoc = await PDFDocument.create();
        const copied = await subDoc.copyPages(srcDoc, indices);
        copied.forEach((cp) => subDoc.addPage(cp));
        const subBytes = await subDoc.save();
        zip.file(`part_${partIndex}_p${start}-${end}.pdf`, subBytes);
        partIndex++;
      }
      if (partIndex === 1) {
        setStatusMsg('No valid page ranges entered (example: 1-2, 3-4).');
        return;
      }
      const zipBytes = await zip.generateAsync({ type: 'uint8array' });
      triggerBytesDownload(
        zipBytes,
        `${project.name.replace(/\s+/g, '_')}_split.zip`,
        'application/zip'
      );
      setStatusMsg(`Split into ${partIndex - 1} PDF file(s) inside ZIP.`);
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Failed to split PDF ranges.');
    } finally {
      setBusy(false);
    }
  };

  const handleMergeExternalPdf = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setStatusMsg(null);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const extDoc = await PDFDocument.load(buf);
      const extCount = extDoc.getPageCount();
      if (extCount === 0) return;

      const baseDoc = await ensureSourcePdfDocument(project);
      const baseCount = baseDoc.getPageCount();
      const indices = Array.from({ length: extCount }, (_, i) => i);
      const copied = await baseDoc.copyPages(extDoc, indices);
      copied.forEach((p) => baseDoc.addPage(p));
      const mergedBytes = await baseDoc.save();
      const mergedB64 = uint8ArrayToBase64(mergedBytes);

      const newMetas: OriginalPageMeta[] = [...pageList];
      for (let i = 0; i < extCount; i++) {
        const newPgNum = baseCount + i + 1;
        const pg = extDoc.getPage(i);
        const { width, height } = pg.getSize();
        const preview = await renderSinglePagePreview(mergedB64, newPgNum, 1.3);
        newMetas.push({
          pageNumber: newPgNum,
          sourcePdfPageNumber: newPgNum,
          widthPt: Number(width.toFixed(1)),
          heightPt: Number(height.toFixed(1)),
          orientation: width > height ? 'landscape' : 'portrait',
          previewImageDataUrl: preview || undefined,
        });
      }

      onApplyPageStructure(
        {
          ...project,
          sourcePdfBase64: mergedB64,
          pageCount: newMetas.length,
          originalPages: newMetas,
          updatedAt: new Date().toISOString(),
        },
        baseCount + 1,
        `Merge External PDF "${file.name}" (+${extCount} pages)`
      );
      setStatusMsg(`Merged ${extCount} page(s) from "${file.name}".`);
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Failed to merge PDF.');
    } finally {
      setBusy(false);
      if (mergeInputRef.current) mergeInputRef.current.value = '';
    }
  };

  return (
    <GlassModal
      isOpen={isOpen}
      onClose={onClose}
      title="Page Engineering Studio"
      subtitle="Insert, reorder, duplicate, delete, rotate, split, extract, and merge PDF pages"
      maxWidthClass="max-w-4xl"
    >
      <input
        ref={mergeInputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => void handleMergeExternalPdf(e.target.files?.[0])}
      />

      <div className="p-4 tablet:p-5 space-y-4 text-xs">
        {statusMsg && (
          <div className="px-3.5 py-2 rounded-xl border border-black/15 dark:border-white/15 glass-level-3 text-[#101010] dark:text-white font-medium flex items-center justify-between">
            <span>{statusMsg}</span>
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          </div>
        )}

        {/* Action Toolbar */}
        <div className="flex flex-wrap gap-2">
          <GlassButton
            variant="glass"
            size="sm"
            disabled={busy}
            onClick={() => void handleInsertBlankPage('after')}
          >
            <FilePlus2 className="w-3.5 h-3.5" />
            Insert Blank After
          </GlassButton>
          <GlassButton
            variant="glass"
            size="sm"
            disabled={busy}
            onClick={() => void handleInsertBlankPage('before')}
          >
            <FilePlus2 className="w-3.5 h-3.5" />
            Insert Blank Before
          </GlassButton>
          <GlassButton
            variant="glass"
            size="sm"
            disabled={busy}
            onClick={() => void handleDuplicateSelected()}
          >
            <CopyPlus className="w-3.5 h-3.5" />
            Duplicate Selected
          </GlassButton>
          <GlassButton
            variant="glass"
            size="sm"
            disabled={busy || pageList.length <= 1}
            onClick={() => void handleDeleteSelected()}
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete Selected
          </GlassButton>
          <GlassButton
            variant="glass"
            size="sm"
            disabled={busy}
            onClick={handleRotateSelected}
          >
            <RotateCw className="w-3.5 h-3.5" />
            Rotate +90°
          </GlassButton>
          <GlassButton
            variant="glass"
            size="sm"
            disabled={busy}
            onClick={() => mergeInputRef.current?.click()}
          >
            <FolderInput className="w-3.5 h-3.5" />
            Merge External PDF
          </GlassButton>
          <GlassButton
            variant="primary"
            size="sm"
            disabled={busy}
            onClick={() => void handleExtractSelected()}
          >
            <Download className="w-3.5 h-3.5" />
            Extract Selected PDF
          </GlassButton>
        </div>

        {/* Pages List */}
        <GlassCard level={2} padding="none" className="overflow-hidden">
          <div className="px-3.5 py-2.5 border-b border-black/10 dark:border-white/12 flex items-center justify-between">
            <span className="font-semibold text-[#101010] dark:text-white">
              Document Pages ({pageList.length})
            </span>
            <button
              type="button"
              onClick={() =>
                setSelectedPages(
                  selectedPages.length === pageList.length
                    ? [currentPage]
                    : pageList.map((p) => p.pageNumber)
                )
              }
              className="text-[11px] font-medium text-[#555555] dark:text-[#B5B5B5] hover:text-[#101010] dark:hover:text-white"
            >
              {selectedPages.length === pageList.length
                ? 'Select Current Only'
                : 'Select All Pages'}
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto divide-y divide-black/10 dark:divide-white/10">
            {pageList.map((pg, idx) => {
              const checked = selectedPages.includes(pg.pageNumber);
              const elCount = project.elements.filter(
                (e) => e.pageNumber === pg.pageNumber
              ).length;
              return (
                <div
                  key={pg.pageNumber}
                  className="px-3.5 py-2.5 flex items-center justify-between gap-3"
                >
                  <label className="flex items-center gap-3 min-w-0 cursor-pointer flex-1">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSelectPage(pg.pageNumber)}
                      className="accent-[#101010] dark:accent-white"
                    />
                    <div className="w-10 h-12 rounded border border-black/15 dark:border-white/15 bg-white overflow-hidden flex items-center justify-center shrink-0">
                      {pg.previewImageDataUrl ? (
                        <img
                          src={pg.previewImageDataUrl}
                          alt={`Page ${pg.pageNumber}`}
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <span className="text-[10px] font-mono text-[#888888]">
                          P{pg.pageNumber}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-[#101010] dark:text-white tabular-nums">
                        Page {pg.pageNumber}
                        {pg.pageNumber === currentPage && (
                          <span className="ml-2 text-[10px] font-normal px-1.5 py-0.5 rounded bg-black/10 dark:bg-white/15">
                            Current
                          </span>
                        )}
                        {pg.isBlankInserted && (
                          <span className="ml-1.5 text-[10px] font-normal text-[#888888]">
                            (Blank)
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[#555555] dark:text-[#B5B5B5] tabular-nums">
                        {Math.round(pg.widthPt)}×{Math.round(pg.heightPt)} pt ·{' '}
                        {elCount} elements · Rot {pg.rotation || 0}°
                      </div>
                    </div>
                  </label>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      disabled={busy || idx === 0}
                      onClick={() => void handleMovePage(pg.pageNumber, -1)}
                      title="Move Page Up"
                      className="p-1.5 rounded-lg border border-black/10 dark:border-white/12 disabled:opacity-35 hover:bg-black/5 dark:hover:bg-white/10"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={busy || idx === pageList.length - 1}
                      onClick={() => void handleMovePage(pg.pageNumber, 1)}
                      title="Move Page Down"
                      className="p-1.5 rounded-lg border border-black/10 dark:border-white/12 disabled:opacity-35 hover:bg-black/5 dark:hover:bg-white/10"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </GlassCard>

        {/* Split & Batch Headers/Footers */}
        <div className="grid grid-cols-1 tablet:grid-cols-2 gap-4">
          <GlassCard level={2} padding="sm" className="space-y-2.5">
            <div className="font-semibold text-[#101010] dark:text-white flex items-center gap-1.5">
              <Scissors className="w-3.5 h-3.5" />
              Split PDF by Page Ranges (ZIP)
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={splitRanges}
                onChange={(e) => setSplitRanges(e.target.value)}
                placeholder="e.g. 1-2, 3-5"
                className="flex-1 min-h-[36px] px-2.5 py-1 rounded-xl studio-input font-mono"
              />
              <GlassButton
                variant="glass"
                size="sm"
                disabled={busy}
                onClick={() => void handleSplitRangesZip()}
              >
                Split ZIP
              </GlassButton>
            </div>
          </GlassCard>

          <GlassCard level={2} padding="sm" className="space-y-2">
            <div className="font-semibold text-[#101010] dark:text-white">
              Batch Header &amp; Footer (Selected Pages)
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={batchHeader}
                onChange={(e) => setBatchHeader(e.target.value)}
                placeholder="Header ({page}/{total})"
                className="px-2.5 py-1.5 rounded-xl studio-input"
              />
              <input
                type="text"
                value={batchFooter}
                onChange={(e) => setBatchFooter(e.target.value)}
                placeholder="Footer ({page}/{total})"
                className="px-2.5 py-1.5 rounded-xl studio-input"
              />
            </div>
            <GlassButton
              variant="glass"
              size="sm"
              className="w-full"
              onClick={handleApplyBatchHeadersFooters}
            >
              Apply Header &amp; Footer to Selected
            </GlassButton>
          </GlassCard>
        </div>
      </div>
    </GlassModal>
  );
};
