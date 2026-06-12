import { LoginForm } from '@/features/auth/login-form';

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-6 px-6">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold tracking-tight">Sign in</h1>
          <p className="text-sm text-muted-foreground">
            Government Workforce Intelligence Platform
          </p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
