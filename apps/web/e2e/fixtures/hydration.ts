import { expect, type Locator } from '@playwright/test';

/**
 * Waits until React has hydrated `control`, so a click or key press reaches
 * its handler. The server renders a page's controls before its JavaScript
 * runs, so a control can be visible and enabled while an event on it still
 * does nothing, and under load that gap lasts seconds. React gives each
 * element it hydrates a `__reactProps$…` property holding the handlers it
 * calls.
 */
export async function waitForHydration(control: Locator): Promise<void> {
  // Each wait lasts as long as a click waits for its control: until the test
  // times out.
  await control.waitFor();
  await expect
    .poll(
      () =>
        control.evaluate(
          (element) =>
            Object.keys(element).some((key) => key.startsWith('__reactProps$')),
          undefined,
          { timeout: 1000 }
        ),
      { message: 'React has hydrated the control', timeout: 0 }
    )
    .toBe(true);
}
