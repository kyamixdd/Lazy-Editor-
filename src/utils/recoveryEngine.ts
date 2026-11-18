import { PDFDocument } from 'pdf-lib';
import {
  AssetFontItem,
  BatchCheckpoint,
  PDFProject,
  SerialBatchRecord,
} from '../types/pdfStudio';
import { ExportJobControl, generateExportBytes } from './pdfExporter';
import { computeSerialValueForSlot } from './serialEngine';

export interface PdfIntegrityReport {
  valid: boolean;
  pageCount: number;
  byteLength: number;
  issues: string[];
}

export interface DuplicateOutputGuardReport {
  hasOverlapWarning: boolean;
  warnings: string[];
  resumableCheckpoints: BatchCheckpoint[];
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (typeof globalThis.Buffer !== 'undefined') {
    return globalThis.Buffer.from(bytes).toString('base64');
  }
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export function base64ToUint8ArrayRecovery(b64: string): Uint8Array {
  if (typeof globalThis.Buffer !== 'undefined') {
    return new Uint8Array(globalThis.Buffer.from(b64, 'base64'));
  }
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export async function verifyPdfBytesIntegrity(
  bytes: Uint8Array
): Promise<PdfIntegrityReport> {
  const issues: string[] = [];
  if (!bytes || bytes.byteLength < 64) {
    return {
      valid: false,
      pageCount: 0,
      byteLength: bytes?.byteLength || 0,
      issues: ['Output byte buffer is empty or truncated (< 64 bytes).'],
    };
  }

  const header = String.fromCharCode(
    bytes[0],
    bytes[1],
    bytes[2],
    bytes[3],
    bytes[4]
  );
  if (header !== '%PDF-') {
    issues.push(`Invalid PDF header "${header}" (expected "%PDF-").`);
    return {
      valid: false,
      pageCount: 0,
      byteLength: bytes.byteLength,
      issues,
    };
  }

  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const pageCount = doc.getPageCount();
    if (pageCount <= 0) {
      issues.push('PDF loaded but contains zero pages.');
      return {
        valid: false,
        pageCount: 0,
        byteLength: bytes.byteLength,
        issues,
      };
    }

    for (let i = 0; i < pageCount; i++) {
      const pg = doc.getPage(i);
      const { width, height } = pg.getSize();
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        issues.push(`Page ${i + 1} has invalid MediaBox dimensions (${width}×${height}).`);
      }
    }

    return {
      valid: issues.length === 0,
      pageCount,
      byteLength: bytes.byteLength,
      issues,
    };
  } catch (err) {
    issues.push(
      `PDF structural parse failed: ${err instanceof Error ? err.message : 'Unknown error'}`
    );
    return {
      valid: false,
      pageCount: 0,
      byteLength: bytes.byteLength,
      issues,
    };
  }
}

export function detectDuplicateOutputGuard(
  project: PDFProject,
  serialBatches: SerialBatchRecord[],
  checkpoints: BatchCheckpoint[]
): DuplicateOutputGuardReport {
  const warnings: string[] = [];

  const resumableCheckpoints = checkpoints.filter(
    (cp) =>
      cp.projectId === project.id &&
      (cp.status === 'in_progress' ||
        cp.status === 'paused' ||
        cp.status === 'interrupted')
  );

  if (resumableCheckpoints.length > 0) {
    const latest = resumableCheckpoints[0];
    warnings.push(
      `An incomplete checkpoint (${latest.completedPageCount}/${latest.totalOutputPages} pages) exists for "${project.name}". Resume it instead of restarting to prevent duplicate numbered output.`
    );
  }

  const projectBatches = serialBatches.filter(
    (b) => b.projectId === project.id
  );
  for (const rule of project.serialRules) {
    const lo = Math.min(rule.startNumber, rule.endNumber);
    const hi = Math.max(rule.startNumber, rule.endNumber);
    for (const batch of projectBatches) {
      if (batch.targetFieldKey !== rule.targetFieldKey) continue;
      const bLo = Math.min(batch.actualFirstNum, batch.actualLastNum);
      const bHi = Math.max(batch.actualFirstNum, batch.actualLastNum);
      if (Math.max(lo, bLo) <= Math.min(hi, bHi)) {
        warnings.push(
          `Serial rule "${rule.name}" (${lo}–${hi}) overlaps previously recorded batch "${batch.ruleName}" (${bLo}–${bHi}).`
        );
      }
    }
  }

  return {
    hasOverlapWarning: warnings.length > 0,
    warnings,
    resumableCheckpoints,
  };
}

export async function runCheckpointedBatchExport(
  project: PDFProject,
  options: {
    customFonts?: AssetFontItem[];
    chunkSizePages?: number;
    resumeCheckpoint?: BatchCheckpoint;
    jobId?: string;
    onCheckpoint?: (cp: BatchCheckpoint) => void;
    onProgress?: (stage: string, current: number, total: number) => void;
    control?: ExportJobControl & {
      shouldInterruptAfterChunk?: (completedPages: number) => boolean;
    };
  } = {}
): Promise<{
  checkpoint: BatchCheckpoint;
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
  interrupted: boolean;
}> {
  const {
    customFonts = [],
    chunkSizePages = 8,
    resumeCheckpoint,
    jobId = resumeCheckpoint?.jobId || `job-${Date.now()}`,
    onCheckpoint,
    onProgress,
    control,
  } = options;

  const isBpMode = Boolean(project.useBlueprintLayout && project.activeBlueprint);
  const isBulkOrImposition =
    project.copiesConfig.enabled ||
    project.bulkConfig.enabled ||
    project.bulkConfig.totalOutputPages > 1 ||
    project.serialRules.length > 0 ||
    isBpMode;

  const totalOutputPages = isBulkOrImposition
    ? Math.max(
        1,
        project.bulkConfig.totalOutputPages ||
          project.bulkConfig.endPageNumber - project.bulkConfig.startPageNumber + 1
      )
    : Math.max(1, project.pageCount);

  const copiesPerPage =
    isBpMode && project.activeBlueprint
      ? Math.max(1, project.activeBlueprint.blocks.filter((b) => b.visible).length)
      : project.copiesConfig.enabled
      ? Math.max(1, project.copiesConfig.columns * project.copiesConfig.rows)
      : 1;

  const safeChunk = Math.max(1, Math.min(50, Math.round(chunkSizePages)));
  const startPageZero = resumeCheckpoint
    ? Math.min(totalOutputPages, resumeCheckpoint.lastVerifiedPageZero + 1)
    : 0;

  let currentBytes: Uint8Array | undefined =
    resumeCheckpoint?.partialPdfBase64
      ? base64ToUint8ArrayRecovery(resumeCheckpoint.partialPdfBase64)
      : undefined;

  let fileName =
    resumeCheckpoint?.outputFileName ||
    `${project.name.replace(/\s+/g, '_')}_batch.pdf`;
  let mimeType = 'application/pdf';

  const checkpointId =
    resumeCheckpoint?.id ||
    `chk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const createdAt = resumeCheckpoint?.createdAt || new Date().toISOString();

  const computeLastSerials = (lastPageZero: number): BatchCheckpoint['lastSerialByRule'] => {
    const out: BatchCheckpoint['lastSerialByRule'] = [];
    const groupedCount = new Map<string, number>();
    for (const r of project.serialRules) {
      groupedCount.set(r.targetFieldKey, (groupedCount.get(r.targetFieldKey) || 0) + 1);
    }
    const fieldOrdinal = new Map<string, number>();
    for (const rule of project.serialRules) {
      const ord = fieldOrdinal.get(rule.targetFieldKey) || 0;
      fieldOrdinal.set(rule.targetFieldKey, ord + 1);
      const res = computeSerialValueForSlot(
        rule,
        Math.max(0, lastPageZero),
        Math.max(0, copiesPerPage - 1),
        copiesPerPage,
        project.dataRows,
        groupedCount.get(rule.targetFieldKey) || 1,
        ord
      );
      const lastNum =
        res.numericValue !== null ? res.numericValue : rule.startNumber;
      const nextStep = computeSerialValueForSlot(
        rule,
        lastPageZero + 1,
        0,
        copiesPerPage,
        project.dataRows,
        groupedCount.get(rule.targetFieldKey) || 1,
        ord
      );
      out.push({
        ruleId: rule.id,
        ruleName: rule.name,
        lastNumber: lastNum,
        nextResumeNumber:
          nextStep.numericValue !== null ? nextStep.numericValue : lastNum + rule.increment,
      });
    }
    return out;
  };

  if (startPageZero >= totalOutputPages && currentBytes) {
    const integrity = await verifyPdfBytesIntegrity(currentBytes);
    const doneCp: BatchCheckpoint = {
      id: checkpointId,
      jobId,
      projectId: project.id,
      projectName: project.name,
      totalOutputPages,
      copiesPerPage,
      chunkSizePages: safeChunk,
      lastVerifiedPageZero: totalOutputPages - 1,
      completedPageCount: totalOutputPages,
      status: 'completed',
      verifiedIntegrity: integrity.valid,
      outputFileName: fileName,
      outputSizeBytes: currentBytes.byteLength,
      lastSerialByRule: computeLastSerials(totalOutputPages - 1),
      partialPdfBase64: uint8ArrayToBase64(currentBytes),
      createdAt,
      updatedAt: new Date().toISOString(),
    };
    onCheckpoint?.(doneCp);
    return {
      checkpoint: doneCp,
      bytes: currentBytes,
      fileName,
      mimeType,
      interrupted: false,
    };
  }

  let latestCp: BatchCheckpoint = resumeCheckpoint || {
    id: checkpointId,
    jobId,
    projectId: project.id,
    projectName: project.name,
    totalOutputPages,
    copiesPerPage,
    chunkSizePages: safeChunk,
    lastVerifiedPageZero: -1,
    completedPageCount: 0,
    status: 'in_progress',
    verifiedIntegrity: false,
    lastSerialByRule: [],
    createdAt,
    updatedAt: createdAt,
  };

  for (let cursor = startPageZero; cursor < totalOutputPages; cursor += safeChunk) {
    if (control?.isCancelled()) {
      latestCp = {
        ...latestCp,
        status: 'paused',
        updatedAt: new Date().toISOString(),
      };
      onCheckpoint?.(latestCp);
      return {
        checkpoint: latestCp,
        bytes: currentBytes || new Uint8Array(),
        fileName,
        mimeType,
        interrupted: true,
      };
    }
    if (control) {
      await control.waitWhilePaused();
    }

    const endZero = Math.min(totalOutputPages, cursor + safeChunk);
    onProgress?.(
      `Checkpointing pages ${cursor + 1}–${endZero} of ${totalOutputPages}`,
      endZero,
      totalOutputPages
    );

    const chunkOut = await generateExportBytes(project, {
      customFonts,
      control,
      pageRange: {
        startPageZero: cursor,
        endPageZeroExclusive: endZero,
      },
      existingPartialPdfBytes: currentBytes,
    });

    const integrity = await verifyPdfBytesIntegrity(chunkOut.data);
    if (!integrity.valid) {
      const brokenCp: BatchCheckpoint = {
        ...latestCp,
        status: 'interrupted',
        verifiedIntegrity: false,
        updatedAt: new Date().toISOString(),
        error: integrity.issues.join(' | '),
      };
      onCheckpoint?.(brokenCp);
      throw new Error(`Chunk integrity check failed: ${integrity.issues.join('; ')}`);
    }

    currentBytes = chunkOut.data;
    fileName = chunkOut.fileName;
    mimeType = chunkOut.mimeType;

    const isDone = endZero >= totalOutputPages;
    latestCp = {
      id: checkpointId,
      jobId,
      projectId: project.id,
      projectName: project.name,
      totalOutputPages,
      copiesPerPage,
      chunkSizePages: safeChunk,
      lastVerifiedPageZero: endZero - 1,
      completedPageCount: endZero,
      status: isDone ? 'completed' : 'in_progress',
      verifiedIntegrity: true,
      outputFileName: fileName,
      outputSizeBytes: currentBytes.byteLength,
      lastSerialByRule: computeLastSerials(endZero - 1),
      partialPdfBase64: uint8ArrayToBase64(currentBytes),
      createdAt,
      updatedAt: new Date().toISOString(),
    };
    onCheckpoint?.(latestCp);

    if (!isDone && control?.shouldInterruptAfterChunk?.(endZero)) {
      latestCp = {
        ...latestCp,
        status: 'interrupted',
        updatedAt: new Date().toISOString(),
      };
      onCheckpoint?.(latestCp);
      return {
        checkpoint: latestCp,
        bytes: currentBytes,
        fileName,
        mimeType,
        interrupted: true,
      };
    }
  }

  return {
    checkpoint: latestCp,
    bytes: currentBytes || new Uint8Array(),
    fileName,
    mimeType,
    interrupted: false,
  };
}
