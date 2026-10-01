import { describe, expect, it } from 'vitest'
import { assetCodes, labelHtml } from './AssetCodes'

describe("an Asset's QR code and barcode", () => {
  it("the QR code opens the Asset's page in the Snipe-IT web UI", () => {
    expect(assetCodes('https://snipe.nomma.net', { id: 42, assetTag: 'NOMMA-001003' }).url).toBe('https://snipe.nomma.net/hardware/42')
    expect(assetCodes('https://nomma.net/snipe', { id: 7, assetTag: 'NOMMA-001003' }).url).toBe('https://nomma.net/snipe/hardware/7')
  })

  it('the barcode is the Asset Tag, so a scan of it looks the Asset up', () => {
    expect(assetCodes('https://snipe.nomma.net', { id: 42, assetTag: 'NOMMA-001003' }).tag).toBe('NOMMA-001003')
  })

  it("there is no barcode for an Asset Tag that Code 128 can't hold", () => {
    expect(assetCodes('https://snipe.nomma.net', { id: 42, assetTag: 'Salle-É12' }).tag).toBeNull()
    expect(assetCodes('https://snipe.nomma.net', { id: 42, assetTag: '' }).tag).toBeNull()
  })
})

describe("the app's own Label", () => {
  const asset = { id: 42, assetTag: 'NOMMA-001003', name: 'Cart <B> & "spare"' }

  it('is 2.25″ × 1.25″ with the QR code, barcode, Asset Tag and name', () => {
    const html = labelHtml('https://snipe.nomma.net', asset, '<svg class="barcode"></svg>')
    expect(html).toContain('size: 2.25in 1.25in')
    expect(html).toContain('class="qr"')
    expect(html).toContain('<svg class="barcode"></svg>')
    expect(html).toContain('NOMMA-001003')
  })

  it("shows the name as text, not markup", () => {
    expect(labelHtml('https://snipe.nomma.net', asset, null)).toContain('Cart &lt;B&gt; &amp; &quot;spare&quot;')
  })
})
