// Shared empty state component.
// Renders a dashed-border placeholder block for tables and lists with no data.
// Reference: governance/GD-M21-1.md — Decision 15

type Props = {
  message: string;
};

export function EmptyState({ message }: Props) {
  return (
    <div
      className="rounded-md border border-dashed p-12 text-center"
      style={{ borderColor: '#e2e8f0' }}
    >
      <p className="text-sm" style={{ color: '#94a3b8' }}>
        {message}
      </p>
    </div>
  );
}
