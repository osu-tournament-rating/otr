'use client';

import { AlertDialog as AlertDialogPrimitive } from 'radix-ui';
import * as React from 'react';

import { Button } from '@/components/kit/controls/Button';
import {
  DIALOG_CLASSES,
  DIALOG_SIZE_CLASSES,
  DialogFooterStrip,
  useReturnFocus,
} from '@/components/kit/controls/DialogTemplate';
import {
  AlertDialog,
  AlertDialogDescription,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

export type ConfirmDialogProps = {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The button that opens it. Leave it out when a menu item opens it. */
  trigger?: React.ReactElement;
  /** A question in sentence case: "Delete this tournament?" */
  title: string;
  /** What happens, what it affects, and whether it can be undone. */
  description: React.ReactNode;
  /** Extra body content under the description, such as an option checkbox. */
  children?: React.ReactNode;
  /** Verb and noun: "Delete tournament". Never "OK" or "Yes". */
  confirmLabel: string;
  /** Shown with a spinner while `onConfirm` runs: "Deleting…". */
  pendingLabel?: string;
  cancelLabel?: string;
  /**
   * `destructive` (the default) makes the confirm button solid red, for
   * actions that delete or overwrite data. `default` makes it the primary
   * blue, for a consequential action that loses nothing.
   */
  tone?: 'destructive' | 'default';
  /**
   * Carries out the action. Return a promise to keep the dialog open with a
   * spinner until it settles; it closes when the promise resolves and shows
   * `errorText` when it rejects.
   */
  onConfirm: () => void | Promise<unknown>;
  /** Shown in the dialog when `onConfirm` rejects. */
  errorText?: string;
  /** Holds the confirm button disabled, such as until a required option is set. */
  confirmDisabled?: boolean;
  className?: string;
  'data-testid'?: string;
};

/**
 * Confirms one consequential action before it runs, such as deleting a
 * tournament or resetting automated checks. Cancel takes the initial focus,
 * and the confirm button is the only solid red button on the site.
 */
export function ConfirmDialog({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  trigger,
  title,
  description,
  children,
  confirmLabel,
  pendingLabel,
  cancelLabel = 'Cancel',
  tone = 'destructive',
  onConfirm,
  errorText = 'Something went wrong. Try again.',
  confirmDisabled = false,
  className,
  'data-testid': testId,
}: ConfirmDialogProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const [pending, setPending] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const confirmRef = React.useRef<HTMLButtonElement>(null);
  const focusHandlers = useReturnFocus();
  const open = openProp ?? uncontrolledOpen;

  // The confirm button is disabled while pending, which drops keyboard focus
  // out of the dialog. After a failure, put it back so a retry is one key away.
  React.useEffect(() => {
    if (failed && !pending) confirmRef.current?.focus();
  }, [failed, pending]);

  const setOpen = (next: boolean) => {
    if (openProp === undefined) setUncontrolledOpen(next);
    if (!next) setFailed(false);
    onOpenChange?.(next);
  };

  const confirm = async () => {
    setFailed(false);
    let result: void | Promise<unknown>;

    try {
      result = onConfirm();
    } catch {
      setFailed(true);
      return;
    }

    if (!isPromiseLike(result)) {
      setOpen(false);
      return;
    }

    setPending(true);
    try {
      await result;
      setOpen(false);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) setOpen(next);
      }}
    >
      {trigger ? (
        <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      ) : null}
      <AlertDialogPortal>
        <AlertDialogOverlay className={DIALOG_CLASSES.backdrop} />
        <AlertDialogPrimitive.Content
          data-slot="confirm-dialog"
          data-testid={testId}
          className={cn(
            DIALOG_CLASSES.position,
            DIALOG_CLASSES.surface,
            DIALOG_SIZE_CLASSES.sm,
            className
          )}
          onEscapeKeyDown={(event) => {
            if (pending) event.preventDefault();
          }}
          {...focusHandlers}
        >
          <div data-slot="dialog-header" className={DIALOG_CLASSES.header}>
            <AlertDialogTitle className={DIALOG_CLASSES.title}>
              {title}
            </AlertDialogTitle>
          </div>

          <div data-slot="dialog-body" className={DIALOG_CLASSES.body}>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-2 text-sm text-muted-foreground">
                {description}
              </div>
            </AlertDialogDescription>
            {children}
            {failed ? (
              <p role="alert" className="text-sm text-destructive-foreground">
                {errorText}
              </p>
            ) : null}
          </div>

          <DialogFooterStrip>
            <AlertDialogPrimitive.Cancel asChild>
              <Button variant="outline" disabled={pending}>
                {cancelLabel}
              </Button>
            </AlertDialogPrimitive.Cancel>
            <Button
              ref={confirmRef}
              variant={
                tone === 'destructive' ? 'destructive-confirm' : 'default'
              }
              pending={pending}
              disabled={confirmDisabled}
              onClick={() => void confirm()}
            >
              {pending ? (pendingLabel ?? confirmLabel) : confirmLabel}
            </Button>
          </DialogFooterStrip>
        </AlertDialogPrimitive.Content>
      </AlertDialogPortal>
    </AlertDialog>
  );
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof value.then === 'function'
  );
}
