/** GitHub's newest published Snipe-IT release (drafts and pre-releases left out). Public: the request carries no key and no NOMMA data. */
export const RELEASES_URL = 'https://api.github.com/repos/grokability/snipe-it/releases/latest'
const HOUR = 3_600_000

/** A Snipe-IT release: its tag ("v8.9.1") and its release notes on GitHub. */
export type Release = { tag: string; url: string }
/** What the release check keeps on this PC: the last release GitHub named and when, the last failed ask, and the tag hidden until the next release. */
export type ReleaseCache = Partial<Release> & { checkedAt?: string; failedAt?: string; hidden?: string }
/** What the screen can do with the Newer Snipe-IT available line. */
export type ReleaseApi = { open(url: string): Promise<void>; hide(tag: string): Promise<void> }

/** Whether url is a Snipe-IT release page on GitHub; if so, the URL as it would open. */
function releaseNotes(url: unknown): string | null {
  let u: URL
  try { u = new URL(url as string) } catch { return null }
  return u.protocol === 'https:' && u.host === 'github.com' && !u.username && !u.password && u.pathname.startsWith('/grokability/snipe-it/releases/') ? u.href : null
}

/** Opens release notes in the browser: the only page the app opens there, so any other URL is refused. */
export async function openReleaseNotes(url: unknown, open: (url: string) => Promise<void>) {
  const page = releaseNotes(url)
  if (!page) throw new Error('Only Snipe-IT release notes on GitHub open from here.')
  await open(page)
}

/**
 * The Newer Snipe-IT available check. GitHub allows 60 requests an hour from one IP, which the whole school shares, so
 * it asks at most once a day, and an hour after an ask that failed (rate limit, no internet), which shows nothing.
 */
export function createReleaseCheck({ store, fetch, now, url }: {
  store: { release(): ReleaseCache; saveRelease(cache: ReleaseCache): void }
  fetch: typeof globalThis.fetch
  now: () => Date
  /** RELEASES_URL, or the mock's. */
  url: string
}) {
  // A clock set back makes the age negative, which counts as old.
  const within = (at: string | undefined, ms: number) => {
    const age = now().getTime() - Date.parse(at ?? '')
    return age >= 0 && age < ms
  }
  async function ask() {
    const at = now().toISOString()
    try {
      const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Snipe-IT-Desktop' }, signal: AbortSignal.timeout(15_000) })
      const body = res.ok ? await res.json() as { tag_name?: unknown; html_url?: unknown } : null
      const notes = releaseNotes(body?.html_url)
      if (typeof body?.tag_name !== 'string' || !notes) throw new Error('No release')
      store.saveRelease({ ...store.release(), tag: body.tag_name, url: notes, checkedAt: at, failedAt: undefined })
    } catch {
      store.saveRelease({ ...store.release(), failedAt: at })
    }
  }
  let asking: Promise<void> | null = null
  return {
    /** The latest release GitHub named, asking again when that's a day old; null when none is known yet or it's hidden. */
    async latest(): Promise<Release | null> {
      const cache = store.release()
      if (!within(cache.checkedAt, 24 * HOUR) && !within(cache.failedAt, HOUR)) await (asking ??= ask().finally(() => { asking = null }))
      const { tag, url: notes, hidden } = store.release()
      return tag && notes && tag !== hidden ? { tag, url: notes } : null
    },
    /** Hide until the next release: this tag stays hidden on this PC; a newer one shows. */
    hide(tag: string) {
      if (typeof tag !== 'string' || !tag) throw new Error('Invalid release')
      store.saveRelease({ ...store.release(), hidden: tag })
    },
  }
}
