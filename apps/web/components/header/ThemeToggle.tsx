'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { toast } from 'sonner';

import { IconButton } from '@/components/kit/controls/IconButton';
import { useSession } from '@/lib/hooks/useSession';
import { useThemeHotkeyEnabled } from '@/lib/hooks/useThemeHotkey';

const TOAST_STORAGE_KEY = 'otr-theme-hotkey-toast-shown';

/**
 * Switches between light and dark. Ctrl+L does the same unless the visitor
 * turned the shortcut off; the first time it fires for a signed-in visitor,
 * a toast says where to turn it off.
 */
export default function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const { setTheme, resolvedTheme } = useTheme();
  const hotkeyEnabled = useThemeHotkeyEnabled();
  const user = useSession();
  const router = useRouter();

  const toggleTheme = () => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
  };

  const showHotkeyToast = () => {
    if (!user) return;

    try {
      if (localStorage.getItem(TOAST_STORAGE_KEY)) return;
      localStorage.setItem(TOAST_STORAGE_KEY, 'true');
    } catch {
      return;
    }

    toast.custom(
      (id) => (
        <button
          type="button"
          className="w-full cursor-pointer rounded-md p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => {
            toast.dismiss(id);
            router.push('/settings?highlight=theme-hotkey');
          }}
        >
          <p className="text-sm font-medium">Ctrl+L toggled the theme</p>
          <p className="text-xs text-muted-foreground">
            Click here to turn this shortcut off in your settings.
          </p>
        </button>
      ),
      {
        duration: 10_000,
        // A custom toast gets no surface from the Toaster.
        className: 'rounded-md border bg-background text-foreground shadow-lg',
      }
    );
  };

  useHotkeys(
    'CTRL+L',
    (e) => {
      e.preventDefault();
      toggleTheme();
      showHotkeyToast();
    },
    { enabled: hotkeyEnabled },
    [hotkeyEnabled, resolvedTheme, user, router]
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <IconButton
      data-testid="header-theme-toggle"
      label="Toggle theme"
      size="default"
      tooltipSide="bottom"
      onClick={toggleTheme}
      icon={mounted && resolvedTheme === 'dark' ? Moon : Sun}
    />
  );
}
