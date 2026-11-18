import JSZip from 'jszip';
import {
  AssetFontItem,
  BatchExportStrategy,
  ExportNamingProfile,
  PDFProject,
} from '../types/pdfStudio';
import { generateExportBytes } from './pdfExporter';
import { computeSerialValueForSlot } from './serialEngine';

export interface BatchExportResultItem {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
  recordIndex?: number;
  pageRangeLabel?: string;
  serialSummary?: string;
}

export function createDefaultExportNamingProfile(
  overrides: Partial<ExportNamingProfile> = {}
): ExportNamingProfile {
  return {
    id: `exprof-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    name: 'Standard Record Export',
    strategy: 'combined_pdf',
    filenameTemplate: '{project}_{serial}_{record}_{date}',
    pageGroupSize: 10,
    includeBatchCsvReport: true,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

export function formatExportFilename(
  template: string,
  ctx: {
    project: string;
    record?: number;
    serial?: string;
    page?: string | number;
    date?: string;
    index?: number;
  }
): string {
  const dateStr = ctx.date || new Date().toISOString().slice(0, 10);
  const raw = (template || '{project}_{index}')
    .replace(/\{project\}/g, ctx.project || 'document')
    .replace(/\{record\}/g, String(ctx.record ?? 1))
    .replace(/\{serial\}/g, ctx.serial || 'static')
    .replace(/\{page\}/g, String(ctx.page ?? 1))
    .replace(/\{date\}/g, dateStr)
    .replace(/\{index\}/g, String(ctx.index ?? 1).padStart(4, '0'));

  const sanitized = raw
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

  const base = sanitized || 'export_document';
  return base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;
}

export function parseRangeFilterNumbers(
  expr: string | undefined,
  maxUpper: number
): number[] {
  if (!expr || !expr.trim()) return [];
  const out = new Set<number>();
  for (const part of expr.split(',')) {
    const clean = part.trim();
    if (!clean) continue;
    const rangeMatch = clean.match(/^(\d+)\s*[-–..]+\s*(\d+)$/);
    if (rangeMatch) {
      const a = Math.max(1, Number(rangeMatch[1]));
      const b = Math.min(maxUpper, Number(rangeMatch[2]));
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.add(i);
    } else {
      const single = Number(clean);
      if (Number.isInteger(single) && single >= 1 && single <= maxUpper) {
        out.add(single);
      }
    }
  }
  return Array.from(out).sort((a, b) => a - b);
}

export function buildBatchExportCsvReport(
  items: BatchExportResultItem[]
): string {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [
    ['Index', 'FileName', 'SizeBytes', 'PageRange', 'RecordIndex', 'SerialSummary'].join(','),
  ];
  items.forEach((item, idx) => {
    lines.push(
      [
        String(idx + 1),
        esc(item.fileName),
        String(item.bytes.byteLength),
        esc(item.pageRangeLabel || ''),
        item.recordIndex !== undefined ? String(item.recordIndex) : '',
        esc(item.serialSummary || ''),
      ].join(',')
    );
  });
  return lines.join('\n');
}

export async function buildBatchZipArchive(
  items: BatchExportResultItem[],
  includeCsvReport = true
): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const item of items) {
    zip.file(item.fileName, item.bytes);
  }
  if (includeCsvReport) {
    zip.file('batch_export_report.csv', buildBatchExportCsvReport(items));
  }
  return await zip.generateAsync({ type: 'uint8array' });
}

export async function runManagedBatchExport(
  project: PDFProject,
  profile: ExportNamingProfile,
  options: {
    customFonts?: AssetFontItem[];
    onProgress?: (stage: string, current: number, total: number) => void;
  } = {}
): Promise<{
  items: BatchExportResultItem[];
  csvReport: string;
  strategy: BatchExportStrategy;
}> {
  const { customFonts = [], onProgress } = options;

  const isBpMode = Boolean(project.useBlueprintLayout && project.activeBlueprint);
  const copiesPerPage =
    isBpMode && project.activeBlueprint
      ? Math.max(1, project.activeBlueprint.blocks.filter((b) => b.visible).length)
      : project.copiesConfig.enabled
      ? Math.max(1, project.copiesConfig.columns * project.copiesConfig.rows)
      : 1;

  const totalPages =
    project.bulkConfig.enabled || project.copiesConfig.enabled || isBpMode
      ? Math.max(1, project.bulkConfig.totalOutputPages)
      : Math.max(1, project.pageCount);

  const items: BatchExportResultItem[] = [];

  if (profile.strategy === 'combined_pdf') {
    onProgress?.('Building combined batch PDF', 1, 1);
    const out = await generateExportBytes(project, { customFonts });
    const firstRule = project.serialRules[0];
    const firstSerial = firstRule
      ? computeSerialValueForSlot(firstRule, 0, 0, copiesPerPage, project.dataRows).value
      : 'combined';
    const fileName = formatExportFilename(profile.filenameTemplate, {
      project: project.name,
      record: 1,
      serial: firstSerial,
      page: `1-${totalPages}`,
      index: 1,
    });
    items.push({
      fileName,
      mimeType: out.mimeType,
      bytes: out.data,
      pageRangeLabel: `1-${totalPages}`,
      serialSummary: firstSerial,
    });
  } else if (profile.strategy === 'per_page_group') {
    const groupSize = Math.max(1, Math.min(200, profile.pageGroupSize || 10));
    const totalGroups = Math.ceil(totalPages / groupSize);
    for (let g = 0; g < totalGroups; g++) {
      const startZero = g * groupSize;
      const endZero = Math.min(totalPages, startZero + groupSize);
      onProgress?.(
        `Exporting page group ${g + 1}/${totalGroups}`,
        g + 1,
        totalGroups
      );
      const out = await generateExportBytes(project, {
        customFonts,
        pageRange: { startPageZero: startZero, endPageZeroExclusive: endZero },
      });
      const firstRule = project.serialRules[0];
      const groupSerial = firstRule
        ? computeSerialValueForSlot(
            firstRule,
            startZero,
            0,
            copiesPerPage,
            project.dataRows
          ).value
        : `p${startZero + 1}`;
      const pageRangeLabel = `${startZero + 1}-${endZero}`;
      const fileName = formatExportFilename(profile.filenameTemplate, {
        project: project.name,
        record: startZero * copiesPerPage + 1,
        serial: groupSerial,
        page: pageRangeLabel,
        index: g + 1,
      });
      items.push({
        fileName,
        mimeType: out.mimeType,
        bytes: out.data,
        pageRangeLabel,
        serialSummary: groupSerial,
      });
    }
  } else {
    // separate_per_record
    const totalAvailableRecords = Math.max(
      1,
      project.dataRows.length > 0 ? project.dataRows.length : totalPages * copiesPerPage
    );
    const startRec = Math.max(1, profile.recordRangeStart || 1);
    const endRec = Math.min(
      totalAvailableRecords,
      profile.recordRangeEnd || Math.min(totalAvailableRecords, 100)
    );
    const filterSerialNums = new Set(
      parseRangeFilterNumbers(profile.serialRangeFilter, 1_000_000)
    );

    const candidateIndices: number[] = [];
    for (let r = startRec; r <= endRec; r++) {
      const zeroIdx = r - 1;
      const pageZero = Math.floor(zeroIdx / copiesPerPage);
      const slotZero = zeroIdx % copiesPerPage;
      const firstRule = project.serialRules[0];
      const serialRes = firstRule
        ? computeSerialValueForSlot(
            firstRule,
            pageZero,
            slotZero,
            copiesPerPage,
            project.dataRows
          )
        : null;
      if (
        filterSerialNums.size > 0 &&
        serialRes?.numericValue !== null &&
        serialRes?.numericValue !== undefined &&
        !filterSerialNums.has(serialRes.numericValue)
      ) {
        continue;
      }
      candidateIndices.push(zeroIdx);
    }

    for (let i = 0; i < candidateIndices.length; i++) {
      const recZero = candidateIndices[i];
      onProgress?.(
        `Exporting record ${i + 1}/${candidateIndices.length}`,
        i + 1,
        candidateIndices.length
      );
      const pageZero = Math.floor(recZero / copiesPerPage);
      const slotZero = recZero % copiesPerPage;
      const firstRule = project.serialRules[0];
      const serialVal = firstRule
        ? computeSerialValueForSlot(
            firstRule,
            pageZero,
            slotZero,
            copiesPerPage,
            project.dataRows
          ).value
        : `rec${recZero + 1}`;

      const singleRecordProject: PDFProject = {
        ...project,
        copiesConfig: {
          ...project.copiesConfig,
          enabled: false,
          columns: 1,
          rows: 1,
        },
        bulkConfig: {
          ...project.bulkConfig,
          enabled: false,
          totalOutputPages: 1,
        },
        dataRows:
          project.dataRows[recZero] !== undefined ? [project.dataRows[recZero]] : [],
        serialRules: project.serialRules.map((rule) => {
          const valRes = computeSerialValueForSlot(
            rule,
            pageZero,
            slotZero,
            copiesPerPage,
            project.dataRows
          );
          return {
            ...rule,
            startNumber: valRes.numericValue ?? rule.startNumber + recZero * rule.increment,
            endNumber: valRes.numericValue ?? rule.startNumber + recZero * rule.increment,
          };
        }),
      };

      const out = await generateExportBytes(singleRecordProject, {
        customFonts,
        pageRange: { startPageZero: 0, endPageZeroExclusive: 1 },
      });

      const fileName = formatExportFilename(profile.filenameTemplate, {
        project: project.name,
        record: recZero + 1,
        serial: serialVal,
        page: pageZero + 1,
        index: i + 1,
      });

      items.push({
        fileName,
        mimeType: 'application/pdf',
        bytes: out.data,
        recordIndex: recZero + 1,
        pageRangeLabel: String(pageZero + 1),
        serialSummary: serialVal,
      });
    }
  }

  return {
    items,
    csvReport: buildBatchExportCsvReport(items),
    strategy: profile.strategy,
  };
}
