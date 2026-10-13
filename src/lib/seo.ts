import { useEffect } from 'react';
import type { GameMeta } from '@/games/registry';
import { SITE_URL } from './site';

/**
 * What a search engine sees of each page: its title, description and
 * canonical address.
 *
 * Read in two places so they cannot drift apart: `usePageMeta`, as the app
 * moves between pages, and `scripts/prerender.ts`, which writes a real HTML
 * page per game after the build so a crawler gets the words without running
 * the app. Until 1 Oct 2026 every address was a `#/…` hash, which a search
 * engine reads as the home page, and the whole site was one indexed page.
 */
export { SITE_URL };
export const SITE_NAME = 'OffSpawn';

export interface PageMeta {
  title: string;
  description: string;
  /** The canonical path, or null for a page that should not claim one. */
  path: string | null;
}

export const HOME_META: PageMeta = {
  title: 'OffSpawn — Competitive Fortnite Puzzles',
  description:
    'Daily puzzle games about competitive Fortnite — guess pro players from their career results, teammates, earnings and FNCS titles. New puzzles every day. Player data from Liquipedia.',
  path: '/',
};

export const PRIVACY_META: PageMeta = {
  title: `Privacy | ${SITE_NAME}`,
  description:
    'What OffSpawn keeps: no accounts or tracking, your results stay in your browser, and finished rounds are counted anonymously.',
  path: '/privacy',
};

export const CREDITS_META: PageMeta = {
  title: `Credits & licence | ${SITE_NAME}`,
  description:
    'Where OffSpawn’s competitive Fortnite data comes from — Liquipedia — and the licence it is shared under.',
  path: '/credits',
};

export const NOT_FOUND_META: PageMeta = {
  title: `Page not found | ${SITE_NAME}`,
  description: HOME_META.description,
  path: null,
};

/** A game's page: its own search title and description, under its slug. */
export function gameMeta(game: GameMeta): PageMeta {
  return {
    title: `${game.seo?.title ?? `${game.title}: ${game.tagline.replace(/\.$/, '')}`} | ${SITE_NAME}`,
    description: game.seo?.description ?? game.tagline,
    path: `/game/${game.slug}`,
  };
}

/** The tags `usePageMeta` and the prerender both write, in one place. */
export function metaTags(meta: PageMeta): { attr: 'name' | 'property'; key: string; content: string }[] {
  return [
    { attr: 'name', key: 'description', content: meta.description },
    { attr: 'property', key: 'og:site_name', content: SITE_NAME },
    { attr: 'property', key: 'og:type', content: 'website' },
    { attr: 'property', key: 'og:title', content: meta.title },
    { attr: 'property', key: 'og:description', content: meta.description },
    { attr: 'property', key: 'og:image', content: `${SITE_URL}/logo.jpg` },
    ...(meta.path === null ? [] : [{ attr: 'property' as const, key: 'og:url', content: SITE_URL + meta.path }]),
    { attr: 'name', key: 'twitter:card', content: 'summary' },
  ];
}

/** Sets the page's title, description, canonical link and share tags while it is open. */
export function usePageMeta(meta: PageMeta): void {
  const { title, description, path } = meta;
  useEffect(() => {
    document.title = title;
    const tags = metaTags({ title, description, path });
    for (const { attr, key, content } of tags) {
      let tag = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
      if (!tag) {
        tag = document.createElement('meta');
        tag.setAttribute(attr, key);
        document.head.append(tag);
      }
      tag.content = content;
    }
    if (path === null) document.head.querySelector('meta[property="og:url"]')?.remove();

    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (path === null) {
      canonical?.remove();
    } else {
      if (!canonical) {
        canonical = document.createElement('link');
        canonical.rel = 'canonical';
        document.head.append(canonical);
      }
      canonical.href = SITE_URL + path;
    }
  }, [title, description, path]);
}
