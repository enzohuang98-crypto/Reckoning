/**
 * 引擎介面 (PikafishAdapter)
 *
 * 以子行程驅動本機象棋引擎，支援兩種協定：
 *  - UCI（Pikafish）：uci→uciok、setoption name X value Y、go movetime
 *  - UCCI（象棋小蟲/旋風/名手/烏雲等）：ucci→ucciok、setoption X Y、go time
 *
 * 協定自動偵測：先送 uci，2 秒內未收到 uciok 改送 ucci 等 ucciok；
 * 若引擎在偵測期間直接結束行程（部分引擎收到未知指令即退出），
 * 會以剩餘協定重新啟動再試。偵測結果經 onProtocolDetected 回呼由上層持久化，
 * 下次啟動直接以已知協定握手。
 *
 * 二進位檔尋找順序：
 *   1. 使用者於設定頁指定並由 StorageService 持久化的路徑（userPath）
 *   2. 環境變數 PIKAFISH_PATH
 *   3. <resources>/engine/pikafish.exe（打包後）
 * 若找不到，isAvailable() 回 false，analyze() 拋出明確錯誤，
 * 由上層 IPC 轉成 renderer 可顯示的訊息。MVP 不內含二進位檔。
 *
 * 握手採「分段等待」：偵測協定（uciok/ucciok）→ setoption → isready 等 readyok，
 * 確認引擎就緒後才送 position / go，避免對未就緒引擎送出指令。
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type {
  EngineAnalysis,
  EngineAnalysisRequest,
  EngineLine,
  EngineProtocol
} from '@shared/types/EngineAnalysis'
import type { EngineTestResult } from '@shared/types/ipc'
import { parseFen } from '@shared/logic/fen'
import { MultiPvAccumulator, parseBestMove } from './EngineOutputParser'

export class EngineUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EngineUnavailableError'
  }
}

const ENGINE_NAME = 'Pikafish'

/** 各協定的握手指令與完成標記 */
const PROTOCOL_HANDSHAKE: Record<EngineProtocol, { greet: string; ok: string }> = {
  uci: { greet: 'uci', ok: 'uciok' },
  ucci: { greet: 'ucci', ok: 'ucciok' }
}

/** 單一協定等待 uciok/ucciok 的時限，逾時改試下一個協定 */
const PROTOCOL_DETECT_TIMEOUT_MS = 2000
/** 握手完成後等待 readyok 的時限（NNUE 載入可能較慢） */
const READY_TIMEOUT_MS = 15000

/** 由環境變數 / 打包資源解析引擎路徑（不含使用者自訂路徑） */
function resolveBundledEnginePath(): string | null {
  const fromEnv = process.env.PIKAFISH_PATH
  if (fromEnv && existsSync(fromEnv)) return fromEnv

  const resourceCandidates = [
    join(process.resourcesPath ?? '', 'engine', 'pikafish.exe'),
    join(process.cwd(), 'resources', 'engine', 'pikafish.exe')
  ]
  for (const candidate of resourceCandidates) {
    if (candidate && existsSync(candidate)) return candidate
  }
  return null
}

/** 引擎路徑來源，供 UI 提示用 */
export type EnginePathSource = 'user' | 'env' | 'resource' | null

/** 握手完成、可收發指令的引擎工作階段 */
interface ReadySession {
  protocol: EngineProtocol
  /** 引擎回報的 id name（未回報為 null） */
  engineId: string | null
  send(cmd: string): void
  /** 註冊握手後 stdout 行回呼（搜尋階段輸出） */
  setLineHandler(handler: (line: string) => void): void
  /** 註冊握手後行程結束回呼 */
  setExitHandler(handler: () => void): void
  /** 送 quit 並終止行程 */
  dispose(): void
}

export class PikafishAdapter {
  /** 使用者於設定頁指定的路徑（最高優先；可為 null） */
  private userPath: string | null
  /** 已知（先前偵測並持久化）的協定；null 表示需自動偵測 */
  private knownProtocol: EngineProtocol | null
  /** 偵測到（或變更）協定時通知上層持久化 */
  private protocolListener: ((protocol: EngineProtocol) => void) | null = null

  constructor(
    userPath: string | null = null,
    knownProtocol: EngineProtocol | null = null
  ) {
    this.userPath = userPath
    this.knownProtocol = knownProtocol
  }

  get engineName(): string {
    return ENGINE_NAME
  }

  /** 設定（或清除）使用者自訂引擎路徑。傳入 null / 空字串代表清除。 */
  setUserPath(path: string | null): void {
    const trimmed = path?.trim()
    this.userPath = trimmed ? trimmed : null
  }

  /** 取得使用者自訂路徑（未設定回 null） */
  getUserPath(): string | null {
    return this.userPath
  }

  /** 已知的引擎協定（尚未偵測回 null） */
  getKnownProtocol(): EngineProtocol | null {
    return this.knownProtocol
  }

  /** 設定（或以 null 重置）已知協定；路徑變更時應重置以重新偵測 */
  setKnownProtocol(protocol: EngineProtocol | null): void {
    this.knownProtocol = protocol
  }

  /** 註冊協定偵測回呼（偵測結果與已知值不同時觸發，供上層持久化） */
  onProtocolDetected(listener: (protocol: EngineProtocol) => void): void {
    this.protocolListener = listener
  }

  private recordDetectedProtocol(protocol: EngineProtocol): void {
    if (this.knownProtocol === protocol) return
    this.knownProtocol = protocol
    this.protocolListener?.(protocol)
  }

  /** 實際會使用的引擎路徑（依優先序解析）；找不到回 null。 */
  resolveEnginePath(): string | null {
    if (this.userPath && existsSync(this.userPath)) return this.userPath
    return resolveBundledEnginePath()
  }

  /** 目前生效路徑的來源，供 UI 顯示。 */
  pathSource(): EnginePathSource {
    if (this.userPath && existsSync(this.userPath)) return 'user'
    const fromEnv = process.env.PIKAFISH_PATH
    if (fromEnv && existsSync(fromEnv)) return 'env'
    if (resolveBundledEnginePath()) return 'resource'
    return null
  }

  isAvailable(): boolean {
    return this.resolveEnginePath() !== null
  }

  /**
   * 啟動引擎並完成「協定偵測 → setoption → isready/readyok」握手。
   * multiPv 為 null 時不設定 MultiPV（測試連線用）。
   */
  private spawnAndHandshake(
    enginePath: string,
    multiPv: number | null
  ): Promise<ReadySession> {
    // 已知協定優先嘗試；偵測失敗仍會輪到另一個協定（自我修復）
    const order: EngineProtocol[] =
      this.knownProtocol === 'ucci' ? ['ucci', 'uci'] : ['uci', 'ucci']
    return this.attemptHandshake(enginePath, order, multiPv)
  }

  private attemptHandshake(
    enginePath: string,
    protocols: EngineProtocol[],
    multiPv: number | null
  ): Promise<ReadySession> {
    return new Promise<ReadySession>((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams
      try {
        child = spawn(enginePath, [], { windowsHide: true })
      } catch (err) {
        reject(new EngineUnavailableError(`無法啟動引擎：${String(err)}`))
        return
      }

      let buffer = ''
      let settled = false
      /** 目前嘗試中的協定索引 */
      let trying = 0
      let detected: EngineProtocol | null = null
      let engineId: string | null = null
      let phase: 'detecting' | 'awaiting-readyok' | 'ready' = 'detecting'
      let detectTimer: ReturnType<typeof setTimeout> | null = null
      let readyTimer: ReturnType<typeof setTimeout> | null = null
      let lineHandler: ((line: string) => void) | null = null
      let exitHandler: (() => void) | null = null

      const send = (cmd: string): void => {
        try {
          child.stdin.write(cmd + '\n')
        } catch {
          /* 行程可能已結束，忽略 */
        }
      }

      const clearTimers = (): void => {
        if (detectTimer) clearTimeout(detectTimer)
        if (readyTimer) clearTimeout(readyTimer)
      }

      const dispose = (): void => {
        clearTimers()
        send('quit')
        child.kill()
      }

      const fail = (err: Error): void => {
        if (settled) return
        settled = true
        dispose()
        reject(err)
      }

      const greetCurrent = (): void => {
        send(PROTOCOL_HANDSHAKE[protocols[trying]].greet)
        detectTimer = setTimeout(() => {
          trying++
          if (trying < protocols.length) {
            greetCurrent()
          } else {
            fail(
              new EngineUnavailableError(
                '引擎握手逾時：對 UCI 與 UCCI 指令皆無回應。請確認指定的檔案為有效的象棋引擎可執行檔。'
              )
            )
          }
        }, PROTOCOL_DETECT_TIMEOUT_MS)
      }

      const onDetected = (protocol: EngineProtocol): void => {
        if (detectTimer) clearTimeout(detectTimer)
        detected = protocol
        phase = 'awaiting-readyok'
        this.recordDetectedProtocol(protocol)
        if (protocol === 'ucci') {
          // UCCI 時間單位預設為「秒」，要求改用毫秒（go time 才能與 UCI movetime 對齊）；
          // UCCI 的 setoption 無 name/value 關鍵字，未支援的選項會被引擎忽略
          send('setoption usemillisec true')
          if (multiPv !== null) send(`setoption multipv ${multiPv}`)
        } else if (multiPv !== null) {
          send(`setoption name MultiPV value ${multiPv}`)
        }
        send('isready')
        readyTimer = setTimeout(() => {
          fail(
            new EngineUnavailableError(
              '引擎未在時限內就緒（readyok）。若為 Pikafish，請確認 pikafish.nnue 評估檔與執行檔在同一目錄。'
            )
          )
        }, READY_TIMEOUT_MS)
      }

      const handleLine = (line: string): void => {
        if (phase === 'ready') {
          lineHandler?.(line)
          return
        }
        if (line.startsWith('id name ')) {
          engineId = line.slice('id name '.length).trim()
          return
        }
        if (phase === 'detecting') {
          // 接受任一協定的完成標記（晚到的回應也算數）
          if (line === 'uciok') onDetected('uci')
          else if (line === 'ucciok') onDetected('ucci')
          return
        }
        if (phase === 'awaiting-readyok' && line === 'readyok') {
          if (readyTimer) clearTimeout(readyTimer)
          phase = 'ready'
          settled = true
          resolve({
            protocol: detected as EngineProtocol,
            engineId,
            send,
            setLineHandler: (h) => {
              lineHandler = h
            },
            setExitHandler: (h) => {
              exitHandler = h
            },
            dispose
          })
        }
      }

      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        buffer += chunk
        let idx: number
        while ((idx = buffer.indexOf('\n')) >= 0) {
          const rawLine = buffer.slice(0, idx).trim()
          buffer = buffer.slice(idx + 1)
          if (!rawLine) continue
          handleLine(rawLine)
        }
      })

      child.on('error', (err) => {
        fail(new EngineUnavailableError(`引擎行程錯誤：${err.message}`))
      })

      child.on('exit', () => {
        if (phase === 'ready') {
          exitHandler?.()
          return
        }
        if (settled) return
        settled = true
        clearTimers()
        // 偵測期間行程提早結束：部分引擎收到未知協定指令會直接退出，
        // 若還有未試過的協定，重新啟動行程改用下一個
        const remaining = protocols.slice(trying + 1)
        if (detected === null && remaining.length > 0) {
          this.attemptHandshake(enginePath, remaining, multiPv).then(resolve, reject)
        } else {
          reject(
            new EngineUnavailableError(
              '引擎行程在握手期間結束。請確認指定的檔案為有效的 UCI/UCCI 象棋引擎。'
            )
          )
        }
      })

      greetCurrent()
    })
  }

  /**
   * 連線測試：啟動引擎完成握手後立即關閉。
   * 回傳偵測到的協定與引擎版本名，失敗時回傳原因（不拋出例外）。
   */
  async test(): Promise<EngineTestResult> {
    const enginePath = this.resolveEnginePath()
    if (!enginePath) {
      return {
        ok: false,
        message: '找不到引擎執行檔。請指定引擎路徑後再測試。'
      }
    }
    try {
      const session = await this.spawnAndHandshake(enginePath, null)
      const result: EngineTestResult = {
        ok: true,
        protocol: session.protocol,
        engineName: session.engineId ?? ENGINE_NAME
      }
      session.dispose()
      return result
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err)
      }
    }
  }

  /**
   * 分析單一局面。回傳完整 EngineAnalysis。
   * 若引擎不可用則拋出 EngineUnavailableError。
   */
  async analyze(request: EngineAnalysisRequest): Promise<EngineAnalysis> {
    const enginePath = this.resolveEnginePath()
    if (!enginePath) {
      throw new EngineUnavailableError(
        '找不到引擎執行檔。請至設定頁指定引擎路徑，或設定 PIKAFISH_PATH 環境變數 / 放置 resources/engine/pikafish.exe。'
      )
    }

    const parsed = parseFen(request.fen)
    if (!parsed.valid) {
      throw new Error(`無效的 FEN：${parsed.message}`)
    }
    const sideToMove = parsed.board.sideToMove

    const multiPv = Math.max(1, request.multiPv ?? 1)
    const session = await this.spawnAndHandshake(enginePath, multiPv)
    const accumulator = new MultiPvAccumulator()

    return new Promise<EngineAnalysis>((resolve, reject) => {
      let settled = false
      let bestMoveUci: string | null = null
      let searchTimer: ReturnType<typeof setTimeout> | null = null

      const finish = (): void => {
        if (settled) return
        settled = true
        if (searchTimer) clearTimeout(searchTimer)
        const lines = accumulator.getLines()
        const best: EngineLine | undefined =
          lines.find((l) => l.multipv === 1) ?? lines[0]
        session.dispose()
        if (!best) {
          reject(new Error('引擎未回傳任何候選線（可能 FEN 不合法、無子可動或引擎異常）'))
          return
        }
        resolve({
          fen: request.fen,
          sideToMove,
          depth: best.depth,
          bestMoveUci: bestMoveUci ?? best.bestMoveUci,
          bestLine: best,
          lines,
          score: best.score,
          engineName: session.engineId ?? ENGINE_NAME,
          computedAt: Date.now()
        })
      }

      session.setExitHandler(finish)
      session.setLineHandler((line) => {
        accumulator.ingestLine(line)
        // UCCI：無著法可走時回 nobestmove
        if (line.startsWith('nobestmove')) {
          finish()
          return
        }
        const bm = parseBestMove(line)
        if (bm !== null) {
          bestMoveUci = bm
          finish()
        }
      })

      // UCCI 不支援 go movetime；usemillisec 已設 true，go time 單位為毫秒
      const go = request.movetimeMs
        ? session.protocol === 'ucci'
          ? `go time ${request.movetimeMs}`
          : `go movetime ${request.movetimeMs}`
        : `go depth ${request.depth ?? 15}`
      session.send(`position fen ${request.fen}`)
      session.send(go)

      // 安全逾時：搜尋總時長上限，逾時停手取目前最佳結果
      searchTimer = setTimeout(() => {
        session.send('stop')
        finish()
      }, (request.movetimeMs ?? 30000) + 15000)
    })
  }
}
