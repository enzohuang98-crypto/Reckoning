/**
 * 買斷授權 IPC 處理器 (licenseHandlers) — SDS Q5
 *
 * license:status / license:activate / license:deactivate 三個 invoke 通道。
 * 驗證與儲存只在 main process（LicenseService）；renderer 只拿 LicenseStatus。
 */

import { ipcMain } from 'electron'
import { IPC } from '@shared/types/ipc'
import type { LicenseStatus } from '@shared/types/License'
import type { LicenseService } from '../license/LicenseService'

export function registerLicenseHandlers(licenseService: LicenseService): void {
  ipcMain.handle(IPC.LICENSE_STATUS, (): LicenseStatus => licenseService.getStatus())

  ipcMain.handle(
    IPC.LICENSE_ACTIVATE,
    (_e, licenseKey: string): LicenseStatus => licenseService.activate(String(licenseKey ?? ''))
  )

  ipcMain.handle(IPC.LICENSE_DEACTIVATE, (): LicenseStatus => licenseService.deactivate())
}
