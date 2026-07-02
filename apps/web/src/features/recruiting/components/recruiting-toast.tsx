'use client';

// Backward-compatible re-export shim for Recruiting toast consumers.
// The implementation has moved to @/components/shared/toast (GD-M21-1 D12).
// All existing Recruiting imports of useRecruitingToast and RecruitingToastContainer
// continue to work without modification.
// Reference: governance/GD-M21-1.md — Decision 12

export type { ToastItem as RecruitingToastItem } from '@/components/shared/toast';
export { useToast as useRecruitingToast, ToastContainer as RecruitingToastContainer } from '@/components/shared/toast';
