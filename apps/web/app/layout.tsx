import SiteBanner from '@/components/banner/SiteBanner';
import SiteUpdatedToast from '@/components/banner/SiteUpdatedToast';
import Header from '@/components/header/Header';
import { ThemeProvider } from 'next-themes';
import { Toaster } from '@/components/ui/sonner';
import { SignInErrorToast } from '@/components/profile/LoginButton';
import type { Metadata } from 'next';
import React from 'react';
import './globals.css';
import Footer from '@/components/footer/Footer';
import SessionProvider from '@/components/session-provider';
import { AudioPlayerProvider } from '@/components/audio/AudioPlayerContext';
import AudioPlayerControls from '@/components/audio/AudioPlayerControls';
import { TooltipProvider } from '@/components/ui/tooltip';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { mapAppSessionToUser } from '@/lib/auth/session-utils';
import { resolveMaintenanceWindowActive } from '@/lib/maintenance-window';

export const metadata: Metadata = {
  title: {
    default: 'osu! Tournament Rating',
    template: '%s | o!TR',
  },
  description: 'The newest osu! tournament statistics platform',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headersList = await headers();
  const appSession = await auth.api.getSession({ headers: headersList });
  const session = mapAppSessionToUser(appSession);

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap"
        />
      </head>
      <body className="flex min-h-screen flex-col font-sans">
        <ThemeProvider attribute="class" disableTransitionOnChange>
          <TooltipProvider>
            <SessionProvider user={session}>
              <AudioPlayerProvider>
                {/* The first stop for keyboard users: past the header's
                    controls to the page. Hidden until focused. */}
                <a
                  href="#main"
                  className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:shadow-md focus:ring-[3px] focus:ring-ring/50 focus:outline-none"
                >
                  Skip to content
                </a>
                <Header />
                {/* One strip: the maintenance window and the signed-out
                    note share it rather than stacking. */}
                <SiteBanner
                  maintenance={resolveMaintenanceWindowActive(headersList)}
                />
                {/* The page frame's margins: 16px at the sides on phones,
                    40px below the header from sm. Pages add no container. */}
                <main
                  id="main"
                  tabIndex={-1}
                  className="mx-auto w-full max-w-[1050px] flex-1 px-4 pt-6 pb-10 outline-none sm:px-5 sm:pt-10"
                >
                  {children}
                </main>
                <Footer />
                <Toaster richColors />
                <SignInErrorToast />
                <SiteUpdatedToast />
                <AudioPlayerControls />
              </AudioPlayerProvider>
            </SessionProvider>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
