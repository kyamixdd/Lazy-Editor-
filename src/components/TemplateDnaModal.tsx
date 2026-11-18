import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Fingerprint,
  GitCompare,
  RefreshCw,
} from 'lucide-react';
import {
  PDFProject,
  TemplateAutomationProfile,
} from '../types/pdfStudio';
import {
  compareTemplateDna,
  computeTemplateDna,
  mergeTemplateProfileUpdate,
} from '../utils/templateProfileEngine';
import { GlassButton, GlassModal } from './glass';

interface TemplateDnaModalProps {
  isOpen: boolean;
  profile: TemplateAutomationProfile | null;
  activeProject: PDFProject | null;
  onClose: () => void;
  onUpdateProfile: (updated: TemplateAutomationProfile) => void;
  onApplyToActive?: (profile: TemplateAutomationProfile) => void;
}

export const TemplateDnaModal: React.FC<TemplateDnaModalProps> = ({
  isOpen,
  profile,
  activeProject,
  onClose,
  onUpdateProfile,
  onApplyToActive,
}) => {
  const [mergeFeedback, setMergeFeedback] = useState<string | null>(null);

  const dna = useMemo(
    () => (profile ? profile.dna || computeTemplateDna(profile) : null),
    [profile]
  );

  const diffReport = useMemo(
    () =>
      profile && activeProject
        ? compareTemplateDna(profile, activeProject)
        : null,
    [profile, activeProject]
  );

  if (!profile || !dna) return null;

  const handleUpdateGeometryPreserveSettings = () => {
    if (!activeProject) return;
    const { updatedProfile, diffReport: report } = mergeTemplateProfileUpdate(
      profile,
      activeProject
    );
    onUpdateProfile(updatedProfile);
    setMergeFeedback(
      `Profile updated to DNA ${updatedProfile.dna?.fingerprintHash} (${report.remappedFieldIds.length} field mappings, ${profile.serialRules.length} serial rules, and imposition grid preserved).`
    );
  };

  return (
    <GlassModal
      isOpen={isOpen}
      onClose={onClose}
      title={`Template DNA · ${profile.name}`}
      subtitle={`Fingerprint ${dna.fingerprintHash} · Captured ${new Date(dna.generatedAt).toLocaleString()}`}
      maxWidthClass="max-w-4xl"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-[#555555] dark:text-[#B5B5B5] font-mono">
            {dna.fingerprintHash}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {activeProject && (
              <GlassButton
                variant="glass"
                size="sm"
                onClick={handleUpdateGeometryPreserveSettings}
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Update Geometry (Keep Rules)
              </GlassButton>
            )}
            {activeProject && onApplyToActive && (
              <GlassButton
                variant="primary"
                size="sm"
                onClick={() => {
                  onApplyToActive(profile);
                  onClose();
                }}
              >
                Apply Profile to Active PDF
              </GlassButton>
            )}
          </div>
        </div>
      }
    >
      <div className="p-4 tablet:p-6 space-y-5 text-xs">
        {mergeFeedback && (
          <div className="p-3 rounded-xl border border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{mergeFeedback}</span>
          </div>
        )}

        {/* Saved DNA Signature Summary */}
        <div className="grid grid-cols-2 tablet:grid-cols-4 gap-3">
          <div className="p-3 rounded-xl border border-black/10 dark:border-white/12 bg-black/[0.02] dark:bg-white/[0.02]">
            <div className="text-[10px] uppercase tracking-wider text-[#888888] dark:text-[#858585]">
              Page Geometry
            </div>
            <div className="mt-1 font-semibold font-mono text-[#101010] dark:text-white tabular-nums">
              {dna.pageDimensionsPt.width.toFixed(0)} × {dna.pageDimensionsPt.height.toFixed(0)} pt
            </div>
            <div className="mt-0.5 text-[11px] text-[#555555] dark:text-[#B5B5B5] tabular-nums">
              {dna.pageCount} page(s) · {dna.scalingMode.replace(/_/g, ' ')}
            </div>
          </div>

          <div className="p-3 rounded-xl border border-black/10 dark:border-white/12 bg-black/[0.02] dark:bg-white/[0.02]">
            <div className="text-[10px] uppercase tracking-wider text-[#888888] dark:text-[#858585]">
              Detected Structure
            </div>
            <div className="mt-1 font-semibold text-[#101010] dark:text-white tabular-nums">
              {dna.fields.length} elements · {dna.blockGeometry.length} blocks
            </div>
            <div className="mt-0.5 text-[11px] text-[#555555] dark:text-[#B5B5B5] tabular-nums">
              {dna.relationships.length} block relationship group(s)
            </div>
          </div>

          <div className="p-3 rounded-xl border border-black/10 dark:border-white/12 bg-black/[0.02] dark:bg-white/[0.02]">
            <div className="text-[10px] uppercase tracking-wider text-[#888888] dark:text-[#858585]">
              Automation Rules
            </div>
            <div className="mt-1 font-semibold text-[#101010] dark:text-white tabular-nums">
              {dna.numberingSignatures.length} serial rules
            </div>
            <div className="mt-0.5 text-[11px] text-[#555555] dark:text-[#B5B5B5] tabular-nums">
              {dna.dataColumnNames.length} data fields · {profile.fieldMappings.length} mapped
            </div>
          </div>

          <div className="p-3 rounded-xl border border-black/10 dark:border-white/12 bg-black/[0.02] dark:bg-white/[0.02]">
            <div className="text-[10px] uppercase tracking-wider text-[#888888] dark:text-[#858585]">
              Sheet Grid
            </div>
            <div className="mt-1 font-semibold text-[#101010] dark:text-white tabular-nums">
              {dna.gridSpec.enabled
                ? `${dna.gridSpec.columns} × ${dna.gridSpec.rows} grid`
                : '1-up single page'}
            </div>
            <div className="mt-0.5 text-[11px] text-[#555555] dark:text-[#B5B5B5] tabular-nums">
              Gap {dna.gridSpec.hSpacingPt}×{dna.gridSpec.vSpacingPt}pt
            </div>
          </div>
        </div>

        {/* Comparison against Active Project */}
        <div className="rounded-xl border border-black/10 dark:border-white/12 overflow-hidden">
          <div className="px-4 py-3 bg-[#F7F7F7] dark:bg-[#0B0B0B] border-b border-black/10 dark:border-white/10 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-semibold text-[#101010] dark:text-white">
              <GitCompare className="w-4 h-4" />
              Structural Version Comparison
            </div>
            {diffReport ? (
              <div className="flex items-center gap-3 tabular-nums">
                <span className="font-mono text-[11px] text-[#555555] dark:text-[#B5B5B5]">
                  Active: {diffReport.incomingFingerprintHash}
                </span>
                <span
                  className={`font-semibold ${
                    diffReport.compatibilityScore >= 85
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : diffReport.compatibilityScore >= 60
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {diffReport.compatibilityScore}% Match
                </span>
              </div>
            ) : (
              <span className="text-[#888888] dark:text-[#858585]">
                Open a PDF project to compare structure
              </span>
            )}
          </div>

          {!diffReport ? (
            <div className="p-4 text-[#555555] dark:text-[#B5B5B5]">
              Upload or open a newer version of this PDF template in the workspace, then reopen Template DNA to inspect element shifts, missing fields, and update without losing your serial rules or data mappings.
            </div>
          ) : diffReport.differences.length === 0 ? (
            <div className="p-4 flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>
                Active PDF &quot;{activeProject?.name}&quot; matches this Template DNA fingerprint identically.
              </span>
            </div>
          ) : (
            <div className="divide-y divide-black/10 dark:divide-white/10 max-h-60 overflow-y-auto">
              {diffReport.differences.map((d) => (
                <div
                  key={d.id}
                  className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-2"
                >
                  <div className="flex items-start gap-2 min-w-0">
                    {d.severity === 'warning' ? (
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    ) : (
                      <Fingerprint className="w-3.5 h-3.5 text-[#888888] dark:text-[#858585] shrink-0 mt-0.5" />
                    )}
                    <div className="min-w-0">
                      <div className="font-medium text-[#101010] dark:text-white">
                        {d.summary}
                      </div>
                      <div className="text-[11px] text-[#555555] dark:text-[#B5B5B5]">
                        {d.detail}
                      </div>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono uppercase text-[#888888] dark:text-[#858585]">
                    {d.category.replace(/_/g, ' ')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Preserved Field Map Preview */}
        {dna.fields.length > 0 && (
          <div className="rounded-xl border border-black/10 dark:border-white/12 overflow-hidden">
            <div className="px-4 py-2.5 bg-[#F7F7F7] dark:bg-[#0B0B0B] border-b border-black/10 dark:border-white/10 font-semibold text-[#101010] dark:text-white">
              Recorded Field Coordinates &amp; Typography ({dna.fields.length})
            </div>
            <div className="max-h-48 overflow-y-auto">
              <table className="w-full text-left border-collapse text-[11px] tabular-nums">
                <thead>
                  <tr className="border-b border-black/10 dark:border-white/10 text-[#888888] dark:text-[#858585]">
                    <th className="py-1.5 px-3">Type</th>
                    <th className="py-1.5 px-3">Sample / Field Key</th>
                    <th className="py-1.5 px-3">Rect (pt)</th>
                    <th className="py-1.5 px-3 text-right">Font</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/10 dark:divide-white/10">
                  {dna.fields.slice(0, 30).map((f) => (
                    <tr key={f.elementId}>
                      <td className="py-1.5 px-3 font-mono text-[#555555] dark:text-[#B5B5B5]">
                        {f.type}
                      </td>
                      <td className="py-1.5 px-3 text-[#101010] dark:text-white truncate max-w-[220px]">
                        {f.fieldKey ? `[${f.fieldKey}] ` : ''}
                        {f.textSample || f.elementId}
                      </td>
                      <td className="py-1.5 px-3 font-mono text-[#555555] dark:text-[#B5B5B5]">
                        ({Math.round(f.x)}, {Math.round(f.y)}) {Math.round(f.width)}×{Math.round(f.height)}
                      </td>
                      <td className="py-1.5 px-3 text-right text-[#555555] dark:text-[#B5B5B5]">
                        {f.fontFamily} {f.fontSize}pt
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </GlassModal>
  );
};
