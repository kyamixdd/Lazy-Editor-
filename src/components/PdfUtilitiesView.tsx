import React, { useEffect, useRef, useState } from 'react';
import {
  BookMarked,
  CheckCircle2,
  Download,
  FileCode2,
  FileSpreadsheet,
  FormInput,
  Image as ImageIcon,
  Lock,
  Merge,
  Plus,
  Scissors,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  Wrench,
} from 'lucide-react';
import { PDFProject } from '../types/pdfStudio';
import { renderSinglePagePreview, uint8ArrayToBase64 } from '../utils/pdfRenderer';
import { computeSha256Hex } from '../utils/passportEngine';
import {
  AcroFormFieldSpec,
  AcroFormReadValue,
  PdfBookmarkItem,
  PdfMetadataValues,
  addAcroFormFieldsToPdf,
  applyPdfA1bXmpMetadata,
  convertMarkdownToPdf,
  convertStructuredRowsToPdf,
  mergePdfByteArrays,
  readAcroFormValues,
  readPdfBookmarks,
  readPdfMetadata,
  repairAndOptimizePdf,
  splitOrExtractPdfPages,
  writeOrScrubPdfMetadata,
  writePdfBookmarks,
} from '../utils/pdfUtilitiesEngine';
import { parseRangeFilterNumbers } from '../utils/batchExportEngine';
import { formatBytesCompact } from '../utils/projectStorage';
import { triggerBytesDownload } from '../utils/downloadHelper';
import { GlassButton, GlassCard } from './glass';
import { NumericDraftInput } from './NumericDraftInput';

interface PdfUtilitiesViewProps {
  activeProject: PDFProject | null;
}

type UtilityTab =
  | 'metadata'
  | 'outlines'
  | 'split_merge'
  | 'forms'
  | 'archival_security'
  | 'convert';

export const PdfUtilitiesView: React.FC<PdfUtilitiesViewProps> = ({
  activeProject,
}) => {
  const [tab, setTab] = useState<UtilityTab>('metadata');
  const [loadedName, setLoadedName] = useState<string>(
    activeProject ? `${activeProject.name}.pdf` : ''
  );
  const [workingBytes, setWorkingBytes] = useState<Uint8Array | null>(() => {
    if (!activeProject?.sourcePdfBase64) return null;
    try {
      const bin = atob(activeProject.sourcePdfBase64);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    } catch {
      return null;
    }
  });
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [sha256, setSha256] = useState<string | null>(null);
  const hasExternalUploadRef = useRef(false);
  const lastInspectedProjectIdRef = useRef<string | null>(null);

  // Metadata state
  const [meta, setMeta] = useState<PdfMetadataValues>({
    title: '',
    author: '',
    subject: '',
    keywords: '',
    creator: 'PDF Studio AI',
    producer: 'PDF Studio AI',
    pageCount: activeProject?.pageCount || 0,
  });

  // Bookmarks state
  const [bookmarks, setBookmarks] = useState<PdfBookmarkItem[]>([]);
  const [newBmTitle, setNewBmTitle] = useState('');
  const [newBmPage, setNewBmPage] = useState(1);

  // Split / Merge state
  const [extractRange, setExtractRange] = useState('1');
  const [mergeList, setMergeList] = useState<
    Array<{ name: string; bytes: Uint8Array }>
  >([]);

  // AcroForm state
  const [formFields, setFormFields] = useState<AcroFormFieldSpec[]>([
    {
      name: 'customer_signature',
      kind: 'text',
      pageNumber: 1,
      xPt: 72,
      yPt: 640,
      widthPt: 220,
      heightPt: 24,
      defaultValue: '',
    },
  ]);
  const [readFields, setReadFields] = useState<AcroFormReadValue[]>([]);

  // Archival PDF/A state
  const [archivalNote, setArchivalNote] = useState<string | null>(null);

  // Conversion state
  const [imageFormat, setImageFormat] = useState<'png' | 'jpeg' | 'webp'>('png');
  const [convertPageNum, setConvertPageNum] = useState(1);
  const [markdownInput, setMarkdownInput] = useState(
    '# Invoice Cover Sheet\n## Summary\nGenerated locally by Lazy Editor.'
  );
  const [markdownTitle, setMarkdownTitle] = useState('Converted Document');

  const downloadBytes = (bytes: Uint8Array, fileName: string, mime = 'application/pdf') => {
    triggerBytesDownload(bytes, fileName, mime);
  };

  const inspectBuffer = async (bytes: Uint8Array, name: string) => {
    try {
      setWorkingBytes(bytes);
      setLoadedName(name);
      const [m, bms, flds, hash] = await Promise.all([
        readPdfMetadata(bytes),
        readPdfBookmarks(bytes),
        readAcroFormValues(bytes),
        computeSha256Hex(bytes),
      ]);
      setMeta(m);
      setBookmarks(bms);
      setReadFields(flds);
      setSha256(hash);
      setConvertPageNum((p) => Math.max(1, Math.min(p, Math.max(1, m.pageCount))));
      setNewBmPage((p) => Math.max(1, Math.min(p, Math.max(1, m.pageCount))));
      setStatusMsg(
        `Loaded "${name}" (${m.pageCount} page(s), ${formatBytesCompact(bytes.byteLength)}).`
      );
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Failed to inspect PDF buffer.');
    }
  };

  useEffect(() => {
    if (!activeProject) {
      if (!hasExternalUploadRef.current) {
        setWorkingBytes(null);
        setLoadedName('');
        setSha256(null);
      }
      return;
    }
    if (lastInspectedProjectIdRef.current === activeProject.id) return;
    lastInspectedProjectIdRef.current = activeProject.id;
    hasExternalUploadRef.current = false;
    setArchivalNote(null);
    if (!activeProject.sourcePdfBase64) {
      setWorkingBytes(null);
      setLoadedName(`${activeProject.name}.pdf`);
      setSha256(null);
      setStatusMsg(null);
      return;
    }
    try {
      const bin = atob(activeProject.sourcePdfBase64);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      void inspectBuffer(out, `${activeProject.name}.pdf`);
    } catch {
      setStatusMsg('Could not decode active project PDF source bytes.');
    }
  }, [activeProject?.id, activeProject?.sourcePdfBase64]);

  const handleUploadPdf = async (file: File | undefined) => {
    if (!file) return;
    try {
      hasExternalUploadRef.current = true;
      const buf = new Uint8Array(await file.arrayBuffer());
      await inspectBuffer(buf, file.name);
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Failed to read PDF file.');
    }
  };

  const handleLoadActiveSource = async () => {
    if (!activeProject?.sourcePdfBase64) return;
    try {
      hasExternalUploadRef.current = false;
      const bin = atob(activeProject.sourcePdfBase64);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      await inspectBuffer(out, `${activeProject.name}.pdf`);
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Failed to load active project PDF.');
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 tablet:p-6 desktop:p-8 max-w-6xl mx-auto w-full space-y-6">
      <div className="flex flex-col tablet:flex-row tablet:items-center justify-between gap-4 pb-5 border-b border-black/10 dark:border-white/12">
        <div>
          <h1 className="text-xl tablet:text-2xl font-display font-semibold tracking-tight text-[#101010] dark:text-white flex items-center gap-2">
            <Wrench className="w-5 h-5" />
            PDF Utilities &amp; Document Toolkit
          </h1>
          <p className="mt-1 text-xs tablet:text-sm text-[#555555] dark:text-[#B5B5B5]">
            100% local tools for PDF metadata scrubbing, outline bookmarks, split/merge/repair, interactive AcroForms, PDF/A XMP auditing, and format conversion.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          {activeProject?.sourcePdfBase64 && (
            <GlassButton variant="glass" size="md" onClick={() => void handleLoadActiveSource()}>
              Load Active Project PDF
            </GlassButton>
          )}
          <label className="min-h-[38px] px-3.5 py-2 rounded-xl bg-[#101010] text-white dark:bg-white dark:text-[#050505] font-semibold cursor-pointer flex items-center gap-1.5">
            <Upload className="w-3.5 h-3.5" />
            Open Local PDF
            <input
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => {
                void handleUploadPdf(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
        </div>
      </div>

      {/* Loaded File Banner */}
      <GlassCard level={2} padding="sm" className="text-xs flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-[#101010] dark:text-white" />
          <span className="font-semibold text-[#101010] dark:text-white truncate">
            {workingBytes ? loadedName : 'No PDF buffer loaded yet — upload a PDF or load active project'}
          </span>
          {workingBytes && (
            <span className="text-[#888888] dark:text-[#858585] tabular-nums">
              · {meta.pageCount} pg · {formatBytesCompact(workingBytes.byteLength)}
            </span>
          )}
        </div>
        {sha256 && (
          <span className="font-mono text-[10px] text-[#555555] dark:text-[#B5B5B5]">
            SHA-256: {sha256.slice(0, 16)}…
          </span>
        )}
      </GlassCard>

      {statusMsg && (
        <div className="p-3 rounded-xl border border-black/15 dark:border-white/15 bg-black/[0.03] dark:bg-white/[0.04] text-xs text-[#101010] dark:text-white">
          {statusMsg}
        </div>
      )}

      {/* Utility Category Tabs */}
      <div className="flex flex-wrap gap-1.5 border-b border-black/10 dark:border-white/12 pb-3 text-xs">
        {(
          [
            ['metadata', 'Metadata & Scrub', FileCode2],
            ['outlines', 'Bookmarks / Outlines', BookMarked],
            ['split_merge', 'Split / Merge / Repair', Scissors],
            ['forms', 'AcroForms', FormInput],
            ['archival_security', 'PDF/A & Security', ShieldCheck],
            ['convert', 'Convert PDF / Data', ImageIcon],
          ] as Array<[UtilityTab, string, React.ComponentType<{ className?: string }>]>
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`px-3 py-1.5 rounded-xl border font-medium flex items-center gap-1.5 transition-colors ${
              tab === id
                ? 'studio-active-surface font-semibold'
                : 'border-black/10 dark:border-white/12 text-[#555555] dark:text-[#B5B5B5] hover:border-black/30 dark:hover:border-white/30'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* 1. Metadata & Scrubbing */}
      {tab === 'metadata' && (
        <GlassCard level={3} padding="md" className="space-y-4 text-xs">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#101010] dark:text-white">
              PDF Catalog Metadata Editor &amp; Privacy Scrubber
            </h2>
            {workingBytes && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    const scrubbed = await writeOrScrubPdfMetadata(workingBytes, {}, true);
                    await inspectBuffer(scrubbed, `scrubbed_${loadedName || 'doc.pdf'}`);
                    downloadBytes(scrubbed, `scrubbed_${loadedName || 'document.pdf'}`);
                  } catch (err) {
                    setStatusMsg(err instanceof Error ? err.message : 'Failed to scrub PDF metadata.');
                  }
                }}
                className="px-3 py-1.5 rounded-lg border border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/10 font-medium"
              >
                Scrub All Metadata &amp; Download
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 tablet:grid-cols-2 gap-3">
            {(
              [
                ['title', 'Document Title'],
                ['author', 'Author'],
                ['subject', 'Subject'],
                ['keywords', 'Keywords (comma-separated)'],
                ['creator', 'Creator Application'],
                ['producer', 'PDF Producer'],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="block">
                <span className="text-[11px] text-[#555555] dark:text-[#B5B5B5]">{label}</span>
                <input
                  type="text"
                  value={meta[k]}
                  onChange={(e) => setMeta((prev) => ({ ...prev, [k]: e.target.value }))}
                  className="mt-1 w-full px-2.5 py-1.5 rounded-lg border studio-input"
                />
              </label>
            ))}
          </div>

          <div className="flex justify-end">
            <GlassButton
              variant="primary"
              size="md"
              disabled={!workingBytes}
              onClick={async () => {
                if (!workingBytes) return;
                try {
                  const updated = await writeOrScrubPdfMetadata(workingBytes, meta, false);
                  await inspectBuffer(updated, loadedName || 'updated.pdf');
                  downloadBytes(updated, `meta_${loadedName || 'document.pdf'}`);
                } catch (err) {
                  setStatusMsg(err instanceof Error ? err.message : 'Failed to save PDF metadata.');
                }
              }}
            >
              <Download className="w-3.5 h-3.5" />
              Save Metadata &amp; Download PDF
            </GlassButton>
          </div>
        </GlassCard>
      )}

      {/* 2. Outlines / Bookmarks */}
      {tab === 'outlines' && (
        <GlassCard level={3} padding="md" className="space-y-4 text-xs">
          <h2 className="text-sm font-semibold text-[#101010] dark:text-white">
            PDF Navigation Outlines &amp; Bookmarks ({bookmarks.length})
          </h2>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex-1 min-w-[200px] block">
              <span className="text-[10px] text-[#888888]">Bookmark Title</span>
              <input
                type="text"
                placeholder="e.g. Section 1 — Summary"
                value={newBmTitle}
                onChange={(e) => setNewBmTitle(e.target.value)}
                className="mt-0.5 w-full px-2.5 py-1.5 rounded-lg border studio-input"
              />
            </label>
            <label className="w-24 block">
              <span className="text-[10px] text-[#888888]">Page #</span>
              <NumericDraftInput
                min={1}
                max={Math.max(1, meta.pageCount)}
                fallback={1}
                value={newBmPage}
                onCommit={(val) =>
                  setNewBmPage(Math.max(1, Math.min(Math.max(1, meta.pageCount), Math.round(val))))
                }
                className="mt-0.5 w-full px-2 py-1.5 rounded-lg border studio-input tabular-nums"
              />
            </label>
            <GlassButton
              variant="glass"
              size="md"
              onClick={() => {
                if (!newBmTitle.trim()) return;
                setBookmarks((prev) => [
                  ...prev,
                  {
                    id: `bm-${Date.now()}`,
                    title: newBmTitle.trim(),
                    pageNumber: newBmPage,
                  },
                ]);
                setNewBmTitle('');
              }}
            >
              <Plus className="w-3.5 h-3.5" />
              Add Bookmark
            </GlassButton>
          </div>

          <div className="divide-y divide-black/10 dark:divide-white/10">
            {bookmarks.map((bm) => (
              <div key={bm.id} className="py-2 flex items-center justify-between gap-2">
                <div>
                  <span className="font-semibold text-[#101010] dark:text-white">{bm.title}</span>
                  <span className="ml-2 text-[#888888] tabular-nums">Page {bm.pageNumber}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setBookmarks((prev) => prev.filter((x) => x.id !== bm.id))}
                  className="p-1 text-[#888888] hover:text-red-600"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          <div className="flex justify-end">
            <GlassButton
              variant="primary"
              size="md"
              disabled={!workingBytes}
              onClick={async () => {
                if (!workingBytes) return;
                try {
                  const updated = await writePdfBookmarks(workingBytes, bookmarks);
                  await inspectBuffer(updated, loadedName || 'bookmarked.pdf');
                  downloadBytes(updated, `bookmarked_${loadedName || 'document.pdf'}`);
                } catch (err) {
                  setStatusMsg(err instanceof Error ? err.message : 'Failed to embed bookmarks.');
                }
              }}
            >
              <Download className="w-3.5 h-3.5" />
              Embed Outlines &amp; Download
            </GlassButton>
          </div>
        </GlassCard>
      )}

      {/* 3. Split / Merge / Repair */}
      {tab === 'split_merge' && (
        <div className="grid grid-cols-1 tablet:grid-cols-2 gap-4 text-xs">
          <GlassCard level={3} padding="md" className="space-y-3">
            <h2 className="text-sm font-semibold text-[#101010] dark:text-white flex items-center gap-1.5">
              <Scissors className="w-4 h-4" />
              Extract / Split Pages &amp; Repair
            </h2>
            <label className="block">
              <span className="text-[11px] text-[#555555] dark:text-[#B5B5B5]">
                Pages to Extract (e.g. 1-3, 5)
              </span>
              <input
                type="text"
                value={extractRange}
                onChange={(e) => setExtractRange(e.target.value)}
                className="mt-1 w-full px-2.5 py-1.5 rounded-lg border studio-input font-mono"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <GlassButton
                variant="primary"
                size="md"
                disabled={!workingBytes}
                onClick={async () => {
                  if (!workingBytes) return;
                  try {
                    const nums = parseRangeFilterNumbers(extractRange, Math.max(1, meta.pageCount));
                    const extracted = await splitOrExtractPdfPages(workingBytes, nums);
                    downloadBytes(extracted, `extracted_${loadedName || 'pages.pdf'}`);
                    setStatusMsg(`Extracted ${nums.length} page(s) (${nums.join(', ')}).`);
                  } catch (err) {
                    setStatusMsg(err instanceof Error ? err.message : 'Failed to extract pages.');
                  }
                }}
              >
                Extract Selected Pages
              </GlassButton>
              <GlassButton
                variant="glass"
                size="md"
                disabled={!workingBytes}
                onClick={async () => {
                  if (!workingBytes) return;
                  try {
                    const rep = await repairAndOptimizePdf(workingBytes, true);
                    await inspectBuffer(rep.bytes, `repaired_${loadedName || 'doc.pdf'}`);
                    downloadBytes(rep.bytes, `optimized_${loadedName || 'document.pdf'}`);
                    setStatusMsg(
                      `Repaired & compressed PDF: ${formatBytesCompact(rep.originalSize)} → ${formatBytesCompact(rep.optimizedSize)}.`
                    );
                  } catch (err) {
                    setStatusMsg(err instanceof Error ? err.message : 'Failed to repair/optimize PDF.');
                  }
                }}
              >
                <Sparkles className="w-3.5 h-3.5" />
                Repair &amp; Optimize Streams
              </GlassButton>
            </div>
          </GlassCard>

          <GlassCard level={3} padding="md" className="space-y-3">
            <h2 className="text-sm font-semibold text-[#101010] dark:text-white flex items-center gap-1.5">
              <Merge className="w-4 h-4" />
              Merge Multiple PDFs ({mergeList.length})
            </h2>
            <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-black/15 dark:border-white/15 cursor-pointer hover:bg-black/[0.04] dark:hover:bg-white/[0.08]">
              <Plus className="w-3.5 h-3.5" />
              Add PDF Files to Merge
              <input
                type="file"
                multiple
                accept="application/pdf"
                className="hidden"
                onChange={async (e) => {
                  try {
                    const files = Array.from(e.target.files || []);
                    const added = await Promise.all(
                      files.map(async (f) => ({
                        name: f.name,
                        bytes: new Uint8Array(await f.arrayBuffer()),
                      }))
                    );
                    setMergeList((prev) => [...prev, ...added]);
                  } catch (err) {
                    setStatusMsg(err instanceof Error ? err.message : 'Failed to read merge PDF file(s).');
                  } finally {
                    e.target.value = '';
                  }
                }}
              />
            </label>
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {mergeList.map((m, i) => (
                <div key={`${m.name}-${i}`} className="flex items-center justify-between">
                  <span className="truncate">{m.name}</span>
                  <button
                    type="button"
                    onClick={() => setMergeList((prev) => prev.filter((_, idx) => idx !== i))}
                    className="text-red-600"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <GlassButton
              variant="primary"
              size="md"
              disabled={mergeList.length === 0 && !workingBytes}
              onClick={async () => {
                try {
                  const bufs = [
                    ...(workingBytes ? [workingBytes] : []),
                    ...mergeList.map((m) => m.bytes),
                  ];
                  if (bufs.length === 0) return;
                  const merged = await mergePdfByteArrays(bufs);
                  downloadBytes(merged, 'merged_bundle.pdf');
                  setStatusMsg(`Merged ${bufs.length} PDF document(s) cleanly.`);
                } catch (err) {
                  setStatusMsg(err instanceof Error ? err.message : 'Failed to merge PDFs.');
                }
              }}
            >
              <Download className="w-3.5 h-3.5" />
              Merge &amp; Download
            </GlassButton>
          </GlassCard>
        </div>
      )}

      {/* 4. Interactive AcroForm Builder & Extractor */}
      {tab === 'forms' && (
        <div className="grid grid-cols-1 tablet:grid-cols-2 gap-4 text-xs">
          <GlassCard level={3} padding="md" className="space-y-3">
            <h2 className="text-sm font-semibold text-[#101010] dark:text-white">
              Add Interactive AcroForm Fields
            </h2>
            {formFields.map((ff, idx) => (
              <div key={idx} className="grid grid-cols-3 gap-1.5 p-2 rounded-lg border border-black/10 dark:border-white/12">
                <input
                  type="text"
                  value={ff.name}
                  onChange={(e) =>
                    setFormFields((prev) =>
                      prev.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x))
                    )
                  }
                  placeholder="field_name"
                  className="col-span-2 px-2 py-1 rounded border studio-input font-mono"
                />
                <select
                  value={ff.kind}
                  onChange={(e) =>
                    setFormFields((prev) =>
                      prev.map((x, i) =>
                        i === idx ? { ...x, kind: e.target.value as AcroFormFieldSpec['kind'] } : x
                      )
                    )
                  }
                  className="px-2 py-1 rounded border studio-select"
                >
                  <option value="text">Text Field</option>
                  <option value="checkbox">Checkbox</option>
                  <option value="dropdown">Dropdown</option>
                </select>
                <NumericDraftInput
                  value={ff.xPt}
                  fallback={0}
                  onCommit={(val) =>
                    setFormFields((prev) =>
                      prev.map((x, i) => (i === idx ? { ...x, xPt: val } : x))
                    )
                  }
                  placeholder="X pt"
                  className="px-2 py-1 rounded border studio-input tabular-nums"
                />
                <NumericDraftInput
                  value={ff.yPt}
                  fallback={0}
                  onCommit={(val) =>
                    setFormFields((prev) =>
                      prev.map((x, i) => (i === idx ? { ...x, yPt: val } : x))
                    )
                  }
                  placeholder="Y pt"
                  className="px-2 py-1 rounded border studio-input tabular-nums"
                />
                <NumericDraftInput
                  value={ff.pageNumber}
                  min={1}
                  max={Math.max(1, meta.pageCount || 1)}
                  fallback={1}
                  onCommit={(val) =>
                    setFormFields((prev) =>
                      prev.map((x, i) =>
                        i === idx
                          ? {
                              ...x,
                              pageNumber: Math.max(1, Math.min(Math.max(1, meta.pageCount || 1), Math.round(val))),
                            }
                          : x
                      )
                    )
                  }
                  placeholder="Page"
                  className="px-2 py-1 rounded border studio-input tabular-nums"
                />
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <GlassButton
                variant="glass"
                size="sm"
                onClick={() =>
                  setFormFields((prev) => [
                    ...prev,
                    {
                      name: `field_${prev.length + 1}`,
                      kind: 'text',
                      pageNumber: 1,
                      xPt: 72,
                      yPt: 580 - prev.length * 36,
                      widthPt: 180,
                      heightPt: 22,
                    },
                  ])
                }
              >
                + Field
              </GlassButton>
              <GlassButton
                variant="primary"
                size="sm"
                disabled={!workingBytes}
                onClick={async () => {
                  if (!workingBytes) return;
                  try {
                    const out = await addAcroFormFieldsToPdf(workingBytes, formFields);
                    await inspectBuffer(out, `form_${loadedName || 'doc.pdf'}`);
                    downloadBytes(out, `acroform_${loadedName || 'document.pdf'}`);
                  } catch (err) {
                    setStatusMsg(err instanceof Error ? err.message : 'Failed to embed AcroForm fields.');
                  }
                }}
              >
                Embed AcroForm &amp; Download
              </GlassButton>
            </div>
          </GlassCard>

          <GlassCard level={3} padding="md" className="space-y-3">
            <h2 className="text-sm font-semibold text-[#101010] dark:text-white">
              Extract Filled AcroForm Responses ({readFields.length})
            </h2>
            {readFields.length === 0 ? (
              <div className="text-[#555555] dark:text-[#B5B5B5]">
                No AcroForm fields detected in loaded PDF.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {readFields.map((rf, idx) => (
                  <div key={idx} className="p-2 rounded-lg border border-black/10 dark:border-white/12 flex justify-between gap-2">
                    <span className="font-mono font-semibold">{rf.name} ({rf.kind})</span>
                    <span className="text-[#555555] dark:text-[#B5B5B5] truncate">{rf.value || '—'}</span>
                  </div>
                ))}
              </div>
            )}
            <GlassButton
              variant="glass"
              size="sm"
              disabled={readFields.length === 0}
              onClick={() => {
                const json = JSON.stringify(readFields, null, 2);
                downloadBytes(new TextEncoder().encode(json), 'acroform_responses.json', 'application/json');
              }}
            >
              Export Form Responses JSON
            </GlassButton>
          </GlassCard>
        </div>
      )}

      {/* 5. Archival PDF/A & Security Truthfulness */}
      {tab === 'archival_security' && (
        <div className="grid grid-cols-1 tablet:grid-cols-2 gap-4 text-xs">
          <GlassCard level={3} padding="md" className="space-y-3">
            <h2 className="text-sm font-semibold text-[#101010] dark:text-white">
              PDF/A Metadata Tagging &amp; Font Embedding Audit
            </h2>
            <p className="text-[#555555] dark:text-[#B5B5B5] leading-relaxed">
              Adds PDF/A-1b XMP metadata and inspects font embedding. This is an audit/tagging aid only: it does not convert the file into a compliant PDF/A document or certify conformance with ISO requirements.
            </p>
            {archivalNote && (
              <div className="p-2.5 rounded-lg border border-black/15 dark:border-white/15 bg-black/[0.03] dark:bg-white/[0.04]">
                {archivalNote}
              </div>
            )}
            <GlassButton
              variant="primary"
              size="md"
              disabled={!workingBytes}
              onClick={async () => {
                if (!workingBytes) return;
                try {
                  const res = await applyPdfA1bXmpMetadata(workingBytes, {
                    title: meta.title || loadedName,
                    author: meta.author,
                  });
                  setArchivalNote(res.complianceNote);
                  downloadBytes(res.bytes, `pdfa_${loadedName || 'document.pdf'}`);
                } catch (err) {
                  setStatusMsg(err instanceof Error ? err.message : 'Failed to write PDF/A XMP metadata.');
                }
              }}
            >
              Tag PDF/A XMP &amp; Audit Fonts
            </GlassButton>
          </GlassCard>

          <GlassCard level={3} padding="md" className="space-y-3">
            <h2 className="text-sm font-semibold text-[#101010] dark:text-white flex items-center gap-1.5">
              <Lock className="w-4 h-4" />
              Security &amp; Sanitization Disclosure
            </h2>
            <p className="text-[#555555] dark:text-[#B5B5B5] leading-relaxed">
              Standard client-side <code className="font-mono">pdf-lib</code> does not write RC4/AES-256 PDF encryption streams, so Lazy Editor never stamps fake password flags. Use Metadata Scrubbing, True Rasterized Redaction in the Editor, and SHA-256 Integrity Passports for verifiable protection.
            </p>
          </GlassCard>
        </div>
      )}

      {/* 6. Conversions */}
      {tab === 'convert' && (
        <div className="grid grid-cols-1 tablet:grid-cols-2 gap-4 text-xs">
          <GlassCard level={3} padding="md" className="space-y-3">
            <h2 className="text-sm font-semibold text-[#101010] dark:text-white flex items-center gap-1.5">
              <ImageIcon className="w-4 h-4" />
              Export PDF Page as Image (PNG / JPEG / WebP)
            </h2>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[10px] text-[#888888]">Page #</span>
                <NumericDraftInput
                  min={1}
                  max={Math.max(1, meta.pageCount)}
                  fallback={1}
                  value={convertPageNum}
                  onCommit={(val) =>
                    setConvertPageNum(
                      Math.max(1, Math.min(Math.max(1, meta.pageCount), Math.round(val)))
                    )
                  }
                  className="mt-0.5 w-full px-2 py-1 rounded-lg border studio-input tabular-nums"
                />
              </label>
              <label className="block">
                <span className="text-[10px] text-[#888888]">Format</span>
                <select
                  value={imageFormat}
                  onChange={(e) => setImageFormat(e.target.value as 'png' | 'jpeg' | 'webp')}
                  className="mt-0.5 w-full px-2 py-1 rounded-lg border studio-select"
                >
                  <option value="png">PNG (Lossless)</option>
                  <option value="jpeg">JPEG (Compact)</option>
                  <option value="webp">WebP</option>
                </select>
              </label>
            </div>
            <GlassButton
              variant="primary"
              size="md"
              disabled={!workingBytes}
              onClick={async () => {
                if (!workingBytes) return;
                try {
                  const dataUrl = await renderSinglePagePreview(
                    uint8ArrayToBase64(workingBytes),
                    convertPageNum,
                    2
                  );
                  if (!dataUrl) {
                    setStatusMsg(`Page ${convertPageNum} could not be rendered.`);
                    return;
                  }
                  const img = new Image();
                  img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.naturalWidth;
                    canvas.height = img.naturalHeight;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) {
                      canvas.width = 0;
                      canvas.height = 0;
                      setStatusMsg('Canvas 2D context unavailable for image export.');
                      return;
                    }
                    ctx.fillStyle = '#FFFFFF';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(img, 0, 0);
                    const mime = `image/${imageFormat}`;
                    const outUrl = canvas.toDataURL(mime, 0.92);
                    canvas.width = 0;
                    canvas.height = 0;
                    const a = document.createElement('a');
                    a.href = outUrl;
                    a.download = `page_${convertPageNum}.${imageFormat}`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                  };
                  img.onerror = () => {
                    setStatusMsg(`Failed to decode rendered image for page ${convertPageNum}.`);
                  };
                  img.src = dataUrl;
                } catch (err) {
                  setStatusMsg(err instanceof Error ? err.message : 'Failed to render page image.');
                }
              }}
            >
              Render &amp; Download Image
            </GlassButton>
          </GlassCard>

          <GlassCard level={3} padding="md" className="space-y-3">
            <h2 className="text-sm font-semibold text-[#101010] dark:text-white flex items-center gap-1.5">
              <FileSpreadsheet className="w-4 h-4" />
              Convert Markdown or Dataset Table → PDF
            </h2>
            <input
              type="text"
              value={markdownTitle}
              onChange={(e) => setMarkdownTitle(e.target.value)}
              placeholder="Document Title"
              className="w-full px-2.5 py-1.5 rounded-lg border studio-input"
            />
            <textarea
              rows={4}
              value={markdownInput}
              onChange={(e) => setMarkdownInput(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border studio-input font-mono"
            />
            <div className="flex flex-wrap gap-2">
              <GlassButton
                variant="primary"
                size="sm"
                onClick={async () => {
                  try {
                    const pdf = await convertMarkdownToPdf(markdownTitle, markdownInput);
                    downloadBytes(pdf, `${markdownTitle.replace(/\s+/g, '_')}.pdf`);
                  } catch (err) {
                    setStatusMsg(err instanceof Error ? err.message : 'Failed to convert Markdown to PDF.');
                  }
                }}
              >
                Convert Markdown → PDF
              </GlassButton>
              {activeProject && activeProject.dataRows.length > 0 && (
                <GlassButton
                  variant="glass"
                  size="sm"
                  onClick={async () => {
                    try {
                      const pdf = await convertStructuredRowsToPdf(
                        `${activeProject.name} Dataset`,
                        activeProject.dataColumns,
                        activeProject.dataRows
                      );
                      downloadBytes(pdf, `${activeProject.name.replace(/\s+/g, '_')}_dataset.pdf`);
                    } catch (err) {
                      setStatusMsg(err instanceof Error ? err.message : 'Failed to convert dataset to PDF.');
                    }
                  }}
                >
                  Active Dataset → PDF Table
                </GlassButton>
              )}
            </div>
          </GlassCard>
        </div>
      )}
    </div>
  );
};
