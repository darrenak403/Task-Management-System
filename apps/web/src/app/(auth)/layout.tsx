import Image from 'next/image';

import { LanguageToggle } from '@/components/language-toggle';
import { ModeToggle } from '@/components/mode-toggle';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-svh items-center justify-center bg-muted p-4 md:p-10">
      <div className="absolute top-4 right-4 flex gap-1">
        <LanguageToggle />
        <ModeToggle />
      </div>
      <div className="grid w-full max-w-5xl overflow-hidden rounded-4xl bg-card shadow-xl md:grid-cols-2">
        {/* The poster repeats what the form side already says, so it is decorative and hidden on small screens. */}
        <div className="hidden p-6 md:block lg:p-8">
          <Image
            src="/aim-poster.png"
            alt=""
            width={1086}
            height={1448}
            sizes="(min-width: 1024px) 480px, 45vw"
            loading="eager"
            className="h-full w-full object-contain"
          />
        </div>
        <main className="flex flex-col justify-center p-6 sm:p-10">
          <div className="mx-auto flex w-full max-w-sm flex-col gap-6">
            <div className="flex items-center justify-center gap-1 text-2xl font-bold tracking-tight">
              <Image src="/aim-logo.png" alt="" width={56} height={56} className="size-14 dark:invert" />
              AIM
            </div>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
