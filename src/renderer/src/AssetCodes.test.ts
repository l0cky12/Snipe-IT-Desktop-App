import { describe, expect, it } from 'vitest'
import { assetCodes } from './AssetCodes'

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
