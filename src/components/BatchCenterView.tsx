import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Layers,
  Pause,
  Play,
  Plus,
  RotateCcw,
  ShieldCheck,
  Square,
  Trash2,
  XCircle,
} from 'lucide-react';
import { MOTION_EASE } from '../config/motionSystem';
import {
  AssetFontItem,
  BatchCheckpoint,
  BatchJob,
  PDFProject,
  SerialBatchRecord,
} from '../types/pdfStudio';
import { formatBytesCompact } from '../utils/projectStorage';
import { ExportJobControl, generateExportBytes } from '../utils/pdfExporter';
import {
  base64ToUint8ArrayRecovery,
  detectDuplicateOutputGuard,
  runCheckpointedBatchExport,
  verifyPdfBytesIntegrity,
} from '../utils/recoveryEngine';
import { validateProject } from '../utils/validationEngine';
import { triggerBytesDownload } from '../utils/downloadHelper';
import { GlassButton, GlassCard } from './glass';
import { NumericDraftInput } from './NumericDraftInput';

interface BatchCenterViewProps {
  projects: PDFProject[];
  customFonts: AssetFontItem[];
  batchJobs: BatchJob[];
  serialBatches?: SerialBatchRecord[];
  checkpoints?: BatchCheckpoint[];
  onSaveBatchJob: (job: BatchJob) => void;
  onDeleteBatchJob: (id: string) => void;
  onClearBatchHistory: () => void;
  onSaveCheckpoint?: (cp: BatchCheckpoint) => void;
  onDeleteCheckpoint?: (id: string) => void;
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
  serialBatches = [],
  checkpoints = [],
  onSaveBatchJob,
  onDeleteBatchJob,
  onClearBatchHistory,
  onSaveCheckpoint,
  onDeleteCheckpoint,
}) => {
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [isRunningQueue, setIsRunningQueue] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [downloads, setDownloads] = useState<Record<string, SessionDownload>>({});
  const [chunkSizePages, setChunkSizePages] = useState<number>(8);
  const [integrityNotices, setIntegrityNotices] = useState<Record<string, string>>({});

  const cancelSetRef = useRef<Set<string>>(new Set());
  const globalCancelRef = useRef(false);
  const pausedRef = useRef(false);
  const sessionUrlsRef = useRef<Record<string, string>>({});

  const registerSessionDownload = (key: string, dl: SessionDownload) => {
    const prevUrl = sessionUrlsRef.current[key];
    if (prevUrl && prevUrl !== dl.url) {
      URL.revokeObjectURL(prevUrl);
    }
    sessionUrlsRef.current[key] = dl.url;
    setDownloads((prev) => ({ ...prev, [key]: dl }));
  };

  const revokeSessionDownload = (key: string) => {
    const url = sessionUrlsRef.current[key];
    if (url) {
      URL.revokeObjectURL(url);
      delete sessionUrlsRef.current[key];
    }
    setDownloads((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  useEffect(() => {
    setSelectedProjectIds((prev) =>
      prev.filter((id) => projects.some((p) => p.id === id))
    );
  }, [projects]);

  useEffect(() => {
    return () => {
      Object.values(sessionUrlsRef.current).forEach((u) => URL.revokeObjectURL(u));
      sessionUrlsRef.current = {};
    };
  }, []);

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
      registerSessionDownload(job.id, {
        url,
        fileName: result.fileName,
        sizeBytes: result.data.byteLength,
      });

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
      if (j.status === 'running') {
        cancelSetRef.current.add(j.id);
      } else if (j.status === 'queued' || j.status === 'paused') {
        onSaveBatchJob({
          ...j,
          status: 'cancelled',
          stage: 'Cancelled by user',
          completedAt: new Date().toISOString(),
        });
      }
    });
  };

  const handleRunCheckpointedForProject = async (
    project: PDFProject,
    resumeCp?: BatchCheckpoint
  ) => {
    const blocking = validateProject(project, customFonts).filter(
      (i) => i.severity === 'error'
    );
    if (blocking.length > 0) {
      setIntegrityNotices((prev) => ({
        ...prev,
        [resumeCp?.id || project.id]: `Preflight blocked: ${blocking[0].message}`,
      }));
      return;
    }

    globalCancelRef.current = false;
    pausedRef.current = false;
    setIsPaused(false);
    setIsRunningQueue(true);

    try {
      const result = await runCheckpointedBatchExport(project, {
        customFonts,
        chunkSizePages,
        resumeCheckpoint: resumeCp,
        onCheckpoint: (cp) => onSaveCheckpoint?.(cp),
        control: {
          isCancelled: () => globalCancelRef.current,
          waitWhilePaused: async () => {
            while (pausedRef.current && !globalCancelRef.current) {
              await new Promise((r) => setTimeout(r, 200));
            }
          },
        },
      });
      if (result.bytes.byteLength > 0) {
        const blob = new Blob([result.bytes.slice().buffer], {
          type: result.mimeType,
        });
        registerSessionDownload(result.checkpoint.id, {
          url: URL.createObjectURL(blob),
          fileName: result.fileName,
          sizeBytes: result.bytes.byteLength,
        });
      }
      setIntegrityNotices((prev) => ({
        ...prev,
        [result.checkpoint.id]: result.interrupted
          ? `Paused cleanly at ${result.checkpoint.completedPageCount}/${result.checkpoint.totalOutputPages} verified pages.`
          : `Completed ${result.checkpoint.completedPageCount}/${result.checkpoint.totalOutputPages} pages with verified PDF integrity.`,
      }));
    } catch (err) {
      setIntegrityNotices((prev) => ({
        ...prev,
        [resumeCp?.id || project.id]:
          err instanceof Error ? err.message : 'Checkpointed run failed',
      }));
    } finally {
      setIsRunningQueue(false);
      setIsPaused(false);
      pausedRef.current = false;
    }
  };

  const handleVerifyCheckpointIntegrity = async (cp: BatchCheckpoint) => {
    if (!cp.partialPdfBase64) {
      setIntegrityNotices((prev) => ({
        ...prev,
        [cp.id]: 'No partial PDF buffer stored in checkpoint.',
      }));
      return;
    }
    const bytes = base64ToUint8ArrayRecovery(cp.partialPdfBase64);
    const rep = await verifyPdfBytesIntegrity(bytes);
    setIntegrityNotices((prev) => ({
      ...prev,
      [cp.id]: rep.valid
        ? `Verified ${rep.pageCount} valid PDF page(s) (${formatBytesCompact(rep.byteLength)}).`
        : `Integrity error: ${rep.issues.join(' | ')}`,
    }));
  };

  const handleDownloadCheckpoint = (cp: BatchCheckpoint) => {
    if (!cp.partialPdfBase64) return;
    const bytes = base64ToUint8ArrayRecovery(cp.partialPdfBase64);
    triggerBytesDownload(
      bytes,
      cp.outputFileName || `${cp.projectName.replace(/\s+/g, '_')}_checkpoint.pdf`,
      'application/pdf'
    );
  };

  const queuedCount = batchJobs.filter((j) => j.status === 'queued').length;
  const completedCount = batchJobs.filter((j) => j.status === 'completed').length;
  const failedCount = batchJobs.filter((j) => j.status === 'failed').length;
  const guardReports = projects
    .filter((p) => selectedProjectIds.includes(p.id))
    .map((p) => ({
      project: p,
      report: detectDuplicateOutputGuard(p, serialBatches, checkpoints),
    }))
    .filter((x) => x.report.hasOverlapWarning);

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
                <div
                  key={p.id}
                  className={`p-2.5 rounded-xl border flex items-center gap-2.5 transition-colors ${
                    checked
                      ? 'studio-active-surface'
                      : 'border-black/10 dark:border-white/12 hover:border-black/25 dark:hover:border-white/25'
                  }`}
                >
                  <label className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer">
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
                  {onSaveCheckpoint && (
                    <button
                      type="button"
                      disabled={isRunningQueue}
                      onClick={() => void handleRunCheckpointedForProject(p)}
                      title="Run with chunked checkpoint recovery"
                      className="px-2 py-1 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] text-[10px] font-medium shrink-0 disabled:opacity-40"
                    >
                      Checkpointed
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {guardReports.length > 0 && (
          <div className="p-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 space-y-1">
            <div className="font-semibold flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              Duplicate Output Guard Warnings
            </div>
            {guardReports.flatMap((g) =>
              g.report.warnings.map((w, idx) => (
                <div key={`${g.project.id}-${idx}`} className="text-[11px]">
                  {w}
                </div>
              ))
            )}
          </div>
        )}
      </GlassCard>

      {/* Smart Batch Recovery & Integrity Checkpoints (Module 7) */}
      {(checkpoints.length > 0 || onSaveCheckpoint) && (
        <GlassCard level={3} padding="md" className="space-y-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-semibold text-[#101010] dark:text-white flex items-center gap-2">
              <ShieldCheck className="w-4 h-4" />
              Smart Batch Recovery &amp; Integrity Checkpoints ({checkpoints.length})
            </div>
            <label className="flex items-center gap-2 text-[11px] text-[#555555] dark:text-[#B5B5B5]">
              <span>Checkpoint Every</span>
              <NumericDraftInput
                min={1}
                max={50}
                fallback={8}
                value={chunkSizePages}
                onCommit={(val) =>
                  setChunkSizePages(Math.max(1, Math.min(50, Math.round(val))))
                }
                className="w-14 px-2 py-0.5 rounded-lg border studio-input tabular-nums text-center"
              />
              <span>pages</span>
            </label>
          </div>

          {checkpoints.length === 0 ? (
            <div className="text-[11px] text-[#555555] dark:text-[#B5B5B5]">
              Use &ldquo;Checkpointed&rdquo; on any project above to save verified page chunks and enable crash-safe resume without duplicating serial numbers.
            </div>
          ) : (
            <div className="divide-y divide-black/10 dark:divide-white/10">
              {checkpoints.map((cp) => {
                const proj = projects.find((p) => p.id === cp.projectId);
                const canResume =
                  proj &&
                  cp.completedPageCount < cp.totalOutputPages &&
                  cp.status !== 'completed';
                const notice = integrityNotices[cp.id];
                return (
                  <div key={cp.id} className="py-3 first:pt-1 last:pb-1 space-y-1.5">
                    <div className="flex flex-col tablet:flex-row tablet:items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-[#101010] dark:text-white">
                            {cp.projectName}
                          </span>
                          <span className="text-[10px] font-mono uppercase text-[#888888] dark:text-[#858585]">
                            {cp.status.replace(/_/g, ' ')}
                          </span>
                          <span className="text-[11px] tabular-nums text-[#555555] dark:text-[#B5B5B5]">
                            {cp.completedPageCount}/{cp.totalOutputPages} pages verified
                          </span>
                        </div>
                        {cp.lastSerialByRule.length > 0 && (
                          <div className="mt-0.5 text-[10px] font-mono text-[#888888] dark:text-[#858585] flex flex-wrap gap-2">
                            {cp.lastSerialByRule.map((sr) => (
                              <span key={sr.ruleId}>
                                {sr.ruleName}: last #{sr.lastNumber} → next #{sr.nextResumeNumber}
                              </span>
                            ))}
                          </div>
                        )}
                        {notice && (
                          <div className="mt-1 text-[11px] text-[#101010] dark:text-white">
                            {notice}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                        {canResume && proj && (
                          <button
                            type="button"
                            disabled={isRunningQueue}
                            onClick={() => void handleRunCheckpointedForProject(proj, cp)}
                            className="px-2.5 py-1 rounded-lg bg-[#101010] text-white dark:bg-white dark:text-[#050505] font-medium text-[11px] flex items-center gap-1 disabled:opacity-40"
                          >
                            <Play className="w-3 h-3" />
                            Resume Safely
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void handleVerifyCheckpointIntegrity(cp)}
                          className="px-2.5 py-1 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/[0.04] dark:hover:bg-white/[0.08] text-[11px] font-medium"
                        >
                          Verify Integrity
                        </button>
                        {cp.partialPdfBase64 && (
                          <button
                            type="button"
                            onClick={() => handleDownloadCheckpoint(cp)}
                            className="px-2.5 py-1 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/[0.04] dark:hover:bg-white/[0.08] text-[11px] font-medium flex items-center gap-1"
                          >
                            <Download className="w-3 h-3" />
                            PDF
                          </button>
                        )}
                        {onDeleteCheckpoint && (
                          <button
                            type="button"
                            onClick={() => {
                              revokeSessionDownload(cp.id);
                              onDeleteCheckpoint(cp.id);
                            }}
                            className="p-1 rounded-lg text-[#888888] hover:text-red-600"
                            title="Discard checkpoint"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </GlassCard>
      )}

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
              onClick={() => {
                Object.keys(sessionUrlsRef.current).forEach((k) => {
                  URL.revokeObjectURL(sessionUrlsRef.current[k]);
                });
                sessionUrlsRef.current = {};
                setDownloads({});
                onClearBatchHistory();
              }}
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
                          onClick={() => {
                            revokeSessionDownload(job.id);
                            onDeleteBatchJob(job.id);
                          }}
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
