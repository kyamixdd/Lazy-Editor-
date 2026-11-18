import React, { useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  Code2,
  ExternalLink,
  FileText,
  Globe,
  Layers,
  Mail,
  Scale,
  Shield,
  Sparkles,
  User,
} from 'lucide-react';
import {
  APP_COPYRIGHT_YEAR,
  APP_PRODUCT_NAME,
  APP_SUITE_NAME,
  APP_VERSION,
  DEVELOPER_PROFILE,
  DeveloperSocialLink,
  OPEN_SOURCE_LICENSES,
  PRODUCT_INFO,
} from '../config/appInfo';
import { NavSection } from '../types/pdfStudio';
import { BrandMark } from './BrandMark';
import { GlassButton, GlassCard, GlassSegmentedControl } from './glass';

interface AboutViewProps {
  onNavigate?: (section: NavSection) => void;
}

type InfoTab = 'privacy' | 'terms' | 'licenses' | 'support';

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'LE';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function renderSocialBadgeLabel(id: DeveloperSocialLink['id']): string {
  if (id === 'facebook') return 'FB';
  if (id === 'instagram') return 'IG';
  if (id === 'github') return 'GH';
  return 'WEB';
}

export const AboutView: React.FC<AboutViewProps> = ({ onNavigate }) => {
  const [activeInfoTab, setActiveInfoTab] = useState<InfoTab>('privacy');

  const dev = DEVELOPER_PROFILE;
  const visibleSocials = (dev.socialLinks || []).filter(
    (s) => Boolean(s.url?.trim()) && Boolean(s.label?.trim())
  );
  const hasBio = Boolean(dev.biography?.trim());
  const hasTitle = Boolean(dev.title?.trim());
  const hasOwnership = Boolean(dev.ownershipStatement?.trim());
  const hasEmail = Boolean(dev.email?.trim());

  return (
    <div className="flex-1 overflow-y-auto p-4 tablet:p-6 desktop:p-8 max-w-6xl mx-auto w-full space-y-5 tablet:space-y-6">
      {/* Header */}
      <div className="flex flex-col tablet:flex-row tablet:items-center justify-between gap-4 pb-5 border-b border-slate-200/70 dark:border-white/10">
        <div className="flex items-center gap-3.5 min-w-0">
          <BrandMark size="lg" />
          <div className="min-w-0">
            <div className="text-xs font-medium text-blue-600 dark:text-blue-400">
              {APP_SUITE_NAME} · Version {APP_VERSION}
            </div>
            <h1 className="mt-0.5 text-xl tablet:text-2xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              About {APP_PRODUCT_NAME}
            </h1>
            <p className="mt-0.5 text-xs tablet:text-sm text-slate-600 dark:text-slate-400">
              Independent document customization, imposition, and bulk PDF production software.
            </p>
          </div>
        </div>

        {onNavigate && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <GlassButton
              variant="glass"
              size="md"
              onClick={() => onNavigate('settings')}
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Settings
            </GlassButton>
            <GlassButton
              variant="primary"
              size="md"
              onClick={() => onNavigate('dashboard')}
            >
              Open Workspace
            </GlassButton>
          </div>
        )}
      </div>

      {/* Primary Two-Column Layout: Product Overview + Developer Profile */}
      <div className="grid grid-cols-1 desktop:grid-cols-12 gap-4 tablet:gap-5 items-stretch">
        {/* Left: About Lazy Editor Studio */}
        <GlassCard
          level={3}
          padding="lg"
          className="desktop:col-span-7 flex flex-col justify-between gap-5"
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-base tablet:text-lg font-display font-semibold text-slate-900 dark:text-slate-100">
                  {PRODUCT_INFO.name}
                </h2>
                <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                  {PRODUCT_INFO.suiteName} · Release v{PRODUCT_INFO.version}
                </div>
              </div>
              <div className="text-xs font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                v{PRODUCT_INFO.version}
              </div>
            </div>

            <p className="text-xs tablet:text-sm leading-relaxed text-slate-700 dark:text-slate-300">
              {PRODUCT_INFO.description}
            </p>

            {/* Mission */}
            <div className="pt-3 border-t border-slate-200/70 dark:border-white/10">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                Product Mission
              </div>
              <p className="mt-1 text-xs tablet:text-sm font-medium text-slate-900 dark:text-slate-100 leading-relaxed">
                {PRODUCT_INFO.mission}
              </p>
            </div>

            {/* Capabilities */}
            <div className="pt-3 border-t border-slate-200/70 dark:border-white/10 space-y-2.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Core Capabilities
              </div>
              <div className="grid grid-cols-1 tablet:grid-cols-2 gap-3">
                {PRODUCT_INFO.capabilities.map((cap) => (
                  <div
                    key={cap.title}
                    className="flex items-start gap-2.5 text-xs"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        {cap.title}
                      </div>
                      <p className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                        {cap.detail}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="pt-3.5 border-t border-slate-200/70 dark:border-white/10 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            <span>
              © {APP_COPYRIGHT_YEAR} {dev.name} · {APP_PRODUCT_NAME}
            </span>
            <span>All rights reserved</span>
          </div>
        </GlassCard>

        {/* Right: Developer Profile Card */}
        <GlassCard
          level={3}
          padding="lg"
          className="desktop:col-span-5 flex flex-col justify-between gap-5"
        >
          <div className="space-y-4">
            <div className="flex items-center gap-3.5">
              <div
                aria-hidden="true"
                className="w-14 h-14 rounded-2xl bg-gradient-to-br from-slate-800 via-blue-700 to-indigo-600 text-white font-display font-bold text-lg flex items-center justify-center shrink-0 border border-white/25 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_8px_20px_-6px_rgba(37,99,235,0.45)]"
              >
                {getInitials(dev.name)}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-blue-600 dark:text-blue-400">
                  <User className="w-3.5 h-3.5 shrink-0" />
                  <span>Developer Profile</span>
                </div>
                <h2 className="mt-0.5 text-base tablet:text-lg font-display font-semibold text-slate-900 dark:text-slate-100 truncate">
                  {dev.name}
                </h2>
                {hasTitle && (
                  <div className="text-xs text-slate-600 dark:text-slate-400">
                    {dev.title}
                  </div>
                )}
              </div>
            </div>

            {hasBio && (
              <div className="pt-3 border-t border-slate-200/70 dark:border-white/10">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Biography
                </div>
                <p className="mt-1.5 text-xs tablet:text-sm text-slate-800 dark:text-slate-200 leading-relaxed">
                  {dev.biography}
                </p>
              </div>
            )}

            {hasOwnership && (
              <div className="pt-3 border-t border-slate-200/70 dark:border-white/10">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Product Ownership
                </div>
                <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  {dev.ownershipStatement}
                </p>
              </div>
            )}

            {hasEmail && (
              <div className="pt-3 border-t border-slate-200/70 dark:border-white/10">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                  Direct Contact
                </div>
                <a
                  href={`mailto:${dev.email}`}
                  className="min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200/80 dark:border-white/12 glass-level-2 glass-interactive flex items-center justify-between gap-2 text-xs font-medium text-slate-900 dark:text-slate-100 hover:border-blue-500/40"
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <Mail className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                    <span className="truncate">{dev.email}</span>
                  </span>
                  <ExternalLink className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                </a>
              </div>
            )}

            {visibleSocials.length > 0 && (
              <div className="pt-3 border-t border-slate-200/70 dark:border-white/10">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                  Social & Developer Links
                </div>
                <div className="space-y-2">
                  {visibleSocials.map((link) => (
                    <a
                      key={link.id}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200/80 dark:border-white/12 glass-level-2 glass-interactive flex items-center justify-between gap-3 text-xs hover:border-blue-500/40"
                    >
                      <span className="flex items-center gap-2.5 min-w-0">
                        <span className="w-7 h-7 rounded-lg bg-blue-600/12 text-blue-600 dark:bg-blue-500/18 dark:text-blue-300 font-mono text-[10px] font-semibold flex items-center justify-center shrink-0">
                          {renderSocialBadgeLabel(link.id)}
                        </span>
                        <span className="min-w-0">
                          <span className="block font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {link.label}
                          </span>
                          <span className="block text-[11px] text-slate-500 dark:text-slate-400 truncate">
                            {link.handle}
                          </span>
                        </span>
                      </span>
                      <ExternalLink className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        </GlassCard>
      </div>

      {/* Additional Information: Privacy, Terms, Open-Source Licenses & Support */}
      <GlassCard level={3} padding="lg" className="space-y-4">
        <div className="flex flex-col tablet:flex-row tablet:items-center justify-between gap-3 pb-3 border-b border-slate-200/70 dark:border-white/10">
          <div>
            <h2 className="text-sm tablet:text-base font-display font-semibold text-slate-900 dark:text-slate-100">
              Additional Information & Transparency
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Version details, local data practices, usage terms, open-source acknowledgments, and support.
            </p>
          </div>
          <GlassSegmentedControl<InfoTab>
            value={activeInfoTab}
            onChange={setActiveInfoTab}
            options={[
              { value: 'privacy', label: 'Privacy Policy' },
              { value: 'terms', label: 'Terms of Use' },
              { value: 'licenses', label: 'Open-Source' },
              { value: 'support', label: 'Support' },
            ]}
          />
        </div>

        {activeInfoTab === 'privacy' && (
          <div className="grid grid-cols-1 tablet:grid-cols-2 gap-4 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            <div className="space-y-2">
              <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
                <Shield className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>Local Document Processing & Storage</span>
              </div>
              <p>
                Uploaded PDF files, edited layouts, CSV/Excel datasets, version snapshots, and preferences are stored locally in your browser&apos;s IndexedDB and local workspace storage.
              </p>
              <p>
                Default PDF scanning, coordinate extraction, and Tesseract.js OCR execute locally without transmitting your document contents to external AI services.
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
                <Sparkles className="w-4 h-4 text-blue-500 shrink-0" />
                <span>Optional AI Feature Disclosure</span>
              </div>
              <p>
                Optional features such as AI-Enhanced Analysis and the AI Editing Assistant only send selected page previews or edit instructions to the configured server-side Gemini API endpoint when you explicitly click to run them.
              </p>
              <p className="text-slate-500 dark:text-slate-400">
                You remain in full control of your documents and can clear local cached project data at any time in Settings.
              </p>
            </div>
          </div>
        )}

        {activeInfoTab === 'terms' && (
          <div className="grid grid-cols-1 tablet:grid-cols-2 gap-4 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            <div className="space-y-2">
              <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
                <Scale className="w-4 h-4 text-blue-500 shrink-0" />
                <span>Ownership & Acceptable Use</span>
              </div>
              <p>
                {APP_PRODUCT_NAME} ({APP_SUITE_NAME}) is owned and copyrighted by {dev.name} (© {APP_COPYRIGHT_YEAR}). You retain complete ownership and responsibility for all PDF templates, spreadsheets, images, fonts, and generated outputs created with the software.
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
                <FileText className="w-4 h-4 text-indigo-500 shrink-0" />
                <span>Software Warranty & Third-Party Assets</span>
              </div>
              <p>
                The application is provided &ldquo;as is&rdquo; without express or implied warranties. Third-party fonts, images, and open-source packages remain governed by their respective licenses and copyright holders.
              </p>
            </div>
          </div>
        )}

        {activeInfoTab === 'licenses' && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
              <Code2 className="w-4 h-4 text-blue-500 shrink-0" />
              <span>
                {APP_PRODUCT_NAME} integrates the following open-source libraries. Ownership and trademarks remain with their respective authors:
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200/70 dark:border-white/10 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    <th className="py-2 pr-4">Package</th>
                    <th className="py-2 px-3">License</th>
                    <th className="py-2 pl-3">Role in Application</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/60 dark:divide-white/8">
                  {OPEN_SOURCE_LICENSES.map((lib) => (
                    <tr key={lib.name}>
                      <td className="py-2 pr-4 font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                        {lib.name}
                      </td>
                      <td className="py-2 px-3 font-mono text-[11px] text-blue-600 dark:text-blue-400 whitespace-nowrap">
                        {lib.license}
                      </td>
                      <td className="py-2 pl-3 text-slate-600 dark:text-slate-400">
                        {lib.role}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeInfoTab === 'support' && (
          <div className="grid grid-cols-1 tablet:grid-cols-3 gap-4 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
                <BookOpen className="w-4 h-4 text-blue-500 shrink-0" />
                <span>Application Build</span>
              </div>
              <div className="tabular-nums">
                {APP_PRODUCT_NAME} · {APP_SUITE_NAME}
              </div>
              <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                Version {APP_VERSION} · Copyright © {APP_COPYRIGHT_YEAR} {dev.name}
              </div>
            </div>

            {hasEmail && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
                  <Mail className="w-4 h-4 text-blue-500 shrink-0" />
                  <span>Developer Contact</span>
                </div>
                <p>For direct product inquiries, feedback, or bug reports:</p>
                <a
                  href={`mailto:${dev.email}`}
                  className="inline-flex items-center gap-1.5 font-medium text-blue-600 dark:text-blue-400 hover:underline"
                >
                  {dev.email}
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}

            <div className="space-y-1.5">
              <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
                <Globe className="w-4 h-4 text-blue-500 shrink-0" />
                <span>Source & Community</span>
              </div>
              <p>Follow updates and developer releases:</p>
              <a
                href="https://github.com/kyamixdd"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 font-medium text-blue-600 dark:text-blue-400 hover:underline"
              >
                github.com/kyamixdd
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        )}
      </GlassCard>

      {/* Quiet Ownership & Copyright Footer */}
      <footer className="pt-2 pb-4 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
        <span className="flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5 text-blue-500" />
          <span>
            {APP_PRODUCT_NAME} ({APP_SUITE_NAME} v{APP_VERSION})
          </span>
        </span>
        <span>
          © {APP_COPYRIGHT_YEAR} {dev.name}. Independent software product.
        </span>
      </footer>
    </div>
  );
};
