import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Search } from 'lucide-react';
import { DocumentElement } from '../types/pdfStudio';
import { computeTypographyLayout } from '../utils/typographyEngine';
import { GlassButton, GlassCard, GlassModal } from './glass';

type OverflowStrategy =
  | 'autofit_font'
  | 'wrap_expand_height'
  | 'widen_box'
  | 'keep_box';

interface SmartReplaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  elements: DocumentElement[];
  currentPage: number;
  onApplyReplace: (
    updates: Array<{ id: string; patch: Partial<DocumentElement> }>,
    summary: string
  ) => void;
}

const TEXT_TYPES = new Set([
  'heading',
  'text',
  'invoice_number',
  'receipt_number',
  'form_field',
  'callout',
]);

function replaceWithCase(
  source: string,
  query: string,
  replacement: string,
  matchCase: boolean
): string {
  if (!query) return source;
  if (matchCase) {
    return source.split(query).join(replacement);
  }
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return source.replace(new RegExp(escaped, 'gi'), replacement);
}

export const SmartReplaceModal: React.FC<SmartReplaceModalProps> = ({
  isOpen,
  onClose,
  elements,
  currentPage,
  onApplyReplace,
}) => {
  const [findQuery, setFindQuery] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [scope, setScope] = useState<'current_page' | 'all_pages'>('all_pages');
  const [matchCase, setMatchCase] = useState(false);
  const [overflowStrategy, setOverflowStrategy] =
    useState<OverflowStrategy>('autofit_font');
  const [selectedMatchIds, setSelectedMatchIds] = useState<Set<string>>(
    new Set()
  );

  const matches = useMemo(() => {
    const q = findQuery.trim();
    if (!q) return [];
    return elements
      .filter((el) => {
        if (!TEXT_TYPES.has(el.type) || !el.visible || el.locked) return false;
        if (scope === 'current_page' && el.pageNumber !== currentPage) {
          return false;
        }
        const hay = el.text || '';
        return matchCase
          ? hay.includes(q)
          : hay.toLowerCase().includes(q.toLowerCase());
      })
      .map((el) => {
        const nextText = replaceWithCase(
          el.text || '',
          q,
          replaceText,
          matchCase
        );
        const testAutofitEl: DocumentElement = {
          ...el,
          text: nextText,
          autofit: overflowStrategy === 'autofit_font' ? true : el.autofit,
        };
        const layout = computeTypographyLayout(testAutofitEl, nextText);
        const rawLayout = computeTypographyLayout(
          { ...el, text: nextText, autofit: false },
          nextText
        );
        return {
          element: el,
          nextText,
          overflowingBeforeAutofit: rawLayout.isClipped,
          autofitFontSize: layout.effectiveFontSize,
          requiredHeight:
            rawLayout.totalTextHeightPt + (el.paddingPt ?? 1) * 2,
        };
      });
  }, [elements, findQuery, replaceText, scope, matchCase, currentPage, overflowStrategy]);

  useEffect(() => {
    setSelectedMatchIds(new Set(matches.map((m) => m.element.id)));
  }, [findQuery, scope, matchCase, isOpen, elements.length]);

  const toggleId = (id: string) => {
    setSelectedMatchIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleApply = () => {
    const chosen = matches.filter((m) => selectedMatchIds.has(m.element.id));
    if (chosen.length === 0) return;

    const updates = chosen.map((m) => {
      const el = m.element;
      const patch: Partial<DocumentElement> = {
        text: m.nextText,
        eraseOriginal: el.isUserAdded ? false : true,
      };

      if (m.overflowingBeforeAutofit) {
        if (overflowStrategy === 'autofit_font') {
          patch.autofit = true;
          patch.fontSize = Math.max(5.5, Number(m.autofitFontSize.toFixed(1)));
        } else if (overflowStrategy === 'wrap_expand_height') {
          patch.textWrap = true;
          patch.height = Math.max(
            el.height,
            Number((m.requiredHeight + 4).toFixed(1))
          );
        } else if (overflowStrategy === 'widen_box') {
          const ratio = m.nextText.length / Math.max(1, (el.text || '').length);
          patch.width = Number(
            Math.max(el.width, el.width * Math.min(2.4, Math.max(1.15, ratio))).toFixed(1)
          );
        }
      }

      return { id: el.id, patch };
    });

    onApplyReplace(
      updates,
      `Smart Replace "${findQuery}" -> "${replaceText}" (${updates.length} items)`
    );
    onClose();
  };

  return (
    <GlassModal
      isOpen={isOpen}
      onClose={onClose}
      title="Smart Find & Replace Studio"
      subtitle="Search across pages with live overflow protection and layout-aware sizing"
      maxWidthClass="max-w-3xl"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-[#555555] dark:text-[#B5B5B5] tabular-nums">
            {selectedMatchIds.size} of {matches.length} match(es) selected
          </span>
          <div className="flex items-center gap-2">
            <GlassButton variant="glass" size="md" onClick={onClose}>
              Cancel
            </GlassButton>
            <GlassButton
              variant="primary"
              size="md"
              disabled={selectedMatchIds.size === 0 || !findQuery.trim()}
              onClick={handleApply}
            >
              <Check className="w-3.5 h-3.5" />
              Apply Smart Replace
            </GlassButton>
          </div>
        </div>
      }
    >
      <div className="p-4 tablet:p-5 space-y-4 text-xs">
        <div className="grid grid-cols-1 tablet:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[11px] font-medium text-[#555555] dark:text-[#B5B5B5]">
              Find Text
            </span>
            <div className="relative mt-1">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#888888]" />
              <input
                type="text"
                value={findQuery}
                onChange={(e) => setFindQuery(e.target.value)}
                placeholder="e.g. ACME Corp or INV-2025"
                className="w-full min-h-[40px] pl-8 pr-3 py-1.5 rounded-xl border studio-input"
                autoFocus
              />
            </div>
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-[#555555] dark:text-[#B5B5B5]">
              Replace With
            </span>
            <input
              type="text"
              value={replaceText}
              onChange={(e) => setReplaceText(e.target.value)}
              placeholder="Replacement string..."
              className="mt-1 w-full min-h-[40px] px-3 py-1.5 rounded-xl border studio-input"
            />
          </label>
        </div>

        <div className="grid grid-cols-1 tablet:grid-cols-3 gap-3 items-end">
          <label className="block">
            <span className="text-[11px] font-medium text-[#555555] dark:text-[#B5B5B5]">
              Search Scope
            </span>
            <select
              value={scope}
              onChange={(e) =>
                setScope(e.target.value as 'current_page' | 'all_pages')
              }
              className="mt-1 w-full min-h-[38px] px-2.5 py-1.5 rounded-xl studio-select"
            >
              <option value="all_pages">All Pages</option>
              <option value="current_page">Current Page Only (Page {currentPage})</option>
            </select>
          </label>

          <label className="block">
            <span className="text-[11px] font-medium text-[#555555] dark:text-[#B5B5B5]">
              Overflow Protection
            </span>
            <select
              value={overflowStrategy}
              onChange={(e) =>
                setOverflowStrategy(e.target.value as OverflowStrategy)
              }
              className="mt-1 w-full min-h-[38px] px-2.5 py-1.5 rounded-xl studio-select"
            >
              <option value="autofit_font">Auto-shrink Font to Fit Box</option>
              <option value="wrap_expand_height">Wrap &amp; Expand Height</option>
              <option value="widen_box">Widen Text Box</option>
              <option value="keep_box">Keep Box Unchanged</option>
            </select>
          </label>

          <label className="flex items-center gap-2 min-h-[38px] px-3 rounded-xl border border-black/10 dark:border-white/12 glass-level-2 cursor-pointer">
            <input
              type="checkbox"
              checked={matchCase}
              onChange={(e) => setMatchCase(e.target.checked)}
              className="accent-[#101010] dark:accent-white"
            />
            <span className="text-[#101010] dark:text-white font-medium">
              Match Exact Case
            </span>
          </label>
        </div>

        <GlassCard level={2} padding="none" className="overflow-hidden">
          <div className="px-3.5 py-2.5 border-b border-black/10 dark:border-white/12 flex items-center justify-between">
            <span className="font-semibold text-[#101010] dark:text-white">
              Matching Elements ({matches.length})
            </span>
            {matches.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  if (selectedMatchIds.size === matches.length) {
                    setSelectedMatchIds(new Set());
                  } else {
                    setSelectedMatchIds(new Set(matches.map((m) => m.element.id)));
                  }
                }}
                className="text-[11px] font-medium text-[#555555] dark:text-[#B5B5B5] hover:text-[#101010] dark:hover:text-white"
              >
                {selectedMatchIds.size === matches.length
                  ? 'Deselect All'
                  : 'Select All'}
              </button>
            )}
          </div>

          <div className="max-h-72 overflow-y-auto divide-y divide-black/10 dark:divide-white/10">
            {!findQuery.trim() ? (
              <div className="p-6 text-center text-[#888888] dark:text-[#858585]">
                Enter text to search across editable elements.
              </div>
            ) : matches.length === 0 ? (
              <div className="p-6 text-center text-[#888888] dark:text-[#858585]">
                No unlocked text elements match "{findQuery}".
              </div>
            ) : (
              matches.map((m) => {
                const checked = selectedMatchIds.has(m.element.id);
                return (
                  <label
                    key={m.element.id}
                    className="px-3.5 py-2.5 flex items-start gap-3 cursor-pointer hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleId(m.element.id)}
                      className="mt-1 accent-[#101010] dark:accent-white"
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 text-[#555555] dark:text-[#B5B5B5]">
                          P{m.element.pageNumber} · {m.element.type}
                        </span>
                        {m.overflowingBeforeAutofit && (
                          <span className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-1 font-medium">
                            <AlertTriangle className="w-3 h-3" />
                            {overflowStrategy === 'autofit_font'
                              ? `Autofit -> ${m.autofitFontSize.toFixed(1)}pt`
                              : overflowStrategy === 'wrap_expand_height'
                              ? `Expands H -> ${Math.round(m.requiredHeight + 4)}pt`
                              : overflowStrategy === 'widen_box'
                              ? 'Widens box'
                              : 'May overflow box'}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[#888888] dark:text-[#858585] line-through truncate">
                        {m.element.text}
                      </div>
                      <div className="text-xs font-medium text-[#101010] dark:text-white truncate">
                        {m.nextText}
                      </div>
                    </div>
                  </label>
                );
              })
            )}
          </div>
        </GlassCard>
      </div>
    </GlassModal>
  );
};
