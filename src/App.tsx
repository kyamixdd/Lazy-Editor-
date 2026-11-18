import { useEffect, useState } from 'react';
import { BulkGeneratorView } from './components/BulkGeneratorView';
import { DashboardView } from './components/DashboardView';
import { DataManagerView } from './components/DataManagerView';
import { EditorView } from './components/EditorView';
import { ExportCenterView } from './components/ExportCenterView';
import { NewProjectView } from './components/NewProjectView';
import { SettingsView } from './components/SettingsView';
import { SidebarNav } from './components/SidebarNav';
import { TemplatesView } from './components/TemplatesView';
import { NavSection, PDFProject, StudioSettings } from './types/pdfStudio';
import {
  clearAllProjectsLocal,
  deleteProjectLocal,
  getActiveProjectId,
  listProjectsLocal,
  loadSettings,
  saveProjectLocal,
  saveSettings,
  setActiveProjectId,
} from './utils/projectStorage';

export default function App() {
  const [settings, setSettings] = useState<StudioSettings>(() => loadSettings());
  const [activeSection, setActiveSection] = useState<NavSection>('dashboard');
  const [projects, setProjects] = useState<PDFProject[]>([]);
  const [activeProjectId, setActiveProjIdState] = useState<string | null>(() =>
    getActiveProjectId()
  );

  // Sync Tailwind dark mode class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    saveSettings(settings);
  }, [settings]);

  // Load saved projects from IndexedDB once on boot
  useEffect(() => {
    void listProjectsLocal().then((items) => {
      setProjects(items);
      const savedActiveId = getActiveProjectId();
      if (savedActiveId && !items.some((p) => p.id === savedActiveId)) {
        const firstId = items[0]?.id || null;
        setActiveProjIdState(firstId);
        setActiveProjectId(firstId);
      }
    });
  }, []);

  const activeProject =
    projects.find((p) => p.id === activeProjectId) || null;

  const handleSaveProject = (updated: PDFProject) => {
    setProjects((prev) => {
      const exists = prev.some((p) => p.id === updated.id);
      if (exists) {
        return prev.map((p) => (p.id === updated.id ? updated : p));
      }
      return [updated, ...prev];
    });
    void saveProjectLocal(updated);
  };

  const handleProjectCreated = (
    project: PDFProject,
    openImmediately: boolean
  ) => {
    handleSaveProject(project);
    setActiveProjIdState(project.id);
    setActiveProjectId(project.id);
    if (openImmediately) {
      setActiveSection('editor');
    }
  };

  const handleOpenProject = (project: PDFProject) => {
    setActiveProjIdState(project.id);
    setActiveProjectId(project.id);
  };

  const handleCloseProject = () => {
    setActiveProjIdState(null);
    setActiveProjectId(null);
    if (
      activeSection === 'editor' ||
      activeSection === 'bulk-generator' ||
      activeSection === 'data-manager' ||
      activeSection === 'export-center'
    ) {
      setActiveSection('dashboard');
    }
  };

  const handleDeleteProject = (id: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== id));
    if (activeProjectId === id) {
      handleCloseProject();
    }
    void deleteProjectLocal(id);
  };

  const handleSaveSnapshot = (project: PDFProject, note: string) => {
    const now = new Date().toISOString();
    const updated: PDFProject = {
      ...project,
      version: project.version + 1,
      updatedAt: now,
      versions: [
        {
          version: project.version,
          savedAt: now,
          note,
          elementsSnapshot: structuredClone(project.elements),
          pageConfigSnapshot: structuredClone(project.pageConfig),
        },
        ...(project.versions || []),
      ],
    };
    handleSaveProject(updated);
  };

  const handleClearWorkspace = () => {
    void clearAllProjectsLocal().then(() => {
      setProjects([]);
      setActiveProjIdState(null);
      setActiveProjectId(null);
      setActiveSection('dashboard');
    });
  };

  return (
    <div className="min-h-[100dvh] flex flex-col tablet:flex-row bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100">
      <SidebarNav
        activeSection={activeSection}
        onSelectSection={setActiveSection}
        activeProject={activeProject}
        onCloseProject={handleCloseProject}
        theme={settings.theme}
        onToggleTheme={() =>
          setSettings((s) => ({
            ...s,
            theme: s.theme === 'dark' ? 'light' : 'dark',
          }))
        }
      />

      <main
        className={`flex-1 flex flex-col min-w-0 ${
          activeSection === 'editor'
            ? 'h-[calc(100dvh-52px)] tablet:h-[100dvh] overflow-hidden'
            : 'min-h-[calc(100dvh-52px)] tablet:min-h-screen pb-16 tablet:pb-0'
        }`}
      >
        {activeSection === 'dashboard' && (
          <DashboardView
            projects={projects}
            activeProject={activeProject}
            onNavigate={setActiveSection}
            onOpenProject={handleOpenProject}
            onDeleteProject={handleDeleteProject}
          />
        )}

        {activeSection === 'new-project' && (
          <NewProjectView
            settings={settings}
            onProjectCreated={handleProjectCreated}
          />
        )}

        {activeSection === 'templates' && (
          <TemplatesView
            projects={projects}
            activeProject={activeProject}
            onOpenProject={handleOpenProject}
            onSaveProject={handleSaveProject}
            onDeleteProject={handleDeleteProject}
            onNavigate={setActiveSection}
          />
        )}

        {activeSection === 'editor' && activeProject && (
          <EditorView
            project={activeProject}
            settings={settings}
            onUpdateProject={handleSaveProject}
            onSaveSnapshot={handleSaveSnapshot}
          />
        )}

        {activeSection === 'bulk-generator' && activeProject && (
          <BulkGeneratorView
            project={activeProject}
            onUpdateProject={handleSaveProject}
            onGoToExport={() => setActiveSection('export-center')}
          />
        )}

        {activeSection === 'data-manager' && activeProject && (
          <DataManagerView
            project={activeProject}
            onUpdateProject={handleSaveProject}
          />
        )}

        {activeSection === 'export-center' && activeProject && (
          <ExportCenterView
            project={activeProject}
            onUpdateProject={handleSaveProject}
            onJumpToEditor={() => setActiveSection('editor')}
            onReopenAsProject={(proj) => handleProjectCreated(proj, true)}
          />
        )}

        {activeSection === 'settings' && (
          <SettingsView
            settings={settings}
            onUpdateSettings={setSettings}
            onClearWorkspace={handleClearWorkspace}
          />
        )}
      </main>
    </div>
  );
}
