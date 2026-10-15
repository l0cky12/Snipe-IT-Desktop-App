// The sidebar's pages Settings can show or hide. Here and not in config.ts: the renderer imports these, and config.ts needs node:fs.

/** In sidebar order. Search, All records and Settings always show. */
export const SIDEBAR_PAGES = ['assets', 'users', 'locations', 'models', 'activity', 'licenses', 'accessories', 'consumables', 'workflows', 'import', 'dashboard', 'reports'] as const
export type SidebarPage = (typeof SIDEBAR_PAGES)[number]
/** Shown until chosen otherwise: the sidebar as it was before it could be changed; the stock Lists are a tick away. */
export const SIDEBAR_DEFAULT: SidebarPage[] = SIDEBAR_PAGES.filter((p) => !['licenses', 'accessories', 'consumables'].includes(p))
