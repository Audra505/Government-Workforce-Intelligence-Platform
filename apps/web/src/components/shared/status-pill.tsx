// Shared status pill primitive — platform-wide.
// Filled rounded-full pill: colored background + matching text + border.
// Used by workforce and recruiting status column wrappers (M23 visual refinement).
// StatusDot is retained for detail pages and secondary indicators.

const PILL_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  green:  { bg: '#f0fdf4', text: '#16a34a', border: '#bbf7d0' },
  yellow: { bg: '#fffbeb', text: '#d97706', border: '#fde68a' },
  blue:   { bg: '#eff6ff', text: '#2563eb', border: 'rgba(37,99,235,.2)' },
  orange: { bg: '#fff7ed', text: '#ea580c', border: '#fed7aa' },
  purple: { bg: '#f5f3ff', text: '#7c3aed', border: '#ddd6fe' },
  red:    { bg: '#fef2f2', text: '#dc2626', border: '#fecaca' },
  gray:   { bg: '#f8fafc', text: '#64748b', border: '#e2e8f0' },
};

export type StatusPillColor = keyof typeof PILL_COLORS;

type StatusPillProps = {
  color: StatusPillColor;
  label: string;
};

export function StatusPill({ color, label }: StatusPillProps) {
  const { bg, text, border } = PILL_COLORS[color];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontSize: 11,
        fontWeight: 600,
        padding: '2px 8px',
        borderRadius: 9999,
        lineHeight: '1.5',
        backgroundColor: bg,
        color: text,
        border: `1px solid ${border}`,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}
