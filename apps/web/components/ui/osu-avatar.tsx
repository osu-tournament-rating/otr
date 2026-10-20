'use client';

import { useState } from 'react';
import Image from 'next/image';
import { User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

interface OsuAvatarProps extends React.ComponentProps<typeof Avatar> {
  osuId: number;
  username?: string | null;
  size?: number;
  className?: string;
  fallback?: React.ReactNode;
}

/**
 * Optimized avatar component for osu! user avatars.
 * Uses Next.js Image for automatic caching and optimization.
 *
 * The placeholder shows until the avatar has loaded, not only after it
 * fails: a slow or stalled request fires no error, and an image that has not
 * loaded yet is transparent.
 */
export function OsuAvatar(props: OsuAvatarProps) {
  // A new player starts over, so a component React reuses for another
  // player never keeps the last one's result.
  return <OsuAvatarImage key={props.osuId} {...props} />;
}

function OsuAvatarImage({
  osuId,
  username,
  size = 32,
  className,
  fallback,
  ...rest
}: OsuAvatarProps) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>(
    'loading'
  );

  return (
    <Avatar
      className={cn(className)}
      style={{ width: size, height: size }}
      {...rest}
    >
      {status !== 'loaded' && (
        <AvatarFallback className="absolute inset-0 size-full">
          {fallback ?? <User className="h-1/2 w-1/2" />}
        </AvatarFallback>
      )}
      {status !== 'error' && (
        // On top of the placeholder, so an avatar that loads before the
        // page hydrates covers it at once.
        <Image
          src={`https://a.ppy.sh/${osuId}`}
          alt={username ? `${username}'s avatar` : 'User avatar'}
          width={size}
          height={size}
          className="relative aspect-square size-full rounded-full object-cover"
          onLoad={() => setStatus('loaded')}
          onError={() => setStatus('error')}
        />
      )}
    </Avatar>
  );
}
