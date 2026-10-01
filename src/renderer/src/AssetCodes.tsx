import { useEffect, useRef } from 'react'
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

// Drawn by the app, not fetched from Snipe-IT, so they show even with barcodes turned off there.
// Always black on white with a quiet zone, which scanners need in either theme.
export function AssetCodes({ baseUrl, asset }: { baseUrl: string; asset: Pick<Asset, 'id' | 'assetTag'> }) {
  const codes = assetCodes(baseUrl, asset)
  const barcodeSvg = useRef<SVGSVGElement>(null)
  useEffect(() => {
    if (codes.tag && barcodeSvg.current)
      JsBarcode(barcodeSvg.current, codes.tag, { format: 'CODE128', height: 56, width: 2, margin: 20, font: 'Space Mono', fontSize: 14, background: '#ffffff', lineColor: '#000000' })
  }, [codes.tag])

  const qr = qrcode(0, 'M')
  qr.addData(codes.url)
  qr.make()
  const n = qr.getModuleCount()
  let path = ''
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) path += `M${c} ${r}h1v1h-1z`

  return (
    <div className="codes">
      <figure>
        <svg className="qr" viewBox={`${-QUIET} ${-QUIET} ${n + 2 * QUIET} ${n + 2 * QUIET}`} shapeRendering="crispEdges" role="img" aria-label={`QR code of ${codes.url}`}>
          <title>{codes.url}</title>
          <rect x={-QUIET} y={-QUIET} width={n + 2 * QUIET} height={n + 2 * QUIET} fill="#ffffff" />
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
