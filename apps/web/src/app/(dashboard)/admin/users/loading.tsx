// Streaming placeholder while /admin/users fetches data.

export default function UsersLoading() {
  return (
    <div className="flex min-h-[300px] items-center justify-center" style={{ color: '#94a3b8' }}>
      <span className="text-sm">Loading users…</span>
    </div>
  );
}
