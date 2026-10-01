/// <reference types="vite/client" />
import type { SnipeItBridge } from '../../main/snipeit'

import type { SettingsApi } from '../../main/config'
import type { LabelApi } from '../../main/index'

declare global {
  interface Window {
    snipeIt: SnipeItBridge
    settings: SettingsApi
    label: LabelApi
  }
}
