// Streaming placeholder while /oversight/audit fetches data.

export default function AuditLoading() {
  return (
    <div className="flex min-h-[300px] items-center justify-center" style={{ color: '#94a3b8' }}>
      <span className="text-sm">Loading audit events…</span>
    </div>
  );
}
