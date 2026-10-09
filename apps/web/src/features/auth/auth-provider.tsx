'use client';

import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { onSessionExpired } from '@/lib/api-client';
import { isAbortError, isUnauthenticated } from '@/lib/api-errors';
import type { User } from '@/lib/dto';

import { fetchMe, logout as logoutRequest } from './auth-api';

export type AuthState =
  | { status: 'loading' }
  | { status: 'authenticated'; user: User }
  | { status: 'unauthenticated' }
  /** `me` could not be reached. This is not a logout: the session may still be valid. */
  | { status: 'error'; error: unknown };

type AuthContextValue = {
  state: AuthState;
  retry: () => void;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const controllerRef = useRef<AbortController | null>(null);
  const queryClient = useQueryClient();

  const load = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const user = await fetchMe(controller.signal);
      if (!controller.signal.aborted) setState({ status: 'authenticated', user });
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) return;
      setState(isUnauthenticated(error) ? { status: 'unauthenticated' } : { status: 'error', error });
    }
  }, []);

  useEffect(() => {
    // Resolving the session on mount is the synchronization this effect exists for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    return () => controllerRef.current?.abort();
  }, [load]);

  // Any later request that finds the session gone ends the authenticated state for the whole shell.
  useEffect(() => onSessionExpired(() => setState({ status: 'unauthenticated' })), []);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    void load();
  }, [load]);

  const logout = useCallback(async () => {
    await logoutRequest();
    setState({ status: 'unauthenticated' });
  }, []);

  // Cached server data belongs to the signed-in user; none of it survives the end of the session.
  const signedOut = state.status === 'unauthenticated';
  useEffect(() => {
    if (signedOut) queryClient.clear();
  }, [signedOut, queryClient]);

  const value = useMemo(() => ({ state, retry, logout }), [state, retry, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}

/** For components rendered only below the authenticated gate. */
export function useCurrentUser(): User {
  const { state } = useAuth();
  if (state.status !== 'authenticated') throw new Error('useCurrentUser requires an authenticated session');
  return state.user;
}
