/** next/image as a plain img, with public paths pointed at the uploads. */
import * as React from 'react';

import { assetUrl } from './asset';

interface ImageProps extends Omit<
  React.ImgHTMLAttributes<HTMLImageElement>,
  'src'
> {
  src: string | { src: string };
  fill?: boolean;
  priority?: boolean;
  quality?: number | string;
  placeholder?: string;
  blurDataURL?: string;
  unoptimized?: boolean;
  overrideSrc?: string;
  preload?: boolean;
}

/** next/image's own props, which an img doesn't take. */
const IMAGE_PROPS = [
  'quality',
  'placeholder',
  'blurDataURL',
  'unoptimized',
  'loader',
  'overrideSrc',
  'preload',
];

const Image = React.forwardRef<HTMLImageElement, ImageProps>(function Image(
  { src, fill, priority, style, ...props },
  ref
) {
  const rest: Record<string, unknown> = { ...props };
  for (const key of IMAGE_PROPS) delete rest[key];
  return React.createElement('img', {
    decoding: 'async',
    loading: priority ? 'eager' : 'lazy',
    ...rest,
    ref,
    src: assetUrl(typeof src === 'string' ? src : src.src),
    style: fill
      ? {
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          ...style,
        }
      : style,
  });
});

export default Image;
