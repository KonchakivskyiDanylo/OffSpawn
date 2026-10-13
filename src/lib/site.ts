/**
 * The site's one address: every canonical link, sitemap entry and shared
 * result uses it, and the server sends `http://` and `www.` requests here
 * (`server/index.ts`). Apart from `seo.ts` so the server reads it without React.
 */
export const SITE_URL = 'https://offspawn.app';
export const SITE_HOST = new URL(SITE_URL).host;
