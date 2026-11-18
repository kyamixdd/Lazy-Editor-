import {
  AssetLibraryItem,
  BatchJob,
  CustomPaperPreset,
  DocumentOperationLog,
  PDFProject,
  ShortcutActionId,
  StudioSettings,
  TemplateAutomationProfile,
  UnsavedDraftRecord,
} from '../types/pdfStudio';

const DB_NAME = 'pdf_studio_ai_db';
const DB_VERSION = 2;
const STORE_PROJECTS = 'projects';
const STORE_DRAFTS = 'drafts';
const STORE_ASSETS = 'assets';
const STORE_PROFILES = 'template_profiles';
const STORE_BATCH_JOBS = 'batch_jobs';

const SETTINGS_KEY = 'pdf_studio_ai_settings_v1';
const ACTIVE_PROJECT_KEY = 'pdf_studio_ai_active_project_id';
const CUSTOM_PAPER_PRESETS_KEY = 'pdf_studio_ai_custom_paper_presets_v1';

export const DEFAULT_SHORTCUTS: Record<ShortcutActionId, string> = {
  undo: 'Ctrl+Z',
  redo: 'Ctrl+Y',
  copy: 'Ctrl+C',
  paste: 'Ctrl+V',
  duplicate: 'Ctrl+D',
  delete: 'Delete',
  group: 'Ctrl+G',
  lock: 'Ctrl+L',
  selectAll: 'Ctrl+A',
  zoomIn: 'Ctrl+=',
  zoomOut: 'Ctrl+-',
  saveSnapshot: 'Ctrl+S',
  nudgeUp: 'ArrowUp',
  nudgeDown: 'ArrowDown',
  nudgeLeft: 'ArrowLeft',
  nudgeRight: 'ArrowRight',
};

export const DEFAULT_SETTINGS: StudioSettings = {
  theme: 'dark',
  defaultUnit: 'mm',
  defaultPagePreset: 'A4',
  gridSizePt: 10,
  snapThresholdPt: 6,
  snapToObjects: true,
  duplicateOffsetXPt: 14,
  duplicateOffsetYPt: 14,
  showRulersByDefault: true,
  showGridByDefault: false,
  ocrLanguage: 'eng',
  autoRunQcBeforeExport: true,
  workspaceLayout: 'standard',
  navSidebarWidthPx: 240,
  layersPanelWidthPx: 224,
  inspectorWidthPx: 320,
  hiddenEditorTools: [],
  recentTools: ['text', 'rect', 'line', 'table'],
  recentFonts: ['Helvetica', 'Times-Roman', 'Courier'],
  favoriteFonts: ['Helvetica', 'Plus Jakarta Sans'],
  shortcuts: DEFAULT_SHORTCUTS,
  autoSnapshotIntervalSec: 120,
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_DRAFTS)) {
        db.createObjectStore(STORE_DRAFTS, { keyPath: 'projectId' });
      }
      if (!db.objectStoreNames.contains(STORE_ASSETS)) {
        db.createObjectStore(STORE_ASSETS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_PROFILES)) {
        db.createObjectStore(STORE_PROFILES, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_BATCH_JOBS)) {
        db.createObjectStore(STORE_BATCH_JOBS, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function listProjectsLocal(): Promise<PDFProject[]> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PROJECTS, 'readonly');
      const store = tx.objectStore(STORE_PROJECTS);
      const req = store.getAll();
      req.onsuccess = () => {
        const items = (req.result as PDFProject[]) || [];
        items.sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
        resolve(items);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error('IndexedDB list error:', err);
    return [];
  }
}

export async function getProjectLocal(id: string): Promise<PDFProject | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PROJECTS, 'readonly');
      const req = tx.objectStore(STORE_PROJECTS).get(id);
      req.onsuccess = () => resolve((req.result as PDFProject) || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function saveProjectLocal(project: PDFProject): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECTS, 'readwrite');
    tx.objectStore(STORE_PROJECTS).put(project);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  // Sync lightweight project metadata + JSON layout to server persistence
  try {
    const payload = {
      ...project,
      originalPages: project.originalPages.map((p) => ({
        pageNumber: p.pageNumber,
        sourcePdfPageNumber: p.sourcePdfPageNumber,
        widthPt: p.widthPt,
        heightPt: p.heightPt,
        orientation: p.orientation,
      })),
      sourcePdfBase64: undefined,
    };
    await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    // Offline or server sync fallback silently continues with IndexedDB
  }
}

export async function deleteProjectLocal(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_PROJECTS, STORE_DRAFTS], 'readwrite');
    tx.objectStore(STORE_PROJECTS).delete(id);
    tx.objectStore(STORE_DRAFTS).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  try {
    await fetch(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch {
    // Ignore network errors on local delete
  }
}

export async function clearAllProjectsLocal(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_PROJECTS, STORE_DRAFTS], 'readwrite');
    tx.objectStore(STORE_PROJECTS).clear();
    tx.objectStore(STORE_DRAFTS).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- Unsaved Drafts (Module 4) ---
export async function saveUnsavedDraft(
  draft: UnsavedDraftRecord
): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_DRAFTS, 'readwrite');
      tx.objectStore(STORE_DRAFTS).put(draft);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore draft errors
  }
}

export async function listUnsavedDrafts(): Promise<UnsavedDraftRecord[]> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_DRAFTS, 'readonly');
      const req = tx.objectStore(STORE_DRAFTS).getAll();
      req.onsuccess = () =>
        resolve(((req.result as UnsavedDraftRecord[]) || []).filter((d) => d.dirty));
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function clearUnsavedDraft(projectId: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_DRAFTS, 'readwrite');
      tx.objectStore(STORE_DRAFTS).delete(projectId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore
  }
}

// --- Template Automation Profiles (Module 3) ---
export async function listTemplateProfiles(): Promise<
  TemplateAutomationProfile[]
> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PROFILES, 'readonly');
      const req = tx.objectStore(STORE_PROFILES).getAll();
      req.onsuccess = () => {
        const items = (req.result as TemplateAutomationProfile[]) || [];
        items.sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
        resolve(items);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function saveTemplateProfile(
  profile: TemplateAutomationProfile
): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_PROFILES, 'readwrite');
    tx.objectStore(STORE_PROFILES).put(profile);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteTemplateProfile(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_PROFILES, 'readwrite');
    tx.objectStore(STORE_PROFILES).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- Asset & Font Library (Module 8) ---
export async function listAssets(): Promise<AssetLibraryItem[]> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_ASSETS, 'readonly');
      const req = tx.objectStore(STORE_ASSETS).getAll();
      req.onsuccess = () => {
        const items = (req.result as AssetLibraryItem[]) || [];
        items.sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        resolve(items);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function saveAsset(asset: AssetLibraryItem): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_ASSETS, 'readwrite');
    tx.objectStore(STORE_ASSETS).put(asset);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteAsset(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_ASSETS, 'readwrite');
    tx.objectStore(STORE_ASSETS).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- Batch Jobs & History (Module 7) ---
export async function listBatchJobs(): Promise<BatchJob[]> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_BATCH_JOBS, 'readonly');
      const req = tx.objectStore(STORE_BATCH_JOBS).getAll();
      req.onsuccess = () => {
        const items = (req.result as BatchJob[]) || [];
        items.sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        resolve(items);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function saveBatchJob(job: BatchJob): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_BATCH_JOBS, 'readwrite');
      tx.objectStore(STORE_BATCH_JOBS).put(job);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore storage quota issues
  }
}

export async function deleteBatchJob(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_BATCH_JOBS, 'readwrite');
    tx.objectStore(STORE_BATCH_JOBS).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearBatchHistory(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_BATCH_JOBS, 'readwrite');
    tx.objectStore(STORE_BATCH_JOBS).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function appendOperationLog(
  project: PDFProject,
  action: string,
  detail: string,
  pageNumber?: number
): PDFProject {
  const entry: DocumentOperationLog = {
    id: `op-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    timestamp: new Date().toISOString(),
    action,
    detail,
    pageNumber,
  };
  const existing = project.operationLog || [];
  return {
    ...project,
    operationLog: [entry, ...existing].slice(0, 120),
  };
}

export function loadSettings(): StudioSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<StudioSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      shortcuts: {
        ...DEFAULT_SHORTCUTS,
        ...(parsed.shortcuts || {}),
      },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: StudioSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function getActiveProjectId(): string | null {
  return localStorage.getItem(ACTIVE_PROJECT_KEY);
}

export function setActiveProjectId(id: string | null): void {
  if (id) {
    localStorage.setItem(ACTIVE_PROJECT_KEY, id);
  } else {
    localStorage.removeItem(ACTIVE_PROJECT_KEY);
  }
}

export function loadCustomPaperPresets(): CustomPaperPreset[] {
  try {
    const raw = localStorage.getItem(CUSTOM_PAPER_PRESETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CustomPaperPreset[]) : [];
  } catch {
    return [];
  }
}

export function saveCustomPaperPresets(presets: CustomPaperPreset[]): void {
  try {
    localStorage.setItem(CUSTOM_PAPER_PRESETS_KEY, JSON.stringify(presets));
  } catch {
    // Ignore storage quota errors in restricted/headless contexts
  }
}

export function upsertCustomPaperPreset(
  preset: CustomPaperPreset
): CustomPaperPreset[] {
  const existing = loadCustomPaperPresets();
  const idx = existing.findIndex((p) => p.id === preset.id);
  const next =
    idx >= 0
      ? existing.map((p) => (p.id === preset.id ? preset : p))
      : [preset, ...existing];
  saveCustomPaperPresets(next);
  return next;
}

export function renameCustomPaperPreset(
  id: string,
  newName: string
): CustomPaperPreset[] {
  const clean = newName.trim();
  const existing = loadCustomPaperPresets();
  if (!clean) return existing;
  const next = existing.map((p) =>
    p.id === id
      ? { ...p, name: clean, updatedAt: new Date().toISOString() }
      : p
  );
  saveCustomPaperPresets(next);
  return next;
}

export function duplicateCustomPaperPreset(id: string): CustomPaperPreset[] {
  const existing = loadCustomPaperPresets();
  const src = existing.find((p) => p.id === id);
  if (!src) return existing;
  const now = new Date().toISOString();
  const copy: CustomPaperPreset = {
    ...structuredClone(src),
    id: `paper-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: `${src.name} (Copy)`,
    createdAt: now,
    updatedAt: now,
  };
  const next = [copy, ...existing];
  saveCustomPaperPresets(next);
  return next;
}

export function deleteCustomPaperPreset(id: string): CustomPaperPreset[] {
  const existing = loadCustomPaperPresets();
  const next = existing.filter((p) => p.id !== id);
  saveCustomPaperPresets(next);
  return next;
}

export interface StorageUsageInfo {
  usedBytes: number;
  quotaBytes: number | null;
  projectsBytes: number;
  formattedUsed: string;
  formattedQuota: string | null;
  percentUsed: number | null;
}

export function formatBytesCompact(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export async function estimateStorageUsage(
  projects: PDFProject[]
): Promise<StorageUsageInfo> {
  let projectsBytes = 0;
  for (const p of projects) {
    projectsBytes += (p.sourcePdfBase64?.length || 0) + (p.name?.length || 0) * 2;
    for (const pg of p.originalPages || []) {
      projectsBytes += pg.previewImageDataUrl?.length || 0;
    }
    projectsBytes += (p.elements?.length || 0) * 320;
  }

  let usedBytes = projectsBytes;
  let quotaBytes: number | null = null;

  if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
    try {
      const est = await navigator.storage.estimate();
      if (typeof est.usage === 'number') {
        usedBytes = Math.max(projectsBytes, est.usage);
      }
      if (typeof est.quota === 'number' && est.quota > 0) {
        quotaBytes = est.quota;
      }
    } catch {
      // Fallback to computed project payload size
    }
  }

  return {
    usedBytes,
    quotaBytes,
    projectsBytes,
    formattedUsed: formatBytesCompact(usedBytes),
    formattedQuota: quotaBytes ? formatBytesCompact(quotaBytes) : null,
    percentUsed:
      quotaBytes && quotaBytes > 0
        ? Math.min(100, Math.round((usedBytes / quotaBytes) * 100))
        : null,
  };
}
