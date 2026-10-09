import { api } from '@/lib/api-client';
import type { User } from '@/lib/dto';

type UserResponse = { data: User };

export async function fetchMe(signal?: AbortSignal): Promise<User> {
  return (await api<UserResponse>('/auth/me', { signal })).data;
}

export async function login(input: { email: string; password: string }): Promise<User> {
  return (await api<UserResponse>('/auth/login', { method: 'POST', body: input })).data;
}

export async function register(input: { email: string; password: string; displayName?: string }): Promise<User> {
  return (await api<UserResponse>('/auth/register', { method: 'POST', body: input })).data;
}

export async function logout(): Promise<void> {
  await api<void>('/auth/logout', { method: 'POST' });
}
