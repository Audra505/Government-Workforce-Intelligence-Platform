import { redirect } from 'next/navigation';

// /recruiting → /recruiting/candidates
// Decision 2 (GD-M20-1): /recruiting redirects to the candidates list.
export default function RecruitingPage() {
  redirect('/recruiting/candidates');
}
