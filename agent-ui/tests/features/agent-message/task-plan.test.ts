import assert from "node:assert/strict"
import { describe, it } from "node:test"

import type { StreamBlock } from "../../../src/features/agent-message/agent-message-data.ts"
import {
  foldTaskPlan,
  foldThreadTaskPlan,
  isTaskBoardTool,
} from "../../../src/features/agent-message/task-plan.ts"

function tool(
  index: number,
  id: string,
  name: string,
  input?: unknown,
  output?: string
): StreamBlock {
  return {
    type: "tool_use",
    blockId: id,
    index,
    id,
    name,
    input,
    tool: {
      id,
      name,
      input,
      status: output === undefined ? "running" : "completed",
      ...(output === undefined ? {} : { output, ok: true }),
    },
  }
}

describe("task board tools", () => {
  it("recognizes TaskCreate/Get/Update/List and ignores Task/TaskOutput/TaskStop", () => {
    assert.equal(isTaskBoardTool("TaskCreate"), true)
    assert.equal(isTaskBoardTool("task_update"), true)
    assert.equal(isTaskBoardTool("TaskList"), true)
    assert.equal(isTaskBoardTool("TaskGet"), true)
    assert.equal(isTaskBoardTool("Task"), false)
    assert.equal(isTaskBoardTool("Agent"), false)
    assert.equal(isTaskBoardTool("TaskOutput"), false)
    assert.equal(isTaskBoardTool("TaskStop"), false)
    assert.equal(isTaskBoardTool("TodoWrite"), false)
  })

  it("folds create → update lifecycle from Claude JSONL-shaped tool results", () => {
    const plan = foldTaskPlan([
      tool(
        0,
        "tu-1",
        "TaskCreate",
        { subject: "Read the file", description: "Open the target", activeForm: "Reading the file" },
        JSON.stringify({ task: { id: "task_a", subject: "Read the file" } })
      ),
      tool(
        1,
        "tu-2",
        "TaskCreate",
        { subject: "Draft the fix" },
        JSON.stringify({ task: { id: "task_b", subject: "Draft the fix" } })
      ),
      tool(
        2,
        "tu-3",
        "TaskUpdate",
        { taskId: "task_a", status: "in_progress" },
        JSON.stringify({
          success: true,
          taskId: "task_a",
          updatedFields: ["status"],
          statusChange: { from: "pending", to: "in_progress" },
        })
      ),
      tool(
        3,
        "tu-4",
        "TaskUpdate",
        { taskId: "task_a", status: "completed" },
        JSON.stringify({
          success: true,
          taskId: "task_a",
          updatedFields: ["status"],
          statusChange: { from: "in_progress", to: "completed" },
        })
      ),
      tool(
        4,
        "tu-5",
        "TaskUpdate",
        { taskId: "task_b", status: "in_progress", activeForm: "Drafting the fix" },
        JSON.stringify({
          success: true,
          taskId: "task_b",
          updatedFields: ["status"],
          statusChange: { from: "pending", to: "in_progress" },
        })
      ),
    ])

    assert.ok(plan)
    assert.deepEqual(
      plan.tasks.map((task) => [task.id, task.status, task.subject]),
      [
        ["task_a", "completed", "Read the file"],
        ["task_b", "in_progress", "Draft the fix"],
      ]
    )
    assert.deepEqual(plan.steps, ["Read the file", "Drafting the fix"])
    assert.equal(plan.activeIndex, 1)
    assert.equal(plan.completedCount, 1)
  })

  it("keeps a streaming TaskCreate as a pending row before the id exists", () => {
    const plan = foldTaskPlan([
      tool(0, "tu-live", "TaskCreate", { subject: "Run tests" }),
    ])
    assert.ok(plan)
    assert.equal(plan.tasks[0]?.id, "pending:tu-live")
    assert.equal(plan.tasks[0]?.status, "pending")
    assert.equal(plan.activeIndex, 0)
  })

  it("promotes a pending create id when the result arrives", () => {
    const plan = foldTaskPlan([
      tool(
        0,
        "tu-1",
        "TaskCreate",
        { subject: "Run tests" },
        JSON.stringify({ task: { id: "task_c", subject: "Run tests" } })
      ),
    ])
    assert.ok(plan)
    assert.equal(plan.tasks[0]?.id, "task_c")
    assert.equal(plan.tasks.length, 1)
  })

  it("uses TaskList as the snapshot and drops deleted tasks", () => {
    const plan = foldTaskPlan([
      tool(
        0,
        "tu-1",
        "TaskCreate",
        { subject: "Keep" },
        JSON.stringify({ task: { id: "keep", subject: "Keep" } })
      ),
      tool(
        1,
        "tu-2",
        "TaskCreate",
        { subject: "Drop" },
        JSON.stringify({ task: { id: "drop", subject: "Drop" } })
      ),
      tool(
        2,
        "tu-3",
        "TaskUpdate",
        { taskId: "drop", status: "deleted" },
        JSON.stringify({ success: true, taskId: "drop", updatedFields: ["status"] })
      ),
      tool(
        3,
        "tu-4",
        "TaskList",
        {},
        JSON.stringify({
          tasks: [
            { id: "keep", subject: "Keep", status: "completed", blockedBy: [] },
            { id: "later", subject: "Open PR", status: "pending", blockedBy: ["keep"] },
          ],
        })
      ),
    ])
    assert.ok(plan)
    assert.deepEqual(
      plan.tasks.map((task) => task.id),
      ["keep", "later"]
    )
    assert.equal(plan.tasks[1]?.blockedBy[0], "keep")
    assert.equal(plan.activeIndex, 1)
  })

  it("applies TaskGet details and blocking edges from TaskUpdate", () => {
    const plan = foldTaskPlan([
      tool(
        0,
        "tu-1",
        "TaskCreate",
        { subject: "A" },
        JSON.stringify({ task: { id: "a", subject: "A" } })
      ),
      tool(
        1,
        "tu-2",
        "TaskCreate",
        { subject: "B" },
        JSON.stringify({ task: { id: "b", subject: "B" } })
      ),
      tool(
        2,
        "tu-3",
        "TaskUpdate",
        { taskId: "b", addBlockedBy: ["a"] },
        JSON.stringify({ success: true, taskId: "b", updatedFields: ["blockedBy"] })
      ),
      tool(
        3,
        "tu-4",
        "TaskGet",
        { taskId: "a" },
        JSON.stringify({
          task: {
            id: "a",
            subject: "A",
            description: "First",
            status: "completed",
            blocks: ["b"],
            blockedBy: [],
          },
        })
      ),
    ])
    assert.ok(plan)
    const a = plan.tasks.find((task) => task.id === "a")
    const b = plan.tasks.find((task) => task.id === "b")
    assert.equal(a?.description, "First")
    assert.equal(a?.status, "completed")
    assert.deepEqual(b?.blockedBy, ["a"])
  })

  it("ignores unrelated tools when folding a plan", () => {
    const plan = foldTaskPlan([
      tool(0, "bash-1", "Bash", { command: "ls" }, "ok\n"),
      tool(
        1,
        "tu-1",
        "TaskCreate",
        { subject: "Only plan" },
        JSON.stringify({ task: { id: "only", subject: "Only plan" } })
      ),
      tool(2, "agent-1", "Task", { prompt: "look around" }, '{"status":"async_launched"}'),
    ])
    assert.ok(plan)
    assert.equal(plan.tasks.length, 1)
    assert.equal(plan.tasks[0]?.id, "only")
  })

  it("keeps a TaskCreate that arrives after a TaskList snapshot", () => {
    const plan = foldTaskPlan([
      tool(
        0,
        "tu-list",
        "TaskList",
        {},
        JSON.stringify({
          tasks: [
            { id: "keep", subject: "Keep", status: "pending", blockedBy: [] },
          ],
        })
      ),
      tool(
        1,
        "tu-new",
        "TaskCreate",
        { subject: "After list" },
        JSON.stringify({ task: { id: "after", subject: "After list" } })
      ),
    ])
    assert.ok(plan)
    assert.deepEqual(
      plan.tasks.map((task) => task.id).sort(),
      ["after", "keep"]
    )
  })

  it("mirrors addBlocks onto the blocked task", () => {
    const plan = foldTaskPlan([
      tool(
        0,
        "tu-1",
        "TaskCreate",
        { subject: "A" },
        JSON.stringify({ task: { id: "a", subject: "A" } })
      ),
      tool(
        1,
        "tu-2",
        "TaskCreate",
        { subject: "B" },
        JSON.stringify({ task: { id: "b", subject: "B" } })
      ),
      tool(
        2,
        "tu-3",
        "TaskUpdate",
        { taskId: "a", addBlocks: ["b"] },
        JSON.stringify({
          success: true,
          taskId: "a",
          updatedFields: ["blocks"],
        })
      ),
    ])
    assert.ok(plan)
    const a = plan.tasks.find((task) => task.id === "a")
    const b = plan.tasks.find((task) => task.id === "b")
    assert.deepEqual(a?.blocks, ["b"])
    assert.deepEqual(b?.blockedBy, ["a"])
  })

  it("reads unrepaired TaskUpdate keys from the assistant stream", () => {
    const plan = foldTaskPlan([
      tool(
        0,
        "tu-1",
        "TaskCreate",
        { subject: "Draft", active_form: "Drafting" },
        JSON.stringify({ task: { id: "draft", subject: "Draft" } })
      ),
      tool(
        1,
        "tu-2",
        "TaskUpdate",
        { task_id: "draft", status: "in_progress", active_form: "Drafting the fix" },
        JSON.stringify({
          success: true,
          taskId: "draft",
          updatedFields: ["status"],
          statusChange: { from: "pending", to: "in_progress" },
        })
      ),
    ])
    assert.ok(plan)
    assert.equal(plan.tasks[0]?.status, "in_progress")
    assert.equal(plan.steps[0], "Drafting the fix")
  })

  it("folds Task* tools across messages without mixing their indexes", () => {
    const plan = foldThreadTaskPlan([
      {
        id: "m1",
        role: "assistant",
        content: "",
        createdAt: "2026-01-01T00:00:00.000Z",
        status: "complete",
        blocks: [
          tool(
            0,
            "c1",
            "TaskCreate",
            { subject: "First" },
            JSON.stringify({ task: { id: "a", subject: "First" } })
          ),
        ],
      },
      {
        id: "u1",
        role: "user",
        content: "continue",
        createdAt: "2026-01-01T00:00:01.000Z",
        status: "complete",
      },
      {
        id: "m2",
        role: "assistant",
        content: "",
        createdAt: "2026-01-01T00:00:02.000Z",
        status: "complete",
        blocks: [
          tool(
            0,
            "u1",
            "TaskUpdate",
            { taskId: "a", status: "completed" },
            JSON.stringify({
              success: true,
              taskId: "a",
              updatedFields: ["status"],
              statusChange: { from: "pending", to: "completed" },
            })
          ),
          tool(
            1,
            "c2",
            "TaskCreate",
            { subject: "Second" },
            JSON.stringify({ task: { id: "b", subject: "Second" } })
          ),
        ],
      },
    ])
    assert.ok(plan)
    assert.deepEqual(
      plan.tasks.map((task) => [task.id, task.status]),
      [
        ["a", "completed"],
        ["b", "pending"],
      ]
    )
  })
})
