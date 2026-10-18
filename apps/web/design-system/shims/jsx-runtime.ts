/** The automatic JSX runtime, over the global React's createElement. */
import * as React from 'react';

export function jsx(
  type: React.ElementType,
  props: Record<string, unknown>,
  key?: React.Key
) {
  return React.createElement(
    type,
    key === undefined ? props : { ...props, key }
  );
}

export const jsxs = jsx;
export const jsxDEV = jsx;
export const Fragment = React.Fragment;
