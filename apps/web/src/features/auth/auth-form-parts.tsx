'use client';

import { EyeIcon, EyeOffIcon } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useT } from '@/i18n/locale-provider';
import { cn } from '@/lib/utils';

/** Heading shared by the sign-in and sign-up forms. */
export function AuthHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col gap-2 text-center">
      <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

type AuthFieldProps = Omit<React.ComponentProps<typeof Input>, 'id' | 'name' | 'placeholder'> & {
  id: string;
  /** Shown inside the empty field and read out as its name. */
  label: string;
  error?: string | undefined;
  hint?: string;
};

/** Filled, borderless field of the auth pages. Password fields get a show/hide toggle. */
export function AuthField({ id, label, error, hint, type = 'text', className, ...inputProps }: AuthFieldProps) {
  const t = useT();
  const [visible, setVisible] = useState(false);
  const isPassword = type === 'password';
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(' ');

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div className="relative">
        <Input
          id={id}
          name={id}
          type={isPassword && visible ? 'text' : type}
          placeholder={label}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={cn('h-12 rounded-xl border-transparent bg-muted px-4 md:text-sm', isPassword && 'pr-12', className)}
          {...inputProps}
        />
        {isPassword ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground"
            aria-label={visible ? t.auth.hidePassword : t.auth.showPassword}
            aria-pressed={visible}
            onClick={() => setVisible((previous) => !previous)}
          >
            {visible ? <EyeIcon aria-hidden="true" /> : <EyeOffIcon aria-hidden="true" />}
          </Button>
        ) : null}
      </div>
      {hint && !error ? (
        <p id={`${id}-hint`} className="px-1 text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="px-1 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const AUTH_SUBMIT_CLASS = 'h-12 w-full rounded-xl text-base font-semibold';
