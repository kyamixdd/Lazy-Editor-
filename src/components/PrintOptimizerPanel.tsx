import React, { useMemo } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FlipHorizontal2,
  FlipVertical2,
  Sparkles,
} from 'lucide-react';
import {
  DuplexFlipEdge,
  PDFProject,
  PrintOptimizationConfig,
} from '../types/pdfStudio';
import { SheetLayoutPlan } from '../utils/geometryEngine';
import {
  applyRecommendedLayoutToProject,
  computeDuplexBackSlotOffsets,
  evaluateNupLayouts,
  getDefaultPrintOptimization,
  LayoutCandidateEvaluation,
} from '../utils/printOptimizerEngine';
import { ptToUnit, unitToPt } from '../utils/units';
import { NumericDraftInput } from './NumericDraftInput';

interface PrintOptimizerPanelProps {
  project: PDFProject;
  layout: SheetLayoutPlan;
  onUpdateProject: (updated: PDFProject) => void;
}

export const PrintOptimizerPanel: React.FC<PrintOptimizerPanelProps> = ({
  project,
  layout,
  onUpdateProject,
}) => {
  const unit = project.pageConfig.unit;
  const printOpt: PrintOptimizationConfig = useMemo(
    () => ({
      ...getDefaultPrintOptimization(),
      ...(project.printOptimization || {}),
    }),
    [project.printOptimization]
  );

  const updatePrintOpt = (patch: Partial<PrintOptimizationConfig>) => {
    onUpdateProject({
      ...project,
      printOptimization: {
        ...printOpt,
        ...patch,
      },
      updatedAt: new Date().toISOString(),
    });
  };

  const analysis = useMemo(
    () =>
      evaluateNupLayouts(project, {
        minReadableFontPt: printOpt.minReadableFontPt,
      }),
    [project, printOpt.minReadableFontPt]
  );

  const duplexSlots = useMemo(
    () =>
      printOpt.duplexEnabled
        ? computeDuplexBackSlotOffsets(
            layout,
            printOpt.duplexFlipEdge,
            printOpt.backSideOffsetXPt,
            printOpt.backSideOffsetYPt
          )
        : [],
    [
      printOpt.duplexEnabled,
      printOpt.duplexFlipEdge,
      printOpt.backSideOffsetXPt,
      printOpt.backSideOffsetYPt,
      layout,
    ]
  );

  const handleApplyCandidate = (cand: LayoutCandidateEvaluation) => {
    onUpdateProject(applyRecommendedLayoutToProject(project, cand));
  };

  return (
    <div className="space-y-4">
      {/* Minimum Readability Threshold & Optimal Recommendation */}
      <div className="p-3.5 rounded-xl border border-black/10 dark:border-white/12 bg-black/[0.02] dark:bg-white/[0.02] space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="font-semibold text-[#101010] dark:text-white flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              Print Production Optimizer
            </div>
            <div className="text-[11px] text-[#555555] dark:text-[#B5B5B5]">
              Calculates highest-yield N-up layout while guarding minimum font readability.
            </div>
          </div>
          {analysis.recommended && (
            <button
              type="button"
              onClick={() => handleApplyCandidate(analysis.recommended!)}
              className="px-3 py-1.5 rounded-lg bg-[#101010] text-white dark:bg-white dark:text-[#050505] font-semibold text-[11px] shrink-0 hover:opacity-90 transition-opacity"
            >
              Apply {analysis.recommended.label}
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 pt-1">
          <label className="block">
            <span className="text-[10px] text-[#888888] dark:text-[#858585]">
              Minimum Readable Font (pt)
            </span>
            <NumericDraftInput
              value={printOpt.minReadableFontPt}
              commitOptions={{ min: 3, max: 18, decimals: 1 }}
              onCommit={(val) =>
                updatePrintOpt({
                  minReadableFontPt: Math.max(3, Math.min(18, val)),
                })
              }
              className="mt-0.5 w-full px-2.5 py-1.5 rounded-lg border studio-input tabular-nums"
            />
          </label>
          <div className="p-2 rounded-lg border border-black/10 dark:border-white/10 bg-[#F7F7F7] dark:bg-[#0B0B0B] tabular-nums">
            <div className="text-[10px] text-[#888888] dark:text-[#858585]">
              Smallest Template Font
            </div>
            <div className="mt-0.5 font-mono font-semibold text-[#101010] dark:text-white">
              {analysis.minOriginalFontPt.toFixed(1)} pt
            </div>
          </div>
        </div>

        {analysis.recommended && (
          <div className="text-[11px] text-[#555555] dark:text-[#B5B5B5] flex items-center gap-1.5 tabular-nums">
            {analysis.recommended.isReadabilityBlocked ? (
              <>
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                <span className="text-amber-700 dark:text-amber-300">
                  {analysis.recommended.reason}
                </span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>{analysis.recommended.reason}</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Candidate Comparison Matrix */}
      <div className="rounded-xl border border-black/10 dark:border-white/12 overflow-hidden">
        <div className="px-3 py-2 bg-[#F7F7F7] dark:bg-[#0B0B0B] border-b border-black/10 dark:border-white/10 flex items-center justify-between">
          <span className="font-semibold text-[#101010] dark:text-white">
            Sheet Layout Yield Matrix
          </span>
          <span className="text-[10px] text-[#888888] dark:text-[#858585] tabular-nums">
            Top {Math.min(10, analysis.candidates.length)} configurations
          </span>
        </div>
        <div className="max-h-60 overflow-y-auto">
          <table className="w-full text-left border-collapse text-[11px] tabular-nums">
            <thead>
              <tr className="border-b border-black/10 dark:border-white/10 text-[#888888] dark:text-[#858585]">
                <th className="py-1.5 px-2.5">Layout</th>
                <th className="py-1.5 px-2">Use %</th>
                <th className="py-1.5 px-2">Min Font</th>
                <th className="py-1.5 px-2">Sheets</th>
                <th className="py-1.5 px-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/10 dark:divide-white/10">
              {analysis.candidates.slice(0, 10).map((cand) => {
                const isCurrent =
                  (project.copiesConfig.enabled
                    ? project.copiesConfig.columns
                    : 1) === cand.columns &&
                  (project.copiesConfig.enabled ? project.copiesConfig.rows : 1) ===
                    cand.rows &&
                  project.copiesConfig.copyRotation === cand.copyRotation;
                return (
                  <tr
                    key={cand.id}
                    className={
                      cand.recommended
                        ? 'bg-black/[0.03] dark:bg-white/[0.04]'
                        : undefined
                    }
                  >
                    <td className="py-1.5 px-2.5 font-medium text-[#101010] dark:text-white">
                      {cand.label}
                      {cand.recommended && (
                        <span className="ml-1.5 text-[10px] text-emerald-600 dark:text-emerald-400">
                          · Best
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 px-2 font-mono text-[#555555] dark:text-[#B5B5B5]">
                      {cand.sheetUtilizationPct}%
                    </td>
                    <td
                      className={`py-1.5 px-2 font-mono ${
                        cand.isReadabilityBlocked
                          ? 'text-red-600 dark:text-red-400 font-semibold'
                          : 'text-[#101010] dark:text-white'
                      }`}
                    >
                      {cand.minScaledFontPt}pt
                    </td>
                    <td className="py-1.5 px-2 font-mono text-[#555555] dark:text-[#B5B5B5]">
                      {cand.totalSheetsNeeded}
                    </td>
                    <td className="py-1.5 px-2.5 text-right">
                      <button
                        type="button"
                        disabled={cand.isReadabilityBlocked || cand.hasClipping || isCurrent}
                        onClick={() => handleApplyCandidate(cand)}
                        className="px-2 py-0.5 rounded border border-black/15 dark:border-white/15 text-[10px] font-medium text-[#101010] dark:text-white hover:bg-black/[0.05] dark:hover:bg-white/[0.08] disabled:opacity-40"
                      >
                        {isCurrent
                          ? 'Active'
                          : cand.isReadabilityBlocked
                          ? 'Too Small'
                          : 'Use'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Duplex Flip-Edge Alignment */}
      <div className="p-3.5 rounded-xl border border-black/10 dark:border-white/12 bg-black/[0.02] dark:bg-white/[0.02] space-y-3">
        <label className="flex items-center justify-between cursor-pointer">
          <div>
            <div className="font-semibold text-[#101010] dark:text-white">
              Duplex Back-Side Imposition &amp; Alignment
            </div>
            <div className="text-[11px] text-[#555555] dark:text-[#B5B5B5]">
              Emits mirrored back sheets (Page 2 or registration back) with calibration offsets
            </div>
          </div>
          <input
            type="checkbox"
            checked={printOpt.duplexEnabled}
            onChange={(e) => updatePrintOpt({ duplexEnabled: e.target.checked })}
            className="rounded border-black/30 dark:border-white/30 accent-[#101010] dark:accent-white"
          />
        </label>

        {printOpt.duplexEnabled && (
          <div className="space-y-3 pt-2 border-t border-black/10 dark:border-white/10">
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ['long_edge', 'Long Edge Flip', FlipHorizontal2],
                  ['short_edge', 'Short Edge Flip', FlipVertical2],
                ] as const
              ).map(([edge, lbl, Icon]) => (
                <button
                  key={edge}
                  type="button"
                  onClick={() =>
                    updatePrintOpt({ duplexFlipEdge: edge as DuplexFlipEdge })
                  }
                  className={`py-2 px-2.5 rounded-lg border flex items-center justify-center gap-1.5 text-[11px] font-medium transition-colors ${
                    printOpt.duplexFlipEdge === edge
                      ? 'studio-active-surface font-semibold'
                      : 'border-black/15 dark:border-white/15 text-[#555555] dark:text-[#B5B5B5]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {lbl}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-[10px] text-[#888888] dark:text-[#858585]">
                  Back X Calibration ({unit})
                </span>
                <NumericDraftInput
                  value={ptToUnit(printOpt.backSideOffsetXPt, unit)}
                  commitOptions={{ decimals: 2 }}
                  onCommit={(val) =>
                    updatePrintOpt({
                      backSideOffsetXPt: unitToPt(val, unit),
                    })
                  }
                  className="mt-0.5 w-full px-2.5 py-1.5 rounded-lg border studio-input tabular-nums"
                />
              </label>
              <label className="block">
                <span className="text-[10px] text-[#888888] dark:text-[#858585]">
                  Back Y Calibration ({unit})
                </span>
                <NumericDraftInput
                  value={ptToUnit(printOpt.backSideOffsetYPt, unit)}
                  commitOptions={{ decimals: 2 }}
                  onCommit={(val) =>
                    updatePrintOpt({
                      backSideOffsetYPt: unitToPt(val, unit),
                    })
                  }
                  className="mt-0.5 w-full px-2.5 py-1.5 rounded-lg border studio-input tabular-nums"
                />
              </label>
            </div>

            {duplexSlots.length > 0 && (
              <div className="p-2.5 rounded-lg border border-black/10 dark:border-white/10 bg-[#F7F7F7] dark:bg-[#0B0B0B] text-[11px] tabular-nums space-y-1">
                <div className="font-medium text-[#101010] dark:text-white">
                  Mirrored Back Slot #1 Coordinates
                </div>
                <div className="text-[#555555] dark:text-[#B5B5B5] font-mono">
                  X: {ptToUnit(duplexSlots[0].backXPt, unit)} {unit} · Y:{' '}
                  {ptToUnit(duplexSlots[0].backTopPt, unit)} {unit} · Rot:{' '}
                  {duplexSlots[0].backRotationDeg}°
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
