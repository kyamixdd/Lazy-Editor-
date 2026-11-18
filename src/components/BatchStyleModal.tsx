import React, { useEffect, useMemo, useState } from 'react';
import { Check, Layers } from 'lucide-react';
import { AssetFontItem, DocumentElement, PDFProject } from '../types/pdfStudio';
import { GlassButton, GlassCard, GlassModal } from './glass';
import { NumericDraftInput } from './NumericDraftInput';

interface BatchStyleModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: PDFProject;
  currentPage: number;
  customFonts?: AssetFontItem[];
  onApplyBatchStyle: (
    updates: Array<{ id: string; patch: Partial<DocumentElement> }>,
    summary: string
  ) => void;
}

type FilterMode =
  | 'all_text'
  | 'same_fieldKey'
  | 'same_type'
  | 'same_blockId'
  | 'matching_font';

const TEXT_TYPES = new Set([
  'heading',
  'text',
  'invoice_number',
  'receipt_number',
  'form_field',
  'callout',
]);

export const BatchStyleModal: React.FC<BatchStyleModalProps> = ({
  isOpen,
  onClose,
  project,
  currentPage,
  customFonts = [],
  onApplyBatchStyle,
}) => {
  const allPages = useMemo(
    () => Array.from({ length: Math.max(1, project.pageCount) }, (_, i) => i + 1),
    [project.pageCount]
  );

  const [selectedPages, setSelectedPages] = useState<number[]>(allPages);
  const [filterMode, setFilterMode] = useState<FilterMode>('all_text');
  const [filterValue, setFilterValue] = useState<string>('');

  useEffect(() => {
    if (!isOpen) return;
    setSelectedPages(allPages);
  }, [isOpen, project.id, allPages]);

  // Style property enable flags + values (strictly never touches `text`!)
  const [applyFontFamily, setApplyFontFamily] = useState(false);
  const [fontFamily, setFontFamily] = useState('Helvetica');

  const [applyFontSize, setApplyFontSize] = useState(false);
  const [fontSize, setFontSize] = useState(11);

  const [applyFontWeight, setApplyFontWeight] = useState(false);
  const [fontWeight, setFontWeight] = useState<'normal' | 'bold'>('bold');

  const [applyFontStyle, setApplyFontStyle] = useState(false);
  const [fontStyle, setFontStyle] = useState<'normal' | 'italic'>('normal');

  const [applyUnderline, setApplyUnderline] = useState(false);
  const [underline, setUnderline] = useState(false);

  const [applyColor, setApplyColor] = useState(false);
  const [color, setColor] = useState('#111827');

  const [applyAlign, setApplyAlign] = useState(false);
  const [align, setAlign] = useState<'left' | 'center' | 'right'>('left');

  const [applyGeometryAlign, setApplyGeometryAlign] = useState(false);
  const [targetX, setTargetX] = useState(72);
  const [targetWidth, setTargetWidth] = useState(180);

  const availableFieldKeys = useMemo(
    () =>
      Array.from(
        new Set(project.elements.map((e) => e.fieldKey).filter((k): k is string => Boolean(k)))
      ),
    [project.elements]
  );

  const availableBlockIds = useMemo(
    () =>
      Array.from(
        new Set(project.elements.map((e) => e.blockId).filter((k): k is string => Boolean(k)))
      ),
    [project.elements]
  );

  const availableTypes = useMemo(
    () => Array.from(new Set(project.elements.map((e) => e.type))),
    [project.elements]
  );

  const availableFonts = useMemo(
    () =>
      Array.from(
        new Set([
          'Helvetica',
          'Times-Roman',
          'Courier',
          'Plus Jakarta Sans',
          'DM Sans',
          'JetBrains Mono',
          ...customFonts.map((f) => f.fontFamily),
          ...project.elements.map((e) => e.fontFamily).filter(Boolean),
        ])
      ),
    [customFonts, project.elements]
  );

  const matchingElements = useMemo(() => {
    const pageSet = new Set(selectedPages);
    return project.elements.filter((el) => {
      if (!el.visible || el.locked || !pageSet.has(el.pageNumber)) return false;
      if (filterMode === 'all_text') return TEXT_TYPES.has(el.type);
      if (filterMode === 'same_fieldKey') {
        return filterValue ? el.fieldKey === filterValue : Boolean(el.fieldKey);
      }
      if (filterMode === 'same_type') {
        return filterValue ? el.type === filterValue : TEXT_TYPES.has(el.type);
      }
      if (filterMode === 'same_blockId') {
        return filterValue ? el.blockId === filterValue : Boolean(el.blockId);
      }
      if (filterMode === 'matching_font') {
        return filterValue ? el.fontFamily === filterValue : true;
      }
      return false;
    });
  }, [project.elements, selectedPages, filterMode, filterValue]);

  const anyPropertySelected =
    applyFontFamily ||
    applyFontSize ||
    applyFontWeight ||
    applyFontStyle ||
    applyUnderline ||
    applyColor ||
    applyAlign ||
    applyGeometryAlign;

  const handleApply = () => {
    if (matchingElements.length === 0 || !anyPropertySelected) return;
    const updates = matchingElements.map((el) => {
      const patch: Partial<DocumentElement> = {
        ...(applyFontFamily ? { fontFamily } : {}),
        ...(applyFontSize ? { fontSize: Math.max(4, fontSize) } : {}),
        ...(applyFontWeight ? { fontWeight } : {}),
        ...(applyFontStyle ? { fontStyle } : {}),
        ...(applyUnderline ? { underline } : {}),
        ...(applyColor ? { color } : {}),
        ...(applyAlign ? { align } : {}),
        ...(applyGeometryAlign
          ? { x: targetX, width: Math.max(12, targetWidth) }
          : {}),
        eraseOriginal: el.isUserAdded ? false : true,
      };
      return { id: el.id, patch };
    });

    onApplyBatchStyle(
      updates,
      `Batch Style updated ${updates.length} element(s) across ${selectedPages.length} page(s)`
    );
    onClose();
  };

  return (
    <GlassModal
      isOpen={isOpen}
      onClose={onClose}
      title="Multi-Page Batch Styling Studio"
      subtitle="Apply unified typography, color, and alignment across pages while preserving unique & serial text"
      maxWidthClass="max-w-3xl"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-[#555555] dark:text-[#B5B5B5] tabular-nums">
            {matchingElements.length} unlocked element(s) matched across{' '}
            {selectedPages.length} page(s) · Unique text values preserved
          </span>
          <div className="flex items-center gap-2">
            <GlassButton variant="glass" size="md" onClick={onClose}>
              Cancel
            </GlassButton>
            <GlassButton
              variant="primary"
              size="md"
              disabled={matchingElements.length === 0 || !anyPropertySelected}
              onClick={handleApply}
            >
              <Check className="w-3.5 h-3.5" />
              Apply to {matchingElements.length} Elements
            </GlassButton>
          </div>
        </div>
      }
    >
      <div className="p-4 tablet:p-5 space-y-4 text-xs">
        {/* Page Selection */}
        <GlassCard level={2} padding="sm" className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-[#101010] dark:text-white flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5" />
              Target Pages
            </span>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setSelectedPages([currentPage])}
                className="px-2 py-1 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/10 text-[11px]"
              >
                Current ({currentPage})
              </button>
              <button
                type="button"
                onClick={() => setSelectedPages(allPages)}
                className="px-2 py-1 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/10 text-[11px]"
              >
                All ({allPages.length})
              </button>
              <button
                type="button"
                onClick={() => setSelectedPages(allPages.filter((p) => p % 2 === 1))}
                className="px-2 py-1 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/10 text-[11px]"
              >
                Odd
              </button>
              <button
                type="button"
                onClick={() => setSelectedPages(allPages.filter((p) => p % 2 === 0))}
                className="px-2 py-1 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/10 text-[11px]"
              >
                Even
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
            {allPages.map((p) => {
              const active = selectedPages.includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() =>
                    setSelectedPages((prev) =>
                      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
                    )
                  }
                  className={`px-2.5 py-1 rounded-lg border text-[11px] font-mono tabular-nums transition-colors ${
                    active
                      ? 'studio-active-surface'
                      : 'border-black/15 dark:border-white/15 text-[#555555] dark:text-[#B5B5B5]'
                  }`}
                >
                  P{p}
                </button>
              );
            })}
          </div>
        </GlassCard>

        {/* Element Filter */}
        <div className="grid grid-cols-1 tablet:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[11px] font-medium text-[#555555] dark:text-[#B5B5B5]">
              Element Match Rule
            </span>
            <select
              value={filterMode}
              onChange={(e) => {
                setFilterMode(e.target.value as FilterMode);
                setFilterValue('');
              }}
              className="mt-1 w-full min-h-[38px] px-2.5 py-1.5 rounded-xl studio-select"
            >
              <option value="all_text">All Text &amp; Number Elements</option>
              <option value="same_fieldKey">Mapped Field Key</option>
              <option value="same_type">Element Type</option>
              <option value="same_blockId">Document Block ID</option>
              <option value="matching_font">Matching Font Family</option>
            </select>
          </label>

          {filterMode !== 'all_text' && (
            <label className="block">
              <span className="text-[11px] font-medium text-[#555555] dark:text-[#B5B5B5]">
                Filter Value
              </span>
              <select
                value={filterValue}
                onChange={(e) => setFilterValue(e.target.value)}
                className="mt-1 w-full min-h-[38px] px-2.5 py-1.5 rounded-xl studio-select"
              >
                <option value="">Any matching</option>
                {filterMode === 'same_fieldKey' &&
                  availableFieldKeys.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                {filterMode === 'same_type' &&
                  availableTypes.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                {filterMode === 'same_blockId' &&
                  availableBlockIds.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                {filterMode === 'matching_font' &&
                  availableFonts.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
              </select>
            </label>
          )}
        </div>

        {/* Selectable Style Properties */}
        <GlassCard level={2} padding="sm" className="space-y-3">
          <div className="font-semibold text-[#101010] dark:text-white">
            Style Properties to Apply (Checked Only)
          </div>

          <div className="grid grid-cols-1 tablet:grid-cols-2 gap-3">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={applyFontFamily}
                onChange={(e) => setApplyFontFamily(e.target.checked)}
                className="accent-[#101010] dark:accent-white"
              />
              <span className="w-24 text-[#555555] dark:text-[#B5B5B5]">Font</span>
              <select
                disabled={!applyFontFamily}
                value={fontFamily}
                onChange={(e) => setFontFamily(e.target.value)}
                className="flex-1 px-2 py-1.5 rounded-lg studio-select disabled:opacity-45"
              >
                {availableFonts.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={applyFontSize}
                onChange={(e) => setApplyFontSize(e.target.checked)}
                className="accent-[#101010] dark:accent-white"
              />
              <span className="w-24 text-[#555555] dark:text-[#B5B5B5]">Size (pt)</span>
              <NumericDraftInput
                disabled={!applyFontSize}
                value={fontSize}
                commitOptions={{ min: 4, max: 144, decimals: 1 }}
                onCommit={(val) => setFontSize(val)}
                className="flex-1 px-2 py-1.5 rounded-lg studio-input disabled:opacity-45 tabular-nums"
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={applyFontWeight}
                onChange={(e) => setApplyFontWeight(e.target.checked)}
                className="accent-[#101010] dark:accent-white"
              />
              <span className="w-24 text-[#555555] dark:text-[#B5B5B5]">Weight</span>
              <select
                disabled={!applyFontWeight}
                value={fontWeight}
                onChange={(e) => setFontWeight(e.target.value as 'normal' | 'bold')}
                className="flex-1 px-2 py-1.5 rounded-lg studio-select disabled:opacity-45"
              >
                <option value="normal">Regular</option>
                <option value="bold">Bold</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={applyFontStyle}
                onChange={(e) => setApplyFontStyle(e.target.checked)}
                className="accent-[#101010] dark:accent-white"
              />
              <span className="w-24 text-[#555555] dark:text-[#B5B5B5]">Style</span>
              <select
                disabled={!applyFontStyle}
                value={fontStyle}
                onChange={(e) => setFontStyle(e.target.value as 'normal' | 'italic')}
                className="flex-1 px-2 py-1.5 rounded-lg studio-select disabled:opacity-45"
              >
                <option value="normal">Normal</option>
                <option value="italic">Italic</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={applyUnderline}
                onChange={(e) => setApplyUnderline(e.target.checked)}
                className="accent-[#101010] dark:accent-white"
              />
              <span className="w-24 text-[#555555] dark:text-[#B5B5B5]">Underline</span>
              <select
                disabled={!applyUnderline}
                value={underline ? 'yes' : 'no'}
                onChange={(e) => setUnderline(e.target.value === 'yes')}
                className="flex-1 px-2 py-1.5 rounded-lg studio-select disabled:opacity-45"
              >
                <option value="yes">Underlined</option>
                <option value="no">None</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={applyColor}
                onChange={(e) => setApplyColor(e.target.checked)}
                className="accent-[#101010] dark:accent-white"
              />
              <span className="w-24 text-[#555555] dark:text-[#B5B5B5]">Color</span>
              <input
                type="color"
                disabled={!applyColor}
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-10 h-8 rounded cursor-pointer disabled:opacity-45"
              />
              <span className="font-mono text-[11px] text-[#555555] dark:text-[#B5B5B5]">
                {color}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={applyAlign}
                onChange={(e) => setApplyAlign(e.target.checked)}
                className="accent-[#101010] dark:accent-white"
              />
              <span className="w-24 text-[#555555] dark:text-[#B5B5B5]">Align</span>
              <select
                disabled={!applyAlign}
                value={align}
                onChange={(e) =>
                  setAlign(e.target.value as 'left' | 'center' | 'right')
                }
                className="flex-1 px-2 py-1.5 rounded-lg studio-select disabled:opacity-45"
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={applyGeometryAlign}
                onChange={(e) => setApplyGeometryAlign(e.target.checked)}
                className="accent-[#101010] dark:accent-white"
              />
              <span className="w-24 text-[#555555] dark:text-[#B5B5B5]">X / Width</span>
              <NumericDraftInput
                disabled={!applyGeometryAlign}
                value={targetX}
                commitOptions={{ decimals: 1 }}
                onCommit={(val) => setTargetX(val)}
                placeholder="X"
                className="w-16 px-2 py-1 rounded-lg studio-input disabled:opacity-45 tabular-nums"
              />
              <NumericDraftInput
                disabled={!applyGeometryAlign}
                value={targetWidth}
                commitOptions={{ min: 12, decimals: 1 }}
                onCommit={(val) => setTargetWidth(val)}
                placeholder="W"
                className="w-16 px-2 py-1 rounded-lg studio-input disabled:opacity-45 tabular-nums"
              />
            </div>
          </div>
        </GlassCard>
      </div>
    </GlassModal>
  );
};
