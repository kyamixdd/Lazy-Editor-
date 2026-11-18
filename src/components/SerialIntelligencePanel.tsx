import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  History,
  Play,
  Plus,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import {
  PDFProject,
  SerialBatchRecord,
  SerialReservedRange,
  SerialSequenceRule,
} from '../types/pdfStudio';
import {
  analyzeSerialIntelligence,
  buildSerialReportCsv,
  createSerialBatchRecord,
  generateSerialReportPdfBytes,
} from '../utils/serialEngine';
import { GlassCard } from './glass';

interface SerialIntelligencePanelProps {
  project: PDFProject;
  copiesPerPage: number;
  serialBatches: SerialBatchRecord[];
  onUpdateRules: (nextRules: SerialSequenceRule[]) => void;
  onSaveSerialBatch: (record: SerialBatchRecord) => void;
  onDeleteSerialBatch: (id: string) => void;
}

export const SerialIntelligencePanel: React.FC<SerialIntelligencePanelProps> = ({
  project,
  copiesPerPage,
  serialBatches,
  onUpdateRules,
  onSaveSerialBatch,
  onDeleteSerialBatch,
}) => {
  const { serialRules, bulkConfig, dataRows } = project;
  const projectBatches = useMemo(
    () => serialBatches.filter((b) => b.projectId === project.id),
    [serialBatches, project.id]
  );

  const intelligence = useMemo(
    () =>
      analyzeSerialIntelligence(
        serialRules,
        bulkConfig.totalOutputPages,
        copiesPerPage,
        dataRows,
        projectBatches
      ),
    [serialRules, bulkConfig.totalOutputPages, copiesPerPage, dataRows, projectBatches]
  );

  const [resRuleId, setResRuleId] = useState<string>(serialRules[0]?.id || '');
  const [resStart, setResStart] = useState<number>(100);
  const [resEnd, setResEnd] = useState<number>(110);
  const [resLabel, setResLabel] = useState<string>('Audit Hold');
  const [reportNotice, setReportNotice] = useState<string | null>(null);

  const activeResRule =
    serialRules.find((r) => r.id === resRuleId) || serialRules[0] || null;

  const handleAddReservedRange = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeResRule) return;
    const range: SerialReservedRange = {
      id: `rr-${Date.now()}`,
      start: Math.min(resStart, resEnd),
      end: Math.max(resStart, resEnd),
      label: resLabel.trim() || 'Reserved',
    };
    onUpdateRules(
      serialRules.map((r) =>
        r.id === activeResRule.id
          ? { ...r, reservedRanges: [...(r.reservedRanges || []), range] }
          : r
      )
    );
  };

  const handleRemoveReservedRange = (ruleId: string, rangeId: string) => {
    onUpdateRules(
      serialRules.map((r) =>
        r.id === ruleId
          ? {
              ...r,
              reservedRanges: (r.reservedRanges || []).filter((x) => x.id !== rangeId),
            }
          : r
      )
    );
  };

  const handleResumeRuleWithoutDuplication = (rule: SerialSequenceRule) => {
    const nextStart = intelligence.nextSafeResumeByRule[rule.id] ?? rule.startNumber;
    const span = Math.max(
      1,
      Math.abs(rule.endNumber - rule.startNumber) || bulkConfig.totalOutputPages
    );
    const inc = rule.increment === 0 ? 1 : rule.increment;
    const nextEnd = inc > 0 ? nextStart + span : nextStart - span;
    onUpdateRules(
      serialRules.map((r) =>
        r.id === rule.id
          ? { ...r, startNumber: nextStart, endNumber: nextEnd }
          : r
      )
    );
    setReportNotice(
      `Resumed "${rule.name}" at #${nextStart} without duplicating prior batches.`
    );
  };

  const handleRecordCurrentBatch = () => {
    for (const rule of serialRules) {
      const rec = createSerialBatchRecord(
        project,
        rule,
        bulkConfig.totalOutputPages,
        copiesPerPage,
        'completed'
      );
      onSaveSerialBatch(rec);
    }
    setReportNotice(`Recorded ${serialRules.length} sequence batch checkpoint(s).`);
  };

  const handleExportCsvReport = () => {
    const csv = buildSerialReportCsv(
      project.name,
      serialRules,
      intelligence,
      projectBatches
    );
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name.replace(/\s+/g, '_')}_serial_report.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleExportPdfReport = async () => {
    const bytes = await generateSerialReportPdfBytes(
      project,
      intelligence,
      projectBatches
    );
    const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name.replace(/\s+/g, '_')}_serial_report.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const minTimelineNum = useMemo(() => {
    if (intelligence.timeline.length === 0) return 0;
    return Math.min(...intelligence.timeline.map((t) => t.start));
  }, [intelligence.timeline]);

  const maxTimelineNum = useMemo(() => {
    if (intelligence.timeline.length === 0) return 100;
    return Math.max(
      minTimelineNum + 1,
      ...intelligence.timeline.map((t) => t.end)
    );
  }, [intelligence.timeline, minTimelineNum]);

  if (serialRules.length === 0) return null;

  return (
    <GlassCard level={3} padding="sm" className="space-y-3.5 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-black/10 dark:border-white/10">
        <div>
          <div className="font-semibold text-[#101010] dark:text-white flex items-center gap-1.5">
            <History className="w-3.5 h-3.5" />
            Serial Number Intelligence
          </div>
          <div className="text-[11px] text-[#555555] dark:text-[#B5B5B5]">
            Reserved ranges, cross-batch conflict detection, safe continuation & numbering timeline
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={handleRecordCurrentBatch}
            className="px-2.5 py-1 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/[0.04] dark:hover:bg-white/[0.08] font-medium"
          >
            Log Batch Run
          </button>
          <button
            type="button"
            onClick={handleExportCsvReport}
            className="px-2.5 py-1 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/[0.04] dark:hover:bg-white/[0.08] font-medium flex items-center gap-1"
          >
            <Download className="w-3 h-3" />
            CSV Report
          </button>
          <button
            type="button"
            onClick={() => void handleExportPdfReport()}
            className="px-2.5 py-1 rounded-lg bg-[#101010] text-white dark:bg-white dark:text-[#050505] font-medium flex items-center gap-1"
          >
            <Download className="w-3 h-3" />
            PDF Report
          </button>
        </div>
      </div>

      {reportNotice && (
        <div className="px-2.5 py-1.5 rounded-lg border border-black/10 dark:border-white/15 bg-black/[0.03] dark:bg-white/[0.04] text-[11px] text-[#101010] dark:text-white">
          {reportNotice}
        </div>
      )}

      {/* Conflict / Health Summary */}
      {intelligence.conflicts.length === 0 ? (
        <div className="flex items-center gap-1.5 text-[11px] text-[#101010] dark:text-white font-medium">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          All serial sequences verified: no duplicates, overlaps, or unlogged batch collisions.
        </div>
      ) : (
        <div className="space-y-1.5">
          {intelligence.conflicts.map((c) => (
            <div
              key={c.id}
              className={`p-2 rounded-lg border text-[11px] flex items-start gap-2 ${
                c.severity === 'error'
                  ? 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300'
                  : 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
              }`}
            >
              {c.severity === 'error' ? (
                <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              )}
              <div className="min-w-0">
                <div className="font-semibold">{c.message}</div>
                <div className="opacity-90">{c.detail}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Sequence Continuation & Safe Batch Resume */}
      <div className="space-y-1.5">
        <div className="text-[11px] font-medium text-[#555555] dark:text-[#B5B5B5]">
          Sequence Continuation & Safe Batch Resume
        </div>
        <div className="space-y-1.5">
          {serialRules.map((rule) => {
            const span = intelligence.ruleSpans.find((s) => s.ruleId === rule.id);
            const nextSafe = intelligence.nextSafeResumeByRule[rule.id] ?? rule.startNumber;
            return (
              <div
                key={rule.id}
                className="p-2 rounded-xl border border-black/10 dark:border-white/10 flex flex-wrap items-center justify-between gap-2 tabular-nums"
              >
                <div className="min-w-0">
                  <div className="font-medium text-[#101010] dark:text-white truncate">
                    {rule.name} · {rule.targetFieldKey}
                  </div>
                  <div className="text-[10px] text-[#888888] dark:text-[#858585]">
                    Planned #{span?.firstNumber ?? '-'}–#{span?.lastNumber ?? '-'} · Skipped
                    reserved: {span?.skippedReservedCount ?? 0} · Next safe: #{nextSafe}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleResumeRuleWithoutDuplication(rule)}
                  className="px-2.5 py-1 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/[0.04] dark:hover:bg-white/[0.08] text-[11px] font-medium flex items-center gap-1 shrink-0"
                >
                  <Play className="w-3 h-3" />
                  Resume at #{nextSafe}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Reserved Number Ranges */}
      <div className="pt-2 border-t border-black/10 dark:border-white/10 space-y-2">
        <div className="text-[11px] font-medium text-[#555555] dark:text-[#B5B5B5]">
          Reserved Number Ranges (Auto-Skipped)
        </div>
        <form onSubmit={handleAddReservedRange} className="grid grid-cols-2 tablet:grid-cols-5 gap-1.5">
          <select
            value={activeResRule?.id || ''}
            onChange={(e) => setResRuleId(e.target.value)}
            className="px-2 py-1 rounded-lg studio-select text-[11px]"
          >
            {serialRules.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <input
            type="number"
            placeholder="Start"
            value={resStart}
            onChange={(e) => setResStart(Number(e.target.value) || 0)}
            className="px-2 py-1 rounded-lg studio-input text-[11px] tabular-nums"
          />
          <input
            type="number"
            placeholder="End"
            value={resEnd}
            onChange={(e) => setResEnd(Number(e.target.value) || 0)}
            className="px-2 py-1 rounded-lg studio-input text-[11px] tabular-nums"
          />
          <input
            type="text"
            placeholder="Reason"
            value={resLabel}
            onChange={(e) => setResLabel(e.target.value)}
            className="px-2 py-1 rounded-lg studio-input text-[11px]"
          />
          <button
            type="submit"
            className="px-2 py-1 rounded-lg bg-[#101010] text-white dark:bg-white dark:text-[#050505] font-medium text-[11px] flex items-center justify-center gap-1"
          >
            <Plus className="w-3 h-3" />
            Reserve
          </button>
        </form>

        {serialRules.some((r) => (r.reservedRanges?.length || 0) > 0) && (
          <div className="space-y-1">
            {serialRules.flatMap((r) =>
              (r.reservedRanges || []).map((rr) => (
                <div
                  key={rr.id}
                  className="flex items-center justify-between px-2.5 py-1 rounded-lg border border-black/10 dark:border-white/10 text-[11px] tabular-nums"
                >
                  <span>
                    {r.name}: #{rr.start}–#{rr.end} ({rr.label || 'Reserved'})
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveReservedRange(r.id, rr.id)}
                    className="p-1 text-[#888888] hover:text-red-500"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Visual Serial-Number Timeline */}
      {intelligence.timeline.length > 0 && (
        <div className="pt-2 border-t border-black/10 dark:border-white/10 space-y-2">
          <div className="flex items-center justify-between text-[11px] tabular-nums">
            <span className="font-medium text-[#555555] dark:text-[#B5B5B5]">
              Visual Serial-Number Timeline
            </span>
            <span className="text-[#888888] dark:text-[#858585]">
              #{minTimelineNum} – #{maxTimelineNum}
            </span>
          </div>
          <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
            {intelligence.timeline.map((seg) => {
              const spanTotal = Math.max(1, maxTimelineNum - minTimelineNum);
              const leftPct = Math.max(
                0,
                ((seg.start - minTimelineNum) / spanTotal) * 100
              );
              const widthPct = Math.max(
                3,
                ((seg.end - seg.start + 1) / spanTotal) * 100
              );
              const barColor =
                seg.kind === 'conflict'
                  ? 'bg-red-500'
                  : seg.kind === 'reserved'
                  ? 'bg-amber-500/80'
                  : seg.kind === 'gap'
                  ? 'bg-transparent border border-dashed border-amber-500'
                  : seg.kind === 'completed_batch'
                  ? 'bg-[#101010] dark:bg-white'
                  : 'bg-[#555555] dark:bg-[#999999]';
              return (
                <div key={seg.id} className="space-y-0.5 text-[10px] tabular-nums">
                  <div className="flex justify-between text-[#555555] dark:text-[#B5B5B5]">
                    <span className="truncate">{seg.label}</span>
                    <span>
                      #{seg.start}–#{seg.end} ({seg.count})
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-black/[0.06] dark:bg-white/[0.08] relative overflow-hidden">
                    <div
                      style={{
                        left: `${Math.min(97, leftPct)}%`,
                        width: `${Math.min(100 - Math.min(97, leftPct), widthPct)}%`,
                      }}
                      className={`absolute top-0 bottom-0 rounded-full ${barColor}`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recorded Batch History */}
      {projectBatches.length > 0 && (
        <div className="pt-2 border-t border-black/10 dark:border-white/10 space-y-1.5">
          <div className="text-[11px] font-medium text-[#555555] dark:text-[#B5B5B5]">
            Numbering Batch History ({projectBatches.length})
          </div>
          <div className="max-h-32 overflow-y-auto space-y-1">
            {projectBatches.map((b) => (
              <div
                key={b.id}
                className="flex items-center justify-between gap-2 px-2.5 py-1 rounded-lg border border-black/10 dark:border-white/10 text-[11px] tabular-nums"
              >
                <span className="truncate">
                  {b.ruleName} · #{b.actualFirstNum}–#{b.actualLastNum} ({b.generatedCount}) ·{' '}
                  {b.createdAt.slice(0, 10)}
                </span>
                <button
                  type="button"
                  onClick={() => onDeleteSerialBatch(b.id)}
                  className="p-1 text-[#888888] hover:text-red-500"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </GlassCard>
  );
};
