import { dialog, ipcMain } from 'electron'
import {
  IPC,
  type TeacherTestActionResult,
  type TeacherTestStartInput
} from '@shared/types/ipc'
import { assertTrustedIpcSender } from '../security/IpcSecurity'
import { TeacherTestRunService } from '../teacherTest/TeacherTestRunService'

function readStartInput(raw: unknown): TeacherTestStartInput {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('老師實測設定格式無效。')
  }
  const value = raw as Record<string, unknown>
  if (
    typeof value.releaseTag !== 'string' ||
    typeof value.productSourceCommit !== 'string' ||
    value.releaseTag.length > 32 ||
    value.productSourceCommit.length > 64
  ) {
    throw new Error('老師實測版本身分格式無效。')
  }
  return {
    releaseTag: value.releaseTag,
    productSourceCommit: value.productSourceCommit
  }
}

function errorResult(error: unknown): TeacherTestActionResult {
  return {
    ok: false,
    message: error instanceof Error ? error.message : '老師實測操作失敗。'
  }
}

export function registerTeacherTestHandlers(service: TeacherTestRunService): void {
  ipcMain.handle(IPC.TEACHER_TEST_STATUS, (event) => {
    assertTrustedIpcSender(event)
    return service.getStatus()
  })

  ipcMain.handle(
    IPC.TEACHER_TEST_START,
    async (event, rawInput: unknown): Promise<TeacherTestActionResult> => {
      assertTrustedIpcSender(event)
      try {
        const input = readStartInput(rawInput)
        const result = await dialog.showOpenDialog({
          title: '選擇要核對的 Windows 安裝檔',
          properties: ['openFile'],
          filters: [{ name: 'Windows installer', extensions: ['exe'] }]
        })
        if (result.canceled || result.filePaths.length === 0) {
          return { ok: false, cancelled: true }
        }
        await service.start({ ...input, installerPath: result.filePaths[0] })
        return { ok: true, status: service.getStatus() }
      } catch (error) {
        return errorResult(error)
      }
    }
  )

  ipcMain.handle(
    IPC.TEACHER_TEST_END,
    (event): TeacherTestActionResult => {
      assertTrustedIpcSender(event)
      try {
        service.end()
        return { ok: true, status: service.getStatus() }
      } catch (error) {
        return errorResult(error)
      }
    }
  )
}
