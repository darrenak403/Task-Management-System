import { RegisterForm } from '@/features/auth/register-form';
import { titleMetadata } from '@/i18n/server';

export const generateMetadata = titleMetadata((m) => m.auth.createAccountTitle);

export default function RegisterPage() {
  return <RegisterForm />;
}
