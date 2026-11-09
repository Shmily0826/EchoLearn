import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  retries: 0,
  projects: [{ name: 'real-auth', testMatch: '**/real-auth-regression.spec.ts' }],
});
