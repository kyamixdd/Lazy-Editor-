import React, { useMemo, useState } from 'react';
import {
  Clock,
  GitCompare,
  Layers,
  RotateCcw,
  Save,
  Undo2,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { popoverVariants } from '../config/motionSystem';
import {
  HistoryEntry,
  PDFProject,
  ProjectVersionSnapshot,
} from '../types/pdfStudio';
import { compareOriginalVsEdited } from '../utils/comparisonEngine';
import {
  GlassButton,
  GlassCard,
  GlassModal,
  GlassSegmentedControl,
} from './glass';

interface VersionHistoryModalProps {
  isOpen: boolean;
  project: PDFProject;
  onClose: () => void;
  onSaveNamedVersion: (note: string) => void;
  onRestoreVersion: (snapshot: ProjectVersionSnapshot) => void;
  historyEntries?: HistoryEntry[];
  onRevertHistoryEntry?: (entryId: string) => void;
  onRevertIndividualOperation?: (entryId: string) => {
    ok: boolean;
    message: string;
  };
}

export const VersionHistoryModal: React.FC<VersionHistoryModalProps> = ({
  isOpen,
  project,
  onClose,
  onSaveNamedVersion,
  onRestoreVersion,
  historyEntries = [],
  onRevertHistoryEntry,
  onRevertIndividualOperation,
}) => {
  const [activeTab, setActiveTab] = useState<'versions' | 'timeline' | 'audit'>(
    'versions'
  );
  const [versionNote, setVersionNote] = useState('');
  const [compareIdx, setCompareIdx] = useState<number | null>(null);
  const [revertMessage, setRevertMessage] = useState<string | null>(null);

  const versions = project.versions || [];
  const auditLogs = project.operationLog || [];

  const comparison = useMemo(() => {
    if (compareIdx === null || !versions[compareIdx]) return null;
    return compareOriginalVsEdited(project, compareIdx);
  }, [compareIdx, project, versions]);

  return (
    <GlassModal
      isOpen={isOpen}
      onClose={onClose}
      title={`Version History & Edit Timeline · ${project.name}`}
      subtitle={`Current v${project.version} · ${versions.length} snapshots · ${historyEntries.length} session edits`}
      maxWidthClass="max-w-4xl"
    >
      {/* Save Named Version Bar + Tabs */}
      <div className="px-4 tablet:px-5 py-3 border-b border-black/10 dark:border-white/12 glass-level-2 flex flex-col tablet:flex-row tablet:items-center justify-between gap-3 sticky top-0 z-10">
        <GlassSegmentedControl
          value={activeTab}
          onChange={setActiveTab}
          options={[
            { value: 'versions', label: 'Snapshots', count: versions.length },
            { value: 'timeline', label: 'Edit Timeline', count: historyEntries.length },
            { value: 'audit', label: 'Audit Log', count: auditLogs.length },
          ]}
        />

        <form
          onSubmit={(e) => {
            e.preventDefault();
            const clean =
              versionNote.trim() || `Named milestone v${project.version}`;
            onSaveNamedVersion(clean);
            setVersionNote('');
          }}
          className="flex items-center gap-2 flex-1 max-w-md"
        >
          <input
            type="text"
            placeholder="Name this version (e.g. Client Approved Layout)..."
            value={versionNote}
            onChange={(e) => setVersionNote(e.target.value)}
            className="flex-1 min-h-[40px] px-3 py-1.5 rounded-xl border studio-input text-xs"
          />
          <GlassButton type="submit" variant="primary" size="md">
            <Save className="w-3.5 h-3.5" />
            Save Version
          </GlassButton>
        </form>
      </div>

      {/* Body */}
      <div className="p-4 tablet:p-5 space-y-4">
        {revertMessage && (
          <div className="px-3.5 py-2 rounded-xl border border-black/15 dark:border-white/15 glass-level-3 text-xs text-[#101010] dark:text-white">
            {revertMessage}
          </div>
        )}

        {activeTab === 'versions' && (
          <>
            <AnimatePresence initial={false}>
              {comparison && compareIdx !== null && versions[compareIdx] && (
                <motion.div
                  key={`diff-${compareIdx}`}
                  variants={popoverVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="p-4 rounded-xl border border-black/20 dark:border-white/20 glass-level-2 space-y-3 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold text-[#101010] dark:text-white">
                      Comparing Version {versions[compareIdx].version} against Current Working State (v{project.version})
                    </div>
                    <button
                      type="button"
                      onClick={() => setCompareIdx(null)}
                      className="text-xs text-[#555555] hover:text-[#101010] dark:text-[#B5B5B5] dark:hover:text-white transition-colors"
                    >
                      Close Diff
                    </button>
                  </div>
                  <div className="grid grid-cols-2 tablet:grid-cols-4 gap-3 tabular-nums">
                    <div className="p-2.5 rounded-lg border border-black/10 dark:border-white/12 bg-[#F7F7F7] dark:bg-[#0B0B0B]">
                      <div className="text-[11px] text-[#888888] dark:text-[#858585]">Modified</div>
                      <div className="text-base font-semibold text-[#101010] dark:text-white">
                        {comparison.modifiedCount}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-lg border border-black/10 dark:border-white/12 bg-[#F7F7F7] dark:bg-[#0B0B0B]">
                      <div className="text-[11px] text-[#888888] dark:text-[#858585]">Added</div>
                      <div className="text-base font-semibold text-[#101010] dark:text-white">
                        {comparison.addedCount}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-lg border border-black/10 dark:border-white/12 bg-[#F7F7F7] dark:bg-[#0B0B0B]">
                      <div className="text-[11px] text-[#888888] dark:text-[#858585]">Removed</div>
                      <div className="text-base font-semibold text-[#555555] dark:text-[#B5B5B5]">
                        {comparison.removedCount}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-lg border border-black/10 dark:border-white/12 bg-[#F7F7F7] dark:bg-[#0B0B0B]">
                      <div className="text-[11px] text-[#888888] dark:text-[#858585]">Page Geometry</div>
                      <div className="text-sm font-semibold text-[#101010] dark:text-white">
                        {comparison.pageSizeChanged ? 'Changed' : 'Matched'}
                      </div>
                    </div>
                  </div>
                  <div className="max-h-48 overflow-y-auto divide-y divide-black/10 dark:divide-white/10 border border-black/10 dark:border-white/12 rounded-xl bg-white dark:bg-[#0B0B0B]">
                    {comparison.diffs
                      .filter((d) => d.status !== 'unchanged')
                      .slice(0, 40)
                      .map((d) => (
                        <div
                          key={d.id}
                          className="px-3 py-2 flex items-center justify-between gap-3"
                        >
                          <div className="min-w-0">
                            <span
                              className={`text-[10px] font-semibold uppercase mr-2 ${
                                d.status === 'removed'
                                  ? 'text-[#888888] dark:text-[#858585] line-through'
                                  : 'text-[#101010] dark:text-white'
                              }`}
                            >
                              {d.status}
                            </span>
                            <span className="font-medium text-[#101010] dark:text-white truncate">
                              {d.label}
                            </span>
                            <div className="text-[11px] text-[#555555] dark:text-[#B5B5B5]">
                              Page {d.pageNumber} · {d.reasons.join(' · ')}
                            </div>
                          </div>
                        </div>
                      ))}
                    {comparison.diffs.filter((d) => d.status !== 'unchanged')
                      .length === 0 && (
                      <div className="px-3 py-4 text-center text-[#888888] dark:text-[#858585]">
                        No element differences between this snapshot and the current document.
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {versions.length === 0 ? (
              <GlassCard
                level={3}
                padding="lg"
                className="text-center text-xs text-[#555555] dark:text-[#B5B5B5]"
              >
                No snapshots recorded yet. Save a named milestone above or enable automatic snapshots in Settings.
              </GlassCard>
            ) : (
              <GlassCard
                level={3}
                padding="none"
                className="divide-y divide-black/10 dark:divide-white/10 overflow-hidden"
              >
                {versions.map((ver, idx) => (
                  <div
                    key={`${ver.version}-${ver.savedAt}-${idx}`}
                    className="p-3.5 flex flex-col tablet:flex-row tablet:items-center justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-[#101010] dark:text-white tabular-nums">
                          Version {ver.version}
                        </span>
                        <span className="text-[#888888] dark:text-[#858585]">·</span>
                        <span className="text-[#101010] dark:text-white font-medium">
                          {ver.note}
                        </span>
                        {ver.isAutoSnapshot && (
                          <span className="text-[11px] text-[#888888] dark:text-[#858585]">
                            · Auto Snapshot
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-[11px] text-[#555555] dark:text-[#B5B5B5] tabular-nums">
                        {new Date(ver.savedAt).toLocaleString()} ·{' '}
                        {ver.elementsSnapshot.length} elements ·{' '}
                        {Math.round(ver.pageConfigSnapshot.widthPt)}×
                        {Math.round(ver.pageConfigSnapshot.heightPt)} pt
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          setCompareIdx(compareIdx === idx ? null : idx)
                        }
                        className={`min-h-[36px] px-3 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 ${
                          compareIdx === idx
                            ? 'studio-active-surface'
                            : 'border-black/15 dark:border-white/15 text-[#555555] dark:text-[#B5B5B5] hover:bg-black/[0.04] dark:hover:bg-white/[0.08]'
                        }`}
                      >
                        <GitCompare className="w-3.5 h-3.5" />
                        {compareIdx === idx ? 'Hide Diff' : 'Compare'}
                      </button>
                      <button
                        type="button"
                        onClick={() => onRestoreVersion(ver)}
                        className="min-h-[36px] px-3 py-1.5 rounded-lg bg-[#101010] text-white hover:bg-[#262626] dark:bg-white dark:text-[#050505] dark:hover:bg-[#E6E6E6] font-medium flex items-center gap-1.5"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Restore
                      </button>
                    </div>
                  </div>
                ))}
              </GlassCard>
            )}
          </>
        )}

        {activeTab === 'timeline' && (
          <GlassCard
            level={3}
            padding="none"
            className="divide-y divide-black/10 dark:divide-white/10 overflow-hidden"
          >
            {historyEntries.length === 0 ? (
              <div className="p-8 text-center text-xs text-[#555555] dark:text-[#B5B5B5]">
                Structured undo states from your current editing session appear here with selective revert support.
              </div>
            ) : (
              [...historyEntries].reverse().map((entry) => (
                <div
                  key={entry.id}
                  className="px-4 py-3 flex flex-col tablet:flex-row tablet:items-center justify-between gap-2 text-xs"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Layers className="w-3.5 h-3.5 text-[#888888] shrink-0" />
                      <span className="font-semibold text-[#101010] dark:text-white truncate">
                        {entry.label}
                      </span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 text-[#555555] dark:text-[#B5B5B5]">
                        {entry.actionType}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-[#555555] dark:text-[#B5B5B5] tabular-nums">
                      {new Date(entry.timestamp).toLocaleTimeString()} ·{' '}
                      {entry.elements.length} elements · {entry.pageCount} page(s)
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {onRevertIndividualOperation && (
                      <button
                        type="button"
                        onClick={() => {
                          const res = onRevertIndividualOperation(entry.id);
                          setRevertMessage(res.message);
                        }}
                        className="min-h-[34px] px-2.5 py-1 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/10 text-[11px] font-medium flex items-center gap-1"
                      >
                        <Undo2 className="w-3 h-3" />
                        Revert This Edit
                      </button>
                    )}
                    {onRevertHistoryEntry && (
                      <button
                        type="button"
                        onClick={() => {
                          onRevertHistoryEntry(entry.id);
                          onClose();
                        }}
                        className="min-h-[34px] px-2.5 py-1 rounded-lg bg-[#101010] text-white dark:bg-white dark:text-[#050505] text-[11px] font-medium flex items-center gap-1"
                      >
                        <RotateCcw className="w-3 h-3" />
                        Roll Back to Here
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </GlassCard>
        )}

        {activeTab === 'audit' && (
          <GlassCard
            level={3}
            padding="none"
            className="divide-y divide-black/10 dark:divide-white/10 overflow-hidden"
          >
            {auditLogs.length === 0 ? (
              <div className="p-8 text-center text-xs text-[#555555] dark:text-[#B5B5B5]">
                Major edits, restores, and exports will be logged here chronologically.
              </div>
            ) : (
              auditLogs.map((log) => (
                <div
                  key={log.id}
                  className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs"
                >
                  <div className="min-w-0">
                    <span className="font-semibold text-[#101010] dark:text-white">
                      {log.action}
                    </span>
                    <span className="mx-2 text-[#888888] dark:text-[#858585]">·</span>
                    <span className="text-[#555555] dark:text-[#B5B5B5]">
                      {log.detail}
                    </span>
                    {log.pageNumber !== undefined && (
                      <span className="ml-2 text-[11px] text-[#888888] dark:text-[#858585] tabular-nums">
                        (Page {log.pageNumber})
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-[#888888] dark:text-[#858585] tabular-nums shrink-0 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              ))
            )}
          </GlassCard>
        )}
      </div>
    </GlassModal>
  );
};
