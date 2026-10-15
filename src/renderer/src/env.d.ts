/// <reference types="vite/client" />
import type { SnipeItBridge } from '../../main/snipeit'

import type { SettingsApi } from '../../main/config'
import type { LabelApi, WorkflowsApi } from '../../main/index'
import type { ReleaseApi } from '../../main/release'
import type { ReportsApi } from '../../main/scheduler'
import type { ReminderApi } from '../../main/reminder'
import type { ExportApi } from '../../main/report'

declare global {
  interface Window {
    snipeIt: SnipeItBridge
    settings: SettingsApi
    label: LabelApi
    reports: ReportsApi
    exporter: ExportApi
    releases: ReleaseApi
    workflows: WorkflowsApi
    reminder: ReminderApi
  }
}
