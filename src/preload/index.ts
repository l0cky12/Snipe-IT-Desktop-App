import { contextBridge, ipcRenderer } from 'electron'
import type { SettingsApi } from '../main/config'
import type { SnipeItBridge } from '../main/snipeit'
import type { LabelApi } from '../main/index'
import type { ReportsApi } from '../main/scheduler'

// Electron wraps a rejection as "Error invoking remote method '…': Error: <message>"; pass on just the message.
// ponytail: matches Electron's current wording; if it changes, the Operator sees the wrapper text too, nothing is lost.
const call = (name: string) => (...args: unknown[]) =>
  ipcRenderer.invoke(name, ...args).catch((e: Error) => {
    throw new Error(e.message.replace(/^Error invoking remote method '[^']*': (\w*Error: )?/, ''))
  })

const snipeIt: SnipeItBridge = {
  testConnection: call('snipeit:testConnection'),
  operatorEmail: call('snipeit:operatorEmail'),
  locations: call('snipeit:locations'),
  lookup: call('snipeit:lookup'),
  getAsset: call('snipeit:getAsset'),
  statusLabels: call('snipeit:statusLabels'),
  searchUsers: call('snipeit:searchUsers'),
  searchLocations: call('snipeit:searchLocations'),
  checkout: call('snipeit:checkout'),
  checkin: call('snipeit:checkin'),
  dashboard: call('snipeit:dashboard'),
  list: call('snipeit:list'),
  exportList: call('snipeit:exportList'),
  names: call('snipeit:names'),
  updateStatus: call('snipeit:updateStatus'),
  report: call('snipeit:report'),
  record: call('snipeit:record'),
  form: call('snipeit:form'),
  customFields: call('snipeit:customFields'),
  save: call('snipeit:save'),
  remove: call('snipeit:remove'),
  canManagePermissions: call('snipeit:canManagePermissions'),
  userAccess: call('snipeit:userAccess'),
  groups: call('snipeit:groups'),
  group: call('snipeit:group'),
  setUserGroups: call('snipeit:setUserGroups'),
  saveGroup: call('snipeit:saveGroup'),
  canImport: call('snipeit:canImport'),
  imports: call('snipeit:imports'),
  uploadImport: call('snipeit:uploadImport'),
  processImport: call('snipeit:processImport'),
  deleteImport: call('snipeit:deleteImport'),
}

contextBridge.exposeInMainWorld('snipeIt', snipeIt)

const label: LabelApi = { print: call('label:print') }
contextBridge.exposeInMainWorld('label', label)

const settings: SettingsApi = { get: call('settings:get'), save: call('settings:save'), test: call('settings:test'), locations: call('settings:locations'), clearToken: call('settings:clearToken'),
  saveMail: call('settings:saveMail'), testMail: call('settings:testMail'), saveBackground: call('settings:saveBackground'),
  savedReports: call('settings:savedReports'), saveReport: call('settings:saveReport'), renameReport: call('settings:renameReport'), deleteReport: call('settings:deleteReport'),
  schedules: call('settings:schedules'), setSchedule: call('settings:setSchedule') }
contextBridge.exposeInMainWorld('settings', settings)

const reports: ReportsApi = { emailNow: call('reports:emailNow') }
contextBridge.exposeInMainWorld('reports', reports)
