'use client';

// Shared toast feedback system — platform-wide.
// Extracted from recruiting-toast.tsx. recruiting-toast.tsx re-exports from here
// for backward compatibility with existing Recruiting component imports.
// Behavior: success auto-dismisses at 4s; error at 8s with manual dismiss button.
// Reference: governance/GD-M21-1.md — Decision 12
// Reference: governance/GD-M20-1.md — Decision 16 (Feedback Pattern)

import { useState, useCallback, useEffect } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToastItem = {
  id: string;
  type: 'success' | 'error';
  title: string;
  message?: string;
};

// ---------------------------------------------------------------------------
// Hook — owns toast list state
// ---------------------------------------------------------------------------

export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((item: Omit<ToastItem, 'id'>) => {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { ...item, id }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, addToast, dismissToast };
}

// ---------------------------------------------------------------------------
// Single toast item — auto-dismisses; success 4s, error 8s
// ---------------------------------------------------------------------------

function SingleToast({
  item,
  onDismiss,
}: {
  item: ToastItem;
  onDismiss: (id: string) => void;
}) {
  const isSuccess = item.type === 'success';

  useEffect(() => {
    const ms = isSuccess ? 4000 : 8000;
    const timer = setTimeout(() => onDismiss(item.id), ms);
    return () => clearTimeout(timer);
  }, [item.id, isSuccess, onDismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-w-[280px] max-w-sm items-start justify-between gap-3 rounded-md px-4 py-3 shadow-lg"
      style={{
        backgroundColor: isSuccess ? '#f0fdf4' : '#fef2f2',
        border: `1px solid ${isSuccess ? '#bbf7d0' : '#fecaca'}`,
      }}
    >
      <div className="min-w-0 flex-1">
        <p
          className="text-sm font-semibold"
          style={{ color: isSuccess ? '#15803d' : '#dc2626' }}
        >
          {item.title}
        </p>
        {item.message && (
          <p
            className="mt-0.5 text-xs leading-relaxed"
            style={{ color: isSuccess ? '#166534' : '#b91c1c' }}
          >
            {item.message}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(item.id)}
        className="shrink-0 transition-opacity hover:opacity-60"
        style={{ color: isSuccess ? '#166534' : '#b91c1c', fontSize: 13, lineHeight: 1 }}
        aria-label="Dismiss notification"
      >
        ✕
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Container — renders at bottom-right over all page content
// ---------------------------------------------------------------------------

export function ToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <SingleToast item={t} onDismiss={onDismiss} />
        </div>
      ))}
    </div>
  );
}
