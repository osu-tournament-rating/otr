import {
  ApiKeysPanelSkeleton,
  DangerZonePanelSkeleton,
  DefaultRulesetPanelSkeleton,
  FriendsPanelSkeleton,
  SettingsFrame,
  ShortcutsPanelSkeleton,
} from './SettingsFrame';

export default function SettingsLoading() {
  return (
    <SettingsFrame>
      <DefaultRulesetPanelSkeleton label="Loading settings" />
      <FriendsPanelSkeleton />
      <ApiKeysPanelSkeleton />
      <ShortcutsPanelSkeleton />
      <DangerZonePanelSkeleton />
    </SettingsFrame>
  );
}
