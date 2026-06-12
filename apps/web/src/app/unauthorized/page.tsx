import Link from 'next/link';

export default function UnauthorizedPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-bold">Access Denied</h1>
      <p className="text-sm text-muted-foreground">
        You do not have permission to view this page.
      </p>
      <Link
        href="/login"
        className="text-sm underline underline-offset-4 hover:text-primary"
      >
        Return to sign in
      </Link>
    </div>
  );
}
