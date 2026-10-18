import assert from 'node:assert/strict'
import React from 'react'
import TestRenderer, { type ReactTestInstance } from 'react-test-renderer'
import { ExplanationView } from '../../../src/renderer/src/features/explanations/ExplanationView'

function textOf(node: ReactTestInstance | string): string {
  if (typeof node === 'string') return node
  return node.children.map(textOf).join('')
}

function render(text: string): TestRenderer.ReactTestRenderer {
  let renderer!: TestRenderer.ReactTestRenderer
  TestRenderer.act(() => {
    renderer = TestRenderer.create(<ExplanationView text={text} />)
  })
  return renderer
}

// v2 回答是多行純文字：每行一段、條列成清單、**小標** 變粗體，星號不外露。
{
  const answer = [
    '**結論**：車一平四讓黑馬吃掉三路兵。',
    '',
    '**問題在哪**：你想搶肋道，但馬 8 進 7 [E2] 先吃兵。',
    '- 出車前先看對方的馬',
    '- 差距屬於「失誤」'
  ].join('\n')
  const root = render(answer).root
  const paragraphs = root.findAll((node) => node.type === 'p')
  assert.equal(paragraphs.length, 2)
  assert.deepEqual(
    root.findAllByType('strong').map((node) => textOf(node)),
    ['結論', '問題在哪']
  )
  assert.equal(textOf(paragraphs[0]), '結論：車一平四讓黑馬吃掉三路兵。')
  assert.equal(textOf(paragraphs[1]), '問題在哪：你想搶肋道，但馬 8 進 7 先吃兵。')
  assert.deepEqual(
    root.findAllByType('li').map((node) => textOf(node)),
    ['出車前先看對方的馬', '差距屬於「失誤」']
  )
  assert.doesNotMatch(textOf(root), /\*\*/)
}

// 串流到一半、** 還沒收尾：原樣顯示，不吞字。
{
  const root = render('**結論**：先看這裡\n**問題在').root
  assert.equal(textOf(root), '結論：先看這裡**問題在')
}

// 沒有任何標記的單行文字照原樣顯示。
{
  const root = render('這步合法。').root
  assert.equal(textOf(root), '這步合法。')
}

console.log('explanation view tests passed')
