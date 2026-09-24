import { contextBridge, ipcRenderer } from 'electron'
import type { SnipeIt } from '../main/snipeit'

// Exactly the SnipeIt interface, one function per IPC channel. Nothing else reaches the screen.
const call = (name: keyof SnipeIt) => (...args: unknown[]) => ipcRenderer.invoke(`snipeit:${name}`, ...args)

const snipeIt: SnipeIt = {
  lookup: call('lookup'),
  getAsset: call('getAsset'),
}

contextBridge.exposeInMainWorld('snipeIt', snipeIt)
