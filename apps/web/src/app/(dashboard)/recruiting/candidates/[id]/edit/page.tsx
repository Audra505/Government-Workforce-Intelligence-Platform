// /recruiting/candidates/[id]/edit — redirects to candidate detail page.
// Candidate actions are handled from the detail page (CandidateActions panel).
// GD-M20-1 Decision 2: standalone edit form not authorized in M20.
import { redirect } from 'next/navigation';

type Props = {
  params: { id: string };
};

export default function EditCandidatePage({ params }: Props) {
  redirect(`/recruiting/candidates/${params.id}`);
}
