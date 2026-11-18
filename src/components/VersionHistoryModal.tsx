import React, { useMemo, useState } from 'react';
import {
  Clock,
  GitCompare,
  RotateCcw,
  Save,
} from 'lucide-react';
import { PDFProject, ProjectVersionSnapshot } from '../types/pdfStudio';
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
}

export const VersionHistoryModal: React.FC<VersionHistoryModalProps> = ({
  isOpen,
  project,
  onClose,
  onSaveNamedVersion,
  onRestoreVersion,
}) => {
  const [activeTab, setActiveTab] = useState<'versions' | 'audit'>('versions');
  const [versionNote, setVersionNote] = useState('');
  const [compareIdx, setCompareIdx] = useState<number | null>(null);

  const versions = project.versions || [];
  const auditLogs = project.operationLog || [];

  const comparison = useMemo(() => {
    if (compareIdx === null || !versions[compareIdx]) return null;
    return compareOriginalVsEdited(project, compareIdx);
  }, [compareIdx, project, versions]);

  if (!isOpen) return null;

  return (
    <GlassModal
      isOpen={isOpen}
      onClose={onClose}
      title={`Version History & Audit Log · ${project.name}`}
      subtitle={`Current v${project.version} · ${versions.length} saved snapshots · Original source PDF preserved`}
      maxWidthClass="max-w-4xl"
    >
      {/* Save Named Version Bar + Tabs */}
      <div className="px-4 tablet:px-5 py-3 border-b border-slate-200/75 dark:border-white/10 glass-level-2 flex flex-col tablet:flex-row tablet:items-center justify-between gap-3 sticky top-0 z-10">
        <GlassSegmentedControl
          value={activeTab}
          onChange={setActiveTab}
          options={[
            { value: 'versions', label: 'Snapshots', count: versions.length },
            { value: 'audit', label: 'Operation History', count: auditLogs.length },
          ]}
        />

        <form
          onSubmit={(e) => {
            e.preventDefault();
            const clean = versionNote.trim() || `Named milestone v${project.version}`;
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
            className="flex-1 min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-300/80 dark:border-white/15 bg-white/75 dark:bg-white/5 text-xs"
          />
          <GlassButton type="submit" variant="primary" size="md">
            <Save className="w-3.5 h-3.5" />
            Save Version
          </GlassButton>
        </form>
      </div>

      {/* Body */}
      <div className="p-4 tablet:p-5 space-y-4">
          {activeTab === 'versions' && (
            <>
              {comparison && compareIdx !== null && versions[compareIdx] && (
                <div className="p-4 rounded-lg border border-blue-500/40 bg-blue-500/5 space-y-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      Comparing Version {versions[compareIdx].version} against Current Working State (v{project.version})
                    </div>
                    <button
                      type="button"
                      onClick={() => setCompareIdx(null)}
                      className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
                    >
                      Close Diff
                    </button>
                  </div>
                  <div className="grid grid-cols-2 tablet:grid-cols-4 gap-3 tabular-nums">
                    <div className="p-2.5 rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
                      <div className="text-[11px] text-slate-500">Modified</div>
                      <div className="text-base font-semibold text-amber-600 dark:text-amber-400">
                        {comparison.modifiedCount}
                      </div>
                    </div>
                    <div className="p-2.5 rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
                      <div className="text-[11px] text-slate-500">Added</div>
                      <div className="text-base font-semibold text-emerald-600 dark:text-emerald-400">
                        {comparison.addedCount}
                      </div>
                    </div>
                    <div className="p-2.5 rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
                      <div className="text-[11px] text-slate-500">Removed</div>
                      <div className="text-base font-semibold text-red-600 dark:text-red-400">
                        {comparison.removedCount}
                      </div>
                    </div>
                    <div className="p-2.5 rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
                      <div className="text-[11px] text-slate-500">Page Geometry</div>
                      <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {comparison.pageSizeChanged ? 'Changed' : 'Matched'}
                      </div>
                    </div>
                  </div>
                  <div className="max-h-48 overflow-y-auto divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded bg-white dark:bg-[#111827]">
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
                                d.status === 'added'
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : d.status === 'removed'
                                  ? 'text-red-600 dark:text-red-400'
                                  : 'text-amber-600 dark:text-amber-400'
                              }`}
                            >
                              {d.status}
                            </span>
                            <span className="font-medium text-slate-900 dark:text-slate-100 truncate">
                              {d.label}
                            </span>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              Page {d.pageNumber} · {d.reasons.join(' · ')}
                            </div>
                          </div>
                        </div>
                      ))}
                    {comparison.diffs.filter((d) => d.status !== 'unchanged')
                      .length === 0 && (
                      <div className="px-3 py-4 text-center text-slate-500">
                        No element differences between this snapshot and the current document.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {versions.length === 0 ? (
                <GlassCard level={3} padding="lg" className="text-center text-xs text-slate-500 dark:text-slate-400">
                  No snapshots recorded yet. Save a named milestone above or enable automatic snapshots in Settings.
                </GlassCard>
              ) : (
                <GlassCard level={3} padding="none" className="divide-y divide-slate-200/75 dark:divide-white/10 overflow-hidden">
                  {versions.map((ver, idx) => (
                    <div
                      key={`${ver.version}-${ver.savedAt}-${idx}`}
                      className="p-3.5 flex flex-col tablet:flex-row tablet:items-center justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                            Version {ver.version}
                          </span>
                          <span className="text-slate-400">·</span>
                          <span className="text-slate-700 dark:text-slate-300 font-medium">
                            {ver.note}
                          </span>
                          {ver.isAutoSnapshot && (
                            <span className="text-[11px] text-slate-400">
                              · Auto Snapshot
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
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
                          className={`min-h-[36px] px-3 py-1.5 rounded border text-xs font-medium flex items-center gap-1.5 ${
                            compareIdx === idx
                              ? 'border-blue-600 bg-blue-600/10 text-blue-600 dark:text-blue-400'
                              : 'border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                          }`}
                        >
                          <GitCompare className="w-3.5 h-3.5" />
                          {compareIdx === idx ? 'Hide Diff' : 'Compare'}
                        </button>
                        <button
                          type="button"
                          onClick={() => onRestoreVersion(ver)}
                          className="min-h-[36px] px-3 py-1.5 rounded bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-medium hover:opacity-90 flex items-center gap-1.5"
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

          {activeTab === 'audit' && (
            <GlassCard level={3} padding="none" className="divide-y divide-slate-200/75 dark:divide-white/10 overflow-hidden">
              {auditLogs.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
                  Major edits, restores, and exports will be logged here chronologically.
                </div>
              ) : (
                auditLogs.map((log) => (
                  <div
                    key={log.id}
                    className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0">
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {log.action}
                      </span>
                      <span className="mx-2 text-slate-400">·</span>
                      <span className="text-slate-600 dark:text-slate-300">
                        {log.detail}
                      </span>
                      {log.pageNumber !== undefined && (
                        <span className="ml-2 text-[11px] text-slate-400 tabular-nums">
                          (Page {log.pageNumber})
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-slate-400 tabular-nums shrink-0 flex items-center gap-1">
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
