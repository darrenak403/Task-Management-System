import type * as React from 'react';

import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

type TextFieldProps = React.ComponentProps<typeof Input> & {
  id: string;
  label: string;
  error?: string | undefined;
  description?: string;
};

/** Labelled input whose error and hint are announced through `aria-describedby`. */
export function TextField({ id, label, error, description, ...inputProps }: TextFieldProps) {
  const describedBy = [error ? `${id}-error` : null, description ? `${id}-hint` : null].filter(Boolean).join(' ');
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} name={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy || undefined} {...inputProps} />
      {description ? <FieldDescription id={`${id}-hint`}>{description}</FieldDescription> : null}
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
    </Field>
  );
}
