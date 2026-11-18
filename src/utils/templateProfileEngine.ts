import {
  DocumentElement,
  PDFProject,
  RectPt,
  TemplateAutomationProfile,
  TemplateDnaDiffItem,
  TemplateDnaDiffReport,
  TemplateDnaFieldNode,
  TemplateDnaFingerprint,
} from '../types/pdfStudio';
import { normalizeFitConfig } from './geometryEngine';

function fnv1aHex(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= ch ^ ((i + 1) & 0xff);
    h2 = Math.imul(h2, 0x01000193);
  }
  const part1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const part2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `dna-${part1}${part2}`.toLowerCase();
}

export function extractBlockBoundaries(
  project: Pick<PDFProject, 'elements' | 'originalPages'>
): Array<{ blockId: string; pageNumber: number; rect: RectPt }> {
  const blockBoundaries: Array<{ blockId: string; pageNumber: number; rect: RectPt }> = [];
  for (const el of project.elements) {
    if (el.type === 'repeated_block' && el.blockId) {
      blockBoundaries.push({
        blockId: el.blockId,
        pageNumber: el.pageNumber,
        rect: { x: el.x, y: el.y, width: el.width, height: el.height },
      });
    }
  }
  if (blockBoundaries.length === 0) {
    for (const pg of project.originalPages) {
      for (const blk of pg.detectedBounds?.blockBoxes || []) {
        blockBoundaries.push({
          blockId: blk.blockId,
          pageNumber: pg.pageNumber,
          rect: structuredClone(blk.rect),
        });
      }
    }
  }
  return blockBoundaries;
}

export function computeTemplateDna(
  source: PDFProject | TemplateAutomationProfile
): TemplateDnaFingerprint {
  const now = new Date().toISOString();
  const fit = 'fitConfig' in source && source.fitConfig
    ? source.fitConfig
    : normalizeFitConfig(source);

  const blockGeometry = 'blockBoundaries' in source
    ? structuredClone(source.blockBoundaries)
    : extractBlockBoundaries(source);

  const fields: TemplateDnaFieldNode[] = source.elements
    .filter((e) => e.visible)
    .map((e) => ({
      elementId: e.id,
      type: e.type,
      pageNumber: e.pageNumber,
      x: Number(e.x.toFixed(2)),
      y: Number(e.y.toFixed(2)),
      width: Number(e.width.toFixed(2)),
      height: Number(e.height.toFixed(2)),
      fontFamily: e.fontFamily,
      fontSize: Number(e.fontSize.toFixed(2)),
      fontWeight: e.fontWeight,
      align: e.align,
      fieldKey: e.fieldKey,
      blockId: e.blockId,
      textSample: (e.text || '').slice(0, 48),
    }))
    .sort((a, b) =>
      a.pageNumber - b.pageNumber || a.y - b.y || a.x - b.x || a.elementId.localeCompare(b.elementId)
    );

  const relMap = new Map<string, string[]>();
  for (const el of source.elements) {
    if (el.blockId && el.type !== 'repeated_block') {
      const arr = relMap.get(el.blockId) || [];
      arr.push(el.id);
      relMap.set(el.blockId, arr);
    }
  }
  const relationships = Array.from(relMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([parentBlockId, childElementIds]) => ({
      parentBlockId,
      childElementIds: [...childElementIds].sort(),
    }));

  const numberingSignatures = source.serialRules.map((r) => ({
    ruleId: r.id,
    name: r.name,
    targetFieldKey: r.targetFieldKey,
    blockIndex: r.blockIndex,
    pattern: `${r.prefix}[${r.digits}:${r.startNumber}-${r.endNumber}+${r.increment}]${r.suffix}`,
  }));

  const dataColumnNames = source.dataColumns.map((c) => c.name);

  const pageDimensionsPt = {
    width: Number(source.pageConfig.widthPt.toFixed(2)),
    height: Number(source.pageConfig.heightPt.toFixed(2)),
  };
  const marginsPt = {
    top: Number(source.pageConfig.marginTopPt.toFixed(2)),
    right: Number(source.pageConfig.marginRightPt.toFixed(2)),
    bottom: Number(source.pageConfig.marginBottomPt.toFixed(2)),
    left: Number(source.pageConfig.marginLeftPt.toFixed(2)),
  };
  const gridSpec = {
    enabled: Boolean(source.copiesConfig.enabled),
    columns: source.copiesConfig.columns,
    rows: source.copiesConfig.rows,
    hSpacingPt: Number(source.copiesConfig.horizontalSpacingPt.toFixed(2)),
    vSpacingPt: Number(source.copiesConfig.verticalSpacingPt.toFixed(2)),
  };

  const canonical = JSON.stringify({
    pageCount: source.pageCount,
    pageDimensionsPt,
    marginsPt,
    blockGeometry,
    fields: fields.map((f) => ({
      t: f.type,
      p: f.pageNumber,
      x: Math.round(f.x),
      y: Math.round(f.y),
      w: Math.round(f.width),
      h: Math.round(f.height),
      ff: f.fontFamily,
      fs: f.fontSize,
      fk: f.fieldKey || '',
      bk: f.blockId || '',
      tx: f.textSample.slice(0, 20),
    })),
    numberingSignatures,
    dataColumnNames,
    scalingMode: fit.scalingMode,
    boundaryMode: fit.boundaryMode,
    gridSpec,
  });

  return {
    fingerprintHash: fnv1aHex(canonical),
    generatedAt: now,
    pageCount: source.pageCount,
    pageDimensionsPt,
    marginsPt,
    blockGeometry,
    fields,
    relationships,
    numberingSignatures,
    dataColumnNames,
    scalingMode: fit.scalingMode,
    boundaryMode: fit.boundaryMode,
    gridSpec,
  };
}

export function buildProfileFromProject(
  project: PDFProject,
  profileName?: string,
  description?: string
): TemplateAutomationProfile {
  const now = new Date().toISOString();
  const blockBoundaries = extractBlockBoundaries(project);

  const fieldMappings = project.elements
    .filter((e) => Boolean(e.fieldKey))
    .map((e) => ({
      elementId: e.id,
      label: e.text.slice(0, 32) || e.type,
      fieldKey: e.fieldKey!,
    }));

  const defaultFontFamily =
    project.elements.find((e) => e.fontFamily)?.fontFamily || 'Helvetica';

  const profile: TemplateAutomationProfile = {
    id: `prof-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: (profileName || `${project.name} Profile`).trim(),
    description: (
      description ||
      project.description ||
      `Automation profile for ${project.sourcePdfName}`
    ).trim(),
    createdAt: now,
    updatedAt: now,
    sourcePdfName: project.sourcePdfName,
    sourcePdfBase64: project.sourcePdfBase64,
    pageCount: project.pageCount,
    originalPages: structuredClone(project.originalPages),
    elements: structuredClone(project.elements),
    blockBoundaries,
    pageConfig: structuredClone(project.pageConfig),
    fitConfig: normalizeFitConfig(project),
    copiesConfig: structuredClone(project.copiesConfig),
    serialRules: structuredClone(project.serialRules),
    bulkConfig: structuredClone(project.bulkConfig),
    dataColumns: structuredClone(project.dataColumns),
    fieldMappings,
    fontSettings: {
      defaultFontFamily,
      embedFonts: project.exportConfig.embedFonts,
    },
    exportConfig: structuredClone(project.exportConfig),
    scanCorrectionRules: project.scanCorrectionRules
      ? structuredClone(project.scanCorrectionRules)
      : undefined,
  };
  profile.dna = computeTemplateDna(profile);
  return profile;
}

function scoreElementMatch(saved: DocumentElement, incoming: DocumentElement): number {
  if (saved.id === incoming.id) return 1000;
  if (saved.pageNumber !== incoming.pageNumber) return -1;
  let score = 0;
  if (saved.fieldKey && incoming.fieldKey && saved.fieldKey === incoming.fieldKey) {
    score += 500;
  }
  if (saved.type === incoming.type) {
    score += 120;
  }
  const sTxt = (saved.text || '').trim().toLowerCase();
  const iTxt = (incoming.text || '').trim().toLowerCase();
  if (sTxt && iTxt && sTxt === iTxt) {
    score += 200;
  } else if (sTxt && iTxt && (sTxt.includes(iTxt) || iTxt.includes(sTxt))) {
    score += 90;
  }
  const dist = Math.hypot(saved.x - incoming.x, saved.y - incoming.y);
  if (dist <= 6) score += 160;
  else if (dist <= 24) score += 100;
  else if (dist <= 72) score += 45;
  else if (dist > 220 && score < 200) return -1;
  return score;
}

export function compareTemplateDna(
  savedProfile: TemplateAutomationProfile,
  incomingProject: PDFProject
): TemplateDnaDiffReport {
  const savedDna = savedProfile.dna || computeTemplateDna(savedProfile);
  const incomingDna = computeTemplateDna(incomingProject);
  const differences: TemplateDnaDiffItem[] = [];
  const remappedFieldIds: TemplateDnaDiffReport['remappedFieldIds'] = [];

  // 1. Page dimensions check
  const dw = Math.abs(
    savedDna.pageDimensionsPt.width - incomingDna.pageDimensionsPt.width
  );
  const dh = Math.abs(
    savedDna.pageDimensionsPt.height - incomingDna.pageDimensionsPt.height
  );
  if (dw > 1 || dh > 1) {
    differences.push({
      id: 'diff-page-dims',
      category: 'page_dimensions',
      severity: 'warning',
      summary: 'Page dimensions changed',
      detail: `Saved ${savedDna.pageDimensionsPt.width.toFixed(1)}×${savedDna.pageDimensionsPt.height.toFixed(1)}pt -> Incoming ${incomingDna.pageDimensionsPt.width.toFixed(1)}×${incomingDna.pageDimensionsPt.height.toFixed(1)}pt`,
    });
  }

  // 2. Document block geometry check
  const incomingBlocks = extractBlockBoundaries(incomingProject);
  for (const sb of savedDna.blockGeometry) {
    const match = incomingBlocks.find(
      (ib) => ib.blockId === sb.blockId && ib.pageNumber === sb.pageNumber
    );
    if (!match) {
      differences.push({
        id: `diff-blk-miss-${sb.blockId}`,
        category: 'block_geometry',
        severity: 'warning',
        summary: `Block "${sb.blockId}" missing`,
        detail: `Page ${sb.pageNumber} repeated/document block was not detected in incoming PDF.`,
      });
    } else {
      const bdx = match.rect.x - sb.rect.x;
      const bdy = match.rect.y - sb.rect.y;
      const bdw = match.rect.width - sb.rect.width;
      const bdh = match.rect.height - sb.rect.height;
      if (Math.abs(bdx) > 1.5 || Math.abs(bdy) > 1.5 || Math.abs(bdw) > 1.5 || Math.abs(bdh) > 1.5) {
        differences.push({
          id: `diff-blk-geom-${sb.blockId}`,
          category: 'block_geometry',
          severity: 'info',
          summary: `Block "${sb.blockId}" geometry shifted`,
          detail: `Offset Δ(${bdx.toFixed(1)}, ${bdy.toFixed(1)})pt, size Δ(${bdw.toFixed(1)}, ${bdh.toFixed(1)})pt`,
          deltaXPt: bdx,
          deltaYPt: bdy,
        });
      }
    }
  }

  // 3. Element-level matching & diffing
  const savedEls = savedProfile.elements.filter((e) => e.visible);
  const incomingEls = incomingProject.elements.filter((e) => e.visible);
  const matchedIncomingIds = new Set<string>();

  for (const sEl of savedEls) {
    let bestEl: DocumentElement | null = null;
    let bestScore = 80;
    for (const iEl of incomingEls) {
      if (matchedIncomingIds.has(iEl.id)) continue;
      const sc = scoreElementMatch(sEl, iEl);
      if (sc > bestScore) {
        bestScore = sc;
        bestEl = iEl;
      }
    }

    if (!bestEl) {
      differences.push({
        id: `diff-miss-${sEl.id}`,
        category: 'missing_element',
        severity: sEl.fieldKey ? 'warning' : 'info',
        summary: `Missing ${sEl.type}: "${(sEl.text || sEl.id).slice(0, 26)}"`,
        detail: `Expected near (${Math.round(sEl.x)}, ${Math.round(sEl.y)})pt on Page ${sEl.pageNumber}`,
        savedElementId: sEl.id,
        fieldKey: sEl.fieldKey,
      });
      continue;
    }

    matchedIncomingIds.add(bestEl.id);

    // Record ID remapping if element maps to a profile field mapping
    const savedMapping = savedProfile.fieldMappings.find(
      (m) => m.elementId === sEl.id
    );
    if (savedMapping || sEl.fieldKey) {
      remappedFieldIds.push({
        oldElementId: sEl.id,
        newElementId: bestEl.id,
        fieldKey: savedMapping?.fieldKey || sEl.fieldKey!,
        label: savedMapping?.label || sEl.text.slice(0, 32) || sEl.type,
      });
    }

    const dx = Number((bestEl.x - sEl.x).toFixed(2));
    const dy = Number((bestEl.y - sEl.y).toFixed(2));
    if (Math.abs(dx) > 1.5 || Math.abs(dy) > 1.5) {
      differences.push({
        id: `diff-move-${sEl.id}`,
        category: 'moved_element',
        severity: 'info',
        summary: `Moved "${(bestEl.text || bestEl.type).slice(0, 24)}"`,
        detail: `Shifted ΔX ${dx >= 0 ? '+' : ''}${dx}pt, ΔY ${dy >= 0 ? '+' : ''}${dy}pt on Page ${bestEl.pageNumber}`,
        savedElementId: sEl.id,
        incomingElementId: bestEl.id,
        fieldKey: sEl.fieldKey,
        deltaXPt: dx,
        deltaYPt: dy,
      });
    }

    if (
      sEl.fontFamily !== bestEl.fontFamily ||
      Math.abs(sEl.fontSize - bestEl.fontSize) > 0.5 ||
      sEl.fontWeight !== bestEl.fontWeight
    ) {
      differences.push({
        id: `diff-font-${sEl.id}`,
        category: 'font_change',
        severity: 'info',
        summary: `Typography changed on "${(bestEl.text || bestEl.type).slice(0, 22)}"`,
        detail: `${sEl.fontFamily} ${sEl.fontSize}pt (${sEl.fontWeight}) -> ${bestEl.fontFamily} ${bestEl.fontSize}pt (${bestEl.fontWeight})`,
        savedElementId: sEl.id,
        incomingElementId: bestEl.id,
      });
    }

    if ((sEl.text || '').trim() !== (bestEl.text || '').trim()) {
      differences.push({
        id: `diff-txt-${sEl.id}`,
        category: 'changed_text',
        severity: 'info',
        summary: `Text updated (${sEl.fieldKey || sEl.type})`,
        detail: `"${(sEl.text || '').slice(0, 24)}" -> "${(bestEl.text || '').slice(0, 24)}"`,
        savedElementId: sEl.id,
        incomingElementId: bestEl.id,
        fieldKey: sEl.fieldKey,
      });
    }
  }

  for (const iEl of incomingEls) {
    if (!matchedIncomingIds.has(iEl.id)) {
      differences.push({
        id: `diff-add-${iEl.id}`,
        category: 'added_element',
        severity: 'info',
        summary: `New ${iEl.type}: "${(iEl.text || iEl.id).slice(0, 26)}"`,
        detail: `Detected at (${Math.round(iEl.x)}, ${Math.round(iEl.y)})pt on Page ${iEl.pageNumber}`,
        incomingElementId: iEl.id,
      });
    }
  }

  const totalCompared = Math.max(1, savedEls.length);
  const missingCount = differences.filter(
    (d) => d.category === 'missing_element'
  ).length;
  const movedCount = differences.filter(
    (d) => d.category === 'moved_element'
  ).length;
  const dimPenalty = dw > 1 || dh > 1 ? 12 : 0;
  const compatibilityScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        100 - (missingCount / totalCompared) * 65 - (movedCount / totalCompared) * 18 - dimPenalty
      )
    )
  );

  return {
    savedFingerprintHash: savedDna.fingerprintHash,
    incomingFingerprintHash: incomingDna.fingerprintHash,
    identicalGeometry: differences.length === 0,
    compatibilityScore,
    differences,
    remappedFieldIds,
  };
}

export function mergeTemplateProfileUpdate(
  savedProfile: TemplateAutomationProfile,
  incomingProject: PDFProject
): { updatedProfile: TemplateAutomationProfile; diffReport: TemplateDnaDiffReport } {
  const diffReport = compareTemplateDna(savedProfile, incomingProject);
  const now = new Date().toISOString();

  const remapByNewId = new Map(
    diffReport.remappedFieldIds.map((r) => [r.newElementId, r.fieldKey])
  );

  const updatedElements = incomingProject.elements.map((el) => {
    const preservedKey = remapByNewId.get(el.id);
    return preservedKey ? { ...el, fieldKey: preservedKey } : { ...el };
  });

  const nextMappings = diffReport.remappedFieldIds.map((r) => ({
    elementId: r.newElementId,
    label: r.label,
    fieldKey: r.fieldKey,
  }));

  // Keep any fieldMappings from incoming that already had new fieldKeys
  for (const el of updatedElements) {
    if (
      el.fieldKey &&
      !nextMappings.some((m) => m.elementId === el.id)
    ) {
      nextMappings.push({
        elementId: el.id,
        label: el.text.slice(0, 32) || el.type,
        fieldKey: el.fieldKey,
      });
    }
  }

  const updatedProfile: TemplateAutomationProfile = {
    ...savedProfile,
    updatedAt: now,
    sourcePdfName: incomingProject.sourcePdfName,
    sourcePdfBase64: incomingProject.sourcePdfBase64,
    pageCount: incomingProject.pageCount,
    originalPages: structuredClone(incomingProject.originalPages),
    elements: structuredClone(updatedElements),
    blockBoundaries: extractBlockBoundaries(incomingProject),
    pageConfig: structuredClone(incomingProject.pageConfig),
    // Preserve user automation rules & configuration!
    fitConfig: structuredClone(savedProfile.fitConfig),
    copiesConfig: structuredClone(savedProfile.copiesConfig),
    serialRules: structuredClone(savedProfile.serialRules),
    bulkConfig: structuredClone(savedProfile.bulkConfig),
    dataColumns: structuredClone(savedProfile.dataColumns),
    fieldMappings:
      nextMappings.length > 0
        ? nextMappings
        : structuredClone(savedProfile.fieldMappings),
    exportConfig: structuredClone(savedProfile.exportConfig),
    scanCorrectionRules:
      incomingProject.scanCorrectionRules || savedProfile.scanCorrectionRules
        ? structuredClone(
            incomingProject.scanCorrectionRules || savedProfile.scanCorrectionRules
          )
        : undefined,
  };
  updatedProfile.dna = computeTemplateDna(updatedProfile);
  return { updatedProfile, diffReport };
}

export function createProjectFromProfile(
  profile: TemplateAutomationProfile,
  customName?: string
): PDFProject {
  const now = new Date().toISOString();
  return {
    id: `proj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: customName?.trim() || `${profile.name} Run`,
    description: profile.description,
    version: 1,
    createdAt: now,
    updatedAt: now,
    sourcePdfName: profile.sourcePdfName,
    sourcePdfBase64: profile.sourcePdfBase64,
    pageCount: profile.pageCount,
    originalPages: structuredClone(profile.originalPages),
    elements: structuredClone(profile.elements),
    pageConfig: structuredClone(profile.pageConfig),
    fitConfig: structuredClone(profile.fitConfig),
    copiesConfig: structuredClone(profile.copiesConfig),
    serialRules: structuredClone(profile.serialRules),
    bulkConfig: structuredClone(profile.bulkConfig),
    dataColumns: structuredClone(profile.dataColumns),
    dataRows: [],
    exportConfig: structuredClone(profile.exportConfig),
    scanCorrectionRules: profile.scanCorrectionRules
      ? structuredClone(profile.scanCorrectionRules)
      : undefined,
    isTemplate: false,
    versions: [],
    operationLog: [
      {
        id: `op-${Date.now()}`,
        timestamp: now,
        action: 'Profile Applied',
        detail: `Initialized from automation profile "${profile.name}"`,
      },
    ],
  };
}

export function applyProfileSettingsToProject(
  project: PDFProject,
  profile: TemplateAutomationProfile
): PDFProject {
  const now = new Date().toISOString();
  const diff = compareTemplateDna(profile, project);
  const remapByNewId = new Map(
    diff.remappedFieldIds.map((r) => [r.newElementId, r.fieldKey])
  );
  const mappingByLabel = new Map(
    profile.fieldMappings.map((m) => [m.label.toLowerCase(), m.fieldKey])
  );
  const mappingById = new Map(
    profile.fieldMappings.map((m) => [m.elementId, m.fieldKey])
  );

  const updatedElements = project.elements.map((el) => {
    const mapped =
      remapByNewId.get(el.id) ||
      mappingById.get(el.id) ||
      mappingByLabel.get((el.text.slice(0, 32) || el.type).toLowerCase());
    return {
      ...el,
      fieldKey: mapped ?? el.fieldKey,
      fontFamily: el.fontFamily || profile.fontSettings.defaultFontFamily,
    };
  });

  return {
    ...project,
    elements: updatedElements,
    pageConfig: structuredClone(profile.pageConfig),
    fitConfig: structuredClone(profile.fitConfig),
    copiesConfig: structuredClone(profile.copiesConfig),
    serialRules: structuredClone(profile.serialRules),
    bulkConfig: structuredClone(profile.bulkConfig),
    dataColumns:
      profile.dataColumns.length > 0
        ? structuredClone(profile.dataColumns)
        : project.dataColumns,
    exportConfig: structuredClone(profile.exportConfig),
    scanCorrectionRules: profile.scanCorrectionRules
      ? structuredClone(profile.scanCorrectionRules)
      : project.scanCorrectionRules,
    updatedAt: now,
    operationLog: [
      {
        id: `op-${Date.now()}`,
        timestamp: now,
        action: 'Profile Applied',
        detail: `Applied automation rules from "${profile.name}" (${diff.remappedFieldIds.length} field mappings matched)`,
      },
      ...(project.operationLog || []),
    ].slice(0, 120),
  };
}
