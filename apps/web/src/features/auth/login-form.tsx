'use client';

// Login form — React Hook Form + Zod v4 + shadcn/ui.
// Calls BFF POST /api/auth/login (Step 3 route handler), not NestJS directly.
// JWT is never returned to the browser; the BFF sets the httpOnly session cookie.
// Reference: spec/07_security_architecture.md — Login Flow, prohibited LocalStorage JWT
// Reference: spec/09_frontend_architecture.md — Form Standards, Session Storage

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';

// Validation rules are intentionally limited to shape/size — NOT password complexity.
// Password complexity (min 12 chars, uppercase, digit, special char) is a registration-only
// constraint enforced by the CreateUserDto. LoginDto has no @MinLength — the backend does not
// apply complexity rules at login, so neither does the frontend.
// max(254) mirrors LoginDto @MaxLength(254); max(1000) mirrors @MaxLength(1000) (bcrypt DoS guard).
const loginSchema = z.object({
  email: z
    .string()
    .min(1, 'Email is required')
    .max(254, 'Email address is too long')
    .email('Please enter a valid email address'),
  password: z.string().min(1, 'Password is required').max(1000, 'Password is too long'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export function LoginForm() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  async function onSubmit(values: LoginFormValues) {
    setIsLoading(true);
    setServerError(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });

      const data = (await res.json()) as {
        success: boolean;
        error?: { code: string; message: string };
      };

      if (!res.ok || !data.success) {
        // All 401 responses map to a single generic message to prevent user enumeration.
        // NestJS collapses wrong password, unknown email, and locked account into one 401.
        setServerError(
          res.status === 401
            ? 'Invalid email or password.'
            : 'Service unavailable. Please try again.',
        );
        return;
      }

      router.push('/dashboard');
    } catch {
      setServerError('An unexpected error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-4">
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email address</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  autoComplete="email"
                  placeholder="you@agency.gov"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Password</FormLabel>
              <FormControl>
                <Input
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {serverError && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {serverError}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </Form>
  );
}
