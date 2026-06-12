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
import { assertTrustedIpcSender } from '../security/IpcSecurity'
import { normalizeLicenseKey } from '../security/InputValidation'

export function registerLicenseHandlers(licenseService: LicenseService): void {
  ipcMain.handle(IPC.LICENSE_STATUS, (event): LicenseStatus => {
    assertTrustedIpcSender(event)
    return licenseService.getStatus()
  })

  ipcMain.handle(
    IPC.LICENSE_ACTIVATE,
    (event, licenseKey: unknown): LicenseStatus => {
      assertTrustedIpcSender(event)
      return licenseService.activate(normalizeLicenseKey(licenseKey))
    }
  )

  ipcMain.handle(IPC.LICENSE_DEACTIVATE, (event): LicenseStatus => {
    assertTrustedIpcSender(event)
    return licenseService.deactivate()
  })
}
