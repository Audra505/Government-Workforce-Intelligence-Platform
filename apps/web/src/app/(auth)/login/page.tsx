import { LoginForm } from '@/features/auth/login-form';

const NAVY  = '#0c2340';
const BLUE  = '#2563eb';
const TEXT  = '#0f172a';
const SUB   = '#475569';
const MUTED = '#94a3b8';

export default function LoginPage() {
  return (
    <div className="flex min-h-screen bg-white">
      {/* ── Left panel — navy brand strip, hidden on mobile ── */}
      <div
        className="hidden lg:flex lg:w-[44%] flex-shrink-0 flex-col"
        style={{
          backgroundColor: NAVY,
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.032) 1px, transparent 1px), ' +
            'linear-gradient(90deg, rgba(255,255,255,0.032) 1px, transparent 1px)',
          backgroundSize: '52px 52px',
          padding: '52px',
        }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <div
            className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center text-[10px] font-extrabold text-white"
            style={{ backgroundColor: BLUE }}
          >
            GW
          </div>
          <span
            className="text-[11px] font-bold uppercase"
            style={{ color: 'rgba(255,255,255,0.8)', letterSpacing: '0.15em' }}
          >
            GWIP
          </span>
        </div>

        {/* Body */}
        <div className="flex flex-1 flex-col justify-center" style={{ padding: '48px 0 40px' }}>
          <div className="mb-7 h-0.5 w-8" style={{ backgroundColor: BLUE }} />
          <p
            className="mb-5 text-[25px] font-bold text-white"
            style={{ lineHeight: 1.32, maxWidth: '22ch' }}
          >
            Workforce intelligence for the public sector.
          </p>
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.42)', lineHeight: 1.78 }}>
            Manage positions, employees, and recruiting pipelines across your agency
            — structured, auditable, and built for accountability.
          </p>
        </div>

        {/* Footer */}
        <p
          className="text-[10px] font-medium uppercase"
          style={{ color: 'rgba(255,255,255,0.18)', letterSpacing: '0.1em' }}
        >
          Government Workforce Intelligence Platform &nbsp;·&nbsp; Restricted Access
        </p>
      </div>

      {/* ── Right panel — form ── */}
      <div className="flex flex-1 items-center justify-center bg-white px-10 py-12">
        <div className="w-full max-w-[344px]">
          <p
            className="mb-2.5 text-[10px] font-bold uppercase"
            style={{ color: MUTED, letterSpacing: '0.12em' }}
          >
            Secure sign-in
          </p>
          <h1 className="mb-1.5 text-[22px] font-bold" style={{ color: TEXT }}>
            Sign in to GWIP
          </h1>
          <p className="mb-9 text-sm leading-relaxed" style={{ color: SUB }}>
            Use your agency credentials to continue.
          </p>
          <LoginForm />
        </div>
      </div>
    </div>
  );
}
