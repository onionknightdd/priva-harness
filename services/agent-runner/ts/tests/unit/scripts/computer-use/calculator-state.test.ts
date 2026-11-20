import { describe, expect, it } from 'vitest'
import { clearedKeypad, readCalculation } from '../../../../scripts/computer-use/calculator-state.js'

const keypad = [
  '  3 滚动区 Description: 编辑字段, ID: StandardInputView, Secondary Actions: 拷贝',
  '    4 文本 ‎0', '  17 按钮 Description: 1, ID: One',
  '  18 按钮 Description: 2, ID: Two', '  20 按钮 Description: 加, ID: Add',
  '  24 按钮 Description: 等于, ID: Equals',
].join('\n')

const resultHeader = '  37 scroll area, ID: StandardResultView'
const resultLine = '    38 static text ‎1‎+‎1'
const output = `${keypad.replace('‎0', '‎2')}\n${resultHeader}\n${resultLine}`

describe('Calculator readback', () => {
  it('addresses controls by the IDs in the freshly cleared app state', () => {
    expect(clearedKeypad(keypad)).toEqual([17, 20, 17, 24])
    expect(() => clearedKeypad(keypad.replace(', ID: One', ', ID: Two'))).toThrow('One control')
    expect(() => clearedKeypad(keypad.replace('‎0', '‎2'))).toThrow('display zero')
  })

  it('verifies both display fields independently of keypad digits and direction marks', () => {
    expect(readCalculation(output)).toEqual({ expression: '1+1', result: '2' })
    expect(() => readCalculation(output.replace('‎1‎+‎1', '‎0‎+‎2'))).toThrow('expression and result')
    expect(() => readCalculation(output.replace('4 文本 ‎2', '4 文本 ‎1'))).toThrow('expression and result')
  })

  it('reads English text and button roles, including spaces and direction marks in the expression', () => {
    const english = keypad.replaceAll('按钮', 'button').replaceAll('文本', 'text')
    expect(clearedKeypad(english)).toEqual([17, 20, 17, 24])
    expect(readCalculation(`${english.replace('‎0', '‎2')}\n${resultHeader}\n    38 text ‎1 ‎+ ‎1`))
      .toEqual({ expression: '1+1', result: '2' })
  })

  it('rejects complete fields with the correct numeric suffix but a different expression, result, or clear state', () => {
    expect(() => clearedKeypad(keypad.replace('‎0', '8 − 0'))).toThrow('display zero')
    for (const expression of ['1 × 1+1', 'Error: 1+1', '1+1=']) {
      expect(() => readCalculation(output.replace('‎1‎+‎1', expression))).toThrow('expression and result')
    }
    expect(() => readCalculation(output.replace('文本 ‎2', '文本 1 + 2'))).toThrow('expression and result')
  })

  it('rejects duplicate fields, direct text children and ambiguous keypad controls', () => {
    expect(() => readCalculation(`${output}\n${resultHeader}`)).toThrow('unique Calculator field')
    expect(() => readCalculation(`${output}\n    39 text 0`)).toThrow('Ambiguous Calculator readback')
    expect(() => clearedKeypad(`${keypad}\n  25 button, ID: Equals`)).toThrow('one Equals control')
    expect(() => clearedKeypad(keypad.replace('20 按钮', '20 文本'))).toThrow('one Add control')
  })

  it('only reads a text child of the named field, ignoring deeper labels and the next field', () => {
    const wrongSources = [
      '  38 text 1+1', '    38 button 1+1', '    38 group\n      39 text 1+1',
      '    38 group\n  39 group\n    40 text 1+1',
    ]
    for (const source of wrongSources) {
      expect(() => readCalculation(output.replace(resultLine, source))).toThrow('Missing Calculator readback')
    }
    expect(readCalculation(output.replace(resultLine, '    38 group\n      39 text 7\n    40 文本 1+1')))
      .toEqual({ expression: '1+1', result: '2' })
  })
})
