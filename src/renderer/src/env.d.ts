/// <reference types="vite/client" />
import type { SnipeIt } from '../../main/snipeit'

import type { SettingsApi } from '../../main/config'

declare global {
  interface Window {
    snipeIt: SnipeIt
    settings: SettingsApi
  }
}
