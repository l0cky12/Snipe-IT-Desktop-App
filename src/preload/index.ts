import { contextBridge, ipcRenderer } from 'electron'
import type { SnipeIt } from '../main/snipeit'

// Exactly the SnipeIt interface, one function per IPC channel. Nothing else reaches the screen.
// Electron wraps a rejection as "Error invoking remote method '…': Error: <message>"; pass on just the message.
// ponytail: matches Electron's current wording; if it changes, the Operator sees the wrapper text too, nothing is lost.
const call = (name: keyof SnipeIt) => (...args: unknown[]) =>
  ipcRenderer.invoke(`snipeit:${name}`, ...args).catch((e: Error) => {
    throw new Error(e.message.replace(/^Error invoking remote method '[^']*': (\w*Error: )?/, ''))
  })

const snipeIt: SnipeIt = {
  lookup: call('lookup'),
  getAsset: call('getAsset'),
  statusLabels: call('statusLabels'),
  searchUsers: call('searchUsers'),
  searchLocations: call('searchLocations'),
  checkout: call('checkout'),
  checkin: call('checkin'),
}

contextBridge.exposeInMainWorld('snipeIt', snipeIt)
