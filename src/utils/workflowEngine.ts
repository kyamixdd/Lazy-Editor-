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
import { analyzeDataQuality } from './dataFormulaEngine';
import { computeSheetLayout } from './geometryEngine';
import { createDocumentIntegrityPassport } from './passportEngine';
import { generateExportBytes } from './pdfExporter';
import { verifyPdfBytesIntegrity } from './recoveryEngine';
import { analyzeSerialIntelligence } from './serialEngine';
import { applyProfileSettingsToProject } from './templateProfileEngine';
import { validateProject } from './validationEngine';

export const WORKFLOW_STEP_CATALOG: Array<{
  kind: WorkflowStepKind;
  label: string;
  description: string;
}> = [
  {
    kind: 'import_pdf',
    label: 'Verify Source PDF',
    description: 'Confirms source document pages and dimensions are loaded.',
  },
  {
    kind: 'local_scan',
    label: 'Audit Local Scan Extraction',
    description: 'Verifies extracted text blocks, coordinates, and fields.',
  },
  {
    kind: 'apply_profile',
    label: 'Apply Template Profile',
    description: 'Applies saved page, margin, grid, and rule settings from a profile.',
  },
  {
    kind: 'import_data',
    label: 'Validate Data Source',
    description: 'Checks spreadsheet rows, required columns, and duplicate keys.',
  },
  {
    kind: 'map_fields',
    label: 'Verify Field Mappings',
    description: 'Checks that dynamic field keys bind cleanly to data or serial rules.',
  },
  {
    kind: 'validate_numbering',
    label: 'Serial Number Intelligence Check',
    description: 'Detects overlaps, duplicate serials, and reserved range collisions.',
  },
  {
    kind: 'preview_sheet',
    label: 'Imposition Sheet Check',
    description: 'Computes copy slots, gutters, and page bounds for overflow.',
  },
  {
    kind: 'preflight_check',
    label: 'Full Preflight QC Gate',
    description: 'Runs complete geometry, barcode, font, and overflow inspection.',
  },
  {
    kind: 'bulk_generate',
    label: 'Generate Bulk Output',
    description: 'Builds multi-page PDF bytes and verifies PDF structure integrity.',
  },
  {
    kind: 'export_pdf',
    label: 'Finalize Export Package',
    description: 'Verifies exported PDF/ZIP payload ready for download.',
  },
  {
    kind: 'create_passport',
    label: 'Issue Integrity Passport',
    description: 'Hashes output SHA-256 and records template DNA & serial audit spans.',
  },
];

const makeStep = (
  kind: WorkflowStepKind,
  overrides: Partial<WorkflowStep> = {}
): WorkflowStep => {
  const catalog = WORKFLOW_STEP_CATALOG.find((c) => c.kind === kind);
  return {
    id: `wstep-${kind}-${Math.random().toString(36).slice(2, 6)}`,
    kind,
    label: catalog?.label || kind,
    enabled: true,
    stopOnCriticalError: true,
    ...overrides,
  };
};

export function createPresetWorkflows(): WorkflowChain[] {
  const now = new Date().toISOString();
  return [
    {
      id: 'preset-full-production',
      name: 'Full Production Print Run',
      description:
        'End-to-end validation: verifies source geometry, serial intelligence, imposition sheet, preflight QC gate, generates PDF, and mints an Integrity Passport.',
      isPreset: true,
      steps: [
        makeStep('import_pdf'),
        makeStep('import_data'),
        makeStep('map_fields'),
        makeStep('validate_numbering'),
        makeStep('preview_sheet'),
        makeStep('preflight_check'),
        makeStep('bulk_generate'),
        makeStep('create_passport'),
      ],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'preset-label-merge',
      name: 'Quick Data-Merge Label Batch',
      description:
        'Validates spreadsheet records, maps fields, inspects preflight, and exports ready-to-print sheet PDF.',
      isPreset: true,
      steps: [
        makeStep('import_data'),
        makeStep('map_fields'),
        makeStep('preflight_check'),
        makeStep('export_pdf'),
      ],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'preset-scan-validate',
      name: 'Scan-Audit-Validate Pipeline',
      description:
        'Audits extracted fields, runs serial conflict analysis, verifies sheet fit, and performs strict preflight inspection without exporting.',
      isPreset: true,
      steps: [
        makeStep('import_pdf'),
        makeStep('local_scan'),
        makeStep('validate_numbering'),
        makeStep('preview_sheet'),
        makeStep('preflight_check'),
      ],
      createdAt: now,
      updatedAt: now,
    },
  ];
}

export async function executeWorkflowChain(
  workflow: WorkflowChain,
  project: PDFProject,
  options: {
    customFonts?: AssetFontItem[];
    profiles?: TemplateAutomationProfile[];
    serialBatches?: SerialBatchRecord[];
    allowCriticalOverride?: boolean;
    onStepUpdate?: (
      stepIndex: number,
      result: WorkflowStepRunResult,
      allResults: WorkflowStepRunResult[]
    ) => void;
    control?: {
      isCancelled: () => boolean;
      waitWhilePaused: () => Promise<void>;
    };
  } = {}
): Promise<{
  runLog: WorkflowRunLog;
  updatedProject: PDFProject;
  pdfBytes?: Uint8Array;
  fileName?: string;
  mimeType?: string;
  passport?: DocumentIntegrityPassport;
}> {
  const {
    customFonts = [],
    profiles = [],
    serialBatches = [],
    allowCriticalOverride = false,
    onStepUpdate,
    control,
  } = options;

  const startedAt = new Date().toISOString();
  let workingProject = structuredClone(project);
  const stepResults: WorkflowStepRunResult[] = [];
  const criticalErrors: string[] = [];

  let generatedBytes: Uint8Array | undefined;
  let generatedFileName: string | undefined;
  let generatedMimeType: string | undefined;
  let passport: DocumentIntegrityPassport | undefined;
  let overallStatus: WorkflowRunLog['status'] = 'completed';

  const getProductionCounts = (proj: PDFProject) => {
    const isBpMode = Boolean(proj.useBlueprintLayout && proj.activeBlueprint);
    const copiesPerPage =
      isBpMode && proj.activeBlueprint
        ? Math.max(1, proj.activeBlueprint.blocks.filter((b) => b.visible).length)
        : proj.copiesConfig.enabled
        ? Math.max(1, proj.copiesConfig.columns * proj.copiesConfig.rows)
        : 1;
    const totalOutputPages =
      proj.bulkConfig.enabled || proj.copiesConfig.enabled || isBpMode
        ? Math.max(1, proj.bulkConfig.totalOutputPages)
        : Math.max(1, proj.pageCount);
    return { copiesPerPage, totalOutputPages };
  };

  for (let idx = 0; idx < workflow.steps.length; idx++) {
    const step = workflow.steps[idx];

    if (control?.isCancelled()) {
      overallStatus = 'cancelled';
      break;
    }
    if (control) {
      await control.waitWhilePaused();
      if (control.isCancelled()) {
        overallStatus = 'cancelled';
        break;
      }
    }

    if (!step.enabled) {
      const skippedRes: WorkflowStepRunResult = {
        stepId: step.id,
        kind: step.kind,
        label: step.label,
        status: 'skipped',
        summary: 'Step disabled by user.',
      };
      stepResults.push(skippedRes);
      onStepUpdate?.(idx, skippedRes, [...stepResults]);
      continue;
    }

    let res: WorkflowStepRunResult;

    try {
      switch (step.kind) {
        case 'import_pdf': {
          if (workingProject.pageCount <= 0) {
            res = {
              stepId: step.id,
              kind: step.kind,
              label: step.label,
              status: 'failed',
              summary: 'Project has 0 pages.',
            };
            criticalErrors.push('Source document has zero pages.');
          } else {
            res = {
              stepId: step.id,
              kind: step.kind,
              label: step.label,
              status: workingProject.sourcePdfBase64 ? 'passed' : 'warning',
              summary: workingProject.sourcePdfBase64
                ? `Verified ${workingProject.pageCount} source page(s) from "${workingProject.sourcePdfName}".`
                : `Project has ${workingProject.pageCount} page(s) using canvas-only geometry (no embedded base PDF).`,
            };
          }
          break;
        }

        case 'local_scan': {
          const totalEls = workingProject.elements.length;
          const reviewEls = workingProject.elements.filter((e) => e.needsReview).length;
          if (totalEls === 0) {
            res = {
              stepId: step.id,
              kind: step.kind,
              label: step.label,
              status: 'warning',
              summary: 'No detected or added elements present on template.',
            };
          } else {
            res = {
              stepId: step.id,
              kind: step.kind,
              label: step.label,
              status: reviewEls > 0 ? 'warning' : 'passed',
              summary: `${totalEls} element(s) mapped (${reviewEls} flagged for review).`,
            };
          }
          break;
        }

        case 'apply_profile': {
          const prof = step.profileId
            ? profiles.find((p) => p.id === step.profileId)
            : undefined;
          if (!prof) {
            res = {
              stepId: step.id,
              kind: step.kind,
              label: step.label,
              status: step.profileId ? 'failed' : 'warning',
              summary: step.profileId
                ? `Selected profile "${step.profileId}" not found.`
                : 'No profile selected for this step — skipped settings merge.',
            };
            if (step.profileId) {
              criticalErrors.push(`Missing automation profile ${step.profileId}.`);
            }
          } else {
            workingProject = applyProfileSettingsToProject(workingProject, prof);
            res = {
              stepId: step.id,
              kind: step.kind,
              label: step.label,
              status: 'passed',
              summary: `Applied profile "${prof.name}" (${prof.pageConfig.sizePreset}, ${prof.copiesConfig.columns}×${prof.copiesConfig.rows} grid).`,
            };
          }
          break;
        }

        case 'import_data': {
          const mappedKeys = Array.from(
            new Set(
              workingProject.elements
                .map((e) => e.fieldKey)
                .filter((k): k is string => Boolean(k))
            )
          );
          const quality = analyzeDataQuality(
            workingProject.dataColumns,
            workingProject.dataRows,
            [],
            mappedKeys
          );
          if (workingProject.dataRows.length === 0) {
            res = {
              stepId: step.id,
              kind: step.kind,
              label: step.label,
              status: 'warning',
              summary: '0 data rows loaded (serial/static fields only).',
            };
          } else if (quality.missingValues.length > 0) {
            res = {
              stepId: step.id,
              kind: step.kind,
              label: step.label,
              status: 'warning',
              summary: `${workingProject.dataRows.length} row(s), ${quality.missingValues.length} missing required cell value(s).`,
            };
          } else {
            res = {
              stepId: step.id,
              kind: step.kind,
              label: step.label,
              status: 'passed',
              summary: `${workingProject.dataRows.length} data record(s) across ${workingProject.dataColumns.length} column(s) verified clean.`,
            };
          }
          break;
        }

        case 'map_fields': {
          const mappedEls = workingProject.elements.filter((e) => Boolean(e.fieldKey));
          const colNames = new Set(workingProject.dataColumns.map((c) => c.name));
          const serialKeys = new Set(
            workingProject.serialRules.map((r) => r.targetFieldKey)
          );
          const unresolved = mappedEls.filter(
            (e) =>
              e.fieldKey &&
              !colNames.has(e.fieldKey) &&
              !serialKeys.has(e.fieldKey)
          );
          if (unresolved.length > 0) {
            res = {
              stepId: step.id,
              kind: step.kind,
              label: step.label,
              status: 'warning',
              summary: `${mappedEls.length} mapped field(s); ${unresolved.length} key(s) have no matching CSV column or serial rule (${unresolved[0].fieldKey}).`,
            };
          } else {
            res = {
              stepId: step.id,
              kind: step.kind,
              label: step.label,
              status: 'passed',
              summary: `All ${mappedEls.length} dynamic field binding(s) resolved to data or serial sequences.`,
            };
          }
          break;
        }

        case 'validate_numbering': {
          const { copiesPerPage, totalOutputPages } = getProductionCounts(workingProject);
          const intel = analyzeSerialIntelligence(
            workingProject.serialRules,
            totalOutputPages,
            copiesPerPage,
            workingProject.dataRows,
            serialBatches
          );
          if (intel.hasCriticalConflicts) {
            const firstErr = intel.conflicts.find((c) => c.severity === 'error');
            const msg = `${intel.conflicts.length} serial numbering conflict(s): ${
              firstErr?.message || intel.conflicts[0].message
            }`;
            criticalErrors.push(msg);
            res = {
              stepId: step.id,
              kind: step.kind,
              label: step.label,
              status: 'failed',
              summary: msg,
            };
          } else {
            res = {
              stepId: step.id,
              kind: step.kind,
              label: step.label,
              status: 'passed',
              summary:
                workingProject.serialRules.length > 0
                  ? `${workingProject.serialRules.length} serial rule(s) verified with zero duplicates or overlaps.`
                  : 'No serial rules configured (static pass).',
            };
          }
          break;
        }

        case 'preview_sheet': {
          const sheet = computeSheetLayout(workingProject, 1);
          const hasBoundsErr = sheet.hasClipping || sheet.hasOverlap;
          if (hasBoundsErr) {
            const msg = sheet.hasOverlap
              ? 'Imposition copy slots overlap each other.'
              : 'Imposition slots extend outside output page bounds.';
            criticalErrors.push(msg);
            res = {
              stepId: step.id,
              kind: step.kind,
              label: step.label,
              status: 'failed',
              summary: msg,
            };
          } else {
            res = {
              stepId: step.id,
              kind: step.kind,
              label: step.label,
              status: 'passed',
              summary: `Sheet ${Math.round(sheet.outputSheetWidthPt)}×${Math.round(
                sheet.outputSheetHeightPt
              )}pt verified with ${sheet.slots.length} slot(s).`,
            };
          }
          break;
        }

        case 'preflight_check': {
          const issues = validateProject(workingProject, customFonts);
          const errs = issues.filter((i) => i.severity === 'error');
          const warns = issues.filter((i) => i.severity === 'warning');
          if (errs.length > 0) {
            const msg = `${errs.length} critical preflight error(s): ${errs[0].message}`;
            criticalErrors.push(msg);
            res = {
              stepId: step.id,
              kind: step.kind,
              label: step.label,
              status: 'failed',
              summary: msg,
            };
          } else if (warns.length > 0) {
            res = {
              stepId: step.id,
              kind: step.kind,
              label: step.label,
              status: 'warning',
              summary: `0 errors, ${warns.length} preflight warning(s) (${warns[0].message}).`,
            };
          } else {
            res = {
              stepId: step.id,
              kind: step.kind,
              label: step.label,
              status: 'passed',
              summary: 'Preflight QC passed with zero errors and zero warnings.',
            };
          }
          break;
        }

        case 'bulk_generate':
        case 'export_pdf': {
          if (criticalErrors.length > 0 && !allowCriticalOverride) {
            res = {
              stepId: step.id,
              kind: step.kind,
              label: step.label,
              status: 'failed',
              summary: `Halted before generation: ${criticalErrors[0]}`,
            };
            stepResults.push(res);
            onStepUpdate?.(idx, res, [...stepResults]);
            overallStatus = 'halted';
            return {
              runLog: {
                id: `wrun-${Date.now()}`,
                workflowId: workflow.id,
                workflowName: workflow.name,
                projectId: workingProject.id,
                status: 'halted',
                stepResults,
                startedAt,
                finishedAt: new Date().toISOString(),
              },
              updatedProject: workingProject,
              pdfBytes: generatedBytes,
              fileName: generatedFileName,
              mimeType: generatedMimeType,
              passport,
            };
          }

          const out = await generateExportBytes(workingProject, {
            customFonts,
          });
          if (control) {
            await control.waitWhilePaused();
            if (control.isCancelled()) {
              overallStatus = 'cancelled';
              res = {
                stepId: step.id,
                kind: step.kind,
                label: step.label,
                status: 'skipped',
                summary: 'Cancellation requested during export; generated output was discarded.',
              };
              break;
            }
          }
          if (out.mimeType === 'application/pdf') {
            const integrity = await verifyPdfBytesIntegrity(out.data);
            if (!integrity.valid) {
              const msg = `Generated PDF failed integrity check: ${integrity.issues.join('; ')}`;
              criticalErrors.push(msg);
              res = {
                stepId: step.id,
                kind: step.kind,
                label: step.label,
                status: 'failed',
                summary: msg,
              };
              break;
            }
          }
          generatedBytes = out.data;
          generatedFileName = out.fileName;
          generatedMimeType = out.mimeType;
          res = {
            stepId: step.id,
            kind: step.kind,
            label: step.label,
            status: 'passed',
            summary: `Generated "${out.fileName}" (${(out.data.byteLength / 1024).toFixed(1)} KB).`,
          };
          break;
        }

        case 'create_passport': {
          if (!generatedBytes) {
            const out = await generateExportBytes(workingProject, { customFonts });
            if (control) {
              await control.waitWhilePaused();
              if (control.isCancelled()) {
                overallStatus = 'cancelled';
                res = {
                  stepId: step.id,
                  kind: step.kind,
                  label: step.label,
                  status: 'skipped',
                  summary: 'Cancellation requested during export; no passport was issued.',
                };
                break;
              }
            }
            generatedBytes = out.data;
            generatedFileName = out.fileName;
            generatedMimeType = out.mimeType;
          }
          const { totalOutputPages } = getProductionCounts(workingProject);
          if (control) {
            await control.waitWhilePaused();
            if (control.isCancelled()) {
              overallStatus = 'cancelled';
              res = {
                stepId: step.id,
                kind: step.kind,
                label: step.label,
                status: 'skipped',
                summary: 'Cancellation requested before passport creation.',
              };
              break;
            }
          }
          passport = await createDocumentIntegrityPassport(workingProject, {
            fileName: generatedFileName || `${workingProject.name}.pdf`,
            mimeType: generatedMimeType || 'application/pdf',
            bytes: generatedBytes,
            verifiedPageCount: totalOutputPages,
            customFonts,
          });
          if (control?.isCancelled()) {
            passport = undefined;
            overallStatus = 'cancelled';
            res = {
              stepId: step.id,
              kind: step.kind,
              label: step.label,
              status: 'skipped',
              summary: 'Cancellation requested during passport generation; passport was discarded.',
            };
            break;
          }
          res = {
            stepId: step.id,
            kind: step.kind,
            label: step.label,
            status: 'passed',
            summary: `Issued Passport #${passport.sha256Hex.slice(0, 12)} (${passport.validationStatus}).`,
          };
          break;
        }

        default: {
          res = {
            stepId: step.id,
            kind: step.kind,
            label: step.label,
            status: 'warning',
            summary: `Unsupported step kind: ${String(step.kind)}`,
          };
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Step execution error';
      criticalErrors.push(msg);
      res = {
        stepId: step.id,
        kind: step.kind,
        label: step.label,
        status: 'failed',
        summary: msg,
      };
    }

    stepResults.push(res);
    onStepUpdate?.(idx, res, [...stepResults]);

    if (res.status === 'failed' && step.stopOnCriticalError !== false) {
      overallStatus = 'halted';
      break;
    }
  }

  return {
    runLog: {
      id: `wrun-${Date.now()}`,
      workflowId: workflow.id,
      workflowName: workflow.name,
      projectId: workingProject.id,
      status: overallStatus,
      stepResults,
      startedAt,
      finishedAt: new Date().toISOString(),
    },
    updatedProject: workingProject,
    pdfBytes: generatedBytes,
    fileName: generatedFileName,
    mimeType: generatedMimeType,
    passport,
  };
}
