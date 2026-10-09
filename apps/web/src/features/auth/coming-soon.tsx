'use client';

import {Badge} from '@/components/ui/badge'
import {Button} from '@/components/ui/button'
import { useT } from '@/i18n/locale-provider';

/** Sign-in options the API does not offer yet. They are shown disabled so the layout is ready for them. */
export function SocialSignIn() {
  const t = useT();
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3 px-6 text-sm text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        {t.auth.orLoginWith}
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Button
          type="button"
          variant="outline"
          disabled
          className="h-12 rounded-xl text-sm font-medium"
        >
          <GoogleMark />
          Google
          <Soon />
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled
          className="h-12 rounded-xl text-sm font-medium"
        >
          <FacebookMark />
          Facebook
          <Soon />
        </Button>
      </div>
    </div>
  )
}

export function ForgotPassword() {
  const t = useT();
  return (
    <span
      className="flex items-center gap-1.5 self-end text-xs text-muted-foreground"
      aria-disabled="true"
    >
      {t.auth.forgotPassword}
    </span>
  )
}

function Soon() {
  const t = useT();
  return (
    <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-medium">
      {t.auth.soon}
    </Badge>
  )
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.5 5.5 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.700z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.2 0 6-1.1 8-2.900l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.300v3.100A12 12 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.3 14.300a7.2 7.2 0 0 1 0-4.600V6.600H1.300a12 12 0 0 0 0 10.800l4-3.100z"
      />
      <path
        fill="#EA4335"
        d="M12 4.800c1.8 0 3.3.6 4.6 1.800L20 3.100A12 12 0 0 0 1.3 6.600l4 3.100c.9-2.9 3.6-4.9 6.7-4.900z"
      />
    </svg>
  )
}

function FacebookMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#1877F2"
        d="M24 12a12 12 0 1 0-13.9 11.900v-8.400H7.100V12h3V9.400c0-3 1.8-4.7 4.5-4.7 1.3 0 2.7.2 2.7.200v3h-1.500c-1.5 0-2 .9-2 1.900V12h3.400l-.5 3.500h-2.900v8.400A12 12 0 0 0 24 12z"
      />
    </svg>
  )
}
