import { contextBridge, ipcRenderer } from 'electron'
import type { SettingsApi } from '../main/config'
import type { SnipeIt } from '../main/snipeit'

// Electron wraps a rejection as "Error invoking remote method '…': Error: <message>"; pass on just the message.
// ponytail: matches Electron's current wording; if it changes, the Operator sees the wrapper text too, nothing is lost.
const call = (name: string) => (...args: unknown[]) =>
  ipcRenderer.invoke(name, ...args).catch((e: Error) => {
    throw new Error(e.message.replace(/^Error invoking remote method '[^']*': (\w*Error: )?/, ''))
  })

const snipeIt: SnipeIt = {
  testConnection: call('snipeit:testConnection'),
  locations: call('snipeit:locations'),
  lookup: call('snipeit:lookup'),
  getAsset: call('snipeit:getAsset'),
  statusLabels: call('snipeit:statusLabels'),
  searchUsers: call('snipeit:searchUsers'),
  searchLocations: call('snipeit:searchLocations'),
  checkout: call('snipeit:checkout'),
  checkin: call('snipeit:checkin'),
  dashboard: call('snipeit:dashboard'),
}

contextBridge.exposeInMainWorld('snipeIt', snipeIt)

const settings: SettingsApi = { get: call('settings:get'), save: call('settings:save'), test: call('settings:test'), locations: call('settings:locations'), clearToken: call('settings:clearToken') }
contextBridge.exposeInMainWorld('settings', settings)
