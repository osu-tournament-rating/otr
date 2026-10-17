'use client';

import type { Ruleset } from '@otr/core/osu';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';

import {
  MOST_PLAYED_VALUE,
  fromRulesetSelectValue,
  getMostPlayedLabel,
  getMostPlayedRuleset,
  toRulesetSelectValue,
  type RulesetSettingKey,
  type RulesetSettingValue,
} from '@/app/settings/default-ruleset';
import RulesetIcon, { AllRulesetsIcon } from '@/components/icons/RulesetIcon';
import { FormGrid } from '@/components/kit/controls/FormPanel';
import { FormFieldLabel } from '@/components/kit/controls/FormFieldLabel';
import { Panel, PanelBody } from '@/components/kit/layout/Panel';
import { SectionHeader } from '@/components/kit/layout/SectionHeader';
import { RulesetSelectContent } from '@/components/tournaments/TournamentFieldOptions';
import {
  Select,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { orpc } from '@/lib/orpc/orpc';
import type { UserSettings } from '@/lib/orpc/schema/user';
import { errorSaveToast, saveToast } from '@/lib/utils/toasts';

const FIELDS: readonly { key: RulesetSettingKey; label: string }[] = [
  { key: 'profileRuleset', label: 'Your profile' },
  { key: 'browsingRuleset', label: 'Leaderboard and tournaments' },
];

/**
 * The rulesets the player's profile and their own lists open in. Each select
 * saves as it changes.
 */
export default function DefaultRulesetClient({
  settings,
}: {
  settings: UserSettings;
}) {
  return (
    <Panel data-testid="settings-default-ruleset-section">
      <SectionHeader icon={AllRulesetsIcon} title="Default ruleset" />
      <PanelBody>
        <FormGrid>
          {FIELDS.map((field) => (
            <RulesetSettingField
              key={field.key}
              setting={field.key}
              label={field.label}
              initialValue={settings[field.key]}
              mostPlayed={settings.mostPlayedRuleset}
            />
          ))}
        </FormGrid>
      </PanelBody>
    </Panel>
  );
}

function RulesetSettingField({
  setting,
  label,
  initialValue,
  mostPlayed,
}: {
  setting: RulesetSettingKey;
  label: string;
  initialValue: Ruleset | null;
  mostPlayed: Ruleset | null;
}) {
  const id = useId();
  const fallback = getMostPlayedRuleset(setting, mostPlayed);
  const router = useRouter();
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);

  const save = async (next: RulesetSettingValue) => {
    const previous = value;
    setValue(next);
    setSaving(true);
    try {
      await orpc.users.updateSettings(
        setting === 'profileRuleset'
          ? { profileRuleset: next }
          : { browsingRuleset: next }
      );
      saveToast();
      router.refresh();
    } catch (error) {
      setValue(previous);
      errorSaveToast(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <FormFieldLabel htmlFor={id}>{label}</FormFieldLabel>
      <Select
        value={toRulesetSelectValue(value)}
        onValueChange={(next) => void save(fromRulesetSelectValue(next))}
        disabled={saving}
      >
        <SelectTrigger
          id={id}
          className="w-full"
          data-testid={`settings-${setting}-select`}
        >
          <SelectValue />
        </SelectTrigger>
        <RulesetSelectContent
          leading={
            <>
              <SelectItem value={MOST_PLAYED_VALUE}>
                {fallback !== null && (
                  <RulesetIcon
                    ruleset={fallback}
                    aria-hidden="true"
                    className="size-4 fill-current text-muted-foreground"
                  />
                )}
                {getMostPlayedLabel(fallback)}
              </SelectItem>
              <SelectSeparator />
            </>
          }
        />
      </Select>
    </div>
  );
}
