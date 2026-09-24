/// <reference types="vite/client" />
import type { SnipeIt } from '../../main/snipeit'

declare global {
  interface Window {
    snipeIt: SnipeIt
  }
}
