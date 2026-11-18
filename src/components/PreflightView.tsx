import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import { MOTION_DURATION, MOTION_EASE } from '../config/motionSystem';
import {
  AssetFontItem,
  PDFProject,
  ValidationIssue,
} from '../types/pdfStudio';
import { analyzeDataQuality } from '../utils/dataFormulaEngine';
import { normalizeFitConfig } from '../utils/geometryEngine';
import { applyTrueRedactionsToProject } from '../utils/redactionEngine';
import { validateProject } from '../utils/validationEngine';
import { GlassButton, GlassCard, GlassSegmentedControl } from './glass';

interface PreflightViewProps {
  project: PDFProject;
  customFonts: AssetFontItem[];
  onUpdateProject: (updated: PDFProject) => void;
  onInspectElement: (pageNumber: number, elementId?: string) => void;
  onGoToExport: () => void;
  onGoToDataManager: () => void;
}

type FilterGroup = 'all' | 'layout' | 'fonts' | 'images' | 'serial_data';

export const PreflightView: React.FC<PreflightViewProps> = ({
  project,
  customFonts,
  onUpdateProject,
  onInspectElement,
  onGoToExport,
  onGoToDataManager,
}) => {
  const shouldReduceMotion = useReducedMotion();
  const [filter, setFilter] = useState<FilterGroup>('all');

  const issues = useMemo(
    () => validateProject(project, customFonts),
    [project, customFonts]
  );

  const dataQuality = useMemo(() => {
    const mapped = project.elements
      .map((e) => e.fieldKey)
      .filter((k): k is string => Boolean(k));
    const dupCandidates = project.dataColumns
      .slice(0, 1)
      .map((c) => c.name);
    return analyzeDataQuality(
      project.dataColumns,
      project.dataRows,
      dupCandidates,
      mapped
    );
  }, [project.dataColumns, project.dataRows, project.elements]);

  const errorsCount = issues.filter((i) => i.severity === 'error').length;
  const warningsCount = issues.filter((i) => i.severity === 'warning').length;

  const filtered = issues.filter((issue) => {
    if (filter === 'all') return true;
    if (filter === 'layout') {
      return (
        issue.category === 'out_of_bounds' ||
        issue.category === 'overlap' ||
        issue.category === 'text_overflow' ||
        issue.category === 'page_dimensions' ||
        issue.category === 'misaligned_block' ||
        issue.category === 'layout_drift' ||
        issue.category === 'clipping' ||
        issue.category === 'aspect_ratio' ||
        issue.category === 'blank_region' ||
        issue.category === 'inconsistent_repeated' ||
        issue.category === 'pending_redaction'
      );
    }
    if (filter === 'fonts') {
      return (
        issue.category === 'font_substitution' ||
        issue.category === 'missing_font' ||
        issue.category === 'font_license'
      );
    }
    if (filter === 'images') {
      return (
        issue.category === 'missing_image' ||
        issue.category === 'image_resolution'
      );
    }
    if (filter === 'serial_data') {
      return (
        issue.category === 'serial_error' ||
        issue.category === 'duplicate_serial' ||
        issue.category === 'missing_field'
      );
    }
    return true;
  });

  const handleAutoFix = (issue: ValidationIssue) => {
    if (issue.category === 'out_of_bounds' && issue.elementId) {
      onUpdateProject({
        ...project,
        elements: project.elements.map((el) => {
          if (el.id !== issue.elementId) return el;
          const meta = project.originalPages.find(
            (p) => p.pageNumber === el.pageNumber
          );
          const tplW = meta?.widthPt || project.pageConfig.widthPt;
          const tplH = meta?.heightPt || project.pageConfig.heightPt;
          return {
            ...el,
            x: Math.max(0, Math.min(el.x, tplW - el.width)),
            y: Math.max(0, Math.min(el.y, tplH - el.height)),
            eraseOriginal: el.isUserAdded ? false : true,
          };
        }),
        updatedAt: new Date().toISOString(),
      });
    } else if (issue.category === 'layout_drift' && issue.elementId) {
      onUpdateProject({
        ...project,
        elements: project.elements.map((el) =>
          el.id === issue.elementId && el.sourceOriginalRect
            ? {
                ...el,
                x: el.sourceOriginalRect.x,
                y: el.sourceOriginalRect.y,
                width: el.sourceOriginalRect.width,
                height: el.sourceOriginalRect.height,
                eraseOriginal: false,
              }
            : el
        ),
        updatedAt: new Date().toISOString(),
      });
    } else if (issue.category === 'text_overflow' && issue.elementId) {
      onUpdateProject({
        ...project,
        elements: project.elements.map((el) =>
          el.id === issue.elementId ? { ...el, height: el.height + 16 } : el
        ),
        updatedAt: new Date().toISOString(),
      });
    } else if (issue.category === 'page_dimensions') {
      const safeMargin = Math.min(
        18,
        Math.floor(
          Math.min(project.pageConfig.widthPt, project.pageConfig.heightPt) *
            0.1
        )
      );
      onUpdateProject({
        ...project,
        pageConfig: {
          ...project.pageConfig,
          marginTopPt: safeMargin,
          marginBottomPt: safeMargin,
          marginLeftPt: safeMargin,
          marginRightPt: safeMargin,
        },
        updatedAt: new Date().toISOString(),
      });
    } else if (issue.autoFixLabel === 'Reset Crop') {
      const p1 = project.originalPages[0];
      const w = p1?.widthPt || project.pageConfig.widthPt;
      const h = p1?.heightPt || project.pageConfig.heightPt;
      const currFit = normalizeFitConfig(project);
      onUpdateProject({
        ...project,
        fitConfig: {
          ...currFit,
          boundaryMode: 'original_page',
          customCropRect: { x: 0, y: 0, width: w, height: h },
        },
        updatedAt: new Date().toISOString(),
      });
    } else if (issue.autoFixLabel === 'Enable Fit-to-Page') {
      const currFit = normalizeFitConfig(project);
      onUpdateProject({
        ...project,
        fitConfig: { ...currFit, scalingMode: 'auto_fit_aspect' },
        copiesConfig: {
          ...project.copiesConfig,
          fitToPage: true,
          outerMarginTopPt: 18,
          outerMarginRightPt: 18,
          outerMarginBottomPt: 18,
          outerMarginLeftPt: 18,
          horizontalSpacingPt: Math.min(
            project.copiesConfig.horizontalSpacingPt,
            14
          ),
          verticalSpacingPt: Math.min(
            project.copiesConfig.verticalSpacingPt,
            14
          ),
        },
        updatedAt: new Date().toISOString(),
      });
    } else if (issue.category === 'font_substitution') {
      onUpdateProject({
        ...project,
        exportConfig: { ...project.exportConfig, embedFonts: true },
        updatedAt: new Date().toISOString(),
      });
    } else if (issue.category === 'pending_redaction') {
      const res = applyTrueRedactionsToProject(project);
      if (res.appliedRedactionCount > 0) {
        onUpdateProject(res.updatedProject);
      }
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 tablet:p-6 desktop:p-8 max-w-6xl mx-auto w-full space-y-6">
      <div className="flex flex-col tablet:flex-row tablet:items-center justify-between gap-4 pb-5 border-b border-black/10 dark:border-white/12">
        <div>
          <h1 className="text-xl tablet:text-2xl font-display font-semibold tracking-tight text-[#101010] dark:text-white">
            PDF Quality Inspection (Preflight)
          </h1>
          <p className="mt-1 text-xs tablet:text-sm text-[#555555] dark:text-[#B5B5B5]">
            Comprehensive pre-production check across geometry, typography, image DPI resolution, serial rules, and layout drift.
          </p>
        </div>

        <GlassButton variant="primary" size="md" onClick={onGoToExport}>
          Proceed to Export Center
          <ArrowRight className="w-3.5 h-3.5" />
        </GlassButton>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 tablet:grid-cols-4 gap-3 text-xs tabular-nums">
        <GlassCard level={3} padding="md">
          <div className="text-[11px] text-[#888888] dark:text-[#858585]">Blocking Errors</div>
          <div
            className={`mt-1 text-2xl font-semibold ${
              errorsCount > 0
                ? 'text-red-600 dark:text-red-400'
                : 'text-[#101010] dark:text-white'
            }`}
          >
            {errorsCount}
          </div>
        </GlassCard>
        <GlassCard level={3} padding="md">
          <div className="text-[11px] text-[#888888] dark:text-[#858585]">Quality Warnings</div>
          <div
            className={`mt-1 text-2xl font-semibold ${
              warningsCount > 0
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-[#101010] dark:text-white'
            }`}
          >
            {warningsCount}
          </div>
        </GlassCard>
        <GlassCard level={3} padding="md">
          <div className="text-[11px] text-[#888888] dark:text-[#858585]">Custom Fonts Active</div>
          <div className="mt-1 text-2xl font-semibold text-[#101010] dark:text-white">
            {customFonts.length}
          </div>
        </GlassCard>
        <GlassCard level={3} padding="md">
          <div className="text-[11px] text-[#888888] dark:text-[#858585]">Data Hygiene Flags</div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-2xl font-semibold text-[#101010] dark:text-white">
              {dataQuality.totalIssues}
            </span>
            {dataQuality.totalIssues > 0 && (
              <button
                type="button"
                onClick={onGoToDataManager}
                className="text-[11px] text-[#101010] dark:text-white hover:underline font-medium"
              >
                Inspect Data
              </button>
            )}
          </div>
        </GlassCard>
      </div>

      {/* Category Filter Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <GlassSegmentedControl
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All', count: issues.length },
            { value: 'layout', label: 'Layout & Bounds' },
            { value: 'fonts', label: 'Fonts & Licenses' },
            { value: 'images', label: 'Images & DPI' },
            { value: 'serial_data', label: 'Serial & Fields' },
          ]}
        />
      </div>

      {/* Issues List */}
      <GlassCard level={3} padding="none" className="overflow-hidden">
        <div className="px-5 py-3.5 border-b border-black/10 dark:border-white/12 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 font-semibold text-[#101010] dark:text-white">
            <ShieldCheck className="w-4 h-4 text-[#101010] dark:text-white" />
            Inspection Results
          </div>
          <span className="text-[#888888] dark:text-[#858585] tabular-nums">
            {filtered.length} item(s) displayed
          </span>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={filter}
            initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -3 }}
            transition={{ duration: MOTION_DURATION.fast, ease: MOTION_EASE.liquid }}
          >
            {filtered.length === 0 ? (
              <div className="p-10 text-center space-y-2">
                <CheckCircle2 className="w-8 h-8 text-[#101010] dark:text-white mx-auto" />
                <div className="text-sm font-semibold text-[#101010] dark:text-white">
                  No issues detected in this category
                </div>
                <p className="text-xs text-[#555555] dark:text-[#B5B5B5]">
                  Geometry, margins, serial numbering, fonts, and embedded assets meet preflight requirements.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-black/10 dark:divide-white/10">
                {filtered.map((issue) => (
                  <div
                    key={issue.id}
                    className="px-5 py-3.5 flex flex-col tablet:flex-row tablet:items-center justify-between gap-3 text-xs"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <AlertTriangle
                        className={`w-4 h-4 shrink-0 mt-0.5 ${
                          issue.severity === 'error'
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-amber-600 dark:text-amber-400'
                        }`}
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`font-semibold uppercase text-[10px] ${
                              issue.severity === 'error'
                                ? 'text-red-600 dark:text-red-400'
                                : 'text-amber-600 dark:text-amber-400'
                            }`}
                          >
                            {issue.severity}
                          </span>
                          <span className="text-[#888888] dark:text-[#858585]">·</span>
                          <span className="text-[11px] text-[#555555] dark:text-[#B5B5B5] capitalize">
                            {issue.category.replace(/_/g, ' ')}
                          </span>
                          {issue.pageNumber && (
                            <>
                              <span className="text-[#888888] dark:text-[#858585]">·</span>
                              <span className="text-[11px] text-[#555555] dark:text-[#B5B5B5] tabular-nums">
                                Page {issue.pageNumber}
                              </span>
                            </>
                          )}
                          {issue.effectiveDpi !== undefined && (
                            <>
                              <span className="text-[#888888] dark:text-[#858585]">·</span>
                              <span className="text-[11px] font-mono text-amber-600 dark:text-amber-400 tabular-nums">
                                {issue.effectiveDpi} DPI
                              </span>
                            </>
                          )}
                        </div>
                        <div className="mt-1 text-[#101010] dark:text-white">
                          {issue.message}
                        </div>
                        {issue.detail && (
                          <div className="mt-0.5 text-[11px] text-[#555555] dark:text-[#B5B5B5]">
                            {issue.detail}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {issue.autoFixLabel && (
                        <button
                          type="button"
                          onClick={() => handleAutoFix(issue)}
                          className="min-h-[36px] px-3 py-1.5 rounded-xl border border-black/15 dark:border-white/15 hover:bg-black/[0.04] dark:hover:bg-white/[0.08] text-[#101010] dark:text-white font-medium flex items-center gap-1.5"
                        >
                          <Wrench className="w-3.5 h-3.5" />
                          {issue.autoFixLabel}
                        </button>
                      )}
                      {(issue.elementId || issue.pageNumber) && (
                        <button
                          type="button"
                          onClick={() =>
                            onInspectElement(issue.pageNumber || 1, issue.elementId)
                          }
                          className="min-h-[36px] px-3 py-1.5 rounded-xl bg-[#101010] text-white hover:bg-[#262626] dark:bg-white dark:text-[#050505] dark:hover:bg-[#E6E6E6] font-medium transition-colors"
                        >
                          Go to Element
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </GlassCard>
    </div>
  );
};
