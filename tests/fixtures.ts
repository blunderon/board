import { test as base, expect } from '@playwright/test';

export { expect } from '@playwright/test';

export const test = base.extend<{ pageErrors: undefined }>({
  pageErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      const recordError = (error: Error) => errors.push(error.message);
      page.on('pageerror', recordError);
      await use(undefined);
      page.off('pageerror', recordError);
      expect(errors).toEqual([]);
    },
    { auto: true },
  ],
});
