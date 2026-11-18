import {
  PDFProject,
  RectPt,
  TemplateAutomationProfile,
} from '../types/pdfStudio';
import { normalizeFitConfig } from './geometryEngine';

export function buildProfileFromProject(
  project: PDFProject,
  profileName?: string,
  description?: string
): TemplateAutomationProfile {
  const now = new Date().toISOString();

  // Compute block boundaries from repeated_block elements or detectedBounds
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

  const fieldMappings = project.elements
    .filter((e) => Boolean(e.fieldKey))
    .map((e) => ({
      elementId: e.id,
      label: e.text.slice(0, 32) || e.type,
      fieldKey: e.fieldKey!,
    }));

  const defaultFontFamily =
    project.elements.find((e) => e.fontFamily)?.fontFamily || 'Helvetica';

  return {
    id: `prof-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: (profileName || `${project.name} Profile`).trim(),
    description:
      (description || project.description || `Automation profile for ${project.sourcePdfName}`).trim(),
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
  };
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
  const mappingByLabel = new Map(
    profile.fieldMappings.map((m) => [m.label.toLowerCase(), m.fieldKey])
  );
  const mappingById = new Map(
    profile.fieldMappings.map((m) => [m.elementId, m.fieldKey])
  );

  const updatedElements = project.elements.map((el) => {
    const mapped =
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
    updatedAt: now,
    operationLog: [
      {
        id: `op-${Date.now()}`,
        timestamp: now,
        action: 'Profile Applied',
        detail: `Applied automation rules from "${profile.name}"`,
      },
      ...(project.operationLog || []),
    ].slice(0, 120),
  };
}
