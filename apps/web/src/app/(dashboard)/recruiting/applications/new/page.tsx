// /recruiting/applications/new — redirects to candidates list.
// Applications are created from the candidate detail page (CandidateActions panel).
// GD-M20-1 Decision 2: no standalone new-application route authorized in M20.
import { redirect } from 'next/navigation';

export default function NewApplicationPage() {
  redirect('/recruiting/candidates');
}
