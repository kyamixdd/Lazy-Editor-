import React, { useMemo, useState } from 'react';
import { BookOpen, Search, ArrowRight, FilePlus2 } from 'lucide-react';
import { NavSection } from '../types/pdfStudio';
import { GlassButton, GlassCard } from './glass';

interface UserManualViewProps {
  onNavigate: (section: NavSection) => void;
}

const GUIDE = [
  {
    title: '1. Getting started',
    summary: 'Understand the workspace and create your first document.',
    steps: [
      'Open Dashboard to see your recent projects, favorites, and workspace activity.',
      'Choose New PDF Project to import a PDF or create a blank document or starter template.',
      'For an imported PDF, wait for the local scan to finish. Lazy Editor extracts text, page geometry, images, and other detectable objects in your browser.',
      'Choose Open in Editor to begin editing. Your project is saved in this browser profile.',
    ],
    tips: 'Keep an original copy of important PDFs. Complex scans and unusual fonts may need manual review after import.',
  },
  {
    title: '2. Dashboard & projects',
    summary: 'Create, open, organize, favorite, and remove documents.',
    steps: [
      'Use Dashboard to open a recent project or jump to a workspace.',
      'Use My Templates to browse saved projects, project versions, and reusable automation profiles.',
      'Mark frequently used projects as favorites for quicker access.',
      'Use Save Version / Snapshot before major edits so you can return to an earlier state.',
      'Restore a version from the project history when you need to roll back.',
    ],
    tips: 'Projects are currently stored in IndexedDB in the browser that created them. They do not automatically sync to another device or browser. Export or keep a backup of important source files.',
  },
  {
    title: '3. PDF Editor: canvas and selection',
    summary: 'Navigate pages and select document elements precisely.',
    steps: [
      'Open a project and choose the Select tool to select an element on the page.',
      'Drag an element to reposition it. Use the selection handles to resize; use the rotation control when available.',
      'Use Shift or multi-select controls to select multiple elements, then align, distribute, group, or batch-edit them.',
      'Use the page navigation and zoom controls to move between pages and inspect details.',
      'Use the Layers panel to select, reorder, hide, lock, and organize objects.',
    ],
    tips: 'Locked objects are protected from ordinary editing and AI edit operations. Unlock an object intentionally before changing it.',
  },
  {
    title: '4. Add and edit content',
    summary: 'Work with text, images, shapes, tables, annotations, and reusable assets.',
    steps: [
      'Choose Add Text and click the page to create a text element. Edit its content and typography in the Properties Inspector.',
      'Use Rectangle, Circle, Line, Arrow, and Table tools to create vector objects and structured content.',
      'Use Upload Image or Asset Library to insert logos and images. Keep image proportions in mind when resizing.',
      'Use Draw, Highlight, Underline, Strikeout, Note, Callout, Stamp, and Signature tools for mark-up and review.',
      'Use the Properties Inspector to adjust position, size, rotation, colors, borders, opacity, font, and alignment.',
      'Use copy/paste, duplicate, group, lock, arrange, and alignment tools to speed up layout work.',
    ],
    tips: 'Some PDF content is flattened into page artwork rather than independent objects. If a text item cannot be selected, it may need OCR/reconstruction or a new overlay element.',
  },
  {
    title: '5. AI Assistant',
    summary: 'Configure Gemini and use AI-assisted analysis and editing.',
    steps: [
      'Open Settings > AI & Gemini and paste your Google Gemini API key.',
      'Select Verify & Save Key. A successful validation saves the key in this browser profile.',
      'Open a project and use the AI tab in the Properties Inspector to enter an instruction, such as aligning selected amounts or changing a heading style.',
      'Review the proposed operations. Confirm multi-element, delete, duplicate, or significant layout changes before applying them.',
      'Use AI-Enhanced Analysis after the local scan to enrich semantic labels, relationships, and detected document elements.',
    ],
    tips: 'AI use sends document content and your key to the Lazy Editor server and Google Gemini over HTTPS. Your key is not stored by the server, but it is stored in this browser local storage. Anyone with access to this browser profile may be able to use it. AI requests use your Google quota and may be billable. Never put the key in a document or share it.',
  },
  {
    title: '6. Scan Inspector',
    summary: 'Review extracted structure and scan quality before editing.',
    steps: [
      'Open Scan Inspector for the active project to review extracted text, detected objects, page structure, and confidence values.',
      'Review low-confidence or flagged elements before relying on them for production.',
      'Use the inspect action to jump to an element in the Editor.',
      'If the source is image-only, use OCR where available and verify the recognized text against the original page.',
    ],
    tips: 'OCR and automated detection can misread small, rotated, low-contrast, or handwritten text. Always proofread critical values such as serial numbers and totals.',
  },
  {
    title: '7. Templates & Blueprint Studio',
    summary: 'Build reusable layouts and production blueprints.',
    steps: [
      'Use My Templates to manage projects and saved template automation profiles.',
      'Create or save a profile when a document layout and its page/fit settings should be reused.',
      'Open Blueprint Studio to define production sheet layouts and reusable print configuration.',
      'Apply a saved profile to an active project or run it to create a new project from the profile.',
    ],
    tips: 'A profile stores layout/configuration choices; it does not replace a backup of the underlying source PDF or linked external data.',
  },
  {
    title: '8. Data Manager & Bulk Generator',
    summary: 'Prepare variable data, serial numbering, and repeated copies.',
    steps: [
      'Open Data Manager with a project loaded and import a CSV or Excel data source.',
      'Check column names and sample rows before mapping fields to document elements.',
      'Use field keys on elements to map data columns to text, numbers, and other supported variable fields.',
      'Open Bulk Generator to configure repeated copies, serial ranges, or repeated blocks.',
      'Preview a small sample before generating a large batch. Verify the first, middle, and last records.',
    ],
    tips: 'Keep a clean source spreadsheet with unique headers. Confirm start/end values and leading zeros for serial-number jobs.',
  },
  {
    title: '9. Preflight QC & Compare PDFs',
    summary: 'Find production issues and compare original and edited documents.',
    steps: [
      'Run Preflight QC before export to review missing or out-of-bounds elements, fonts, image quality, and other detected issues.',
      'Open each warning and inspect the affected element. Fix critical problems before printing.',
      'Use Compare PDFs to inspect the original and edited result side by side.',
      'Re-run preflight after the final changes rather than relying on an earlier report.',
    ],
    tips: 'Preflight is an automated inspection aid, not a guarantee of print-shop acceptance or PDF standard certification.',
  },
  {
    title: '10. Export Center & Batch Center',
    summary: 'Create final PDFs and manage queued production jobs.',
    steps: [
      'Open Export Center with the correct project active.',
      'Choose the required export mode and page range, then review naming and output options.',
      'Use preflight checks and inspect the output preview before downloading.',
      'For multiple jobs, enqueue exports and use Batch Center to review progress, checkpoints, retry, and download completed output.',
      'Open downloaded PDFs in an independent viewer and check page count, dimensions, text, images, and print margins.',
    ],
    tips: 'Keep the downloaded export as the deliverable. Batch output stored in this browser may not be available from another device.',
  },
  {
    title: '11. Asset Library',
    summary: 'Reuse fonts, images, logos, shapes, palettes, and text styles.',
    steps: [
      'Open Asset Library to add or manage reusable resources.',
      'Upload supported image/font files and provide a clear name so they can be found later.',
      'Save frequently used shapes, text styles, and color palettes where those asset types are supported.',
      'Insert an asset into an active project and adjust its placement in the Editor.',
      'Remove obsolete assets from the library when they are no longer needed.',
    ],
    tips: 'Use fonts that you are licensed to embed and distribute. Check font embedding and substitution in the exported PDF.',
  },
  {
    title: '12. Workflow Studio & PDF Utilities',
    summary: 'Automate repeatable work and run document maintenance tasks.',
    steps: [
      'Use Workflow Studio to create and save a sequence of supported project, preflight, and export actions.',
      'Choose the intended project and profile inputs before running a workflow.',
      'Monitor the workflow status. Pause or cancel a running job when the control is available.',
      'Use PDF Utilities for supported metadata, split/merge, form, and document maintenance operations.',
      'Review the result file after every utility operation; keep the original source unchanged until the result is verified.',
    ],
    tips: 'Metadata tagging is not the same as full PDF/A conversion or certification. Verify standards compliance with a dedicated validator when required.',
  },
  {
    title: '13. Settings, shortcuts & appearance',
    summary: 'Customize the workspace and manage local preferences.',
    steps: [
      'Choose dark, light, or system theme and set the default measurement unit and page size.',
      'Adjust sidebar/panel widths, grid size, snapping, rulers, and toolbar visibility.',
      'Customize favorite tools and keyboard shortcuts. Use Reset Defaults if a shortcut mapping becomes confusing.',
      'Set the auto-snapshot interval to create recovery points while editing.',
      'Use Settings > AI & Gemini to validate, replace, or remove your Gemini API key.',
    ],
    tips: 'Settings and the Gemini key are local to the browser profile. Clearing browser site data may remove them.',
  },
  {
    title: '14. Saving, privacy & troubleshooting',
    summary: 'Understand where data lives and how to recover from common problems.',
    steps: [
      'Wait for the save indicator to confirm that a project has been stored before closing the tab.',
      'If the app shows a recoverable draft banner, choose Restore Draft to reopen it or dismiss it only when you no longer need it.',
      'If an AI request fails, verify the API key, network connection, model availability, and Google AI Studio quota.',
      'If a PDF fails to import, try a smaller or re-saved copy and check whether it is password-protected or damaged.',
      'If an export looks different from the editor, inspect fonts, transparency, unsupported source objects, page bounds, and the PDF in another viewer.',
      'For important production work, retain the original PDF, source data file, and final exported PDF.',
    ],
    tips: 'Lazy Editor currently provides browser-local project storage and does not provide account sign-in or cross-device cloud synchronization. Do not use a shared/public computer for sensitive documents or API keys.',
  },
];

export const UserManualView: React.FC<UserManualViewProps> = ({ onNavigate }) => {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return GUIDE;
    return GUIDE.filter((section) =>
      [section.title, section.summary, ...section.steps, section.tips]
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }, [query]);

  return (
    <div className="flex-1 overflow-y-auto p-4 tablet:p-6 desktop:p-8 max-w-5xl mx-auto w-full space-y-5">
      <header className="pb-4 border-b border-black/10 dark:border-white/12">
        <div className="flex items-center gap-2">
          <BookOpen className="w-5 h-5" />
          <h1 className="text-xl tablet:text-2xl font-display font-semibold text-[#101010] dark:text-white">Lazy Editor User Manual</h1>
        </div>
        <p className="mt-2 text-sm text-[#555555] dark:text-[#B5B5B5]">
          A practical guide to importing, editing, checking, automating, and exporting PDF documents.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <GlassButton variant="primary" size="md" onClick={() => onNavigate('new-project')}>
            <FilePlus2 className="w-3.5 h-3.5" /> Create a project
          </GlassButton>
          <GlassButton variant="glass" size="md" onClick={() => onNavigate('settings')}>
            Open Settings <ArrowRight className="w-3.5 h-3.5" />
          </GlassButton>
        </div>
      </header>

      <label className="block relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#888888]" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the manual: export, serial numbers, Gemini, shortcuts…" className="w-full min-h-[44px] pl-10 pr-3 py-2 rounded-xl border studio-select text-sm" />
      </label>

      <div className="space-y-3">
        {filtered.map((section) => (
          <details key={section.title} className="group rounded-2xl border border-black/10 dark:border-white/12 glass-level-2" open={Boolean(query)}>
            <summary className="cursor-pointer list-none p-4 flex items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-[#101010] dark:text-white">{section.title}</span>
                <span className="block mt-1 text-xs text-[#555555] dark:text-[#B5B5B5]">{section.summary}</span>
              </span>
              <span className="text-xs text-[#777777] group-open:rotate-90 transition-transform">›</span>
            </summary>
            <div className="px-4 pb-4 space-y-3">
              <ol className="list-decimal pl-5 space-y-2 text-xs leading-relaxed text-[#444444] dark:text-[#C8C8C8]">
                {section.steps.map((step, index) => <li key={index}>{step}</li>)}
              </ol>
              <div className="rounded-xl border border-black/10 dark:border-white/12 p-3 text-xs leading-relaxed text-[#555555] dark:text-[#B5B5B5]">
                <strong className="text-[#101010] dark:text-white">Tip: </strong>{section.tips}
              </div>
            </div>
          </details>
        ))}
        {filtered.length === 0 && (
          <GlassCard level={2} padding="md">
            <p className="text-sm font-medium text-[#101010] dark:text-white">No matching guide sections</p>
            <p className="mt-1 text-xs text-[#555555] dark:text-[#B5B5B5]">Try another term, such as “PDF”, “Gemini”, “batch”, or “shortcut”.</p>
          </GlassCard>
        )}
      </div>
      <p className="text-[11px] text-[#888888] dark:text-[#858585]">The manual describes the current application workflows. Individual PDF files and advanced layouts can behave differently depending on their structure, embedded fonts, and security restrictions.</p>
    </div>
  );
};
