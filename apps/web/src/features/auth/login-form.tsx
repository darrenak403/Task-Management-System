'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n/locale-provider';
import { errorMessage, fieldErrors, isApiError } from '@/lib/api-errors';
import { validate, type FieldErrors } from '@/lib/form';

import { login } from './auth-api';
import { AUTH_SUBMIT_CLASS, AuthField, AuthHeading } from './auth-form-parts';
import { ForgotPassword, SocialSignIn } from './coming-soon';
import { loginSchema } from './auth-schemas';

export function LoginForm() {
  const t = useT();
  const router = useRouter();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = validate(loginSchema, {
      email: form.get('email'),
      password: form.get('password'),
    });
    setFormError(null);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setPending(true);
    try {
      await login(result.data);
      router.replace('/workspaces');
    } catch (error) {
      setPending(false);
      setErrors(fieldErrors(error));
      setFormError(isApiError(error) && error.code === 'INVALID_CREDENTIALS' ? t.auth.invalidCredentials : errorMessage(error));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <AuthHeading title={t.auth.welcomeBack} description={t.auth.welcomeBackDescription} />
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {formError ? (
          <Alert variant="destructive">
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}
        <AuthField id="email" label={t.auth.emailAddress} type="email" autoComplete="email" error={errors.email} />
        <AuthField id="password" label={t.auth.password} type="password" autoComplete="current-password" error={errors.password} />
        <ForgotPassword />
        <Button type="submit" disabled={pending} className={AUTH_SUBMIT_CLASS}>
          {pending ? t.auth.signingIn : t.auth.signIn}
        </Button>
      </form>
      <SocialSignIn />
      <p className="text-center text-sm text-muted-foreground">
        {t.auth.noAccount}{' '}
        <Link href="/register" className="font-medium text-primary underline underline-offset-4">
          {t.auth.signUp}
        </Link>
      </p>
    </div>
  );
}
