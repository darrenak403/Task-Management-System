import { aiSettings as enAiSettings } from './en/aiSettings';
import { auth as enAuth } from './en/auth';
import { common as enCommon } from './en/common';
import { dashboard as enDashboard } from './en/dashboard';
import { nav as enNav } from './en/nav';
import { teams as enTeams } from './en/teams';
import { workspaces as enWorkspaces } from './en/workspaces';
import { aiSettings as viAiSettings } from './vi/aiSettings';
import { auth as viAuth } from './vi/auth';
import { common as viCommon } from './vi/common';
import { dashboard as viDashboard } from './vi/dashboard';
import { nav as viNav } from './vi/nav';
import { teams as viTeams } from './vi/teams';
import { workspaces as viWorkspaces } from './vi/workspaces';
import { tasks as enTasks } from './en/tasks';
import { tasks as viTasks } from './vi/tasks';
import { planner as enPlanner } from './en/planner';
import { planner as viPlanner } from './vi/planner';

const en = { aiSettings: enAiSettings, auth: enAuth, common: enCommon, dashboard: enDashboard, nav: enNav, teams: enTeams, workspaces: enWorkspaces, planner: enPlanner, tasks: enTasks };
const vi: typeof en = { aiSettings: viAiSettings, auth: viAuth, common: viCommon, dashboard: viDashboard, nav: viNav, teams: viTeams, workspaces: viWorkspaces, planner: viPlanner, tasks: viTasks };

/** Every text the interface shows. English is the source; other languages must provide the same keys. */
export type Messages = typeof en;

export const LOCALES = ['en', 'vi'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_COOKIE = 'locale';
export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', vi: 'Tiếng Việt' };

export const DICTIONARIES: Record<Locale, Messages> = { en, vi };

export function isLocale(value: unknown): value is Locale {
  return LOCALES.includes(value as Locale);
}

let active: Locale = DEFAULT_LOCALE;

/** Called by the locale provider so code outside React reads the same language as the components. */
export function setActiveLocale(locale: Locale): void {
  active = locale;
}

/** Texts in the active language, for code that cannot use the `useT` hook (schemas, error mappers, formatters). */
export function messages(): Messages {
  return DICTIONARIES[active];
}

/** Zod error option that resolves its text when validation runs, so it follows the active language. */
export function msg(pick: (m: Messages) => string): { error: () => string } {
  return { error: () => pick(messages()) };
}

const INTL_TAGS: Record<Locale, string> = { en: 'en-US', vi: 'vi-VN' };

/** BCP 47 tag of the active language, for `Intl` formatters. */
export function intlLocale(): string {
  return INTL_TAGS[active];
}
