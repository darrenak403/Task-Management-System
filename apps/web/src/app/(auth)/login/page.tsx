import { LoginForm } from '@/features/auth/login-form';
import { titleMetadata } from '@/i18n/server';

export const generateMetadata = titleMetadata((m) => m.auth.signInTitle);

export default function LoginPage() {
  return <LoginForm />;
}
