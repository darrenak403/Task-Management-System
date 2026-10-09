type Person = { email: string; displayName: string | null };

export function displayNameOf(person: Person): string {
  return person.displayName?.trim() || person.email;
}

export function initialsOf(person: Person): string {
  const words = displayNameOf(person)
    .split(/[\s@._-]+/)
    .filter(Boolean);
  const first = words[0]?.[0] ?? '?';
  const second = words[1]?.[0] ?? '';
  return (first + second).toUpperCase();
}
