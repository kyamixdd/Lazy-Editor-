import React, { useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  CheckCircle2,
  Download,
  Layers,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Square,
  Trash2,
  XCircle,
} from 'lucide-react';
import { MOTION_EASE } from '../config/motionSystem';
import {
  AssetFontItem,
  BatchJob,
  PDFProject,
} from '../types/pdfStudio';
import { formatBytesCompact } from '../utils/projectStorage';
import { ExportJobControl, generateExportBytes } from '../utils/pdfExporter';
import { validateProject } from '../utils/validationEngine';
import { GlassButton, GlassCard } from './glass';

interface BatchCenterViewProps {
  projects: PDFProject[];
  customFonts: AssetFontItem[];
  batchJobs: BatchJob[];
  onSaveBatchJob: (job: BatchJob) => void;
  onDeleteBatchJob: (id: string) => void;
  onClearBatchHistory: () => void;
}

interface SessionDownload {
  url: string;
  fileName: string;
  sizeBytes: number;
}

export const BatchCenterView: React.FC<BatchCenterViewProps> = ({
  projects,
  customFonts,
  batchJobs,
  onSaveBatchJob,
  onDeleteBatchJob,
  onClearBatchHistory,
}) => {
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [isRunningQueue, setIsRunningQueue] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [downloads, setDownloads] = useState<Record<string, SessionDownload>>({});

  const cancelSetRef = useRef<Set<string>>(new Set());
  const globalCancelRef = useRef(false);
  const pausedRef = useRef(false);

  const enqueueSelected = () => {
    if (selectedProjectIds.length === 0) return;
    const now = new Date().toISOString();
    selectedProjectIds.forEach((pid, idx) => {
      const proj = projects.find((p) => p.id === pid);
      if (!proj) return;
      const totalPages =
        proj.bulkConfig.enabled || proj.copiesConfig.enabled
          ? Math.max(1, proj.bulkConfig.totalOutputPages)
          : Math.max(1, proj.pageCount);
      const job: BatchJob = {
        id: `job-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 5)}`,
        projectId: proj.id,
        projectName: proj.name,
        status: 'queued',
        progressCurrent: 0,
        progressTotal: totalPages,
        stage: 'Queued for generation',
        createdAt: now,
      };
      onSaveBatchJob(job);
    });
    setSelectedProjectIds([]);
  };

  const runJob = async (job: BatchJob) => {
    const project = projects.find((p) => p.id === job.projectId);
    if (!project) {
      onSaveBatchJob({
        ...job,
        status: 'failed',
        error: 'Source project no longer exists in local storage.',
        completedAt: new Date().toISOString(),
      });
      return;
    }

    const blockingErrors = validateProject(project, customFonts).filter(
      (i) => i.severity === 'error'
    );
    if (blockingErrors.length > 0) {
      onSaveBatchJob({
        ...job,
        status: 'failed',
        stage: 'Preflight blocked export',
        error: `${blockingErrors.length} preflight error(s): ${blockingErrors[0].message}`,
        completedAt: new Date().toISOString(),
      });
      return;
    }

    const startedAt = new Date().toISOString();
    onSaveBatchJob({
      ...job,
      status: 'running',
      startedAt,
      stage: 'Initializing PDF generator',
      error: undefined,
    });

    const control: ExportJobControl = {
      isCancelled: () =>
        globalCancelRef.current || cancelSetRef.current.has(job.id),
      waitWhilePaused: async () => {
        while (
          pausedRef.current &&
          !globalCancelRef.current &&
          !cancelSetRef.current.has(job.id)
        ) {
          onSaveBatchJob({
            ...job,
            status: 'paused',
            stage: 'Paused by user',
            startedAt,
          });
          await new Promise((r) => setTimeout(r, 250));
        }
      },
    };

    try {
      let lastReportAt = 0;
      const result = await generateExportBytes(project, {
        customFonts,
        control,
        onProgress: (stage, current, total) => {
          const nowMs = Date.now();
          if (nowMs - lastReportAt > 180 || current === total) {
            lastReportAt = nowMs;
            onSaveBatchJob({
              ...job,
              status: pausedRef.current ? 'paused' : 'running',
              progressCurrent: current,
              progressTotal: Math.max(1, total),
              stage,
              startedAt,
            });
          }
        },
      });

      const blob = new Blob([result.data.slice().buffer], {
        type: result.mimeType,
      });
      const url = URL.createObjectURL(blob);
      setDownloads((prev) => ({
        ...prev,
        [job.id]: {
          url,
          fileName: result.fileName,
          sizeBytes: result.data.byteLength,
        },
      }));

      onSaveBatchJob({
        ...job,
        status: 'completed',
        progressCurrent: job.progressTotal,
        progressTotal: job.progressTotal,
        stage: 'Completed',
        outputFileName: result.fileName,
        outputMimeType: result.mimeType,
        outputSizeBytes: result.data.byteLength,
        startedAt,
        completedAt: new Date().toISOString(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Batch generation failed';
      const cancelled = msg.toLowerCase().includes('cancelled');
      onSaveBatchJob({
        ...job,
        status: cancelled ? 'cancelled' : 'failed',
        stage: cancelled ? 'Cancelled' : 'Error',
        error: cancelled ? undefined : msg,
        startedAt,
        completedAt: new Date().toISOString(),
      });
    }
  };

  const handleStartQueue = async () => {
    const queued = batchJobs.filter(
      (j) => j.status === 'queued' || j.status === 'paused'
    );
    if (queued.length === 0) return;
    globalCancelRef.current = false;
    cancelSetRef.current.clear();
    pausedRef.current = false;
    setIsPaused(false);
    setIsRunningQueue(true);

    // Run oldest queued jobs first
    const ordered = [...queued].reverse();
    for (const job of ordered) {
      if (globalCancelRef.current) break;
      if (cancelSetRef.current.has(job.id)) continue;
      await runJob(job);
    }
    setIsRunningQueue(false);
    setIsPaused(false);
    pausedRef.current = false;
  };

  const handleTogglePause = () => {
    const next = !isPaused;
    pausedRef.current = next;
    setIsPaused(next);
  };

  const handleCancelAll = () => {
    globalCancelRef.current = true;
    pausedRef.current = false;
    setIsPaused(false);
    batchJobs.forEach((j) => {
      if (j.status === 'queued' || j.status === 'paused') {
        onSaveBatchJob({
          ...j,
          status: 'cancelled',
          stage: 'Cancelled by user',
          completedAt: new Date().toISOString(),
        });
      }
    });
  };

  const queuedCount = batchJobs.filter((j) => j.status === 'queued').length;
  const completedCount = batchJobs.filter((j) => j.status === 'completed').length;
  const failedCount = batchJobs.filter((j) => j.status === 'failed').length;

  return (
    <div className="flex-1 overflow-y-auto p-4 tablet:p-6 desktop:p-8 max-w-6xl mx-auto w-full space-y-6">
      <div className="flex flex-col tablet:flex-row tablet:items-center justify-between gap-4 pb-5 border-b border-black/10 dark:border-white/12">
        <div>
          <h1 className="text-xl tablet:text-2xl font-display font-semibold tracking-tight text-[#101010] dark:text-white">
            Batch Processing Center
          </h1>
          <p className="mt-1 text-xs tablet:text-sm text-[#555555] dark:text-[#B5B5B5]">
            Queue multiple PDF projects for automated validation, bulk imposition, and tracked export execution.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0 text-xs">
          {!isRunningQueue ? (
            <GlassButton
              variant="primary"
              size="md"
              disabled={queuedCount === 0}
              onClick={() => void handleStartQueue()}
            >
              <Play className="w-3.5 h-3.5" />
              Run Queue ({queuedCount})
            </GlassButton>
          ) : (
            <>
              <GlassButton
                variant="glass"
                size="md"
                onClick={handleTogglePause}
                className="border-black/25 dark:border-white/25 text-[#101010] dark:text-white"
              >
                {isPaused ? (
                  <>
                    <Play className="w-3.5 h-3.5" />
                    Resume
                  </>
                ) : (
                  <>
                    <Pause className="w-3.5 h-3.5" />
                    Pause
                  </>
                )}
              </GlassButton>
              <GlassButton variant="danger" size="md" onClick={handleCancelAll}>
                <Square className="w-3.5 h-3.5" />
                Cancel Queue
              </GlassButton>
            </>
          )}
        </div>
      </div>

      {/* Add Projects to Queue */}
      <GlassCard level={3} padding="md" className="space-y-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold text-[#101010] dark:text-white">
            Select Projects to Enqueue ({projects.length} available)
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedProjectIds(projects.map((p) => p.id))}
              className="text-[#101010] dark:text-white hover:underline font-medium"
            >
              Select All
            </button>
            <button
              type="button"
              disabled={selectedProjectIds.length === 0}
              onClick={enqueueSelected}
              className="min-h-[36px] px-3 py-1.5 rounded-lg bg-[#101010] text-white hover:bg-[#262626] dark:bg-white dark:text-[#050505] dark:hover:bg-[#E6E6E6] font-medium disabled:opacity-40 flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Selected ({selectedProjectIds.length})
            </button>
          </div>
        </div>

        {projects.length === 0 ? (
          <div className="text-[#555555] dark:text-[#B5B5B5] py-2">
            No saved projects yet. Upload a PDF first to add batch jobs.
          </div>
        ) : (
          <div className="grid grid-cols-1 tablet:grid-cols-2 desktop:grid-cols-3 gap-2 max-h-48 overflow-y-auto">
            {projects.map((p) => {
              const checked = selectedProjectIds.includes(p.id);
              const pages =
                p.bulkConfig.enabled || p.copiesConfig.enabled
                  ? p.bulkConfig.totalOutputPages
                  : p.pageCount;
              return (
                <label
                  key={p.id}
                  className={`p-2.5 rounded-xl border cursor-pointer flex items-center gap-2.5 transition-colors ${
                    checked
                      ? 'studio-active-surface'
                      : 'border-black/10 dark:border-white/12 hover:border-black/25 dark:hover:border-white/25'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) =>
                      setSelectedProjectIds((prev) =>
                        e.target.checked
                          ? [...prev, p.id]
                          : prev.filter((id) => id !== p.id)
                      )
                    }
                    className="rounded border-black/25 dark:border-white/25"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-[#101010] dark:text-white truncate">
                      {p.name}
                    </div>
                    <div className="text-[11px] text-[#888888] dark:text-[#858585] tabular-nums">
                      {pages} output pg · {p.exportConfig.mode.replace(/_/g, ' ')}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </GlassCard>

      {/* Queue & Processing History */}
      <GlassCard level={3} padding="none" className="overflow-hidden">
        <div className="px-5 py-3.5 border-b border-black/10 dark:border-white/12 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 font-semibold text-[#101010] dark:text-white">
            <Layers className="w-4 h-4 text-[#101010] dark:text-white" />
            Queue & Processing History
            <span className="font-normal text-[#888888] dark:text-[#858585] tabular-nums">
              · {queuedCount} queued · {completedCount} completed · {failedCount} failed
            </span>
          </div>
          {batchJobs.length > 0 && !isRunningQueue && (
            <button
              type="button"
              onClick={onClearBatchHistory}
              className="text-[#555555] hover:text-[#101010] dark:text-[#B5B5B5] dark:hover:text-white hover:underline font-medium"
            >
              Clear History
            </button>
          )}
        </div>

        {batchJobs.length === 0 ? (
          <div className="p-8 text-center text-xs text-[#555555] dark:text-[#B5B5B5]">
            Batch queue is empty. Select one or more projects above and click Add Selected.
          </div>
        ) : (
          <div className="divide-y divide-black/10 dark:divide-white/10 text-xs">
            {batchJobs.map((job) => {
              const pct = Math.min(
                100,
                Math.round(
                  (job.progressCurrent / Math.max(1, job.progressTotal)) * 100
                )
              );
              const dl = downloads[job.id];
              return (
                <div key={job.id} className="p-4 space-y-2">
                  <div className="flex flex-col tablet:flex-row tablet:items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-[#101010] dark:text-white">
                          {job.projectName}
                        </span>
                        <span
                          className={`text-[10px] font-semibold uppercase ${
                            job.status === 'failed'
                              ? 'text-red-600 dark:text-red-400'
                              : job.status === 'completed' || job.status === 'running'
                              ? 'text-[#101010] dark:text-white'
                              : 'text-[#888888] dark:text-[#858585]'
                          }`}
                        >
                          {job.status}
                        </span>
                        <span className="text-[#888888] dark:text-[#858585]">·</span>
                        <span className="text-[#555555] dark:text-[#B5B5B5]">
                          {job.stage}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-[#888888] dark:text-[#858585] tabular-nums">
                        {new Date(job.createdAt).toLocaleString()}
                        {job.outputFileName ? ` · ${job.outputFileName}` : ''}
                        {job.outputSizeBytes
                          ? ` (${formatBytesCompact(job.outputSizeBytes)})`
                          : ''}
                      </div>
                      {job.error && (
                        <div className="mt-1 text-[11px] text-red-600 dark:text-red-400 flex items-center gap-1">
                          <XCircle className="w-3.5 h-3.5 shrink-0" />
                          {job.error}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {dl && (
                        <a
                          href={dl.url}
                          download={dl.fileName}
                          className="min-h-[34px] px-3 py-1 rounded-lg bg-[#101010] text-white hover:bg-[#262626] dark:bg-white dark:text-[#050505] dark:hover:bg-[#E6E6E6] font-medium flex items-center gap-1.5"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Download
                        </a>
                      )}
                      {job.status === 'completed' && !dl && (
                        <span className="text-[11px] text-[#101010] dark:text-white font-medium flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Recorded
                        </span>
                      )}
                      {(job.status === 'failed' || job.status === 'cancelled') && (
                        <button
                          type="button"
                          disabled={isRunningQueue}
                          onClick={() => {
                            const retried: BatchJob = {
                              ...job,
                              status: 'queued',
                              progressCurrent: 0,
                              stage: 'Re-queued for retry',
                              error: undefined,
                              completedAt: undefined,
                            };
                            onSaveBatchJob(retried);
                          }}
                          className="min-h-[34px] px-2.5 py-1 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/[0.04] dark:hover:bg-white/[0.08] flex items-center gap-1 font-medium disabled:opacity-40"
                        >
                          <RotateCcw className="w-3 h-3" />
                          Retry
                        </button>
                      )}
                      {job.status === 'running' && (
                        <button
                          type="button"
                          onClick={() => cancelSetRef.current.add(job.id)}
                          className="min-h-[34px] px-2.5 py-1 rounded-lg border border-black/20 dark:border-white/20 text-[#101010] dark:text-white hover:bg-black/[0.05] dark:hover:bg-white/[0.08] font-medium"
                        >
                          Cancel
                        </button>
                      )}
                      {job.status !== 'running' && (
                        <button
                          type="button"
                          onClick={() => onDeleteBatchJob(job.id)}
                          className="p-1.5 rounded-lg text-[#888888] hover:text-[#101010] dark:text-[#858585] dark:hover:text-white"
                          title="Delete record"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {(job.status === 'running' ||
                    job.status === 'paused' ||
                    job.status === 'completed') && (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-black/10 dark:bg-white/12 overflow-hidden">
                        <motion.div
                          initial={false}
                          animate={{ width: `${pct}%` }}
                          transition={{ duration: 0.2, ease: MOTION_EASE.liquid }}
                          className={`h-full glass-progress-fill ${
                            job.status === 'paused'
                              ? 'bg-[#888888] dark:bg-[#858585]'
                              : 'bg-[#101010] dark:bg-white'
                          }`}
                        />
                      </div>
                      <span className="text-[11px] font-mono tabular-nums text-[#888888] dark:text-[#858585] w-10 text-right">
                        {pct}%
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </GlassCard>
    </div>
  );
};
