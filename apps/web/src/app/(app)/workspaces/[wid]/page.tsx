import { redirect } from 'next/navigation';

export default async function Page({ params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  redirect(`/workspaces/${wid}/dashboard`);
}
