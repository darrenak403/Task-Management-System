import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { getMessages } from '@/i18n/server';

export default async function NotFound() {
  const t = (await getMessages()).common.notFound;

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold">{t.title}</h1>
      <p className="text-sm text-muted-foreground">{t.message}</p>
      <Button asChild>
        <Link href="/workspaces">{t.action}</Link>
      </Button>
    </main>
  );
}
