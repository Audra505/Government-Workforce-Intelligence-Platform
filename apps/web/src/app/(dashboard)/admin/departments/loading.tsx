// Streaming placeholder while /admin/departments fetches data.
// Mirrors workforce/positions/loading.tsx structure (GD-M25-1 D12).

export default function DepartmentsLoading() {
  return (
    <div className="flex min-h-[300px] items-center justify-center" style={{ color: '#94a3b8' }}>
      <span className="text-sm">Loading departments…</span>
    </div>
  );
}
