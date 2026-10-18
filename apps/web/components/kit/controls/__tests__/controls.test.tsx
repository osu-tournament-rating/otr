import { describe, expect, it } from 'bun:test';
import { History, Trash2, Trophy } from 'lucide-react';
import Link from 'next/link';
import type * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useForm } from 'react-hook-form';

import { AdminMenu } from '@/components/kit/controls/AdminMenu';
import { Button } from '@/components/kit/controls/Button';
import { ConfirmDialog } from '@/components/kit/controls/ConfirmDialog';
import { DialogTemplate } from '@/components/kit/controls/DialogTemplate';
import { FormFieldLabel } from '@/components/kit/controls/FormFieldLabel';
import {
  FormActions,
  FormGrid,
  FormPanel,
  FormSection,
} from '@/components/kit/controls/FormPanel';
import { IconButton } from '@/components/kit/controls/IconButton';
import { RowActionsMenu } from '@/components/kit/controls/RowActionsMenu';
import { Panel } from '@/components/kit/layout/Panel';
import { Form, FormField, FormItem } from '@/components/ui/form';
import { TooltipProvider } from '@/components/ui/tooltip';

const render = (node: React.ReactNode) =>
  renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>);

/** The class attribute of the first element with this tag. */
const classOf = (html: string, tag = 'button') =>
  new RegExp(`<${tag}[^>]*class="([^"]*)"`).exec(html)?.[1] ?? '';

describe('Button', () => {
  it('lets a long label wrap, keeping its size as the minimum height', () => {
    const sm = classOf(
      render(
        <Button size="sm" variant="outline" wrap>
          46 matches: 45 verified, 1 rejected
        </Button>
      )
    );
    expect(sm).toContain('h-auto');
    expect(sm).toContain('min-h-8');
    expect(sm).toContain('whitespace-normal');
    expect(sm).toContain('text-left');
    expect(sm).not.toMatch(/(^| )h-8( |$)/);
    expect(sm).not.toContain('whitespace-nowrap');

    expect(classOf(render(<Button wrap>Save</Button>))).toContain('min-h-9');
    expect(
      classOf(
        render(
          <Button size="lg" wrap>
            Save
          </Button>
        )
      )
    ).toContain('min-h-10');
    // Off by default, and never passed on to the element.
    const plain = render(<Button>Save</Button>);
    expect(classOf(plain)).toContain('whitespace-nowrap');
    expect(plain).not.toContain('wrap=');
  });

  it('is type="button" unless told otherwise', () => {
    expect(render(<Button>Cancel</Button>)).toContain('type="button"');
    expect(render(<Button type="submit">Save</Button>)).toContain(
      'type="submit"'
    );
  });

  it('keeps a ghost button filled while its menu is open', () => {
    const classes = classOf(render(<Button variant="ghost">More</Button>));

    expect(classes).toContain('data-[state=open]:bg-accent');
    // The hover fill comes from the shadcn variant, once.
    expect(classes.match(/hover:bg-accent/g)).toHaveLength(1);
  });

  it('never fills a destructive trigger, only the final confirm', () => {
    const trigger = classOf(
      render(<Button variant="destructive">Delete tournament</Button>)
    );
    const confirm = classOf(
      render(<Button variant="destructive-confirm">Delete tournament</Button>)
    );

    expect(trigger).toContain('text-destructive-foreground');
    expect(trigger).not.toMatch(/\bbg-destructive(-solid)?(\s|$)/);
    expect(confirm).toContain('text-white');
  });

  it('fills the final confirm with the darker solid red', () => {
    // White text on dark mode's --destructive is under 4.5:1.
    const confirm = classOf(
      render(<Button variant="destructive-confirm">Delete tournament</Button>)
    );

    expect(confirm).toMatch(/\bbg-destructive-solid(\s|$)/);
    expect(confirm).toContain('hover:bg-destructive-solid/90');
    expect(confirm).not.toMatch(/\bbg-destructive(\s|$)/);
    expect(confirm).not.toContain('hover:bg-destructive/90');
  });

  it('swaps the icon for a spinner and disables itself while pending', () => {
    const idle = render(<Button icon={Trash2}>Delete</Button>);
    const busy = render(
      <Button icon={Trash2} pending>
        Deleting
      </Button>
    );

    expect(idle).toContain('lucide-trash');
    expect(busy).not.toContain('lucide-trash');
    expect(busy).toContain('animate-spin');
    expect(busy).toContain('disabled=""');
    expect(busy).toContain('aria-busy="true"');
  });

  it('puts the icon inside the child when drawn on a link', () => {
    const html = render(
      <Button asChild variant="outline" icon={Trophy}>
        <Link href="/tournaments">Tournaments</Link>
      </Button>
    );

    expect(html).toStartWith('<a');
    expect(html).toMatch(
      /<a[^>]*href="\/tournaments"[^>]*><svg[^>]*>.*<\/svg>Tournaments<\/a>/
    );
    expect(html).not.toContain('type=');
  });
});

describe('IconButton', () => {
  it('is named by its label and fills on hover', () => {
    const html = render(<IconButton label="Audit history" icon={History} />);
    const classes = classOf(html);

    expect(html).toContain('aria-label="Audit history"');
    expect(html).toContain('type="button"');
    expect(classes).toContain('size-8');
    expect(classes).toContain('hover:bg-accent');
    expect(classes).toContain('text-muted-foreground');
  });

  it('draws the dark pill on art and ignores the destructive tone there', () => {
    const classes = classOf(
      render(
        <IconButton
          label="Delete"
          icon={Trash2}
          variant="overlay"
          destructive
        />
      )
    );

    expect(classes).toContain('bg-black/55');
    expect(classes).toContain('rounded-full');
    expect(classes).not.toContain('text-destructive');
  });

  it('renders the glyph inside a link with asChild', () => {
    const html = render(
      <IconButton asChild label="Audit history" icon={History}>
        <Link href="/audit/tournaments/1" />
      </IconButton>
    );

    expect(html).toStartWith('<a');
    expect(html).toContain('aria-label="Audit history"');
    expect(html).toContain('lucide-history');
  });

  it('keeps the open fill for menu triggers', () => {
    const classes = classOf(render(<IconButton label="Actions" />));
    expect(classes).toContain('data-[state=open]:bg-accent');
    expect(render(<IconButton label="Actions" />)).not.toContain(
      'aria-expanded'
    );
  });

  it('is a disclosure toggle without the open fill when given expanded', () => {
    const collapsed = render(
      <IconButton label="Details for game 3" expanded={false} />
    );
    expect(collapsed).toContain('aria-expanded="false"');
    expect(classOf(collapsed)).not.toContain('data-[state=open]');

    const open = render(
      <IconButton label="Details for game 3" variant="outline" expanded />
    );
    expect(open).toContain('aria-expanded="true"');
    expect(classOf(open)).not.toContain('data-[state=open]');
    // Hover still fills it.
    expect(classOf(open)).toContain('hover:bg-accent');
  });
});

describe('AdminMenu', () => {
  it('is one labelled button that opens a menu', () => {
    const html = render(
      <AdminMenu
        actions={[{ label: 'Edit tournament', onSelect: () => {} }]}
        data-testid="tournament-admin"
      />
    );

    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('data-testid="tournament-admin"');
    expect(html).toMatch(/<\/svg>Admin<svg/);
    expect(classOf(html)).toContain('h-8');
  });

  it('renders nothing when every action is hidden', () => {
    expect(
      render(<AdminMenu actions={[{ label: 'Edit', hidden: true }, false]} />)
    ).toBe('');
  });

  it('shows the notification dot with its screen-reader text', () => {
    const html = render(
      <AdminMenu
        actions={[{ label: 'Admin notes', onSelect: () => {} }]}
        notification="Has admin notes"
      />
    );

    expect(html).toContain('data-slot="notification-dot"');
    expect(html).toContain('Has admin notes');
  });

  it('uses the dark pill on art', () => {
    const html = render(
      <AdminMenu actions={[{ label: 'Edit beatmap' }]} onArt />
    );

    expect(classOf(html)).toContain('bg-black/55');
  });
});

describe('RowActionsMenu', () => {
  it('names the button after its row', () => {
    const html = render(
      <RowActionsMenu
        itemName="Hidden Chamber [Insane]"
        actions={[{ label: 'Edit game', onSelect: () => {} }]}
      />
    );

    expect(html).toContain('aria-label="Actions for Hidden Chamber [Insane]"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('lucide-ellipsis');
    expect(html).not.toContain('notification-dot');
  });

  it('shows a notification dot and says so in the button name', () => {
    const html = render(
      <RowActionsMenu
        itemName="Game 3"
        notification="Has admin notes"
        actions={[{ label: 'Admin notes', onSelect: () => {} }]}
      />
    );

    expect(html).toContain('aria-label="Actions for Game 3, Has admin notes"');
    expect(html).toMatch(
      /<span data-slot="notification-dot" class="[^"]*absolute[^"]*" aria-hidden="true">/
    );
    expect(classOf(html)).toContain('relative');
  });
});

describe('FormFieldLabel', () => {
  it('labels a control by id outside a react-hook-form field', () => {
    const html = render(
      <FormFieldLabel htmlFor="lobby-size" info="Players per team" hint="1–8">
        Lobby size
      </FormFieldLabel>
    );

    expect(html).toContain('<label data-slot="label"');
    expect(html).toContain('for="lobby-size"');
    expect(html).toContain('data-error="false"');
    expect(html).toContain('aria-label="About lobby size"');
    expect(html).toContain('1–8');
  });

  it('turns the label red when invalid', () => {
    const html = render(
      <FormFieldLabel htmlFor="rank" invalid>
        Rank restriction
      </FormFieldLabel>
    );
    expect(html).toContain('data-error="true"');
    expect(html).toContain('data-[error=true]:text-destructive-foreground');
  });

  it('labels a group of controls by id, in the same row', () => {
    const html = render(
      <FormFieldLabel groupId="priority-label" info="How soon the jobs run">
        Priority
      </FormFieldLabel>
    );

    // Plain text that aria-labelledby can name a RadioGroup with: no
    // <label> (it would point at nothing) and no FormLabel (it needs a
    // FormItem).
    expect(html).toContain('<span id="priority-label" data-slot="label"');
    expect(html).not.toContain('<label');
    // Set like a field's label, in the same row height.
    const fieldLabel = render(
      <FormFieldLabel htmlFor="priority">Priority</FormFieldLabel>
    );
    const typeClasses = classOf(fieldLabel, 'label')
      .split(' ')
      .filter((name) => /^(?:text|leading|font)-/.test(name));
    expect(classOf(html, 'span').split(' ')).toEqual(
      expect.arrayContaining(typeClasses)
    );
    expect(html).toContain('min-h-5');
    expect(html).toContain('aria-label="About priority"');
    expect(html).toContain('>Priority</span>');

    const invalid = render(
      <FormFieldLabel groupId="reason-label" invalid>
        Ban reason
      </FormFieldLabel>
    );
    expect(invalid).toContain('data-error="true"');
  });

  it('gives the hint an id for aria-describedby', () => {
    const html = render(
      <FormFieldLabel htmlFor="comment" hint="Required" hintId="comment-hint">
        Comment
      </FormFieldLabel>
    );
    expect(html).toContain('<span id="comment-hint" class="ml-auto');
    expect(html).toContain('>Required</span>');

    const withoutId = render(
      <FormFieldLabel htmlFor="comment" hint="Required">
        Comment
      </FormFieldLabel>
    );
    expect(withoutId).toContain('<span class="ml-auto');
  });
});

describe('dialogs', () => {
  it('render only their trigger until opened', () => {
    const template = render(
      <DialogTemplate title="Edit tournament" trigger={<Button>Edit</Button>}>
        Body
      </DialogTemplate>
    );
    const confirm = render(
      <ConfirmDialog
        title="Delete this tournament?"
        description="This cannot be undone."
        confirmLabel="Delete tournament"
        onConfirm={() => {}}
        trigger={<Button variant="destructive">Delete</Button>}
      />
    );

    expect(template).toContain('aria-haspopup="dialog"');
    expect(template).not.toContain('Body');
    expect(confirm).toContain('aria-haspopup="dialog"');
    expect(confirm).not.toContain('This cannot be undone.');
  });
});

function FormDemo() {
  const form = useForm<{ name: string }>({ defaultValues: { name: '' } });

  return (
    <Form {...form}>
      <FormPanel data-testid="demo-form">
        <FormSection icon={Trophy} title="Tournament" description="Basics.">
          <FormGrid>
            <FormField
              control={form.control}
              name="name"
              render={() => (
                <FormItem>
                  <FormFieldLabel info="The full name." hint="Required">
                    Name
                  </FormFieldLabel>
                </FormItem>
              )}
            />
          </FormGrid>
        </FormSection>
        <FormSection title="Data">Fields</FormSection>
        <FormActions start="Changes apply on the next rating run.">
          <Button type="submit">Submit</Button>
        </FormActions>
      </FormPanel>
    </Form>
  );
}

describe('form layout', () => {
  const html = render(<FormDemo />);

  it('puts one form on one panel, ending with the actions strip', () => {
    expect(html).toStartWith('<div data-slot="form-panel"');
    // The surface comes from Panel, not a copy of its classes.
    expect(classOf(html, 'div')).toContain(
      classOf(render(<Panel />), 'section')
    );
    expect(html).toContain(
      '<form class="flex flex-col" data-testid="demo-form"'
    );
    expect(html).toContain('data-slot="form-actions"');
    expect(html).toContain('Changes apply on the next rating run.');
    expect(html).toContain('type="submit"');
  });

  it('heads each section with a strip and divides the sections', () => {
    expect(html).toContain('role="group" aria-label="Tournament"');
    expect(html).toContain(
      '<h2 class="truncate font-semibold">Tournament</h2>'
    );
    expect(html).toContain('<h2 class="truncate font-semibold">Data</h2>');
    expect(html).toContain('not-first:border-t');
  });

  it('labels fields with the info button and a hint', () => {
    expect(html).toContain('aria-label="About name"');
    expect(html).toContain('Required');
  });
});
