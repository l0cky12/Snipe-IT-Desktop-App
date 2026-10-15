/**
 * The organisation's look: its name (the sidebar, window title, tray and emails), two colours (primary: the logo tile
 * and buttons; accent: the marker and focus ring) and a square PNG icon. icon: the saved one as a data: URL, or null.
 * Global to this PC's install. The installer's name, app ID and launcher icon stay as built (ADR 0003).
 * No Node imports: the window imports this too.
 */
export type Branding = BrandingInput & { icon: string | null }
export type BrandingInput = { name: string; primary: string; accent: string; footer: string }
export const BRAND_DEFAULTS: BrandingInput = { name: 'Snipe-IT Desktop', primary: '#14285a', accent: '#f5b301', footer: '' }
/** A colour as Branding keeps it: "#rrggbb". */
export const HEX = /^#[0-9a-f]{6}$/i

// WCAG relative luminance of "#rrggbb".
function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => { const c = parseInt(hex.slice(i, i + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
/** Text that reads on a background colour: preferred if it contrasts 4.5:1 (WCAG AA), else black or white, whichever contrasts more. */
export function textOn(background: string, preferred?: string): string {
  const bg = luminance(background)
  if (preferred !== undefined) {
    const fg = luminance(preferred)
    if ((Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05) >= 4.5) return preferred
  }
  return bg > 0.179 ? '#000000' : '#ffffff'
}
