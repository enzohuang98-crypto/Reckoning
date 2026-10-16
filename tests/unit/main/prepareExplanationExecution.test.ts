import { strict as assert } from 'node:assert'
import type { AnalysisSession } from '../../../src/main/storage/AnalysisSessionStore'
import {
  prepareExplanationExecution,
  type ExplanationExecutionRequest
} from '../../../src/main/ai/prepareExplanationExecution'

/** 原本借用老師凍結題目當資料；老師測試移除後改用固定的開局局面。 */
interface FixtureCase {
  caseKey: string
  positionFen: string
  sideToMove: 'w' | 'b'
  attachedMove: string
  question: string
  mode: 'research'
}

const ordinaryCase: FixtureCase = {
  caseKey: 'opening',
  positionFen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1',
  sideToMove: 'w',
  attachedMove: 'h2e2',
  question: '為什麼這步比較好？',
  mode: 'research'
}

function sessionFor(testCase: FixtureCase): AnalysisSession {
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

function payloadFor(testCase: FixtureCase): ExplanationExecutionRequest {
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

async function main(): Promise<void> {
  const mutablePayload = payloadFor(ordinaryCase)
  mutablePayload.followUpQuestion = undefined
  mutablePayload.conversationHistory = []
  const mutableSession = sessionFor(ordinaryCase)
  const ordinaryMove = prepareExplanationExecution(
    mutablePayload,
    mutableSession,
    'gpt-5.6-sol'
  )
  assert.equal(ordinaryMove.interactionKind, 'ordinary')
  assert.equal(ordinaryMove.answerStrategy, 'move-comparison')
  assert.equal(ordinaryMove.executionSemanticsVersion, 2)

  const ordinaryPosition = prepareExplanationExecution(
    { ...mutablePayload, attachedMove: undefined },
    { ...mutableSession, userMove: undefined, engineAnalysis: { ...mutableSession.engineAnalysis, userMove: undefined } },
    'gpt-5.6-sol'
  )
  assert.equal(ordinaryPosition.answerStrategy, 'position-explanation')

  // P1-2：附著法但沒有歷史的具體問題直接回答，不再被當成完整一鍵解說。
  const firstQuestion = prepareExplanationExecution(
    { ...mutablePayload, followUpQuestion: '照我的想法走會怎樣' },
    mutableSession,
    'gpt-5.6-sol'
  )
  assert.equal(firstQuestion.answerStrategy, 'conversation-follow-up')
  const explicitOverview = prepareExplanationExecution(
    { ...mutablePayload, followUpQuestion: '請給我完整解說' },
    mutableSession,
    'gpt-5.6-sol'
  )
  assert.equal(explicitOverview.answerStrategy, 'move-comparison')
  const blankQuestion = prepareExplanationExecution(
    { ...mutablePayload, followUpQuestion: '   ' },
    mutableSession,
    'gpt-5.6-sol'
  )
  assert.equal(blankQuestion.answerStrategy, 'move-comparison')
  const positionQuestion = prepareExplanationExecution(
    { ...mutablePayload, attachedMove: undefined, followUpQuestion: '紅方現在該怎麼走' },
    { ...mutableSession, userMove: undefined, engineAnalysis: { ...mutableSession.engineAnalysis, userMove: undefined } },
    'gpt-5.6-sol'
  )
  assert.equal(positionQuestion.answerStrategy, 'conversation-follow-up')

  const ordinaryFollowUpPayload = payloadFor(ordinaryCase)
  const ordinaryFollowUp = prepareExplanationExecution(
    ordinaryFollowUpPayload,
    sessionFor(ordinaryCase),
    'gpt-5.6-sol'
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

  console.log('Prepared explanation execution checks passed.')
}

void main()
