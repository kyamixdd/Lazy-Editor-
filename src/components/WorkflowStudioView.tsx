import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Copy,
  Download,
  GitBranch,
  Pause,
  Play,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Square,
  Trash2,
  XCircle,
} from 'lucide-react';
import {
  AssetFontItem,
  DocumentIntegrityPassport,
  PDFProject,
  SerialBatchRecord,
  TemplateAutomationProfile,
  WorkflowChain,
  WorkflowRunLog,
  WorkflowStep,
  WorkflowStepKind,
  WorkflowStepRunResult,
} from '../types/pdfStudio';
import {
  WORKFLOW_STEP_CATALOG,
  createPresetWorkflows,
  executeWorkflowChain,
} from '../utils/workflowEngine';
import { GlassButton, GlassCard } from './glass';

interface WorkflowStudioViewProps {
  projects: PDFProject[];
  activeProject: PDFProject | null;
  customFonts: AssetFontItem[];
  profiles: TemplateAutomationProfile[];
  serialBatches: SerialBatchRecord[];
  workflows: WorkflowChain[];
  onSaveWorkflow: (wf: WorkflowChain) => void;
  onDeleteWorkflow: (id: string) => void;
  onUpdateProject: (proj: PDFProject) => void;
  onSavePassport: (passport: DocumentIntegrityPassport) => void;
}

export const WorkflowStudioView: React.FC<WorkflowStudioViewProps> = ({
  projects,
  activeProject,
  customFonts,
  profiles,
  serialBatches,
  workflows,
  onSaveWorkflow,
  onDeleteWorkflow,
  onUpdateProject,
  onSavePassport,
}) => {
  const presets = useMemo(() => createPresetWorkflows(), []);
  const allWorkflows = useMemo(() => {
    const customIds = new Set(workflows.map((w) => w.id));
    return [...workflows, ...presets.filter((p) => !customIds.has(p.id))];
  }, [workflows, presets]);

  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>(
    () => allWorkflows[0]?.id || 'preset-full-production'
  );
  const [targetProjectId, setTargetProjectId] = useState<string>(
    () => activeProject?.id || projects[0]?.id || ''
  );
  const [allowCriticalOverride, setAllowCriticalOverride] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [liveResults, setLiveResults] = useState<WorkflowStepRunResult[]>([]);
  const [lastRunLog, setLastRunLog] = useState<WorkflowRunLog | null>(null);
  const [lastPassport, setLastPassport] =
    useState<DocumentIntegrityPassport | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<{
    url: string;
    fileName: string;
    sizeBytes: number;
  } | null>(null);
  const [newStepKind, setNewStepKind] =
    useState<WorkflowStepKind>('preflight_check');

  const cancelRef = useRef(false);
  const pausedRef = useRef(false);

  const selectedWorkflow =
    allWorkflows.find((w) => w.id === selectedWorkflowId) || allWorkflows[0];
  const targetProject =
    projects.find((p) => p.id === targetProjectId) ||
    activeProject ||
    projects[0] ||
    null;

  const ensureEditableCopy = (wf: WorkflowChain): WorkflowChain => {
    if (!wf.isPreset) return wf;
    const now = new Date().toISOString();
    const copy: WorkflowChain = {
      ...structuredClone(wf),
      id: `wf-${Date.now()}`,
      name: `${wf.name} (Custom)`,
      isPreset: false,
      createdAt: now,
      updatedAt: now,
    };
    onSaveWorkflow(copy);
    setSelectedWorkflowId(copy.id);
    return copy;
  };

  const handleUpdateSelected = (updater: (wf: WorkflowChain) => WorkflowChain) => {
    if (!selectedWorkflow) return;
    const base = ensureEditableCopy(selectedWorkflow);
    const next = {
      ...updater(base),
      updatedAt: new Date().toISOString(),
    };
    onSaveWorkflow(next);
  };

  const handleCreateNew = () => {
    const now = new Date().toISOString();
    const created: WorkflowChain = {
      id: `wf-${Date.now()}`,
      name: `Custom Pipeline ${workflows.length + 1}`,
      description: 'Custom multi-step PDF production automation chain.',
      isPreset: false,
      projectId: targetProject?.id,
      steps: [
        {
          id: `wstep-${Date.now()}-1`,
          kind: 'import_pdf',
          label: 'Verify Source PDF',
          enabled: true,
          stopOnCriticalError: true,
        },
        {
          id: `wstep-${Date.now()}-2`,
          kind: 'preflight_check',
          label: 'Full Preflight QC Gate',
          enabled: true,
          stopOnCriticalError: true,
        },
        {
          id: `wstep-${Date.now()}-3`,
          kind: 'export_pdf',
          label: 'Finalize Export Package',
          enabled: true,
          stopOnCriticalError: true,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };
    onSaveWorkflow(created);
    setSelectedWorkflowId(created.id);
  };

  const handleDuplicate = (wf: WorkflowChain) => {
    const now = new Date().toISOString();
    const dup: WorkflowChain = {
      ...structuredClone(wf),
      id: `wf-${Date.now()}`,
      name: `${wf.name} Copy`,
      isPreset: false,
      createdAt: now,
      updatedAt: now,
    };
    onSaveWorkflow(dup);
    setSelectedWorkflowId(dup.id);
  };

  const handleRunWorkflow = async () => {
    if (!selectedWorkflow || !targetProject) return;
    cancelRef.current = false;
    pausedRef.current = false;
    setIsPaused(false);
    setIsRunning(true);
    setLiveResults([]);
    setLastRunLog(null);
    setLastPassport(null);
    if (downloadUrl) {
      URL.revokeObjectURL(downloadUrl.url);
      setDownloadUrl(null);
    }

    const res = await executeWorkflowChain(selectedWorkflow, targetProject, {
      customFonts,
      profiles,
      serialBatches,
      allowCriticalOverride,
      onStepUpdate: (_idx, _latest, all) => {
        setLiveResults(all);
      },
      control: {
        isCancelled: () => cancelRef.current,
        waitWhilePaused: async () => {
          while (pausedRef.current && !cancelRef.current) {
            await new Promise((r) => setTimeout(r, 200));
          }
        },
      },
    });

    setLastRunLog(res.runLog);
    if (res.updatedProject) {
      onUpdateProject(res.updatedProject);
    }
    if (res.passport) {
      setLastPassport(res.passport);
      onSavePassport(res.passport);
    }
    if (res.pdfBytes && res.pdfBytes.byteLength > 0) {
      const blob = new Blob([res.pdfBytes.slice().buffer], {
        type: res.mimeType || 'application/pdf',
      });
      setDownloadUrl({
        url: URL.createObjectURL(blob),
        fileName: res.fileName || `${targetProject.name}.pdf`,
        sizeBytes: res.pdfBytes.byteLength,
      });
    }
    if (!selectedWorkflow.isPreset) {
      onSaveWorkflow({
        ...selectedWorkflow,
        lastRunAt: res.runLog.finishedAt,
      });
    }
    setIsRunning(false);
    setIsPaused(false);
    pausedRef.current = false;
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 tablet:p-6 desktop:p-8 max-w-6xl mx-auto w-full space-y-6">
      <div className="flex flex-col tablet:flex-row tablet:items-center justify-between gap-4 pb-5 border-b border-black/10 dark:border-white/12">
        <div>
          <h1 className="text-xl tablet:text-2xl font-display font-semibold tracking-tight text-[#101010] dark:text-white flex items-center gap-2">
            <GitBranch className="w-5 h-5" />
            Workflow Automation Studio
          </h1>
          <p className="mt-1 text-xs tablet:text-sm text-[#555555] dark:text-[#B5B5B5]">
            Chain validation, profile merging, serial intelligence, preflight gates, PDF generation, and Integrity Passports into repeatable pipelines.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <GlassButton variant="glass" size="md" onClick={handleCreateNew}>
            <Plus className="w-3.5 h-3.5" />
            New Workflow
          </GlassButton>
          {!isRunning ? (
            <GlassButton
              variant="primary"
              size="md"
              disabled={!selectedWorkflow || !targetProject}
              onClick={() => void handleRunWorkflow()}
            >
              <Play className="w-3.5 h-3.5" />
              Run Pipeline
            </GlassButton>
          ) : (
            <>
              <GlassButton
                variant="glass"
                size="md"
                onClick={() => {
                  const next = !isPaused;
                  pausedRef.current = next;
                  setIsPaused(next);
                }}
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
              <GlassButton
                variant="danger"
                size="md"
                onClick={() => {
                  cancelRef.current = true;
                  pausedRef.current = false;
                }}
              >
                <Square className="w-3.5 h-3.5" />
                Cancel
              </GlassButton>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 desktop:grid-cols-12 gap-5">
        {/* Saved Workflows & Presets List */}
        <GlassCard level={3} padding="md" className="desktop:col-span-4 space-y-3 text-xs">
          <div className="font-semibold text-[#101010] dark:text-white">
            Automation Pipelines ({allWorkflows.length})
          </div>
          <div className="space-y-1.5">
            {allWorkflows.map((wf) => {
              const active = selectedWorkflow?.id === wf.id;
              return (
                <div
                  key={wf.id}
                  onClick={() => setSelectedWorkflowId(wf.id)}
                  className={`p-2.5 rounded-xl border cursor-pointer transition-colors space-y-1 ${
                    active
                      ? 'studio-active-surface'
                      : 'border-black/10 dark:border-white/12 hover:border-black/30 dark:hover:border-white/30'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-[#101010] dark:text-white truncate">
                      {wf.name}
                    </span>
                    <span className="text-[10px] font-mono uppercase text-[#888888] dark:text-[#858585] shrink-0">
                      {wf.isPreset ? 'Preset' : `${wf.steps.length} steps`}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#555555] dark:text-[#B5B5B5] line-clamp-2">
                    {wf.description}
                  </p>
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDuplicate(wf);
                      }}
                      className="text-[10px] text-[#555555] hover:text-[#101010] dark:text-[#B5B5B5] dark:hover:text-white flex items-center gap-1"
                    >
                      <Copy className="w-3 h-3" />
                      Duplicate
                    </button>
                    {!wf.isPreset && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteWorkflow(wf.id);
                        }}
                        className="text-[10px] text-red-600 dark:text-red-400 hover:underline flex items-center gap-1"
                      >
                        <Trash2 className="w-3 h-3" />
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </GlassCard>

        {/* Pipeline Builder & Execution Log */}
        <div className="desktop:col-span-8 space-y-4">
          {selectedWorkflow && (
            <GlassCard level={3} padding="md" className="space-y-4 text-xs">
              <div className="grid grid-cols-1 tablet:grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[10px] text-[#888888] dark:text-[#858585]">
                    Pipeline Name {selectedWorkflow.isPreset ? '(edits create custom copy)' : ''}
                  </span>
                  <input
                    type="text"
                    value={selectedWorkflow.name}
                    onChange={(e) =>
                      handleUpdateSelected((wf) => ({ ...wf, name: e.target.value }))
                    }
                    className="mt-1 w-full px-2.5 py-1.5 rounded-lg border studio-input"
                  />
                </label>

                <label className="block">
                  <span className="text-[10px] text-[#888888] dark:text-[#858585]">
                    Target PDF Project
                  </span>
                  <select
                    value={targetProject?.id || ''}
                    onChange={(e) => setTargetProjectId(e.target.value)}
                    className="mt-1 w-full px-2.5 py-1.5 rounded-lg border studio-select"
                  >
                    {projects.length === 0 ? (
                      <option value="">No saved projects</option>
                    ) : (
                      projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.pageCount} pg · {p.elements.length} el)
                        </option>
                      ))
                    )}
                  </select>
                </label>
              </div>

              <label className="flex items-center justify-between gap-2 p-2.5 rounded-xl border border-black/10 dark:border-white/12 bg-black/[0.02] dark:bg-white/[0.03] cursor-pointer">
                <div>
                  <div className="font-semibold text-[#101010] dark:text-white flex items-center gap-1.5">
                    {allowCriticalOverride ? (
                      <ShieldAlert className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                    ) : (
                      <ShieldCheck className="w-3.5 h-3.5" />
                    )}
                    Strict Quality Gate
                  </div>
                  <div className="text-[11px] text-[#555555] dark:text-[#B5B5B5]">
                    {allowCriticalOverride
                      ? 'Override enabled: generation continues despite critical preflight/numbering errors.'
                      : 'Workflow automatically halts before PDF generation if critical preflight or serial conflicts occur.'}
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={!allowCriticalOverride}
                  onChange={(e) => setAllowCriticalOverride(!e.target.checked)}
                />
              </label>

              {/* Step Sequence */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-[#101010] dark:text-white">
                    Ordered Execution Steps ({selectedWorkflow.steps.length})
                  </span>
                  <div className="flex items-center gap-1.5">
                    <select
                      value={newStepKind}
                      onChange={(e) =>
                        setNewStepKind(e.target.value as WorkflowStepKind)
                      }
                      className="px-2 py-1 rounded-lg border studio-select text-[11px]"
                    >
                      {WORKFLOW_STEP_CATALOG.map((item) => (
                        <option key={item.kind} value={item.kind}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        const cat = WORKFLOW_STEP_CATALOG.find(
                          (c) => c.kind === newStepKind
                        );
                        const step: WorkflowStep = {
                          id: `wstep-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
                          kind: newStepKind,
                          label: cat?.label || newStepKind,
                          enabled: true,
                          stopOnCriticalError: true,
                        };
                        handleUpdateSelected((wf) => ({
                          ...wf,
                          steps: [...wf.steps, step],
                        }));
                      }}
                      className="px-2.5 py-1 rounded-lg bg-[#101010] text-white dark:bg-white dark:text-[#050505] font-medium text-[11px] flex items-center gap-1"
                    >
                      <Plus className="w-3 h-3" />
                      Add Step
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  {selectedWorkflow.steps.map((step, idx) => {
                    const liveRes = liveResults.find((r) => r.stepId === step.id);
                    return (
                      <div
                        key={step.id}
                        className={`p-2.5 rounded-xl border space-y-1.5 ${
                          liveRes?.status === 'failed'
                            ? 'border-red-500/40 bg-red-500/10'
                            : liveRes?.status === 'passed'
                            ? 'border-black/25 dark:border-white/25 bg-black/[0.03] dark:bg-white/[0.04]'
                            : 'border-black/10 dark:border-white/12'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={step.enabled}
                              onChange={(e) =>
                                handleUpdateSelected((wf) => ({
                                  ...wf,
                                  steps: wf.steps.map((s) =>
                                    s.id === step.id
                                      ? { ...s, enabled: e.target.checked }
                                      : s
                                  ),
                                }))
                              }
                            />
                            <span className="font-mono text-[10px] text-[#888888] dark:text-[#858585] tabular-nums">
                              #{idx + 1}
                            </span>
                            <span className="font-semibold text-[#101010] dark:text-white">
                              {step.label}
                            </span>
                          </label>

                          <div className="flex items-center gap-1">
                            {liveRes && (
                              <span
                                className={`text-[10px] font-semibold uppercase flex items-center gap-1 mr-2 ${
                                  liveRes.status === 'failed'
                                    ? 'text-red-600 dark:text-red-400'
                                    : liveRes.status === 'warning'
                                    ? 'text-amber-600 dark:text-amber-400'
                                    : liveRes.status === 'passed'
                                    ? 'text-[#101010] dark:text-white'
                                    : 'text-[#888888]'
                                }`}
                              >
                                {liveRes.status === 'passed' && (
                                  <CheckCircle2 className="w-3 h-3" />
                                )}
                                {liveRes.status === 'warning' && (
                                  <AlertTriangle className="w-3 h-3" />
                                )}
                                {liveRes.status === 'failed' && (
                                  <XCircle className="w-3 h-3" />
                                )}
                                {liveRes.status}
                              </span>
                            )}
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={() =>
                                handleUpdateSelected((wf) => {
                                  const arr = [...wf.steps];
                                  [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
                                  return { ...wf, steps: arr };
                                })
                              }
                              className="p-1 rounded border border-black/15 dark:border-white/15 disabled:opacity-35"
                              title="Move Up"
                            >
                              <ArrowUp className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              disabled={idx === selectedWorkflow.steps.length - 1}
                              onClick={() =>
                                handleUpdateSelected((wf) => {
                                  const arr = [...wf.steps];
                                  [arr[idx + 1], arr[idx]] = [arr[idx], arr[idx + 1]];
                                  return { ...wf, steps: arr };
                                })
                              }
                              className="p-1 rounded border border-black/15 dark:border-white/15 disabled:opacity-35"
                              title="Move Down"
                            >
                              <ArrowDown className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                handleUpdateSelected((wf) => ({
                                  ...wf,
                                  steps: wf.steps.filter((s) => s.id !== step.id),
                                }))
                              }
                              className="p-1 rounded text-[#888888] hover:text-red-600"
                              title="Remove step"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>

                        {step.kind === 'apply_profile' && (
                          <div className="pl-6">
                            <select
                              value={step.profileId || ''}
                              onChange={(e) =>
                                handleUpdateSelected((wf) => ({
                                  ...wf,
                                  steps: wf.steps.map((s) =>
                                    s.id === step.id
                                      ? { ...s, profileId: e.target.value || undefined }
                                      : s
                                  ),
                                }))
                              }
                              className="w-full px-2 py-1 rounded-lg border studio-select text-[11px]"
                            >
                              <option value="">Select Template Profile...</option>
                              {profiles.map((prof) => (
                                <option key={prof.id} value={prof.id}>
                                  {prof.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}

                        {liveRes && (
                          <div className="pl-6 text-[11px] text-[#555555] dark:text-[#B5B5B5]">
                            {liveRes.summary}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </GlassCard>
          )}

          {/* Execution Summary & Outputs */}
          {lastRunLog && (
            <GlassCard level={3} padding="md" className="space-y-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-semibold text-[#101010] dark:text-white flex items-center gap-2">
                  {lastRunLog.status === 'completed' ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
                  )}
                  Pipeline {lastRunLog.status.toUpperCase()}
                </div>
                <span className="text-[11px] text-[#888888] dark:text-[#858585] tabular-nums">
                  Finished {new Date(lastRunLog.finishedAt).toLocaleTimeString()}
                </span>
              </div>

              {downloadUrl && (
                <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl border border-black/15 dark:border-white/15 bg-black/[0.03] dark:bg-white/[0.04]">
                  <div>
                    <div className="font-semibold text-[#101010] dark:text-white">
                      {downloadUrl.fileName}
                    </div>
                    <div className="text-[11px] text-[#888888] dark:text-[#858585] tabular-nums">
                      {(downloadUrl.sizeBytes / 1024).toFixed(1)} KB · Verified PDF integrity
                    </div>
                  </div>
                  <a
                    href={downloadUrl.url}
                    download={downloadUrl.fileName}
                    className="px-3 py-1.5 rounded-lg bg-[#101010] text-white dark:bg-white dark:text-[#050505] font-semibold flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download PDF
                  </a>
                </div>
              )}

              {lastPassport && (
                <div className="p-2.5 rounded-xl border border-black/12 dark:border-white/12 text-[11px] space-y-0.5">
                  <div className="font-semibold text-[#101010] dark:text-white">
                    Integrity Passport Recorded ({lastPassport.validationStatus})
                  </div>
                  <div className="font-mono text-[#555555] dark:text-[#B5B5B5] break-all">
                    SHA-256: {lastPassport.sha256Hex}
                  </div>
                </div>
              )}
            </GlassCard>
          )}
        </div>
      </div>
    </div>
  );
};
