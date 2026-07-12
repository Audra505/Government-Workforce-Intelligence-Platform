'use client';

// Assign / Update Skill form — embedded in employee detail Skills card.
// Upsert: POST /api/employees/:id/skills
// 201 on first assignment (INSERT), 200 on update.
// verifiedAt silently dropped by NestJS for non-SA/HRD roles (SKL-211) — form always shows it
// since this component is only rendered when canWrite=true (SA + HR Director).
// SEC-003: tenantId never sent from client.
// On success: toast + router.refresh() + form reset. No navigation.
// Reference: governance/GD-M24-1.md — Decisions 6, 7

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast, ToastContainer } from '@/components/shared/toast';
import type { SkillRow, AssignSkillBffResponse } from '@/features/workforce/types';

const PROFICIENCY_OPTIONS = [
  { value: 'BEGINNER',   label: 'Beginner' },
  { value: 'DEVELOPING', label: 'Developing' },
  { value: 'PROFICIENT', label: 'Proficient' },
  { value: 'ADVANCED',   label: 'Advanced' },
  { value: 'EXPERT',     label: 'Expert' },
] as const;

const ERROR_MESSAGES: Record<string, string> = {
  SKILL_NOT_FOUND:          'The selected skill was not found. Refresh and try again.',
  INVALID_PROFICIENCY_LEVEL: 'The selected proficiency level is not valid.',
  EMPLOYEE_SEPARATED:        'This employee is separated and cannot be modified.',
  UNAUTHORIZED:              'Session expired. Please sign in again.',
  FORBIDDEN:                 "You don't have permission to assign skills.",
  INTERNAL_ERROR:            'Service unavailable. Please try again.',
};

const SELECT_CLASS =
  'block w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500';

const TEXT   = '#0f172a';
const SUB    = '#475569';
const BORDER = '#e2e8f0';
const BLUE   = '#2563eb';

type Props = {
  employeeId: string;
  skillsCatalog: SkillRow[];
};

export function AssignSkillForm({ employeeId, skillsCatalog }: Props) {
  const router = useRouter();
  const { toasts, addToast, dismissToast } = useToast();
  const [skillId, setSkillId]               = useState('');
  const [proficiencyLevel, setProficiency]  = useState('');
  const [verifiedAt, setVerifiedAt]         = useState('');
  const [error, setError]                   = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting]     = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!skillId) { setError('Please select a skill.'); return; }

    setError(null);
    setIsSubmitting(true);

    const payload: Record<string, string> = { skillId };
    if (proficiencyLevel) payload.proficiencyLevel = proficiencyLevel;
    if (verifiedAt)       payload.verifiedAt       = verifiedAt;

    try {
      const res = await fetch(`/api/employees/${employeeId}/skills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const json = (await res.json()) as AssignSkillBffResponse;

      if (json.success) {
        const isInsert = res.status === 201;
        addToast({
          type: 'success',
          title: isInsert ? 'Skill assigned' : 'Skill updated',
          message: json.data.skillName,
        });
        router.refresh();
        setSkillId('');
        setProficiency('');
        setVerifiedAt('');
      } else {
        setError(ERROR_MESSAGES[json.error.code] ?? json.error.message);
      }
    } catch {
      setError('Unable to reach the server. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <form onSubmit={handleSubmit} noValidate>
        {error && (
          <div
            className="mb-4 rounded-md border px-4 py-2.5 text-sm"
            style={{ borderColor: '#fca5a5', backgroundColor: '#fef2f2', color: '#dc2626' }}
            role="alert"
          >
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {/* Skill */}
          <div>
            <label
              htmlFor="assign-skill-id"
              className="mb-1 block text-xs font-medium uppercase tracking-wide"
              style={{ color: SUB }}
            >
              Skill <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <select
              id="assign-skill-id"
              value={skillId}
              onChange={(e) => { setSkillId(e.target.value); setError(null); }}
              disabled={isSubmitting}
              className={SELECT_CLASS}
              style={{ borderColor: BORDER, color: skillId ? TEXT : SUB }}
            >
              <option value="">Select a skill…</option>
              {skillsCatalog.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}{s.category ? ` (${s.category})` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Proficiency */}
          <div>
            <label
              htmlFor="assign-skill-proficiency"
              className="mb-1 block text-xs font-medium uppercase tracking-wide"
              style={{ color: SUB }}
            >
              Proficiency
            </label>
            <select
              id="assign-skill-proficiency"
              value={proficiencyLevel}
              onChange={(e) => setProficiency(e.target.value)}
              disabled={isSubmitting}
              className={SELECT_CLASS}
              style={{ borderColor: BORDER, color: proficiencyLevel ? TEXT : SUB }}
            >
              <option value="">Optional…</option>
              {PROFICIENCY_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>

          {/* Verified At */}
          <div>
            <label
              htmlFor="assign-skill-verified-at"
              className="mb-1 block text-xs font-medium uppercase tracking-wide"
              style={{ color: SUB }}
            >
              Verified At
            </label>
            <input
              id="assign-skill-verified-at"
              type="date"
              value={verifiedAt}
              onChange={(e) => setVerifiedAt(e.target.value)}
              disabled={isSubmitting}
              className={SELECT_CLASS}
              style={{ borderColor: BORDER, color: TEXT }}
            />
          </div>
        </div>

        <div className="mt-4">
          <button
            type="submit"
            disabled={isSubmitting || !skillId}
            className="rounded-md px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-50"
            style={{ backgroundColor: BLUE }}
          >
            {isSubmitting ? 'Saving…' : 'Assign Skill'}
          </button>
        </div>
      </form>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
