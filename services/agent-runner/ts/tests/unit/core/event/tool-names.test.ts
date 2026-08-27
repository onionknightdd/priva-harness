import { describe, expect, it } from 'vitest'

import { isAgentName, isTaskBoardName } from '../../../../src/core/event/tool-names.js'

describe('task board tool names', () => {
  it('matches TaskCreate/Get/Update/List and ignores the Task subagent', () => {
    expect(isTaskBoardName('TaskCreate')).toBe(true)
    expect(isTaskBoardName('task_update')).toBe(true)
    expect(isTaskBoardName('task-list')).toBe(true)
    expect(isTaskBoardName('TaskGet')).toBe(true)
    expect(isTaskBoardName('Task')).toBe(false)
    expect(isTaskBoardName('Agent')).toBe(false)
    expect(isTaskBoardName('TaskOutput')).toBe(false)
    expect(isTaskBoardName('TaskStop')).toBe(false)
    expect(isAgentName('Task')).toBe(true)
    expect(isAgentName('TaskCreate')).toBe(false)
  })
})
