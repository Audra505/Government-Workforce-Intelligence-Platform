// Shared pagination component — pill button style per M23 visual refinement.
// Renders numbered page buttons with ellipsis for large page counts.
// Prev/Next arrows flank the page buttons.
// Used by Workforce and Recruiting list pages.
// Reference: governance/GD-M21-1.md — Decision 15

import Link from 'next/link';

type Props = {
  currentPage: number;
  totalPages: number;
  buildUrl: (page: number) => string;
  summary?: React.ReactNode;
};

function buildPageNumbers(currentPage: number, totalPages: number): (number | '...')[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const pages: (number | '...')[] = [1];
  if (currentPage > 3) pages.push('...');
  const rangeStart = Math.max(2, currentPage - 1);
  const rangeEnd   = Math.min(totalPages - 1, currentPage + 1);
  for (let i = rangeStart; i <= rangeEnd; i++) pages.push(i);
  if (currentPage < totalPages - 2) pages.push('...');
  pages.push(totalPages);
  return pages;
}

const BTN_BASE = [
  'flex h-[28px] min-w-[28px] items-center justify-center',
  'rounded-[5px] border px-2 text-xs font-medium transition-colors',
].join(' ');

const BTN_DEFAULT = `${BTN_BASE} border-[#e2e8f0] bg-white text-[#475569] hover:border-[#2563eb] hover:text-[#2563eb]`;
const BTN_ACTIVE  = `${BTN_BASE} border-[#2563eb] bg-[#2563eb] text-white`;
const BTN_OFF     = `${BTN_BASE} cursor-not-allowed border-[#e2e8f0] bg-white text-[#475569] opacity-40`;

export function Pagination({ currentPage, totalPages, buildUrl, summary }: Props) {
  const pages = buildPageNumbers(currentPage, totalPages);

  return (
    <div className="mt-4 flex items-center justify-between" style={{ fontSize: 12, color: '#94a3b8' }}>
      <span>{summary}</span>

      <div className="flex items-center gap-1">
        {currentPage > 1 ? (
          <Link href={buildUrl(currentPage - 1)} className={BTN_DEFAULT}>‹</Link>
        ) : (
          <span className={BTN_OFF}>‹</span>
        )}

        {pages.map((p, i) =>
          p === '...' ? (
            <span key={`e${i}`} style={{ padding: '0 4px', lineHeight: '28px' }}>…</span>
          ) : p === currentPage ? (
            <span key={p} className={BTN_ACTIVE}>{p}</span>
          ) : (
            <Link key={p} href={buildUrl(p as number)} className={BTN_DEFAULT}>{p}</Link>
          )
        )}

        {currentPage < totalPages ? (
          <Link href={buildUrl(currentPage + 1)} className={BTN_DEFAULT}>›</Link>
        ) : (
          <span className={BTN_OFF}>›</span>
        )}
      </div>
    </div>
  );
}
