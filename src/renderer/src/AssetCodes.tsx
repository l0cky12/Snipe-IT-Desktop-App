import { useEffect, useRef, useState } from 'react'
import qrcode from 'qrcode-generator'
import JsBarcode from 'jsbarcode'
import type { Asset } from '../../main/snipeit'

// What the Asset page's codes encode: the QR code the Asset's page in the Snipe-IT web UI (Settings saves the base URL
// without a trailing slash), the barcode its Asset Tag (none when Code 128 can't hold it: it takes printable ASCII only).
export const assetCodes = (baseUrl: string, a: Pick<Asset, 'id' | 'assetTag'>) => ({
  url: `${baseUrl}/hardware/${a.id}`,
  tag: /^[\x20-\x7e]+$/.test(a.assetTag) ? a.assetTag : null,
})
// Blank modules around the QR code, as its standard asks; the barcode's margin is 10 bars wide (Code 128's minimum).
const QUIET = 4
const BARCODE = { format: 'CODE128', width: 2, margin: 20, background: '#ffffff', lineColor: '#000000' }

// The QR code's size in modules, quiet zone included, and its dark modules as one SVG path.
function qrModules(url: string) {
  const qr = qrcode(0, 'M')
  qr.addData(url)
  qr.make()
  const n = qr.getModuleCount()
  let path = ''
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) path += `M${c} ${r}h1v1h-1z`
  return { size: n + 2 * QUIET, path }
}

// Drawn by the app, not fetched from Snipe-IT, so they show even with barcodes turned off there.
// Always black on white with a quiet zone, which scanners need in either theme.
export function AssetCodes({ baseUrl, asset }: { baseUrl: string; asset: Pick<Asset, 'id' | 'assetTag'> }) {
  const codes = assetCodes(baseUrl, asset)
  const barcodeSvg = useRef<SVGSVGElement>(null)
  useEffect(() => {
    if (codes.tag && barcodeSvg.current) JsBarcode(barcodeSvg.current, codes.tag, { ...BARCODE, height: 56, font: 'Space Mono', fontSize: 14 })
  }, [codes.tag])
  const { size, path } = qrModules(codes.url)

  return (
    <div className="codes">
      <figure>
        <svg className="qr" viewBox={`${-QUIET} ${-QUIET} ${size} ${size}`} shapeRendering="crispEdges" role="img" aria-label={`QR code of ${codes.url}`}>
          <title>{codes.url}</title>
          <rect x={-QUIET} y={-QUIET} width={size} height={size} fill="#ffffff" />
          <path d={path} fill="#000000" />
        </svg>
        <figcaption>Opens in Snipe-IT</figcaption>
      </figure>
      <figure>
        {codes.tag
          ? <svg className="barcode" ref={barcodeSvg} role="img" aria-label={`Code 128 barcode of ${codes.tag}`} />
          : <p className="dim">This Asset Tag can't be a Code 128 barcode</p>}
        <figcaption>Asset Tag</figcaption>
      </figure>
    </div>
  )
}

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ENTITIES[c])

// The app's own Label, for a Snipe-IT that can't make one over the API: a 2.25″ × 1.25″ page with the QR code beside the
// Asset Tag and name, above the barcode (its SVG, or null when the tag can't be one) the Label's width.
export function labelHtml(baseUrl: string, a: Pick<Asset, 'id' | 'assetTag' | 'name'>, barcodeSvg: string | null) {
  const { size, path } = qrModules(assetCodes(baseUrl, a).url)
  return `<!doctype html><meta charset="utf-8"><title>Label ${escapeHtml(a.assetTag)}</title><style>
@page { size: 2.25in 1.25in; margin: 0 }
body { margin: 0; width: 2.25in; height: 1.25in; box-sizing: border-box; padding: .06in; overflow: hidden; color: #000; background: #fff;
  display: grid; grid-template: 1fr auto / .74in 1fr; gap: .04in .08in; font: 7pt sans-serif }
.qr { width: .74in; height: .74in; align-self: center }
.text { align-self: center; overflow: hidden; overflow-wrap: anywhere; max-height: .74in }
.tag { font: bold 9pt monospace }
.barcode { grid-column: 1 / -1; width: 100%; height: .34in }
</style>
<svg class="qr" viewBox="${-QUIET} ${-QUIET} ${size} ${size}" shape-rendering="crispEdges"><rect x="${-QUIET}" y="${-QUIET}" width="${size}" height="${size}" fill="#fff"/><path d="${path}"/></svg>
<div class="text"><div class="tag">${escapeHtml(a.assetTag)}</div><div>${escapeHtml(a.name)}</div></div>
${barcodeSvg ?? ''}`
}

// The barcode stretches to the Label's width; stretching every bar alike keeps it scannable.
function labelBarcode(tag: string | null) {
  if (!tag) return null
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  JsBarcode(svg, tag, { ...BARCODE, height: 50, displayValue: false })
  svg.setAttribute('class', 'barcode')
  svg.setAttribute('preserveAspectRatio', 'none')
  return svg.outerHTML
}

// Opens the Asset's Label in its own window to print or save: Snipe-IT's, or the app's own when Snipe-IT can't make one.
export function PrintLabel({ baseUrl, asset }: { baseUrl: string; asset: Pick<Asset, 'id' | 'assetTag' | 'name'> }) {
  const [state, setState] = useState<{ busy?: boolean; note?: string; error?: string }>({})
  async function print() {
    setState({ busy: true })
    try {
      const source = await window.label.print(asset.assetTag, labelHtml(baseUrl, asset, labelBarcode(assetCodes(baseUrl, asset).tag)))
      setState(source === 'own' ? { note: "Snipe-IT didn't make this Label, so it's the app's own." } : {})
    } catch (e) {
      setState({ error: (e as Error).message })
    }
  }
  return (
    <>
      <button className="quiet" disabled={state.busy} onClick={print}>{state.busy ? 'Opening Label…' : 'Print label'}</button>
      {state.note && <span className="dim">{state.note}</span>}
      {state.error && <span className="field-error" role="alert">{state.error}</span>}
    </>
  )
}
