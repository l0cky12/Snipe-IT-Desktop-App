import { HEX, textOn, type Branding } from '../../main/branding'

/**
 * Puts the two brand colours on the page, with the text that reads on each; the stylesheet derives the rest. On the
 * accent, the primary colour when it reads (NOMMA's navy on gold), otherwise black or white. A colour still being typed
 * leaves the page as it was.
 */
export function applyColors({ primary, accent }: Pick<Branding, 'primary' | 'accent'>) {
  if (!HEX.test(primary) || !HEX.test(accent)) return
  const root = document.documentElement.style
  root.setProperty('--navy', primary)
  root.setProperty('--on-navy', textOn(primary))
  root.setProperty('--gold', accent)
  root.setProperty('--on-gold', textOn(accent, primary))
}
