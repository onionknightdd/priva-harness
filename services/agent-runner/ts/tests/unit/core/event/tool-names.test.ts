import { describe, expect, it } from 'vitest'

import {
  isAgentName,
  isImageEditToolName,
  isImageGenToolName,
  isImageReadToolName,
  isTaskBoardName,
} from '../../../../src/core/event/tool-names.js'

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

  it('matches image product tools including Claude MCP aliases', () => {
    expect(isImageGenToolName('mcp__agentWorkshop__image_gen')).toBe(true)
    expect(isImageReadToolName('Image_Read')).toBe(true)
    expect(isImageEditToolName('image_edit')).toBe(true)
    expect(isImageGenToolName('canvas')).toBe(false)
  })
})
