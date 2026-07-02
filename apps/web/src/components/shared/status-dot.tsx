// Shared status dot primitive — platform-wide.
// 6px filled circle + label text, font-weight 500.
// Used by Recruiting convenience wrappers and (from M21C) Workforce status dot wrappers.
// Reference: governance/GD-M21-1.md — Decision 10, Decision 14
// Reference: governance/GD-M20-1.md — Decision 16

const DOT_HEX: Record<string, string> = {
  green:  '#16a34a',
  yellow: '#ca8a04',
  blue:   '#2563eb',
  orange: '#ea580c',
  purple: '#7c3aed',
  red:    '#dc2626',
  gray:   '#64748b',
};

export type StatusDotColor = keyof typeof DOT_HEX;

type StatusDotProps = {
  color: StatusDotColor;
  label: string;
};

export function StatusDot({ color, label }: StatusDotProps) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm" style={{ color: '#0f172a', fontWeight: 500 }}>
      <span
        aria-hidden="true"
        style={{
          display: 'inline-block',
          width: 6,
          height: 6,
          borderRadius: '50%',
          backgroundColor: DOT_HEX[color],
          flexShrink: 0,
        }}
      />
      {label}
    </span>
  );
}
