// Employee detail display — Server Component.
// M21C: EmploymentStatusDot replaces pill badge; IBM Plex Mono for employee # and IDs.
// M24C: Skills and Certifications cards added — data passed from parent page (non-fatal fetches).
//   canWrite (SA + HR Director) + !SEPARATED gates assign forms (GD-M24-1 D3).
//   REVOKED cert rows are read-only; no edit action shown (CRT-301).
// EMP-400/EMP-401: audit metadata not exposed in UI; PII-bearing fields shown only
// to roles that passed NestJS RBAC (SA, HR, WP, HM, CO — RBAC-952 excludes Executive User).
// currentPositionTitle: resolved by parent page via secondary serverFetch; null when unavailable.
// Reference: directives/13_employee_management_rules.md — EMP-302 (SEPARATED read-only indicator)
// Reference: governance/GD-M15-1.md — Decision 5, 7 (positionId in employee response)
// Reference: governance/GD-M24-1.md — Decisions 3, 6, 7, 8, 9

import type { ReactNode } from 'react';
import type {
  EmployeeRow,
  EmployeeSkillAssignment,
  EmployeeCertificationAssignment,
  SkillRow,
  CertificationRow,
  ProficiencyLevel,
  CertificationAssignmentStatus,
} from '@/features/workforce/types';
import { EmploymentStatusDot } from '@/features/workforce/components/employee-status-badge';
import { EmptyState } from '@/components/shared/empty-state';
import { AssignSkillForm } from '@/features/workforce/components/assign-skill-form';
import { AssignCertificationForm } from '@/features/workforce/components/assign-certification-form';

const MONO_STYLE = {
  fontFamily: "var(--font-ibm-plex-mono, 'IBM Plex Mono', monospace)",
} as const;

const MONO_ID_STYLE = {
  fontFamily: "var(--font-ibm-plex-mono, 'IBM Plex Mono', monospace)",
  fontSize: 12,
  color: '#94a3b8',
} as const;

const SANS_STYLE = {
  fontFamily: "var(--font-ibm-plex-sans, 'IBM Plex Sans', system-ui, sans-serif)",
  fontStyle: 'normal' as const,
} as const;

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(iso));
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 text-sm">{children}</dd>
    </div>
  );
}

const PROFICIENCY_LABELS: Record<ProficiencyLevel, string> = {
  BEGINNER:   'Beginner',
  DEVELOPING: 'Developing',
  PROFICIENT: 'Proficient',
  ADVANCED:   'Advanced',
  EXPERT:     'Expert',
};

const CERT_STATUS_STYLE: Record<
  CertificationAssignmentStatus,
  { backgroundColor: string; color: string }
> = {
  ACTIVE:  { backgroundColor: '#dcfce7', color: '#15803d' },
  EXPIRED: { backgroundColor: '#fef9c3', color: '#a16207' },
  REVOKED: { backgroundColor: '#fee2e2', color: '#dc2626' },
};

const CERT_STATUS_LABELS: Record<CertificationAssignmentStatus, string> = {
  ACTIVE:  'Active',
  EXPIRED: 'Expired',
  REVOKED: 'Revoked',
};

type Props = {
  employee: EmployeeRow;
  currentPositionTitle: string | null;
  employeeSkills: EmployeeSkillAssignment[] | null;
  employeeCertifications: EmployeeCertificationAssignment[] | null;
  skillsCatalog: SkillRow[] | null;
  certificationsCatalog: CertificationRow[] | null;
  canWrite: boolean;
};

export function EmployeeDetail({
  employee,
  currentPositionTitle,
  employeeSkills,
  employeeCertifications,
  skillsCatalog,
  certificationsCatalog,
  canWrite,
}: Props) {
  const isSeparated = employee.employmentStatus === 'SEPARATED';

  return (
    <div className="space-y-6">
      {/* EMP-302: Read-only indicator for SEPARATED employees */}
      {isSeparated && (
        <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-4 py-3">
          <span className="text-sm font-medium text-gray-600">
            Read-only — Separated employees cannot be modified.
          </span>
        </div>
      )}

      {/* Personal Information */}
      <div className="rounded-md border p-6">
        <h3 className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Personal Information
        </h3>
        <dl className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="First Name">{employee.firstName}</Field>
          <Field label="Last Name">{employee.lastName}</Field>
          <Field label="Email">
            {employee.email ? (
              <a
                href={`mailto:${employee.email}`}
                className="text-primary hover:underline"
              >
                {employee.email}
              </a>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </Field>
        </dl>
      </div>

      {/* Employment Information */}
      <div className="rounded-md border p-6">
        <h3 className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Employment
        </h3>
        <dl className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Employee Number">
            <span style={MONO_STYLE}>{employee.employeeNumber}</span>
          </Field>
          <Field label="Department">{employee.departmentName}</Field>
          <Field label="Current Position">
            {employee.positionId ? (
              currentPositionTitle ? (
                <span>{currentPositionTitle}</span>
              ) : (
                <span style={MONO_ID_STYLE}>
                  {employee.positionId}
                  <span className="ml-1 text-xs" style={SANS_STYLE}> — title unavailable</span>
                </span>
              )
            ) : (
              <span className="text-muted-foreground">
                Unassigned — no position is currently held.
              </span>
            )}
          </Field>
          <Field label="Status">
            <EmploymentStatusDot status={employee.employmentStatus} />
          </Field>
          <Field label="Hire Date">
            {employee.hireDate ? formatDate(employee.hireDate) : <span className="text-muted-foreground">—</span>}
          </Field>
          {/* EMP-303: terminationDate system-managed; rendered when present (SEPARATED only) */}
          {employee.terminationDate && (
            <Field label="Termination Date">{formatDate(employee.terminationDate)}</Field>
          )}
        </dl>
      </div>

      {/* Timeline */}
      <div className="rounded-md border p-6">
        <h3 className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Timeline
        </h3>
        <dl className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Created">{formatDate(employee.createdAt)}</Field>
          <Field label="Last Updated">{formatDate(employee.updatedAt)}</Field>
        </dl>
      </div>

      {/* Identifiers */}
      <div className="rounded-md border p-6">
        <h3 className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Identifiers
        </h3>
        <dl className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <Field label="Employee ID">
            <span style={MONO_ID_STYLE}>{employee.id}</span>
          </Field>
        </dl>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Skills — M24C                                                       */}
      {/* GD-M24-1 D3: canWrite + !SEPARATED gates assign form.              */}
      {/* employeeSkills=null means the fetch failed; show degraded state.   */}
      {/* ------------------------------------------------------------------ */}
      <div className="rounded-md border p-6">
        <h3 className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Skills
        </h3>

        {employeeSkills === null ? (
          <p className="text-sm" style={{ color: '#94a3b8' }}>
            Skills data is currently unavailable.
          </p>
        ) : employeeSkills.length === 0 ? (
          <EmptyState message="No skills assigned to this employee yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                  {(['Skill', 'Category', 'Proficiency', 'Verified At'] as const).map((h) => (
                    <th
                      key={h}
                      className="px-0 pb-2.5 pt-0 text-left uppercase"
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: '0.09em',
                        color: '#94a3b8',
                        whiteSpace: 'nowrap',
                        paddingRight: 20,
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {employeeSkills.map((s) => (
                  <tr
                    key={s.skillId}
                    className="border-b last:border-0"
                    style={{ borderColor: '#e2e8f0' }}
                  >
                    <td className="py-2.5 pr-5 font-medium" style={{ color: '#0f172a' }}>
                      {s.skillName}
                    </td>
                    <td className="py-2.5 pr-5" style={{ color: '#475569' }}>
                      {s.skillCategory ?? '—'}
                    </td>
                    <td className="py-2.5 pr-5" style={{ color: '#475569' }}>
                      {s.proficiencyLevel ? PROFICIENCY_LABELS[s.proficiencyLevel] : '—'}
                    </td>
                    <td className="whitespace-nowrap py-2.5" style={{ color: '#475569' }}>
                      {s.verifiedAt ? formatDate(s.verifiedAt) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Assign form — SA + HR Director only; hidden for SEPARATED */}
        {canWrite && !isSeparated && skillsCatalog && skillsCatalog.length > 0 && (
          <>
            <div className="my-5 border-t" style={{ borderColor: '#e2e8f0' }} />
            <h4
              className="mb-3 text-xs font-semibold uppercase tracking-wide"
              style={{ color: '#94a3b8' }}
            >
              Assign / Update Skill
            </h4>
            <AssignSkillForm employeeId={employee.id} skillsCatalog={skillsCatalog} />
          </>
        )}

        {canWrite && !isSeparated && skillsCatalog && skillsCatalog.length === 0 && (
          <p className="mt-4 text-xs" style={{ color: '#94a3b8' }}>
            No skills are defined in the catalog yet. Add skills via the{' '}
            <a href="/workforce/skills" className="underline" style={{ color: '#2563eb' }}>
              Skills catalog
            </a>{' '}
            before assigning.
          </p>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Certifications — M24C                                               */}
      {/* GD-M24-1 D3: canWrite + !SEPARATED gates assign form.              */}
      {/* REVOKED rows are read-only; no edit action (CRT-301).              */}
      {/* employeeCertifications=null means the fetch failed.                */}
      {/* ------------------------------------------------------------------ */}
      <div className="rounded-md border p-6">
        <h3 className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Certifications
        </h3>

        {employeeCertifications === null ? (
          <p className="text-sm" style={{ color: '#94a3b8' }}>
            Certifications data is currently unavailable.
          </p>
        ) : employeeCertifications.length === 0 ? (
          <EmptyState message="No certifications assigned to this employee yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                  {(['Certification', 'Issuer', 'Status', 'Issue Date', 'Expiration'] as const).map((h) => (
                    <th
                      key={h}
                      className="pb-2.5 pt-0 text-left uppercase"
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: '0.09em',
                        color: '#94a3b8',
                        whiteSpace: 'nowrap',
                        paddingRight: 20,
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {employeeCertifications.map((c) => (
                  <tr
                    key={c.certificationId}
                    className="border-b last:border-0"
                    style={{ borderColor: '#e2e8f0' }}
                  >
                    <td className="py-2.5 pr-5 font-medium" style={{ color: '#0f172a' }}>
                      {c.certificationName}
                    </td>
                    <td className="py-2.5 pr-5" style={{ color: '#475569' }}>
                      {c.issuer ?? '—'}
                    </td>
                    <td className="py-2.5 pr-5">
                      <span
                        className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
                        style={CERT_STATUS_STYLE[c.status]}
                      >
                        {CERT_STATUS_LABELS[c.status]}
                      </span>
                    </td>
                    <td className="whitespace-nowrap py-2.5 pr-5" style={{ color: '#475569' }}>
                      {c.issueDate ? formatDate(c.issueDate) : '—'}
                    </td>
                    <td className="whitespace-nowrap py-2.5" style={{ color: '#475569' }}>
                      {c.expirationDate ? formatDate(c.expirationDate) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Assign form — SA + HR Director only; hidden for SEPARATED */}
        {canWrite && !isSeparated && certificationsCatalog && certificationsCatalog.length > 0 && (
          <>
            <div className="my-5 border-t" style={{ borderColor: '#e2e8f0' }} />
            <h4
              className="mb-3 text-xs font-semibold uppercase tracking-wide"
              style={{ color: '#94a3b8' }}
            >
              Assign / Update Certification
            </h4>
            <AssignCertificationForm
              employeeId={employee.id}
              certificationsCatalog={certificationsCatalog}
              existingAssignments={employeeCertifications ?? []}
            />
          </>
        )}

        {canWrite && !isSeparated && certificationsCatalog && certificationsCatalog.length === 0 && (
          <p className="mt-4 text-xs" style={{ color: '#94a3b8' }}>
            No certifications are defined in the catalog yet. Add certifications via the{' '}
            <a href="/workforce/certifications" className="underline" style={{ color: '#2563eb' }}>
              Certifications catalog
            </a>{' '}
            before assigning.
          </p>
        )}
      </div>
    </div>
  );
}
