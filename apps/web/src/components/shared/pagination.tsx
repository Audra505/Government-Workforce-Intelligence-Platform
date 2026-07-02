// Shared pagination controls component.
// Renders Previous/Next navigation with a page count display and optional summary.
// Used by Workforce list pages in M21B and available for Recruiting pages.
// Reference: governance/GD-M21-1.md — Decision 15

import Link from 'next/link';

type Props = {
  currentPage: number;
  totalPages: number;
  buildUrl: (page: number) => string;
  summary?: React.ReactNode;
};

export function Pagination({ currentPage, totalPages, buildUrl, summary }: Props) {
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
      <span>{summary}</span>
      <div className="flex items-center gap-2">
        {currentPage > 1 ? (
          <Link
            href={buildUrl(currentPage - 1)}
            className="rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-muted"
          >
            ← Previous
          </Link>
        ) : (
          <span
            aria-disabled="true"
            className="cursor-not-allowed rounded-md border px-3 py-1.5 text-sm opacity-40"
          >
            ← Previous
          </span>
        )}
        <span className="px-2">Page {currentPage} of {totalPages}</span>
        {currentPage < totalPages ? (
          <Link
            href={buildUrl(currentPage + 1)}
            className="rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-muted"
          >
            Next →
          </Link>
        ) : (
          <span
            aria-disabled="true"
            className="cursor-not-allowed rounded-md border px-3 py-1.5 text-sm opacity-40"
          >
            Next →
          </span>
        )}
      </div>
    </div>
  );
}
