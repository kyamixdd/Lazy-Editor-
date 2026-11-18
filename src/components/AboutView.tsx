import React, { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
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
import { MOTION_DURATION, MOTION_EASE } from '../config/motionSystem';
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
  const shouldReduceMotion = useReducedMotion();
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
      <div className="flex flex-col tablet:flex-row tablet:items-center justify-between gap-4 pb-5 border-b border-black/10 dark:border-white/12">
        <div className="flex items-center gap-3.5 min-w-0">
          <BrandMark size="lg" />
          <div className="min-w-0">
            <div className="text-xs font-medium text-[#555555] dark:text-[#B5B5B5]">
              {APP_SUITE_NAME} · Version {APP_VERSION}
            </div>
            <h1 className="mt-0.5 text-xl tablet:text-2xl font-display font-semibold tracking-tight text-[#101010] dark:text-white">
              About {APP_PRODUCT_NAME}
            </h1>
            <p className="mt-0.5 text-xs tablet:text-sm text-[#555555] dark:text-[#B5B5B5]">
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
                <h2 className="text-base tablet:text-lg font-display font-semibold text-[#101010] dark:text-white">
                  {PRODUCT_INFO.name}
                </h2>
                <div className="mt-0.5 text-xs text-[#888888] dark:text-[#858585] tabular-nums">
                  {PRODUCT_INFO.suiteName} · Release v{PRODUCT_INFO.version}
                </div>
              </div>
              <div className="text-xs font-mono text-[#888888] dark:text-[#858585] tabular-nums">
                v{PRODUCT_INFO.version}
              </div>
            </div>

            <p className="text-xs tablet:text-sm leading-relaxed text-[#555555] dark:text-[#B5B5B5]">
              {PRODUCT_INFO.description}
            </p>

            {/* Mission */}
            <div className="pt-3 border-t border-black/10 dark:border-white/12">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[#555555] dark:text-[#B5B5B5]">
                Product Mission
              </div>
              <p className="mt-1 text-xs tablet:text-sm font-medium text-[#101010] dark:text-white leading-relaxed">
                {PRODUCT_INFO.mission}
              </p>
            </div>

            {/* Capabilities */}
            <div className="pt-3 border-t border-black/10 dark:border-white/12 space-y-2.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[#888888] dark:text-[#858585]">
                Core Capabilities
              </div>
              <div className="grid grid-cols-1 tablet:grid-cols-2 gap-3">
                {PRODUCT_INFO.capabilities.map((cap) => (
                  <div
                    key={cap.title}
                    className="flex items-start gap-2.5 text-xs"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#101010] dark:text-white shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold text-[#101010] dark:text-white">
                        {cap.title}
                      </div>
                      <p className="mt-0.5 text-[11px] text-[#555555] dark:text-[#B5B5B5] leading-relaxed">
                        {cap.detail}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="pt-3.5 border-t border-black/10 dark:border-white/12 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#888888] dark:text-[#858585] tabular-nums">
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
                className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#1B1B1B] via-[#101010] to-[#3A3A3A] dark:from-white dark:via-[#E5E5E5] dark:to-[#B5B5B5] text-white dark:text-[#050505] font-display font-bold text-lg flex items-center justify-center shrink-0 border border-black/15 dark:border-white/25 shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_10px_24px_-8px_rgba(0,0,0,0.45)]"
              >
                {getInitials(dev.name)}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#555555] dark:text-[#B5B5B5]">
                  <User className="w-3.5 h-3.5 shrink-0" />
                  <span>Developer Profile</span>
                </div>
                <h2 className="mt-0.5 text-base tablet:text-lg font-display font-semibold text-[#101010] dark:text-white truncate">
                  {dev.name}
                </h2>
                {hasTitle && (
                  <div className="text-xs text-[#555555] dark:text-[#B5B5B5]">
                    {dev.title}
                  </div>
                )}
              </div>
            </div>

            {hasBio && (
              <div className="pt-3 border-t border-black/10 dark:border-white/12">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-[#888888] dark:text-[#858585]">
                  Biography
                </div>
                <p className="mt-1.5 text-xs tablet:text-sm text-[#101010] dark:text-white leading-relaxed">
                  {dev.biography}
                </p>
              </div>
            )}

            {hasOwnership && (
              <div className="pt-3 border-t border-black/10 dark:border-white/12">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-[#888888] dark:text-[#858585]">
                  Product Ownership
                </div>
                <p className="mt-1.5 text-xs text-[#555555] dark:text-[#B5B5B5] leading-relaxed">
                  {dev.ownershipStatement}
                </p>
              </div>
            )}

            {hasEmail && (
              <div className="pt-3 border-t border-black/10 dark:border-white/12">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-[#888888] dark:text-[#858585] mb-2">
                  Direct Contact
                </div>
                <a
                  href={`mailto:${dev.email}`}
                  className="min-h-[44px] px-3.5 py-2 rounded-xl border border-black/12 dark:border-white/14 glass-level-2 glass-interactive flex items-center justify-between gap-2 text-xs font-medium text-[#101010] dark:text-white"
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <Mail className="w-4 h-4 text-[#101010] dark:text-white shrink-0" />
                    <span className="truncate">{dev.email}</span>
                  </span>
                  <ExternalLink className="w-3.5 h-3.5 text-[#888888] dark:text-[#858585] shrink-0" />
                </a>
              </div>
            )}

            {visibleSocials.length > 0 && (
              <div className="pt-3 border-t border-black/10 dark:border-white/12">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-[#888888] dark:text-[#858585] mb-2">
                  Social & Developer Links
                </div>
                <div className="space-y-2">
                  {visibleSocials.map((link) => (
                    <a
                      key={link.id}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-h-[44px] px-3.5 py-2 rounded-xl border border-black/12 dark:border-white/14 glass-level-2 glass-interactive flex items-center justify-between gap-3 text-xs"
                    >
                      <span className="flex items-center gap-2.5 min-w-0">
                        <span className="w-7 h-7 rounded-lg bg-black/[0.08] text-[#101010] dark:bg-white/[0.12] dark:text-white font-mono text-[10px] font-semibold flex items-center justify-center shrink-0">
                          {renderSocialBadgeLabel(link.id)}
                        </span>
                        <span className="min-w-0">
                          <span className="block font-semibold text-[#101010] dark:text-white truncate">
                            {link.label}
                          </span>
                          <span className="block text-[11px] text-[#888888] dark:text-[#858585] truncate">
                            {link.handle}
                          </span>
                        </span>
                      </span>
                      <ExternalLink className="w-3.5 h-3.5 text-[#888888] dark:text-[#858585] shrink-0" />
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
        <div className="flex flex-col tablet:flex-row tablet:items-center justify-between gap-3 pb-3 border-b border-black/10 dark:border-white/12">
          <div>
            <h2 className="text-sm tablet:text-base font-display font-semibold text-[#101010] dark:text-white">
              Additional Information & Transparency
            </h2>
            <p className="mt-0.5 text-xs text-[#888888] dark:text-[#858585]">
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

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={activeInfoTab}
            initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -3 }}
            transition={{ duration: MOTION_DURATION.fast, ease: MOTION_EASE.liquid }}
          >
        {activeInfoTab === 'privacy' && (
          <div className="grid grid-cols-1 tablet:grid-cols-2 gap-4 text-xs leading-relaxed text-[#555555] dark:text-[#B5B5B5]">
            <div className="space-y-2">
              <div className="flex items-center gap-2 font-semibold text-[#101010] dark:text-white">
                <Shield className="w-4 h-4 text-[#101010] dark:text-white shrink-0" />
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
              <div className="flex items-center gap-2 font-semibold text-[#101010] dark:text-white">
                <Sparkles className="w-4 h-4 text-[#101010] dark:text-white shrink-0" />
                <span>Optional AI Feature Disclosure</span>
              </div>
              <p>
                Optional features such as AI-Enhanced Analysis and the AI Editing Assistant only send selected page previews or edit instructions to the configured server-side Gemini API endpoint when you explicitly click to run them.
              </p>
              <p className="text-[#888888] dark:text-[#858585]">
                You remain in full control of your documents and can clear local cached project data at any time in Settings.
              </p>
            </div>
          </div>
        )}

        {activeInfoTab === 'terms' && (
          <div className="grid grid-cols-1 tablet:grid-cols-2 gap-4 text-xs leading-relaxed text-[#555555] dark:text-[#B5B5B5]">
            <div className="space-y-2">
              <div className="flex items-center gap-2 font-semibold text-[#101010] dark:text-white">
                <Scale className="w-4 h-4 text-[#101010] dark:text-white shrink-0" />
                <span>Ownership & Acceptable Use</span>
              </div>
              <p>
                {APP_PRODUCT_NAME} ({APP_SUITE_NAME}) is owned and copyrighted by {dev.name} (© {APP_COPYRIGHT_YEAR}). You retain complete ownership and responsibility for all PDF templates, spreadsheets, images, fonts, and generated outputs created with the software.
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2 font-semibold text-[#101010] dark:text-white">
                <FileText className="w-4 h-4 text-[#101010] dark:text-white shrink-0" />
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
            <div className="flex items-center gap-2 text-xs text-[#555555] dark:text-[#B5B5B5]">
              <Code2 className="w-4 h-4 text-[#101010] dark:text-white shrink-0" />
              <span>
                {APP_PRODUCT_NAME} integrates the following open-source libraries. Ownership and trademarks remain with their respective authors:
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-black/10 dark:border-white/12 text-[11px] font-medium text-[#888888] dark:text-[#858585]">
                    <th className="py-2 pr-4">Package</th>
                    <th className="py-2 px-3">License</th>
                    <th className="py-2 pl-3">Role in Application</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/8 dark:divide-white/8">
                  {OPEN_SOURCE_LICENSES.map((lib) => (
                    <tr key={lib.name}>
                      <td className="py-2 pr-4 font-medium text-[#101010] dark:text-white whitespace-nowrap">
                        {lib.name}
                      </td>
                      <td className="py-2 px-3 font-mono text-[11px] text-[#555555] dark:text-[#B5B5B5] whitespace-nowrap">
                        {lib.license}
                      </td>
                      <td className="py-2 pl-3 text-[#555555] dark:text-[#B5B5B5]">
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
          <div className="grid grid-cols-1 tablet:grid-cols-3 gap-4 text-xs leading-relaxed text-[#555555] dark:text-[#B5B5B5]">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 font-semibold text-[#101010] dark:text-white">
                <BookOpen className="w-4 h-4 text-[#101010] dark:text-white shrink-0" />
                <span>Application Build</span>
              </div>
              <div className="tabular-nums">
                {APP_PRODUCT_NAME} · {APP_SUITE_NAME}
              </div>
              <div className="font-mono text-[11px] text-[#888888] dark:text-[#858585]">
                Version {APP_VERSION} · Copyright © {APP_COPYRIGHT_YEAR} {dev.name}
              </div>
            </div>

            {hasEmail && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 font-semibold text-[#101010] dark:text-white">
                  <Mail className="w-4 h-4 text-[#101010] dark:text-white shrink-0" />
                  <span>Developer Contact</span>
                </div>
                <p>For direct product inquiries, feedback, or bug reports:</p>
                <a
                  href={`mailto:${dev.email}`}
                  className="inline-flex items-center gap-1.5 font-medium text-[#101010] dark:text-white hover:underline"
                >
                  {dev.email}
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}

            <div className="space-y-1.5">
              <div className="flex items-center gap-2 font-semibold text-[#101010] dark:text-white">
                <Globe className="w-4 h-4 text-[#101010] dark:text-white shrink-0" />
                <span>Source & Community</span>
              </div>
              <p>Follow updates and developer releases:</p>
              <a
                href="https://github.com/kyamixdd"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 font-medium text-[#101010] dark:text-white hover:underline"
              >
                github.com/kyamixdd
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        )}
          </motion.div>
        </AnimatePresence>
      </GlassCard>

      {/* Quiet Ownership & Copyright Footer */}
      <footer className="pt-2 pb-4 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#888888] dark:text-[#858585]">
        <span className="flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5 text-[#101010] dark:text-white" />
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
