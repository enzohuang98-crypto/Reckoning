import { strict as assert } from 'node:assert'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GenerateExplanationStartPayload } from '../../../src/shared/types/ipc'
import type { AnalysisSession } from '../../../src/main/storage/AnalysisSessionStore'
import {
  prepareExplanationExecution,
  TeacherCaseRejectedError
} from '../../../src/main/ai/prepareExplanationExecution'
import { getTeacherTestCatalog } from '../../../src/main/teacherTest/TeacherTestCatalog'
import { TeacherTestRunService } from '../../../src/main/teacherTest/TeacherTestRunService'
import { normalizeTeacherTestQuestion } from '../../../src/shared/logic/teacherTestEvaluation'

function sessionFor(testCase: ReturnType<typeof getTeacherTestCatalog>['cases'][number]): AnalysisSession {
  const sideToMove = testCase.sideToMove === 'w' ? 'red' : 'black'
  return {
    analysisId: `analysis-${testCase.caseKey}`,
    requestId: `request-${testCase.caseKey}`,
    createdAt: '2026-08-07T00:00:00.000Z',
    expiresAt: '2026-08-08T00:00:00.000Z',
    positionFen: testCase.positionFen,
    userMove: testCase.attachedMove,
    primaryEngineId: 'engine-primary',
    engineAnalysis: {
      positionFen: testCase.positionFen,
      sideToMove,
      userMove: testCase.attachedMove,
      displayUserMove: testCase.attachedMove,
      bestMove: 'a0a1',
      displayBestMove: '測試首選',
      scoreAfterUserMove: null,
      scoreAfterBestMove: null,
      evaluationAfterUserMove: null,
      evaluationAfterBestMove: null,
      userMoveEvaluationSource: 'unavailable',
      userMovePrincipalVariation: [testCase.attachedMove],
      displayUserMovePrincipalVariation: [testCase.attachedMove],
      depth: 1,
      candidateMoves: [],
      principalVariation: ['a0a1'],
      displayPrincipalVariation: ['測試首選'],
      incomplete: false,
      warnings: [],
      engineId: 'engine-primary',
      engineName: 'Test Engine'
    },
    moveComparison: {
      positionFen: testCase.positionFen,
      sideToMove,
      userMove: testCase.attachedMove,
      engineBestMove: 'a0a1',
      evaluationAfterUserMove: null,
      evaluationAfterBestMove: null,
      scoreDifference: null,
      mistakeLevel: 'unknown',
      depth: 1,
      confidence: 'low',
      uncertaintyReasons: ['test fixture']
    }
  }
}

function payloadFor(
  testCase: ReturnType<typeof getTeacherTestCatalog>['cases'][number]
): GenerateExplanationStartPayload {
  return {
    requestId: `ai-${testCase.caseKey}`,
    analysisId: `analysis-${testCase.caseKey}`,
    provider: 'openai',
    model: 'gpt-5.6-sol',
    userLevel: 'intermediate',
    explanationStyle: 'long_analytical',
    language: 'zh-TW',
    conversationHistory: [
      {
        id: 'prelude',
        role: 'assistant',
        text: 'GENERIC-PRELUDE-MARKER-DO-NOT-SEND',
        createdAt: '2026-08-07T00:00:00.000Z'
      }
    ],
    followUpQuestion: testCase.question,
    attachedMove: testCase.attachedMove,
    answerMode: testCase.mode,
    budget: {
      engineTimeMs: 1000,
      maxEngineRounds: 1,
      maxModelCalls: 2,
      maxOutputTokens: 4000
    }
  }
}

async function expectRejected(run: () => unknown): Promise<void> {
  assert.throws(run, TeacherCaseRejectedError)
}

async function main(): Promise<void> {
  const catalog = getTeacherTestCatalog()
  assert.equal(catalog.cases.length, 6)
  assert.ok(Object.isFrozen(catalog))
  assert.ok(Object.isFrozen(catalog.cases))
  assert.ok(Object.isFrozen(catalog.cases[0]))

  const service = new TeacherTestRunService({
    getRuntime: () => ({
      appVersion: '0.3.11',
      platform: 'win32',
      systemVersion: '10.0.22631',
      osBuild: 'Windows 11 10.0.22631',
      arch: 'x64'
    })
  })
  const ordinaryCase = catalog.cases[0]
  const mutablePayload = payloadFor(ordinaryCase)
  mutablePayload.followUpQuestion = undefined
  mutablePayload.conversationHistory = []
  const mutableSession = sessionFor(ordinaryCase)
  const ordinaryMove = prepareExplanationExecution(
    mutablePayload,
    mutableSession,
    'gpt-5.6-sol',
    service
  )
  assert.equal(ordinaryMove.interactionKind, 'ordinary')
  assert.equal(ordinaryMove.answerStrategy, 'move-comparison')
  assert.equal(ordinaryMove.evaluation, undefined)

  const ordinaryPosition = prepareExplanationExecution(
    { ...mutablePayload, attachedMove: undefined },
    { ...mutableSession, userMove: undefined, engineAnalysis: { ...mutableSession.engineAnalysis, userMove: undefined } },
    'gpt-5.6-sol',
    service
  )
  assert.equal(ordinaryPosition.answerStrategy, 'position-explanation')

  const ordinaryFollowUpPayload = payloadFor(ordinaryCase)
  const ordinaryFollowUp = prepareExplanationExecution(
    ordinaryFollowUpPayload,
    sessionFor(ordinaryCase),
    'gpt-5.6-sol',
    service
  )
  assert.equal(ordinaryFollowUp.answerStrategy, 'conversation-follow-up')
  assert.equal(ordinaryFollowUp.effective.conversationHistory.length, 1)

  ordinaryFollowUpPayload.conversationHistory![0].text = 'mutated history'
  ordinaryFollowUpPayload.budget!.maxModelCalls = 999
  assert.equal(
    ordinaryFollowUp.effective.conversationHistory[0].text,
    'GENERIC-PRELUDE-MARKER-DO-NOT-SEND'
  )
  assert.equal(ordinaryFollowUp.effective.budget?.maxModelCalls, 2)
  assert.ok(Object.isFrozen(ordinaryFollowUp))
  assert.ok(Object.isFrozen(ordinaryFollowUp.effective))
  assert.ok(Object.isFrozen(ordinaryFollowUp.effective.conversationHistory))
  assert.equal(Object.getOwnPropertySymbols(ordinaryFollowUp).length, 1)

  const directory = await mkdtemp(join(tmpdir(), 'prepared-explanation-'))
  const installerPath = join(directory, 'xiangqi-analyzer-0.3.11-setup.exe')
  await writeFile(installerPath, 'candidate bytes')
  try {
    await service.start({
      releaseTag: 'v0.3.11',
      productSourceCommit: 'a'.repeat(40),
      installerPath
    })

    const prelude = prepareExplanationExecution(
      { ...payloadFor(ordinaryCase), followUpQuestion: undefined },
      sessionFor(ordinaryCase),
      'gpt-5.6-sol',
      service
    )
    assert.equal(prelude.interactionKind, 'teacher-prelude')
    assert.equal(prelude.evaluation, undefined)

    const testCaseIds = new Set<string>()
    let firstPrepared: ReturnType<typeof prepareExplanationExecution> | null = null
    for (const testCase of catalog.cases) {
      const prepared = prepareExplanationExecution(
        payloadFor(testCase),
        sessionFor(testCase),
        'gpt-5.6-sol',
        service
      )
      assert.equal(prepared.interactionKind, 'teacher-formal-case')
      assert.equal(prepared.answerStrategy, 'formal-move-comparison')
      assert.equal(prepared.effective.conversationHistory.length, 0)
      assert.equal(prepared.effective.followUpQuestion, testCase.question)
      assert.equal(prepared.teacherCase?.caseKey, testCase.caseKey)
      assert.equal(prepared.teacherCase?.caseSetId, 'teacher-test-cases-v1')
      assert.equal(prepared.teacherCase?.caseSetStatus, 'fixture-only; teacher-confirmation-pending')
      assert.equal(prepared.executionSemanticsVersion, 2)
      assert.match(prepared.evaluation?.testCaseId ?? '', /^[0-9a-f]{64}$/)
      assert.match(prepared.evaluation?.externalReviewId ?? '', /^review-/)
      assert.equal(
        prepared.formalAttemptKey,
        `${prepared.evaluation?.testRunId}:${prepared.evaluation?.testCaseId}`
      )
      testCaseIds.add(prepared.evaluation!.testCaseId)
      firstPrepared ??= prepared
    }
    assert.equal(testCaseIds.size, 6)
    assert(firstPrepared?.evaluation)
    const resubmitted = prepareExplanationExecution(
      payloadFor(ordinaryCase),
      sessionFor(ordinaryCase),
      'gpt-5.6-sol',
      service
    )
    assert.equal(resubmitted.evaluation?.testCaseId, firstPrepared.evaluation.testCaseId)
    assert.notEqual(
      resubmitted.evaluation?.externalReviewId,
      firstPrepared.evaluation.externalReviewId
    )

    const wrongQuestion = payloadFor(ordinaryCase)
    wrongQuestion.followUpQuestion = '這不是凍結題目'
    await expectRejected(() =>
      prepareExplanationExecution(
        wrongQuestion,
        sessionFor(ordinaryCase),
        'gpt-5.6-sol',
        service
      )
    )

    const wrongMove = payloadFor(ordinaryCase)
    wrongMove.attachedMove = 'a0a1'
    await expectRejected(() =>
      prepareExplanationExecution(
        wrongMove,
        sessionFor(ordinaryCase),
        'gpt-5.6-sol',
        service
      )
    )

    const inconsistentSession = sessionFor(ordinaryCase)
    inconsistentSession.moveComparison.userMove = 'a0a1'
    await expectRejected(() =>
      prepareExplanationExecution(
        payloadFor(ordinaryCase),
        inconsistentSession,
        'gpt-5.6-sol',
        service
      )
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }

  assert.equal(
    normalizeTeacherTestQuestion('caf\u0065\u0301\r\n下一行'),
    'caf\u00e9\n下一行'
  )
  console.log('Prepared explanation execution checks passed.')
}

void main()
