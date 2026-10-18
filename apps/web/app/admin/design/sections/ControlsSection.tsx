'use client';

import { VerificationStatus } from '@otr/core/osu';
import {
  ArrowDownWideNarrow,
  CalendarDays,
  ChevronDown,
  Database,
  ExternalLink,
  Filter,
  Flag,
  Gamepad2,
  GitMerge,
  History,
  ListChecks,
  LogOut,
  Music2,
  NotebookPen,
  PencilLine,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings,
  ShieldCheck,
  Swords,
  Target,
  Trash2,
  Trophy,
  Unlink,
  Upload,
  User,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import Image from 'next/image';
import * as React from 'react';
import { useForm } from 'react-hook-form';

import { GallerySection, Specimen } from '../gallery';
import { DELETE_CASCADE_DESCRIPTION } from '@/components/admin-forms/adminFormFields';
import { ActionMenu } from '@/components/kit/controls/ActionMenu';
import { AdminMenu } from '@/components/kit/controls/AdminMenu';
import { Button, type ButtonSize } from '@/components/kit/controls/Button';
import { ConfirmDialog } from '@/components/kit/controls/ConfirmDialog';
import {
  DIALOG_CLASSES,
  DIALOG_SIZE_CLASSES,
  DialogFooterStrip,
  DialogTemplate,
  type DialogSize,
} from '@/components/kit/controls/DialogTemplate';
import { FormFieldLabel } from '@/components/kit/controls/FormFieldLabel';
import {
  FormActions,
  FormGrid,
  FormPanel,
  FormSection,
} from '@/components/kit/controls/FormPanel';
import { IconButton } from '@/components/kit/controls/IconButton';
import { RowActionsMenu } from '@/components/kit/controls/RowActionsMenu';
import { DetailHero, HeroMetaItem } from '@/components/kit/layout/DetailHero';
import { PageHeader } from '@/components/kit/layout/PageHeader';
import { Panel, PanelBody } from '@/components/kit/layout/Panel';
import { RowList, RowListItem } from '@/components/kit/layout/RowList';
import { SectionHeader } from '@/components/kit/layout/SectionHeader';
import { typeScale } from '@/components/kit/layout/Typography';
import { Badge } from '@/components/kit/status/Badge';
import { NotificationDot } from '@/components/kit/status/NotificationDot';
import { VerificationStatusBadge } from '@/components/kit/status/VerificationStatusBadge';
import { VerificationStatusIcon } from '@/components/kit/status/VerificationStatusIcon';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { formatLobbySize } from '@/lib/kit/format/fields';
import { RATED_RULESETS, RULESET_NAMES } from '@/lib/kit/format/ruleset';
import {
  FORUM_POST_URL_PREFIX_MESSAGE,
  FORUM_POST_URL_REQUIRED_MESSAGE,
  FORUM_POST_URL_SOURCE_MESSAGE,
  LOBBY_SIZE_REQUIRED_MESSAGE,
  RANK_RESTRICTION_MINIMUM_MESSAGE,
  RANK_RESTRICTION_REQUIRED_MESSAGE,
  RANK_RESTRICTION_WHOLE_NUMBER_MESSAGE,
  RULESET_REQUIRED_MESSAGE,
  TOURNAMENT_ABBREVIATION_REQUIRED_MESSAGE,
  TOURNAMENT_NAME_REQUIRED_MESSAGE,
  maxBeatmapIdsMessage,
  maxMatchIdsMessage,
} from '@/lib/orpc/schema/tournamentMessages';
import { MAX_SUBMISSION_IDS } from '@/lib/orpc/schema/tournamentSubmission';
import { cn } from '@/lib/utils';

const KIT = '@/components/kit/controls';

/** Stands in for a network call in the demos. */
const wait = (ms: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/** A small caption under a demo control. */
function Caption({ children }: { children: React.ReactNode }) {
  return <span className={typeScale.meta}>{children}</span>;
}

const SIZES: { size: ButtonSize; name: string; use: string }[] = [
  {
    size: 'sm',
    name: 'Small, 32px',
    use: 'Inside panels and heroes: section headers, rows, hero actions, menus.',
  },
  {
    size: 'default',
    name: 'Default, 36px',
    use: 'Form and dialog actions, page header actions.',
  },
  {
    size: 'lg',
    name: 'Large, 40px',
    use: 'List toolbars, beside the 40px search field and sort select.',
  },
];

function ButtonSizes() {
  return (
    <div className="flex flex-col gap-5">
      {SIZES.map(({ size, name, use }) => (
        <div key={size} className="flex flex-col gap-2">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">{name}</span>
            <Caption>{use}</Caption>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size={size} variant="outline">
              Cancel
            </Button>
            <Button size={size}>Save changes</Button>
            <IconButton
              size={size}
              variant="outline"
              label="Filters"
              icon={Filter}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function ButtonVariants() {
  const [saving, setSaving] = React.useState(false);

  const items: { caption: string; control: React.ReactNode }[] = [
    {
      caption: 'Primary, one per view',
      control: <Button icon={Trophy}>Submit tournament</Button>,
    },
    {
      caption: 'Secondary',
      control: <Button variant="outline">Cancel</Button>,
    },
    {
      caption: 'Quiet, inside a panel',
      control: <Button variant="ghost">Clear all</Button>,
    },
    {
      caption: 'Destructive: opens a confirm',
      control: (
        <Button variant="destructive" icon={Trash2}>
          Delete tournament
        </Button>
      ),
    },
    {
      caption: 'Final confirm only',
      control: <Button variant="destructive-confirm">Delete tournament</Button>,
    },
    {
      caption: 'Pending (click it)',
      control: (
        <Button
          pending={saving}
          onClick={async () => {
            setSaving(true);
            await wait(1500);
            setSaving(false);
          }}
        >
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      ),
    },
    {
      caption: 'Drawn on a link',
      control: (
        <Button asChild variant="outline" icon={ExternalLink}>
          <a href="#controls-button-variants">Read our acceptance criteria</a>
        </Button>
      ),
    },
  ];

  return (
    <div className="@container">
      <div className="grid gap-x-6 gap-y-5 @sm:grid-cols-2">
        {items.map(({ caption, control }) => (
          <div key={caption} className="flex flex-col items-start gap-1.5">
            {control}
            <Caption>{caption}</Caption>
          </div>
        ))}
      </div>
    </div>
  );
}

function IconButtons() {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <IconButton size="sm" label="View audit history" icon={History} />
            <IconButton
              size="default"
              label="View audit history"
              icon={History}
            />
            <IconButton size="lg" label="View audit history" icon={History} />
          </div>
          <Caption>Ghost, the default: 32, 36 and 40px</Caption>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <IconButton
              size="sm"
              variant="outline"
              label="Sort order is descending"
              tooltip="Descending order"
              icon={ArrowDownWideNarrow}
            />
            <IconButton
              size="default"
              variant="outline"
              label="Sort order is descending"
              tooltip="Descending order"
              icon={ArrowDownWideNarrow}
            />
            <IconButton
              size="lg"
              variant="outline"
              label="Sort order is descending"
              tooltip="Descending order"
              icon={ArrowDownWideNarrow}
            />
          </div>
          <Caption>Outline, beside inputs</Caption>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <IconButton label="Delete note" icon={Trash2} destructive />
          </div>
          <Caption>Destructive, outside a menu</Caption>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <IconButton asChild label="View on osu!" icon={ExternalLink}>
              <a
                href="https://osu.ppy.sh/beatmaps/1872396"
                target="_blank"
                rel="noopener noreferrer"
              />
            </IconButton>
          </div>
          <Caption>Drawn on a link</Caption>
        </div>
      </div>
      <Panel>
        <SectionHeader
          icon={Swords}
          title="Matches"
          meta="124 matches"
          actions={
            <Button variant="outline" size="sm" icon={Plus}>
              Add matches
            </Button>
          }
        />
        <PanelBody className={typeScale.bodyMuted}>
          A section&apos;s main action keeps its label: a small outline button.
        </PanelBody>
      </Panel>
      <DisclosureDemo />
    </div>
  );
}

/**
 * `expanded` makes an IconButton a disclosure toggle for a row that expands
 * in place: aria-expanded, and no open fill, which belongs to menu triggers.
 */
function DisclosureDemo() {
  const [open, setOpen] = React.useState(true);
  const game = GAMES[0];

  return (
    <Panel>
      <SectionHeader icon={Swords} title="Games" meta="1 game" />
      <RowList>
        <RowListItem>
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{game.name}</p>
              <p className={typeScale.bodyMuted}>{game.detail}</p>
            </div>
            <IconButton
              label={`Details for ${game.name}`}
              icon={ChevronDown}
              expanded={open}
              onClick={() => setOpen((value) => !value)}
              className="[&>svg]:transition-transform aria-expanded:[&>svg]:rotate-180"
            />
          </div>
          {open ? (
            <p className={cn(typeScale.bodyMuted, 'mt-3 border-t pt-3')}>
              Expanded in place: the toggle keeps its resting look.
            </p>
          ) : null}
        </RowListItem>
      </RowList>
    </Panel>
  );
}

// The tournament fields' rules, from lib/orpc/schema/tournamentSubmission.ts
// (submission) and tournamentEditFormSchema in lib/validation-schema.ts
// (edit), with their shared messages from tournamentMessages.ts. Messages
// name the field as its label does, and a missing value reads "… is required".
const FORUM_POST_URL_PATTERN =
  /^(https:\/\/osu\.ppy\.sh\/(community\/forums\/topics\/\d+|wiki\/en\/Tournaments\/[^?#]*))(\?.*)?$/;
const FORUM_POST_URL_PREFIXES = [
  'https://osu.ppy.sh/community/forums/topics/',
  'https://osu.ppy.sh/wiki/en/Tournaments/',
];

/** The edit dialog's rule: a link under either prefix. */
function validateEditedForumPostUrl(value: string) {
  if (value.trim() === '') return FORUM_POST_URL_REQUIRED_MESSAGE;
  return (
    FORUM_POST_URL_PREFIXES.some((prefix) => value.startsWith(prefix)) ||
    FORUM_POST_URL_PREFIX_MESSAGE
  );
}

/** The submission form's rule: a forum topic or a tournament wiki page. */
function validateSubmittedForumPostUrl(value: string) {
  const url = value.trim();
  if (url === '') return FORUM_POST_URL_REQUIRED_MESSAGE;
  return FORUM_POST_URL_PATTERN.test(url) || FORUM_POST_URL_SOURCE_MESSAGE;
}

type EditValues = { abbreviation: string; name: string; forumUrl: string };

const EDIT_DEFAULTS: EditValues = {
  abbreviation: 'BTMC',
  name: 'Break The Meta Cup',
  forumUrl: 'https://osu.ppy.sh/community/forums/topics/1446216',
};

function EditTournamentDialog({
  open,
  onOpenChange,
  trigger,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: React.ReactElement;
}) {
  const [saving, setSaving] = React.useState(false);
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const form = useForm<EditValues>({ defaultValues: EDIT_DEFAULTS });
  const isOpen = open ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (!next) form.reset();
    setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  return (
    <Form {...form}>
      <DialogTemplate
        open={isOpen}
        onOpenChange={setOpen}
        trigger={trigger}
        title="Edit tournament"
        description="Editing Break The Meta Cup"
        onSubmit={form.handleSubmit(async () => {
          setSaving(true);
          await wait(1200);
          setSaving(false);
          setOpen(false);
        })}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" pending={saving}>
              Save
            </Button>
          </>
        }
      >
        <div className="grid items-start gap-4 sm:grid-cols-3">
          <FormField
            control={form.control}
            name="abbreviation"
            rules={{ required: TOURNAMENT_ABBREVIATION_REQUIRED_MESSAGE }}
            render={({ field }) => (
              <FormItem>
                <FormFieldLabel>Abbreviation</FormFieldLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="name"
            rules={{ required: TOURNAMENT_NAME_REQUIRED_MESSAGE }}
            render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormFieldLabel>Name</FormFieldLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="forumUrl"
          rules={{ validate: validateEditedForumPostUrl }}
          render={({ field }) => (
            <FormItem>
              <FormFieldLabel>Forum post URL</FormFieldLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </DialogTemplate>
    </Form>
  );
}

function AdminMenuDemo() {
  const [editOpen, setEditOpen] = React.useState(false);
  const [resetOpen, setResetOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [unlinkPoolOpen, setUnlinkPoolOpen] = React.useState(false);
  const [includeVerified, setIncludeVerified] = React.useState(false);
  const checkboxId = React.useId();

  return (
    <>
      <DetailHero
        title="Break The Meta Cup"
        titleSuffix="BTMC"
        status={
          <VerificationStatusBadge
            status={VerificationStatus.Verified}
            reviewer="apricot"
            tooltip="tap"
          />
        }
        meta={
          <>
            <HeroMetaItem icon={Gamepad2}>osu!</HeroMetaItem>
            <HeroMetaItem icon={Users}>4v4</HeroMetaItem>
            <HeroMetaItem icon={Target}>Open rank</HeroMetaItem>
            <HeroMetaItem icon={CalendarDays}>Dec 4 – 18, 2021</HeroMetaItem>
          </>
        }
        adminActions={
          <AdminMenu
            notification="Has admin notes"
            actions={[
              {
                label: 'Edit tournament',
                icon: PencilLine,
                onSelect: () => setEditOpen(true),
              },
              {
                label: 'Admin notes',
                icon: NotebookPen,
                trailing: <Badge size="sm">2</Badge>,
                onSelect: () => {},
              },
              {
                label: 'Accept pre-verification statuses',
                icon: ListChecks,
                group: 'data',
                onSelect: () => {},
              },
              {
                label: 'Reset automated checks',
                icon: RotateCcw,
                group: 'data',
                onSelect: () => setResetOpen(true),
              },
              {
                label: 'Refetch match data',
                icon: RefreshCw,
                group: 'data',
                onSelect: () => {},
              },
              {
                label: 'Delete tournament',
                icon: Trash2,
                destructive: true,
                onSelect: () => setDeleteOpen(true),
              },
              {
                label: 'Unlink pooled beatmaps',
                icon: Unlink,
                destructive: true,
                onSelect: () => setUnlinkPoolOpen(true),
              },
            ]}
          />
        }
        actions={
          <IconButton
            asChild
            variant="outline"
            label="View on osu!"
            icon={ExternalLink}
          >
            <a
              href="https://osu.ppy.sh/community/forums/topics/1446216"
              target="_blank"
              rel="noopener noreferrer"
            />
          </IconButton>
        }
      />

      <EditTournamentDialog open={editOpen} onOpenChange={setEditOpen} />

      <ConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title="Reset automated checks?"
        description={
          <>
            <p>This action will cascade to all children.</p>
            <p>This action cannot be undone.</p>
          </>
        }
        confirmLabel="Reset automated checks"
        pendingLabel="Resetting…"
        onConfirm={() => wait(1200)}
      >
        <div className="flex items-center gap-2">
          <Checkbox
            id={checkboxId}
            checked={includeVerified}
            onCheckedChange={(checked) => setIncludeVerified(checked === true)}
          />
          <Label htmlFor={checkboxId}>Reset verified and rejected data</Label>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this tournament?"
        description={DELETE_CASCADE_DESCRIPTION}
        confirmLabel="Delete tournament"
        pendingLabel="Deleting…"
        onConfirm={() => wait(1200)}
      />

      <ConfirmDialog
        open={unlinkPoolOpen}
        onOpenChange={setUnlinkPoolOpen}
        title="Unlink pooled beatmaps?"
        description={
          <>
            <p>
              This action unlinks all beatmaps from the tournament. The beatmaps
              themselves will not be deleted from the system.
            </p>
            <p>This action cannot be undone.</p>
          </>
        }
        confirmLabel="Unlink pooled beatmaps"
        onConfirm={() => wait(1200)}
      />
    </>
  );
}

const ART = (
  <Image
    src="/images/beatmap-background-narrow.png"
    alt=""
    fill
    sizes="(max-width: 1050px) 100vw, 1050px"
    loading="eager"
    className="object-cover saturate-75"
  />
);

function OnArtDemo() {
  return (
    <div className="flex flex-col gap-4">
      <DetailHero
        art={ART}
        title="HAELEQUIN"
        titleSuffix="[alacat's Light Insane]"
        meta={
          <>
            <HeroMetaItem icon={Music2}>orangentle</HeroMetaItem>
            <HeroMetaItem icon={UserRound}>Mapped by Gamu, alacat</HeroMetaItem>
          </>
        }
        adminActions={
          <AdminMenu
            onArt
            actions={[
              {
                label: 'Edit beatmap data',
                icon: PencilLine,
              },
            ]}
          />
        }
        actions={
          <IconButton variant="overlay" label="Play preview" icon={Play} />
        }
      />

      <div className="relative isolate flex h-32 flex-col justify-between overflow-hidden rounded-xl p-3 text-white">
        {ART}
        <div className="absolute inset-0 bg-black/60" aria-hidden />
        <div className="relative flex items-center justify-between gap-2">
          <span className="text-sm text-white/80">Team Vs · ScoreV2</span>
          <RowActionsMenu
            onArt
            itemName="HAELEQUIN [alacat's Light Insane]"
            actions={[
              { label: 'Report an issue', icon: Flag, onSelect: () => {} },
              {
                label: 'View audit history',
                icon: History,
                href: '#controls-on-art',
              },
              {
                label: 'Edit game',
                icon: PencilLine,
                group: 'admin',
                onSelect: () => {},
              },
              {
                label: 'Admin notes',
                icon: NotebookPen,
                group: 'admin',
                onSelect: () => {},
              },
              {
                label: 'Merge games',
                icon: GitMerge,
                group: 'data',
                onSelect: () => {},
              },
              {
                label: 'Delete game',
                icon: Trash2,
                destructive: true,
                onSelect: () => {},
              },
            ]}
          />
        </div>
        <p className="relative truncate font-semibold">
          HAELEQUIN [alacat&apos;s Light Insane]
        </p>
      </div>
    </div>
  );
}

const GAMES = [
  {
    name: 'Hidden Chamber [Insane]',
    detail: 'Team Vs · HR · 3:12',
    status: VerificationStatus.Verified,
  },
  {
    name: 'Kokoro no Kakera [Extra]',
    detail: 'Team Vs · DT · 2:48',
    status: VerificationStatus.PreRejected,
  },
  {
    name: 'Arigatou Sayonara (PSYQUI Remix) [Tiebreaker]',
    detail: 'Team Vs · FM · 4:05',
    status: VerificationStatus.None,
  },
];

function RowActionsDemo() {
  const [deleting, setDeleting] = React.useState<string | null>(null);

  return (
    <>
      <Panel>
        <SectionHeader icon={Swords} title="Games" meta="3 games" />
        <RowList>
          {GAMES.map((game, index) => (
            <RowListItem
              key={game.name}
              leading={
                <VerificationStatusIcon status={game.status} tooltip="tap" />
              }
              title={
                <a
                  href="#controls-row-actions-menu"
                  className="rounded-sm transition-colors hover:text-link focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  {game.name}
                </a>
              }
              description={game.detail}
              trailing={
                <RowActionsMenu
                  itemName={game.name}
                  notification={index === 0 ? 'Has admin notes' : undefined}
                  actions={[
                    {
                      label: 'View audit history',
                      icon: History,
                      href: '#controls-row-actions-menu',
                    },
                    {
                      label: 'Edit game',
                      icon: PencilLine,
                      group: 'admin',
                      onSelect: () => {},
                    },
                    {
                      label: 'Admin notes',
                      icon: NotebookPen,
                      group: 'admin',
                      trailing:
                        index === 0 ? <Badge size="sm">1</Badge> : undefined,
                      onSelect: () => {},
                    },
                    {
                      label: 'Merge games',
                      icon: GitMerge,
                      group: 'data',
                      onSelect: () => {},
                    },
                    {
                      label: 'Delete game',
                      icon: Trash2,
                      destructive: true,
                      onSelect: () => setDeleting(game.name),
                    },
                  ]}
                />
              }
            />
          ))}
        </RowList>
      </Panel>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="Delete this game?"
        description={DELETE_CASCADE_DESCRIPTION}
        confirmLabel="Delete game"
        pendingLabel="Deleting…"
        onConfirm={() => wait(1000)}
      />
    </>
  );
}

/** An ActionMenu with a header: the account menu's avatar, name and role. */
function ActionMenuHeaderDemo() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <ActionMenu
        data-testid="gallery-action-menu-content"
        header={
          <span className="flex items-center gap-3">
            <Avatar className="size-9 ring-1 ring-border">
              <AvatarFallback className="font-medium">A</AvatarFallback>
            </Avatar>
            <span className="flex min-w-0 flex-col items-start gap-1">
              <span className="max-w-full truncate font-semibold">apricot</span>
              <Badge size="sm">
                <ShieldCheck aria-hidden />
                Admin
              </Badge>
            </span>
          </span>
        }
        actions={[
          { label: 'My profile', icon: User, href: '#controls-action-menu' },
          { label: 'Settings', icon: Settings, href: '#controls-action-menu' },
          {
            label: 'My reports',
            icon: Flag,
            href: '#controls-action-menu',
            trailing: <NotificationDot label="Unread report updates" />,
          },
          {
            label: 'Log out',
            icon: LogOut,
            group: 'session',
            onSelect: () => {},
          },
        ]}
        trigger={
          <Button variant="ghost" size="sm">
            apricot
            <ChevronDown
              className="-mr-0.5 text-muted-foreground"
              aria-hidden
            />
          </Button>
        }
      />
      <Caption>The header sits above the items and is not focusable.</Caption>
    </div>
  );
}

/** The dialog anatomy drawn in place, so both themes show it. */
function DialogAnatomy({
  title,
  description,
  closable = true,
  size = 'md',
  children,
  footer,
  footerStart,
}: {
  title: string;
  description?: string;
  closable?: boolean;
  /** ConfirmDialog is always `sm`. */
  size?: DialogSize;
  children: React.ReactNode;
  footer: React.ReactNode;
  footerStart?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        DIALOG_CLASSES.surface,
        DIALOG_SIZE_CLASSES[size],
        'relative w-full'
      )}
      aria-hidden
      inert
    >
      <div className={cn(DIALOG_CLASSES.header, closable && 'pr-14')}>
        <p className={DIALOG_CLASSES.title}>{title}</p>
        {description ? (
          <p className={DIALOG_CLASSES.description}>{description}</p>
        ) : null}
      </div>
      <div className={DIALOG_CLASSES.body}>{children}</div>
      <DialogFooterStrip start={footerStart}>{footer}</DialogFooterStrip>
      {closable ? (
        <div className="absolute top-3 right-4">
          <IconButton label="Close" icon={X} tooltip={false} />
        </div>
      ) : null}
    </div>
  );
}

function DialogTemplateDemo() {
  return (
    <div className="flex flex-col items-start gap-4">
      <DialogAnatomy
        title="Edit tournament"
        description="Editing Break The Meta Cup"
        footer={
          <>
            <Button variant="outline">Cancel</Button>
            <Button>Save</Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-2">
            <Label>Abbreviation</Label>
            <Input defaultValue="BTMC" tabIndex={-1} />
          </div>
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label>Name</Label>
            <Input defaultValue="Break The Meta Cup" tabIndex={-1} />
          </div>
        </div>
      </DialogAnatomy>
      <EditTournamentDialog
        trigger={
          <Button variant="outline" icon={PencilLine}>
            Edit tournament
          </Button>
        }
      />
    </div>
  );
}

function ConfirmDialogDemo() {
  return (
    <div className="flex flex-col items-start gap-4">
      <DialogAnatomy
        title="Delete this tournament?"
        closable={false}
        size="sm"
        footer={
          <>
            <Button variant="outline">Cancel</Button>
            <Button variant="destructive-confirm">Delete tournament</Button>
          </>
        }
      >
        <div className="flex flex-col gap-2 text-sm text-muted-foreground">
          {DELETE_CASCADE_DESCRIPTION}
        </div>
      </DialogAnatomy>
      <div className="flex flex-wrap gap-2">
        <ConfirmDialog
          trigger={
            <Button variant="destructive" icon={Trash2}>
              Delete tournament
            </Button>
          }
          title="Delete this tournament?"
          description={DELETE_CASCADE_DESCRIPTION}
          confirmLabel="Delete tournament"
          pendingLabel="Deleting…"
          onConfirm={() => wait(1200)}
        />
        <ConfirmDialog
          tone="default"
          trigger={<Button variant="outline">Submit tournament</Button>}
          title="Continue without beatmaps?"
          description={
            <p>
              You are submitting a tournament without any beatmap links. This is
              strongly discouraged.
            </p>
          }
          confirmLabel="Continue without beatmaps"
          onConfirm={() => wait(800)}
        />
        <ConfirmDialog
          trigger={
            <Button variant="destructive" icon={Trash2}>
              Delete match (fails)
            </Button>
          }
          title="Delete this match?"
          description={DELETE_CASCADE_DESCRIPTION}
          confirmLabel="Delete match"
          pendingLabel="Deleting…"
          errorText="Failed to delete match"
          onConfirm={() =>
            wait(800).then(() => Promise.reject(new Error('demo')))
          }
        />
      </div>
    </div>
  );
}

// Help text and placeholders from components/tournaments/TournamentSubmissionForm.tsx.
const ABBREVIATION_INFO =
  "The prefix of each tournament lobby, such as 'OWC2024' from OWC2024: (United States) vs. (Canada)";
const RANK_RESTRICTION_INFO =
  "The 'best' global rank allowed to participate. Use 1 for open rank.";
const FORUM_URL_PLACEHOLDER = 'https://osu.ppy.sh/community/forums/topics/...';
const MATCHES_PLACEHOLDER =
  'https://osu.ppy.sh/community/matches/12345\nhttps://osu.ppy.sh/mp/67890';
const BEATMAPS_PLACEHOLDER =
  'https://osu.ppy.sh/b/12345\nhttps://osu.ppy.sh/beatmapsets/123#osu/456';
/** The submission form's lobby sizes, 1v1 to 8v8. */
const LOBBY_SIZES = [1, 2, 3, 4, 5, 6, 7, 8];

/** Validates a whole-number rank restriction of at least 1. */
function validateRankRestriction(value: string) {
  if (value.trim() === '') return RANK_RESTRICTION_REQUIRED_MESSAGE;
  const rank = Number(value);
  if (!Number.isInteger(rank)) return RANK_RESTRICTION_WHOLE_NUMBER_MESSAGE;
  return rank >= 1 || RANK_RESTRICTION_MINIMUM_MESSAGE;
}

// The submission form's link formats: an ID or an osu! URL on each line.
const MATCH_LINK_PATTERN =
  /^(?:(\d+)|https:\/\/osu\.ppy\.sh\/(?:community\/matches|mp|multiplayer\/rooms)\/(\d+)(?:\/events)?)$/;
const BEATMAP_LINK_PATTERN =
  /^(?:(\d+)|https:\/\/osu\.ppy\.sh\/b\/(\d+)|https:\/\/osu\.ppy\.sh\/beatmapsets\/\d+#(?:osu|fruits|mania|taiko)\/(\d+))$/;
const MAX_BEATMAP_ID = 20_000_000;

/** The ID on each line, or 0 for a line that is not a valid link. */
function parseLinkIds(value: string, pattern: RegExp, maxId = Infinity) {
  if (value.trim() === '') return [];
  return value.split('\n').map((line) => {
    const match = pattern.exec(line.trim());
    const id = Number(match?.slice(1).find(Boolean) ?? 0);
    return id > maxId ? 0 : id;
  });
}

/** The submission schema's checks on a list of links, with its messages. */
function validateLinkIds(ids: number[], noun: 'match' | 'beatmap') {
  if (ids.some((id) => id === 0)) {
    return `All ${noun} links must be valid osu! ${noun} IDs or URLs`;
  }
  if (ids.length > MAX_SUBMISSION_IDS) {
    return noun === 'match'
      ? maxMatchIdsMessage(MAX_SUBMISSION_IDS)
      : maxBeatmapIdsMessage(MAX_SUBMISSION_IDS);
  }
  return (
    new Set(ids).size === ids.length || `Duplicate ${noun} IDs are not allowed`
  );
}

type SubmissionValues = {
  abbreviation: string;
  name: string;
  forumUrl: string;
  ruleset: string;
  lobbySize: string;
  rankRangeLowerBound: string;
  // Not "matches": a control with that name would shadow form.matches().
  matchIds: string;
  beatmapIds: string;
};

function FormLayoutDemo() {
  const [submitting, setSubmitting] = React.useState(false);
  const form = useForm<SubmissionValues>({
    defaultValues: {
      abbreviation: '',
      name: '',
      forumUrl: '',
      ruleset: '',
      lobbySize: '',
      rankRangeLowerBound: '',
      matchIds: '',
      beatmapIds: '',
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        icon={Upload}
        title="Tournament submission"
        description="Use this form to submit a new tournament for verification and tracking."
        actions={
          <Button asChild variant="outline" icon={ExternalLink}>
            <a
              href="https://docs.otr.stagec.net/rating-framework/data-processing/tournament-approval#acceptance-criteria"
              target="_blank"
              rel="noopener noreferrer"
            >
              Read our acceptance criteria
            </a>
          </Button>
        }
      />
      <Form {...form}>
        <FormPanel
          noValidate
          onSubmit={form.handleSubmit(async () => {
            setSubmitting(true);
            await wait(1200);
            setSubmitting(false);
            form.reset();
          })}
        >
          <FormSection icon={Trophy} title="Information">
            <FormGrid>
              <FormField
                control={form.control}
                name="abbreviation"
                rules={{ required: TOURNAMENT_ABBREVIATION_REQUIRED_MESSAGE }}
                render={({ field }) => (
                  <FormItem>
                    <FormFieldLabel info={ABBREVIATION_INFO}>
                      Abbreviation
                    </FormFieldLabel>
                    <FormControl>
                      <Input placeholder="OWC2024" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="name"
                rules={{ required: TOURNAMENT_NAME_REQUIRED_MESSAGE }}
                render={({ field }) => (
                  <FormItem>
                    <FormFieldLabel>Name</FormFieldLabel>
                    <FormControl>
                      <Input placeholder="osu! World Cup 2024" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </FormGrid>
            <FormField
              control={form.control}
              name="forumUrl"
              rules={{ validate: validateSubmittedForumPostUrl }}
              render={({ field }) => (
                <FormItem>
                  <FormFieldLabel info="Forum post URL or wiki page for the tournament">
                    Forum post URL
                  </FormFieldLabel>
                  <FormControl>
                    <Input placeholder={FORUM_URL_PLACEHOLDER} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormGrid columns={3}>
              <FormField
                control={form.control}
                name="ruleset"
                rules={{ required: RULESET_REQUIRED_MESSAGE }}
                render={({ field }) => (
                  <FormItem>
                    <FormFieldLabel>Ruleset</FormFieldLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select ruleset" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {RATED_RULESETS.map((ruleset) => (
                          <SelectItem key={ruleset} value={String(ruleset)}>
                            {RULESET_NAMES[ruleset].label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="lobbySize"
                rules={{ required: LOBBY_SIZE_REQUIRED_MESSAGE }}
                render={({ field }) => (
                  <FormItem>
                    <FormFieldLabel info="Number of players per team in each match">
                      Lobby size
                    </FormFieldLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select size" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {LOBBY_SIZES.map((size) => (
                          <SelectItem key={size} value={String(size)}>
                            {formatLobbySize(size)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="rankRangeLowerBound"
                rules={{ validate: validateRankRestriction }}
                render={({ field }) => (
                  <FormItem>
                    <FormFieldLabel info={RANK_RESTRICTION_INFO}>
                      Rank restriction
                    </FormFieldLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        placeholder="Enter rank restriction"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </FormGrid>
          </FormSection>

          <FormSection icon={Database} title="Data">
            <FormGrid>
              <FormField
                control={form.control}
                name="matchIds"
                rules={{
                  validate: (value) => {
                    const ids = parseLinkIds(value, MATCH_LINK_PATTERN);
                    if (ids.length === 0) {
                      return 'At least one valid match link is required';
                    }
                    return validateLinkIds(ids, 'match');
                  },
                }}
                render={({ field }) => (
                  <FormItem>
                    <FormFieldLabel hint="IDs or URLs, one per line">
                      Matches
                    </FormFieldLabel>
                    <FormControl>
                      <Textarea
                        className="min-h-28"
                        placeholder={MATCHES_PLACEHOLDER}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="beatmapIds"
                rules={{
                  validate: (value) =>
                    validateLinkIds(
                      parseLinkIds(value, BEATMAP_LINK_PATTERN, MAX_BEATMAP_ID),
                      'beatmap'
                    ),
                }}
                render={({ field }) => (
                  <FormItem>
                    <FormFieldLabel hint="IDs or URLs, one per line">
                      Beatmaps
                    </FormFieldLabel>
                    <FormControl>
                      <Textarea
                        className="min-h-28"
                        placeholder={BEATMAPS_PLACEHOLDER}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </FormGrid>
          </FormSection>

          <FormActions>
            <Button
              variant="outline"
              disabled={submitting}
              onClick={() => form.reset()}
            >
              Clear
            </Button>
            <Button type="submit" pending={submitting}>
              Submit tournament
            </Button>
          </FormActions>
        </FormPanel>
      </Form>
    </div>
  );
}

type LabelValues = {
  abbreviation: string;
  forumUrl: string;
  rankRangeLowerBound: string;
};

function FormFieldLabelDemo() {
  const form = useForm<LabelValues>({
    defaultValues: {
      abbreviation: 'BTMC',
      forumUrl: '',
      rankRangeLowerBound: '1000.5',
    },
  });
  const { setError } = form;

  React.useEffect(() => {
    setError('rankRangeLowerBound', {
      message: RANK_RESTRICTION_WHOLE_NUMBER_MESSAGE,
    });
  }, [setError]);

  return (
    <Form {...form}>
      <div className="flex flex-col gap-4">
        <FormGrid>
          <FormField
            control={form.control}
            name="abbreviation"
            render={({ field }) => (
              <FormItem>
                <FormFieldLabel info={ABBREVIATION_INFO}>
                  Abbreviation
                </FormFieldLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="forumUrl"
            render={({ field }) => (
              <FormItem>
                <FormFieldLabel>Forum post URL</FormFieldLabel>
                <FormControl>
                  <Input placeholder={FORUM_URL_PLACEHOLDER} {...field} />
                </FormControl>
              </FormItem>
            )}
          />
        </FormGrid>
        <FormField
          control={form.control}
          name="rankRangeLowerBound"
          render={({ field }) => (
            <FormItem>
              <FormFieldLabel info={RANK_RESTRICTION_INFO}>
                Rank restriction
              </FormFieldLabel>
              <FormControl>
                <Input type="number" min={1} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <PlainFieldLabelDemo />
        <GroupFieldLabelDemo />
      </div>
    </Form>
  );
}

/** A label outside react-hook-form: `htmlFor` with the control's id. */
function PlainFieldLabelDemo() {
  const id = React.useId();
  const [lobbySize, setLobbySize] = React.useState('');
  return (
    <div className="flex flex-col gap-2 border-t pt-4">
      <FormFieldLabel
        htmlFor={id}
        info="Number of players per team in each match"
        hint="htmlFor, no form"
      >
        Lobby size
      </FormFieldLabel>
      <Select value={lobbySize} onValueChange={setLobbySize}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder="Any" />
        </SelectTrigger>
        <SelectContent>
          {LOBBY_SIZES.map((size) => (
            <SelectItem key={size} value={String(size)}>
              {formatLobbySize(size)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

const PRIORITIES = ['Low', 'Normal', 'High'] as const;

/**
 * A label for a group of controls, as the admin home's Priority: `groupId`
 * on the label and `aria-labelledby` on the RadioGroup.
 */
function GroupFieldLabelDemo() {
  const labelId = React.useId();
  const [priority, setPriority] = React.useState<string>('Normal');
  return (
    <div className="flex flex-col gap-2 border-t pt-4">
      <FormFieldLabel groupId={labelId} hint="groupId, a radio group">
        Priority
      </FormFieldLabel>
      <RadioGroup
        aria-labelledby={labelId}
        value={priority}
        onValueChange={setPriority}
        className="flex flex-wrap gap-4"
      >
        {PRIORITIES.map((option) => (
          <div key={option} className="flex items-center gap-2">
            <RadioGroupItem value={option} id={`${labelId}-${option}`} />
            <Label
              htmlFor={`${labelId}-${option}`}
              className="cursor-pointer font-normal"
            >
              {option}
            </Label>
          </div>
        ))}
      </RadioGroup>
    </div>
  );
}

export default function ControlsSection() {
  return (
    <GallerySection
      id="controls"
      title="Buttons, dialogs and forms"
      description="Button sizes, icon buttons, admin menus, dialogs and form layout."
    >
      <Specimen
        id="controls-button-sizes"
        name="Button sizes"
        importPath={`${KIT}/Button`}
        description="Three heights only. Small inside panels and heroes, default in forms and dialogs, large in list toolbars."
      >
        <ButtonSizes />
      </Specimen>

      <Specimen
        id="controls-button-variants"
        name="Button"
        importPath={`${KIT}/Button`}
        description="One primary action per view. Red marks an action that deletes or overwrites data; only the final confirm in a dialog is solid red."
      >
        <ButtonVariants />
      </Specimen>

      <Specimen
        id="controls-button-wrap"
        name="Button with a long label"
        importPath={`${KIT}/Button`}
        description="A label that can be longer than a phone is wide, such as a cascade level's counts in the audit log, wraps with wrap: the size's height becomes the minimum and the label aligns left."
      >
        <div className="flex max-w-52 flex-wrap gap-2">
          <Button variant="outline" size="sm" wrap>
            46 matches: 45 verified, 1 rejected
            <ChevronDown aria-hidden />
          </Button>
          <Button variant="outline" size="sm" wrap>
            12 games
            <ChevronDown aria-hidden />
          </Button>
        </div>
      </Specimen>

      <Specimen
        id="controls-icon-button"
        name="IconButton"
        importPath={`${KIT}/IconButton`}
        description="Every icon-only control: an accessible name, a tooltip that repeats it (except an X that closes or clears, with tooltip={false}), and a hover fill. Small and ghost unless it sits beside inputs. The fill stays while a menu or dialog it opens is open; a disclosure toggle (expanded) for a row that expands in place sets aria-expanded and keeps its resting look."
      >
        <IconButtons />
      </Specimen>

      <Specimen
        id="controls-admin-menu"
        name="AdminMenu"
        importPath={`${KIT}/AdminMenu`}
        description="The one admin control in a detail hero. Every admin action, labelled, with destructive items last and red. Edit, reset, unlink and delete open their dialogs."
        stacked
      >
        <AdminMenuDemo />
      </Specimen>

      <Specimen
        id="controls-row-actions-menu"
        name="RowActionsMenu"
        importPath={`${KIT}/RowActionsMenu`}
        description="One overflow button at the end of a row or card in place of a cluster of icons, such as each game on a match page. itemName names each button, so keep it unique per row, and heads the menu, truncated at the width the items set, as on the last game. A notification puts the dot on the button and its text in the button's name, as on the first game."
        stacked
      >
        <RowActionsDemo />
      </Specimen>

      <Specimen
        id="controls-action-menu"
        name="ActionMenu with a header"
        importPath={`${KIT}/ActionMenu`}
        description="The menu AdminMenu and RowActionsMenu are built on, for another trigger. Its header holds richer content than a title, such as an avatar with a name and role; AdminMenu passes it through. Menus open in the page's theme."
      >
        <ActionMenuHeaderDemo />
      </Specimen>

      <Specimen
        id="controls-on-art"
        name="Controls on cover art"
        importPath={`${KIT}/AdminMenu`}
        description="On art, AdminMenu, RowActionsMenu and IconButton take the dark pill (onArt, or variant overlay), white in both themes."
        stacked
      >
        <OnArtDemo />
      </Specimen>

      <Specimen
        id="controls-dialog-template"
        name="DialogTemplate"
        importPath={`${KIT}/DialogTemplate`}
        description="Every dialog that is not a confirmation: a header strip with a sentence-case title and close button, a body, and a footer with the actions on the right."
      >
        <DialogTemplateDemo />
      </Specimen>

      <Specimen
        id="controls-confirm-dialog"
        name="ConfirmDialog"
        importPath={`${KIT}/ConfirmDialog`}
        description="Confirms one consequential action. The title asks a question, the body says what happens, and the confirm button names the action."
      >
        <ConfirmDialogDemo />
      </Specimen>

      <Specimen
        id="controls-form-layout"
        name="FormPanel, FormSection, FormActions"
        importPath={`${KIT}/FormPanel`}
        description="A page form: the standard page header, one panel, sections split by header strips, and normal-sized actions at the bottom right. Submit it empty to see the errors."
        stacked
      >
        <FormLayoutDemo />
      </Specimen>

      <Specimen
        id="controls-form-field-label"
        name="FormFieldLabel"
        importPath={`${KIT}/FormFieldLabel`}
        description="A field label with the info button for help and an optional muted hint. Labels keep one height, so inputs side by side line up, and turn red with the field's error. Outside a react-hook-form field, pass htmlFor with the control's id; for a radio group, groupId with the group's aria-labelledby (the last two examples)."
      >
        <FormFieldLabelDemo />
      </Specimen>
    </GallerySection>
  );
}
