'use client';

import { LogIn } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button, type ButtonSize } from '@/components/kit/controls/Button';
import { authClient } from '@/lib/auth/auth-client';
import { humanizeFieldName } from '@/lib/kit/format/fields';
import { isTailnetPreview, signInE2eAdmin } from '@/lib/auth/e2e-auth';
import { useAuthRedirectPath } from '@/lib/hooks/useAbsolutePath';

const LOGIN_STORAGE_KEY = 'otr:isLoggingIn';
// Better Auth sends a failed sign-in back to the site with these in the
// address.
const SIGN_IN_ERROR_PARAMS = ['error', 'error_description'];
// osu! sends this when the player cancels on its authorize page.
const CANCELLED_ERROR = 'access_denied';
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function readSignInError() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('error');
  return code ? { code, description: params.get('error_description') } : null;
}

// Storage throws when the browser blocks site data. The flag only keeps the
// spinner up across the OAuth redirect, so sign-in works without it.
function readLoginFlag(): boolean {
  try {
    return sessionStorage.getItem(LOGIN_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeLoginFlag(isLoggingIn: boolean) {
  try {
    if (isLoggingIn) {
      sessionStorage.setItem(LOGIN_STORAGE_KEY, 'true');
    } else {
      sessionStorage.removeItem(LOGIN_STORAGE_KEY);
    }
  } catch {
    // Nothing to persist.
  }
}

/**
 * Signs in with osu!. The button keeps its spinner across the OAuth redirect
 * until the session has loaded. Tailnet previews sign in as the e2e admin.
 */
export default function LoginButton({
  size = 'default',
  className,
}: {
  size?: ButtonSize;
  className?: string;
}) {
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const sessionRefreshTriggeredRef = useRef(false);
  const { isPending: sessionPending } = authClient.useSession();
  const path = useAuthRedirectPath();

  useEffect(() => {
    // A failed sign-in comes back with the flag still set. SignInErrorToast
    // reads it to tell a real failure from a link, then clears it.
    if (readSignInError()) {
      return;
    }

    if (readLoginFlag()) {
      sessionRefreshTriggeredRef.current = true;
      setIsLoggingIn(true);
    }
  }, []);

  useEffect(() => {
    if (!isLoggingIn) {
      return;
    }

    if (sessionPending) {
      sessionRefreshTriggeredRef.current = true;
      return;
    }

    if (sessionRefreshTriggeredRef.current) {
      let cancelled = false;

      const finish = async () => {
        writeLoginFlag(false);
        await delay(10000);

        if (!cancelled) {
          setIsLoggingIn(false);
          sessionRefreshTriggeredRef.current = false;
        }
      };

      void finish();

      return () => {
        cancelled = true;
      };
    }
  }, [isLoggingIn, sessionPending]);

  const fail = async (message: string) => {
    toast.error('Error occurred: ' + message);
    writeLoginFlag(false);
    sessionRefreshTriggeredRef.current = false;
    await delay(1000);
    setIsLoggingIn(false);
  };

  const logIn = async () => {
    writeLoginFlag(true);
    sessionRefreshTriggeredRef.current = false;
    setIsLoggingIn(true);

    if (isTailnetPreview()) {
      try {
        await signInE2eAdmin();
        window.location.assign(path);
      } catch (error) {
        await fail(error instanceof Error ? error.message : String(error));
      }

      return;
    }

    const { error } = await authClient.signIn.social({
      provider: 'osu',
      callbackURL: path,
      errorCallbackURL: path,
    });

    if (error) {
      await fail(error.message ?? String(error));
    }
  };

  return (
    <Button
      size={size}
      icon={LogIn}
      pending={isLoggingIn}
      onClick={() => void logIn()}
      className={className}
    >
      {isLoggingIn ? 'Logging in…' : 'Log in'}
    </Button>
  );
}

/**
 * Reports a failed osu! sign-in in an error toast and takes the error out of
 * the address. Mount it once, after the Toaster.
 */
export function SignInErrorToast() {
  useEffect(() => {
    const signInError = readSignInError();

    // Anyone can put an error in a link, so report only a sign-in this tab
    // started.
    if (!signInError || !readLoginFlag()) {
      return;
    }

    writeLoginFlag(false);

    const url = new URL(window.location.href);
    for (const param of SIGN_IN_ERROR_PARAMS) {
      url.searchParams.delete(param);
    }
    window.history.replaceState(null, '', url);

    if (signInError.code !== CANCELLED_ERROR) {
      toast.error("Couldn't log in with osu!", {
        // Some failures carry only a code, such as unable_to_get_user_info.
        description:
          signInError.description ?? humanizeFieldName(signInError.code),
      });
    }
  }, []);

  return null;
}
