/**
 * 引擎介面 (PikafishAdapter) — SDS v0.2 §2.15
 *
 * 以子行程驅動本機象棋引擎，支援 UCI（Pikafish）與 UCCI（小蟲/旋風/名手/烏雲）。
 * 協定自動偵測：先送 uci，2 秒內未收到 uciok 改送 ucci；引擎在偵測期間
 * 退出則以剩餘協定重啟再試。偵測結果經 onProtocolDetected 由上層持久化。
 *
 * 雙階段分析（§2.15.2）：
 *   root analysis → bestMove / scoreAfterBestMove / candidateMoves
 *   userMove 在候選中 → 直接用 candidate.score（source: candidate_move，不取負號）
 *   不在候選 → 對 userMove 後局面二次分析（movetime 固定值，§2.15.6），
 *              結果必須經 invertEngineScore() 反轉回原局面行棋方視角
 *   二次分析失敗 → scoreAfterUserMove = null + uncertainty reason（§2.15.7）
 *
 * 取消（§2.16.5）：analyzePosition 接受 AbortSignal；abort 時對目前子行程送
 * UCI "stop"，500ms 寬限期後強制 kill，流程以 AbortError 拒絕。
 *
 * 二進位檔尋找順序：使用者設定路徑 > PIKAFISH_PATH > resources/engine/pikafish.exe。
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { lstatSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  MATE_SCORE,
  type AnalysisConfig,
  type EngineAnalysis,
  type EngineCandidateMove,
  type EngineProtocol,
  type EngineScore,
  type UserMoveEvaluationSource
} from '@shared/types/EngineAnalysis'
import type {
  EngineAnalysisErrorCode,
  EngineTestResult
} from '@shared/types/ipc'
import { parseFen } from '@shared/logic/fen'
import { applyUciMove, legalMoveCheck } from '@shared/logic/moves'
import {
  formatChineseMove,
  formatChineseVariation
} from '@shared/logic/ChineseNotation'
import { START_FEN } from '@shared/types/BoardState'
import {
  MultiPvAccumulator,
  parseBestMove,
  parseInfoLine
} from './EngineOutputParser'
import { normalizeEnginePath } from '../security/InputValidation'

/** 帶 IPC 錯誤碼的分析錯誤（§2.16.3 code 對應） */
export class EngineAnalysisError extends Error {
  constructor(
    public readonly code: EngineAnalysisErrorCode,
    message: string,
    public readonly diagnostics: string[] = []
  ) {
    super(message)
    this.name = 'EngineAnalysisError'
  }
}

function abortError(): DOMException {
  return new DOMException('Analysis cancelled', 'AbortError')
}

const DEFAULT_ENGINE_NAME = '象棋引擎'

/** 各協定的握手指令與完成標記 */
const PROTOCOL_HANDSHAKE: Record<EngineProtocol, { greet: string; ok: string }> = {
  uci: { greet: 'uci', ok: 'uciok' },
  ucci: { greet: 'ucci', ok: 'ucciok' }
}

/** 單一協定等待 uciok/ucciok 的時限，逾時改試下一個協定 */
const PROTOCOL_DETECT_TIMEOUT_MS = 2000
/** 握手完成後等待 readyok 的時限（NNUE 載入可能較慢） */
const READY_TIMEOUT_MS = 15000
/** 取消時等待引擎回應 stop 的寬限期（§2.16.5） */
const CANCEL_GRACE_MS = 500
/** 搜尋安全逾時的額外緩衝 */
const SEARCH_TIMEOUT_MARGIN_MS = 15000
/** 防止異常或惡意引擎持續輸出未換行資料造成記憶體耗盡 */
const MAX_ENGINE_OUTPUT_BUFFER_CHARS = 1024 * 1024
const MAX_RAW_ANALYSIS_LINES = 300
const MAX_RAW_ANALYSIS_LINE_CHARS = 2000

function sanitizeEngineLine(line: string): string {
  return line
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim()
    .slice(0, MAX_RAW_ANALYSIS_LINE_CHARS)
}

function isSafeEngineFile(path: string): boolean {
  try {
    const info = lstatSync(path)
    return info.isFile() && !info.isSymbolicLink()
  } catch {
    return false
  }
}

/**
 * 視角反轉（§2.15.4，含 mate 0 修正）。
 * 二次分析的局面行棋方已換邊，分數須取負號轉回原局面行棋方視角。
 * mate 0 反轉後 = 使用者剛將死對方 → +MATE_SCORE，顯示「殺棋（終局）」。
 */
export function invertEngineScore(score: EngineScore): EngineScore {
  if (score.type === 'cp') {
    const invertedCp = -score.cp
    const value = invertedCp / 100
    return {
      type: 'cp',
      cp: invertedCp,
      value,
      comparableValue: value,
      raw: score.raw,
      displayText: value >= 0 ? `+${value.toFixed(2)}` : value.toFixed(2),
      wasInverted: true,
      source: 'separate_engine_call'
    }
  }
  const invertedMateIn = -score.mateIn
  if (invertedMateIn === 0) {
    return {
      type: 'mate',
      mateIn: 0,
      comparableValue: MATE_SCORE, // 反轉後為正：使用者剛將死對方
      raw: score.raw,
      displayText: '殺棋（終局）',
      isTerminalMate: true,
      wasInverted: true,
      source: 'separate_engine_call'
    }
  }
  const sign = invertedMateIn > 0 ? 1 : -1
  const distancePenalty = Math.min(Math.abs(invertedMateIn), 100)
  return {
    type: 'mate',
    mateIn: invertedMateIn,
    comparableValue: sign * (MATE_SCORE - distancePenalty),
    raw: score.raw,
    displayText:
      invertedMateIn > 0 ? `殺 ${invertedMateIn}` : `被殺 ${Math.abs(invertedMateIn)}`,
    isTerminalMate: false,
    wasInverted: true,
    source: 'separate_engine_call'
  }
}

/** 改寫分數來源（保留其餘欄位）；root 最佳分數需標記為 root_analysis */
function withSource(score: EngineScore, source: EngineScore['source']): EngineScore {
  return score.type === 'cp' ? { ...score, source } : { ...score, source }
}

/** 由環境變數 / 打包資源解析引擎路徑（不含使用者自訂路徑） */
function resolveBundledEnginePath(): string | null {
  const fromEnv = process.env.PIKAFISH_PATH
  if (fromEnv) {
    try {
      const normalized = normalizeEnginePath(fromEnv)
      if (normalized && isSafeEngineFile(normalized)) return normalized
    } catch {
      // 無效或不安全的環境變數路徑不採用
    }
  }

  const resourceCandidates = [
    join(process.resourcesPath ?? '', 'engine', 'pikafish.exe'),
    join(process.cwd(), 'resources', 'engine', 'pikafish.exe')
  ]
  for (const candidate of resourceCandidates) {
    if (candidate && isSafeEngineFile(candidate)) return candidate
  }
  return null
}

/** 引擎路徑來源，供 UI 提示用 */
export type EnginePathSource = 'user' | 'env' | 'resource' | null

/** 進行中分析的階段（§2.16.5） */
export type AnalysisPhase = 'root_analysis' | 'user_move_analysis'

/** 取消控制：對目前使用中的子行程操作 */
export interface EngineProcessControls {
  phase: AnalysisPhase
  /** 寫入 "stop" 到 engine stdin */
  sendStop: () => void
  /** 強制終止子程序 */
  killEngine: () => void
}

export interface EngineLiveAnalysisProgress {
  phase: AnalysisPhase
  elapsedMs: number
  targetMs: number
  depth: number | null
  score: EngineScore | null
  displayMove?: string
  displayPrincipalVariation: string[]
}

interface SearchProgress {
  elapsedMs: number
  targetMs: number
  depth: number | null
  score: EngineScore | null
  move?: string
  principalVariation: string[]
}

/** 握手完成、可收發指令的引擎工作階段 */
interface ReadySession {
  protocol: EngineProtocol
  engineId: string | null
  send(cmd: string): void
  setLineHandler(handler: (line: string) => void): void
  setExitHandler(handler: () => void): void
  kill(): void
  dispose(): void
}

/** 單一局面搜尋結果（內部） */
interface SearchResult {
  candidateMoves: EngineCandidateMove[]
  /** 最佳行分數（含無 pv 的 mate 0 終局行） */
  topScore: EngineScore | null
  /** bestmove 著法；(none)/nobestmove 為 null（無合法著法） */
  bestMoveUci: string | null
  engineId: string | null
  protocol: EngineProtocol
  rawLines: string[]
  timedOut: boolean
}

export class PikafishAdapter {
  private userPath: string | null
  private knownProtocol: EngineProtocol | null
  private detectedEngineName: string | null = null
  private protocolListener: ((protocol: EngineProtocol) => void) | null = null

  constructor(
    userPath: string | null = null,
    knownProtocol: EngineProtocol | null = null,
    private readonly fallbackName: string = DEFAULT_ENGINE_NAME,
    private readonly installationId?: string
  ) {
    this.userPath = userPath
    this.knownProtocol = knownProtocol
  }

  get engineName(): string {
    return this.detectedEngineName ?? this.fallbackName
  }

  setUserPath(path: string | null): void {
    const trimmed = path?.trim()
    this.userPath = trimmed ? trimmed : null
  }

  getUserPath(): string | null {
    return this.userPath
  }

  getKnownProtocol(): EngineProtocol | null {
    return this.knownProtocol
  }

  setKnownProtocol(protocol: EngineProtocol | null): void {
    this.knownProtocol = protocol
  }

  onProtocolDetected(listener: (protocol: EngineProtocol) => void): void {
    this.protocolListener = listener
  }

  private recordDetectedProtocol(protocol: EngineProtocol): void {
    if (this.knownProtocol === protocol) return
    this.knownProtocol = protocol
    this.protocolListener?.(protocol)
  }

  resolveEnginePath(): string | null {
    if (this.userPath && isSafeEngineFile(this.userPath)) return this.userPath
    return resolveBundledEnginePath()
  }

  pathSource(): EnginePathSource {
    if (this.userPath && isSafeEngineFile(this.userPath)) return 'user'
    const fromEnv = process.env.PIKAFISH_PATH
    if (fromEnv) {
      try {
        const normalized = normalizeEnginePath(fromEnv)
        if (normalized && isSafeEngineFile(normalized)) return 'env'
      } catch {
        // 忽略無效或不安全的環境變數路徑
      }
    }
    if (resolveBundledEnginePath()) return 'resource'
    return null
  }

  isAvailable(): boolean {
    return this.resolveEnginePath() !== null
  }

  /* ---------- 握手（協定偵測） ---------- */

  private spawnAndHandshake(
    enginePath: string,
    multiPv: number | null
  ): Promise<ReadySession> {
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
        // Pikafish 預設從目前工作目錄載入 pikafish.nnue。
        child = spawn(enginePath, [], { cwd: dirname(enginePath), windowsHide: true })
      } catch (err) {
        reject(
          new EngineAnalysisError('engine_start_failed', `無法啟動引擎：${String(err)}`)
        )
        return
      }

      let buffer = ''
      let settled = false
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
              new EngineAnalysisError(
                'engine_timeout',
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
          // UCCI 時間單位預設為秒，要求改用毫秒；setoption 無 name/value 關鍵字
          send('setoption usemillisec true')
          if (multiPv !== null) send(`setoption multipv ${multiPv}`)
        } else if (multiPv !== null) {
          send(`setoption name MultiPV value ${multiPv}`)
        }
        send('isready')
        readyTimer = setTimeout(() => {
          fail(
            new EngineAnalysisError(
              'engine_timeout',
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
            kill: () => child.kill(),
            dispose
          })
        }
      }

      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        buffer += chunk
        if (buffer.length > MAX_ENGINE_OUTPUT_BUFFER_CHARS) {
          fail(
            new EngineAnalysisError(
              'engine_parse_error',
              '引擎輸出超過安全限制，已終止該引擎行程。'
            )
          )
          return
        }
        let idx: number
        while ((idx = buffer.indexOf('\n')) >= 0) {
          const rawLine = buffer.slice(0, idx).trim()
          buffer = buffer.slice(idx + 1)
          if (!rawLine) continue
          handleLine(rawLine)
        }
      })

      child.on('error', (err) => {
        fail(
          new EngineAnalysisError('engine_start_failed', `引擎行程錯誤：${err.message}`)
        )
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
            new EngineAnalysisError(
              'engine_start_failed',
              '引擎行程在握手期間結束。請確認指定的檔案為有效的 UCI/UCCI 象棋引擎。'
            )
          )
        }
      })

      greetCurrent()
    })
  }

  /* ---------- 單一局面搜尋（內部） ---------- */

  private async searchPosition(options: {
    enginePath: string
    fen: string
    movesUci?: string[]
    movetimeMs: number
    multiPv: number
    scoreSource: 'candidate_move' | 'separate_engine_call'
    signal?: AbortSignal
    onControls?: (controls: { sendStop: () => void; killEngine: () => void }) => void
    onProgress?: (progress: SearchProgress) => void
  }): Promise<SearchResult> {
    if (options.signal?.aborted) throw abortError()

    const searchStartedAt = Date.now()
    const session = await this.spawnAndHandshake(options.enginePath, options.multiPv)
    const accumulator = new MultiPvAccumulator(options.scoreSource)
    const rawLines: string[] = []
    let lastProgressAt = 0

    const recordRawLine = (line: string): void => {
      if (rawLines.length >= MAX_RAW_ANALYSIS_LINES) return
      const sanitized = sanitizeEngineLine(line)
      if (sanitized) rawLines.push(sanitized)
    }

    // 回報目前子行程控制，供 IPC 取消 handle 使用（§2.16.5）
    options.onControls?.({
      sendStop: () => session.send('stop'),
      killEngine: () => session.kill()
    })

    return new Promise<SearchResult>((resolve, reject) => {
      let settled = false
      let bestMoveUci: string | null = null
      let searchEnded = false
      let timedOut = false
      let searchTimer: ReturnType<typeof setTimeout> | null = null
      let graceTimer: ReturnType<typeof setTimeout> | null = null

      const cleanup = (): void => {
        if (searchTimer) clearTimeout(searchTimer)
        if (graceTimer) clearTimeout(graceTimer)
        options.signal?.removeEventListener('abort', onAbort)
        session.dispose()
      }

      const finish = (): void => {
        if (settled) return
        settled = true
        // 取消優先於結果（§2.16.5：取消後不得發送 analysis-result）
        if (options.signal?.aborted) {
          cleanup()
          reject(abortError())
          return
        }
        const candidateMoves = accumulator.getCandidateMoves()
        const topScore = accumulator.getTopScore()
        cleanup()
        if (candidateMoves.length === 0 && topScore === null && !searchEnded) {
          reject(
            new EngineAnalysisError(
              'engine_parse_error',
              '引擎未回傳任何候選線（可能引擎異常或輸出無法解析）',
              rawLines
            )
          )
          return
        }
        resolve({
          candidateMoves,
          topScore,
          bestMoveUci,
          engineId: session.engineId,
          protocol: session.protocol,
          rawLines,
          timedOut
        })
      }

      // 取消：送 stop，寬限期內等引擎回 bestmove，逾期強制 kill（§2.16.5）
      const onAbort = (): void => {
        session.send('stop')
        graceTimer = setTimeout(() => {
          session.kill()
        }, CANCEL_GRACE_MS)
      }
      options.signal?.addEventListener('abort', onAbort, { once: true })

      session.setExitHandler(finish)
      session.setLineHandler((line) => {
        recordRawLine(line)
        accumulator.ingestLine(line)
        const parsed = parseInfoLine(line, options.scoreSource)
        const now = Date.now()
        if (
          parsed?.multipv === 1 &&
          (lastProgressAt === 0 || now - lastProgressAt >= 80)
        ) {
          lastProgressAt = now
          options.onProgress?.({
            elapsedMs: now - searchStartedAt,
            targetMs: options.movetimeMs,
            depth: parsed.depth,
            score: parsed.score,
            move: parsed.pv[0],
            principalVariation: parsed.pv
          })
        }
        // bestmove xxx / bestmove (none)（UCI）、nobestmove（UCCI）都代表搜尋結束
        if (line.startsWith('bestmove') || line.startsWith('nobestmove')) {
          searchEnded = true
          bestMoveUci = parseBestMove(line)
          finish()
        }
      })

      // UCCI 不支援 go movetime；usemillisec 已設 true，go time 單位為毫秒
      const go =
        session.protocol === 'ucci'
          ? `go time ${options.movetimeMs}`
          : `go movetime ${options.movetimeMs}`
      const moves = options.movesUci?.length ? ` moves ${options.movesUci.join(' ')}` : ''
      session.send(`position fen ${options.fen}${moves}`)
      session.send(go)

      // 安全逾時：停止引擎，保留已取得資料（§2.8 分析 timeout 處理）
      searchTimer = setTimeout(() => {
        timedOut = true
        session.send('stop')
        finish()
      }, options.movetimeMs + SEARCH_TIMEOUT_MARGIN_MS)
    })
  }

  /* ---------- 連線測試 ---------- */

  async test(): Promise<EngineTestResult> {
    const enginePath = this.resolveEnginePath()
    if (!enginePath) {
      return { ok: false, message: '找不到引擎執行檔。請指定引擎路徑後再測試。' }
    }
    try {
      const search = await this.searchPosition({
        enginePath,
        fen: START_FEN,
        movetimeMs: 250,
        multiPv: 1,
        scoreSource: 'candidate_move'
      })
      if (!search.bestMoveUci || search.candidateMoves.length === 0) {
        return {
          ok: false,
          message: '引擎已連線，但短搜尋沒有回傳可用著法。',
          diagnostics: search.rawLines
        }
      }
      this.detectedEngineName = search.engineId ?? this.fallbackName
      return {
        ok: true,
        protocol: search.protocol,
        engineName: this.detectedEngineName,
        diagnostics: search.rawLines
      }
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
        diagnostics: err instanceof EngineAnalysisError ? err.diagnostics : undefined
      }
    }
  }

  /* ---------- 雙階段分析（§2.15） ---------- */

  async analyzePosition(
    input: { positionFen: string; userMove?: string },
    config: AnalysisConfig,
    options?: {
      signal?: AbortSignal
      /** 每個階段開始時回報目前子行程的控制（供 IPC 取消 handle 使用） */
      onPhase?: (phase: AnalysisPhase, controls: EngineProcessControls) => void
      /** 搜尋期間持續回報目前深度、評估與主要變例 */
      onProgress?: (progress: EngineLiveAnalysisProgress) => void
    }
  ): Promise<EngineAnalysis> {
    const enginePath = this.resolveEnginePath()
    if (!enginePath) {
      throw new EngineAnalysisError(
        'engine_not_configured',
        '找不到引擎。請至設定頁指定引擎路徑，或設定 PIKAFISH_PATH / 放置 resources/engine/pikafish.exe。'
      )
    }

    const parsed = parseFen(input.positionFen)
    if (!parsed.valid) {
      throw new EngineAnalysisError('invalid_fen', `FEN 格式不正確：${parsed.message}`)
    }
    const canonicalFen = parsed.board.fen
    const sideToMove = parsed.board.sideToMove

    if (
      !Number.isSafeInteger(config.rootAnalysisMovetimeMs) ||
      config.rootAnalysisMovetimeMs < 100 ||
      config.rootAnalysisMovetimeMs > 60_000 ||
      !Number.isSafeInteger(config.userMoveEvalMovetimeMs) ||
      config.userMoveEvalMovetimeMs < 100 ||
      config.userMoveEvalMovetimeMs > 60_000 ||
      !Number.isSafeInteger(config.multiPv) ||
      config.multiPv < 1 ||
      config.multiPv > 20
    ) {
      throw new EngineAnalysisError(
        'invalid_analysis_config',
        '分析參數無效：時間必須介於 100–60000 毫秒，MultiPV 必須介於 1–20。'
      )
    }

    const userMove = input.userMove?.trim().toLowerCase() || undefined
    if (userMove) {
      const check = legalMoveCheck(parsed.board.grid, sideToMove, userMove)
      if (!check.ok) {
        throw new EngineAnalysisError('invalid_user_move', `使用者著法不合法：${check.message}`)
      }
    }

    const startedAt = Date.now()
    const signal = options?.signal

    // ---- 第一階段：root analysis ----
    const registerControls =
      (phase: AnalysisPhase) =>
      (c: { sendStop: () => void; killEngine: () => void }): void => {
        options?.onPhase?.(phase, { phase, ...c })
      }
    const forwardProgress =
      (phase: AnalysisPhase, progressBoard: typeof parsed.board) =>
      (progress: SearchProgress): void => {
        options?.onProgress?.({
          phase,
          elapsedMs: progress.elapsedMs,
          targetMs: progress.targetMs,
          depth: progress.depth,
          score:
            phase === 'user_move_analysis' && progress.score
              ? invertEngineScore(progress.score)
              : progress.score,
          displayMove: progress.move
            ? formatChineseMove(progressBoard, progress.move) ?? '無法辨識著法'
            : undefined,
          displayPrincipalVariation: formatChineseVariation(
            progressBoard,
            progress.principalVariation
          )
        })
      }

    const root = await this.searchPosition({
      enginePath,
      fen: canonicalFen,
      movetimeMs: config.rootAnalysisMovetimeMs,
      multiPv: Math.max(1, config.multiPv),
      scoreSource: 'candidate_move',
      signal,
      onControls: registerControls('root_analysis'),
      onProgress: forwardProgress('root_analysis', parsed.board)
    })
    if (signal?.aborted) throw abortError()
    this.detectedEngineName = root.engineId ?? this.fallbackName

    const candidateMoves = root.candidateMoves.map((candidate) => ({
      ...candidate,
      displayMove:
        formatChineseMove(parsed.board, candidate.move) ?? '無法辨識著法',
      displayPrincipalVariation: formatChineseVariation(
        parsed.board,
        candidate.principalVariation
      )
    }))
    const bestCandidate = candidateMoves[0]
    const bestMove = root.bestMoveUci ?? bestCandidate?.move ?? null
    if (!bestMove || !bestCandidate) {
      // root 局面即無合法著法（已被將死/困斃）或無可解析輸出
      throw new EngineAnalysisError(
        'engine_parse_error',
        root.topScore?.type === 'mate' && root.topScore.isTerminalMate
          ? '該局面已被將死或困斃，沒有可分析的著法。'
          : '引擎未回傳任何候選著法（可能局面已終局或引擎輸出無法解析）。'
      )
    }

    const scoreAfterBestMove =
      bestCandidate.score !== null ? withSource(bestCandidate.score, 'root_analysis') : null

    // ---- 第二階段：userMove 評估（§2.15.2） ----
    let scoreAfterUserMove: EngineScore | null = null
    let userMoveEvaluationSource: UserMoveEvaluationSource = 'unavailable'
    let userMovePrincipalVariation: string[] | undefined
    let displayUserMovePrincipalVariation: string[] | undefined
    let userMoveRawLines: string[] | undefined
    const warnings: string[] = []
    if (root.timedOut) {
      warnings.push('分析時間過長，僅保留逾時前取得的資料，結果可能不完整。')
    }

    if (userMove) {
      const matched = candidateMoves.find((c) => c.move === userMove)
      if (matched) {
        // candidate fast path：已是原局面視角，不取負號（§2.15.3）
        scoreAfterUserMove = matched.score
        userMoveEvaluationSource = matched.score !== null ? 'candidate_move' : 'unavailable'
        userMovePrincipalVariation = matched.principalVariation
        displayUserMovePrincipalVariation =
          matched.displayPrincipalVariation ??
          formatChineseVariation(parsed.board, matched.principalVariation)
      } else {
        try {
          const moved = applyUciMove(parsed.board, userMove)
          const userMoveBoard = moved.valid ? moved.board : parsed.board
          const second = await this.searchPosition({
            enginePath,
            fen: canonicalFen,
            movesUci: [userMove],
            movetimeMs: config.userMoveEvalMovetimeMs,
            multiPv: 1,
            scoreSource: 'separate_engine_call',
            signal,
            onControls: registerControls('user_move_analysis'),
            onProgress: forwardProgress('user_move_analysis', userMoveBoard)
          })
          userMoveRawLines = second.rawLines
          const opponentLine = second.candidateMoves[0]?.principalVariation ?? []
          userMovePrincipalVariation = [userMove, ...opponentLine]
          displayUserMovePrincipalVariation = formatChineseVariation(
            parsed.board,
            userMovePrincipalVariation
          )
          // 取對手視角最佳分數後反轉；無任何分數但搜尋正常結束
          //（bestmove (none)/nobestmove）= 對方已無著法 = userMove 將死對方
          const opponentScore =
            second.topScore ??
            (second.bestMoveUci === null
              ? // 等同 score mate 0（對方視角已被將死）；invertEngineScore 轉為「殺棋（終局）」
                ({
                  type: 'mate',
                  mateIn: 0,
                  comparableValue: -MATE_SCORE,
                  raw: 'bestmove (none)',
                  displayText: '已被將死',
                  isTerminalMate: true,
                  wasInverted: false,
                  source: 'separate_engine_call'
                } satisfies EngineScore)
              : null)
          if (opponentScore !== null) {
            scoreAfterUserMove = invertEngineScore(opponentScore)
            userMoveEvaluationSource = 'separate_engine_call'
          }
          if (second.timedOut) {
            warnings.push('使用者著法的二次分析逾時，該比較結果可能不完整。')
          }
        } catch (err) {
          // 取消必須中止整個分析；其他失敗依 §2.15.7 降級為 unavailable
          if (err instanceof DOMException && err.name === 'AbortError') throw err
          scoreAfterUserMove = null
          userMoveEvaluationSource = 'unavailable'
        }
      }
    }
    if (signal?.aborted) throw abortError()

    return {
      positionFen: canonicalFen,
      sideToMove,
      userMove,
      displayUserMove: userMove
        ? formatChineseMove(parsed.board, userMove) ?? '無法辨識著法'
        : undefined,
      bestMove,
      displayBestMove:
        formatChineseMove(parsed.board, bestMove) ?? '無法辨識著法',
      scoreAfterUserMove,
      scoreAfterBestMove,
      evaluationAfterUserMove: scoreAfterUserMove?.comparableValue ?? null,
      evaluationAfterBestMove: scoreAfterBestMove?.comparableValue ?? null,
      userMoveEvaluationSource: userMove ? userMoveEvaluationSource : 'unavailable',
      userMovePrincipalVariation,
      displayUserMovePrincipalVariation,
      depth: bestCandidate.depth,
      candidateMoves,
      principalVariation: bestCandidate.principalVariation,
      displayPrincipalVariation:
        bestCandidate.displayPrincipalVariation ??
        formatChineseVariation(parsed.board, bestCandidate.principalVariation),
      analysisTimeMs: Date.now() - startedAt,
      incomplete: warnings.length > 0,
      warnings,
      engineId: this.installationId,
      engineName: this.detectedEngineName,
      rawAnalysis: {
        root: root.rawLines,
        userMove: userMoveRawLines
      }
    }
  }
}
