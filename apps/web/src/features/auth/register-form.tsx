'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n/locale-provider';
import { errorMessage, fieldErrors, isApiError } from '@/lib/api-errors';
import { validate, type FieldErrors } from '@/lib/form';

import { register } from './auth-api';
import { AUTH_SUBMIT_CLASS, AuthField, AuthHeading } from './auth-form-parts';
import { registerSchema } from './auth-schemas';

export function RegisterForm() {
  const t = useT();
  const router = useRouter();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = validate(registerSchema, {
      displayName: form.get('displayName'),
      email: form.get('email'),
      password: form.get('password'),
      confirmPassword: form.get('confirmPassword'),
    });
    setFormError(null);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setPending(true);
    try {
      await register(result.data);
      router.replace('/workspaces');
    } catch (error) {
      setPending(false);
      if (isApiError(error) && error.code === 'EMAIL_ALREADY_REGISTERED') {
        setErrors({ email: t.auth.emailTaken });
        return;
      }
      const serverFields = fieldErrors(error);
      setErrors(serverFields);
      if (Object.keys(serverFields).length === 0) setFormError(errorMessage(error));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <AuthHeading title={t.auth.createYourAccount} description={t.auth.createYourAccountDescription} />
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {formError ? (
          <Alert variant="destructive">
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}
        <AuthField id="displayName" label={t.auth.nameOptional} autoComplete="name" error={errors.displayName} />
        <AuthField id="email" label={t.auth.emailAddress} type="email" autoComplete="email" error={errors.email} />
        <AuthField
          id="password"
          label={t.auth.password}
          type="password"
          autoComplete="new-password"
          hint={t.auth.passwordHint}
          error={errors.password}
        />
        <AuthField id="confirmPassword" label={t.auth.confirmPassword} type="password" autoComplete="new-password" error={errors.confirmPassword} />
        <Button type="submit" disabled={pending} className={AUTH_SUBMIT_CLASS}>
          {pending ? t.auth.creatingAccount : t.auth.createAccount}
        </Button>
      </form>
      <p className="text-center text-sm text-muted-foreground">
        {t.auth.haveAccount}{' '}
        <Link href="/login" className="font-medium text-primary underline underline-offset-4">
          {t.auth.signIn}
        </Link>
      </p>
    </div>
  );
}
