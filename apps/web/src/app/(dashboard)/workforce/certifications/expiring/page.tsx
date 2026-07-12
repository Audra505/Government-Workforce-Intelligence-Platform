// Expiring Certifications report page — Server Component.
// Route: /workforce/certifications/expiring
// Fetches GET /api/v1/employee-certifications/expiring?withinDays=&page=&pageSize=
// Roles allowed: SA, HRD, WP, CO. 403 rendered gracefully inside WorkforceShell
//   (not thrown to error boundary) — expected role restriction, not a system error.
// withinDays: defaults to 30; valid values: 30, 60, 90, 365; invalid falls back to 30.
// Pagination via existing Pagination component.
// Reference: governance/GD-M24-1.md — Decision 10

import Link from 'next/link';
import { serverFetch, ApiError } from '@/lib/api';
import { WorkforceShell } from '@/features/workforce/components/workforce-shell';
import { Pagination } from '@/components/shared/pagination';
import { ExpiringCertificationTable } from '@/features/workforce/components/expiring-certification-table';
import type { ExpiringCertListApiResponse } from '@/features/workforce/types';

type PageSearchParams = { [key: string]: string | string[] | undefined };
type Props = { searchParams: PageSearchParams };

const VALID_WITHIN_DAYS = [30, 60, 90, 365] as const;
type WithinDays = (typeof VALID_WITHIN_DAYS)[number];

const PAGE_SIZE = 20;

function getString(v: string | string[] | undefined): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function parseWithinDays(raw: string | undefined): WithinDays {
  const n = parseInt(raw ?? '', 10);
  return (VALID_WITHIN_DAYS as readonly number[]).includes(n) ? (n as WithinDays) : 30;
}

function buildPageUrl(withinDays: number, targetPage: number): string {
  return `/workforce/certifications/expiring?withinDays=${withinDays}&page=${targetPage}`;
}

const WITHIN_DAYS_LABELS: Record<WithinDays, string> = {
  30:  '30 days',
  60:  '60 days',
  90:  '90 days',
  365: '1 year',
};

export default async function ExpiringCertificationsPage({ searchParams }: Props) {
  const withinDays = parseWithinDays(getString(searchParams.withinDays));
  const page = parseInt(getString(searchParams.page) ?? '1', 10);

  const params = new URLSearchParams();
  params.set('withinDays', String(withinDays));
  params.set('page', String(page));
  params.set('pageSize', String(PAGE_SIZE));

  // 403 is an expected role restriction — render gracefully inside the shell.
  // Other errors re-throw to the error boundary.
  let response: ExpiringCertListApiResponse;

  try {
    response = await serverFetch<ExpiringCertListApiResponse>(
      `/api/v1/employee-certifications/expiring?${params.toString()}`,
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) {
      return (
        <WorkforceShell activeTab="certifications" breadcrumb="Expiring Certifications">
          <div
            className="rounded-lg border p-8 text-center"
            style={{ borderColor: '#e2e8f0', backgroundColor: '#f8fafc' }}
          >
            <h3 className="text-base font-semibold" style={{ color: '#0f172a' }}>
              Access restricted
            </h3>
            <p className="mt-2 text-sm" style={{ color: '#475569' }}>
              This report is available to System Administrators, HR Directors, Workforce Planners,
              and Compliance Officers.
            </p>
            <p className="mt-1 text-sm" style={{ color: '#94a3b8' }}>
              Contact your administrator if you believe this is an error.
            </p>
          </div>
        </WorkforceShell>
      );
    }
    throw err;
  }

  const { expiringCertifications, total, page: currentPage, pageSize, totalPages } = response.data;

  const rangeStart = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const rangeEnd   = Math.min(currentPage * pageSize, total);

  return (
    <WorkforceShell activeTab="certifications" breadcrumb="Expiring Certifications">
      {/* Page header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <Link
              href="/workforce/certifications"
              className="text-sm hover:underline"
              style={{ color: '#2563eb' }}
            >
              ← Certifications
            </Link>
          </div>
          <h2 className="text-2xl font-bold tracking-tight">Expiring Certifications</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Employee certifications expiring within the selected window
          </p>
        </div>
      </div>

      {/* withinDays quick-select filter */}
      <div className="mb-5 flex items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide" style={{ color: '#94a3b8' }}>
          Window
        </span>
        <div className="flex gap-1.5">
          {VALID_WITHIN_DAYS.map((d) => {
            const isActive = d === withinDays;
            return (
              <Link
                key={d}
                href={`/workforce/certifications/expiring?withinDays=${d}`}
                className="rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
                style={
                  isActive
                    ? { backgroundColor: '#0c2340', color: '#ffffff' }
                    : { backgroundColor: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0' }
                }
              >
                {WITHIN_DAYS_LABELS[d]}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Table */}
      <ExpiringCertificationTable items={expiringCertifications} withinDays={withinDays} />

      {/* Pagination */}
      {total > 0 && (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          buildUrl={(p) => buildPageUrl(withinDays, p)}
          summary={
            <span>
              Showing {rangeStart}–{rangeEnd} of {total}{' '}
              {total === 1 ? 'certification' : 'certifications'} expiring within {withinDays} days
            </span>
          }
        />
      )}
    </WorkforceShell>
  );
}
