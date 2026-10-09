'use client';

import { useState } from 'react';

import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useT } from '@/i18n/locale-provider';

import { GEMINI_MODELS, priceLabel } from './gemini-models';

const CUSTOM = 'custom';

/**
 * Picks a Gemini model from the known list, or any other model name through "Other model".
 * The chosen name is submitted with the surrounding form under `id`.
 */
export function GeminiModelField({
  id,
  defaultValue,
  error,
  disabled,
  onValueChange,
}: {
  id: string;
  defaultValue: string;
  error?: string | undefined;
  disabled?: boolean;
  /** Reports the model name the form would submit, on every change. */
  onValueChange?: (model: string) => void;
}) {
  const t = useT();
  const known = GEMINI_MODELS.some((model) => model.id === defaultValue);
  const [choice, setChoice] = useState(known ? defaultValue : CUSTOM);
  const selected = GEMINI_MODELS.find((model) => model.id === choice);
  const about = selected ? t.aiSettings.models[selected.id] : undefined;

  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={`${id}-select`}>{t.aiSettings.model.label}</FieldLabel>
      <Select
        value={choice}
        onValueChange={(next) => {
          setChoice(next);
          onValueChange?.(next === CUSTOM ? '' : next);
        }}
        disabled={disabled}
      >
        <SelectTrigger id={`${id}-select`} className="w-full" aria-describedby={`${id}-hint`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {GEMINI_MODELS.map((model) => (
            <SelectItem key={model.id} value={model.id}>
              {model.name}
              <span className="ml-2 text-xs text-muted-foreground">{priceLabel(model)}</span>
            </SelectItem>
          ))}
          <SelectItem value={CUSTOM}>{t.aiSettings.model.other}</SelectItem>
        </SelectContent>
      </Select>
      {selected ? (
        <input type="hidden" name={id} value={selected.id} />
      ) : (
        <Input
          name={id}
          aria-label={t.aiSettings.model.nameLabel}
          aria-invalid={error ? true : undefined}
          placeholder="gemini-…"
          defaultValue={known ? '' : defaultValue}
          maxLength={128}
          spellCheck={false}
          disabled={disabled}
          onChange={(event) => onValueChange?.(event.target.value.trim())}
        />
      )}
      <FieldDescription id={`${id}-hint`}>
        {selected ? [about?.summary, about?.note].filter(Boolean).join(' ') : t.aiSettings.model.customHint}
      </FieldDescription>
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
    </Field>
  );
}
