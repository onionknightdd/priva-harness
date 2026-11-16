import { describe, expect, it } from 'vitest'

import type { Interaction, Item, Run } from '../../../../src/core/agent-api/objects.js'
import { interactionLineage, pendingInteractionsOf, runLineage } from '../../../../src/core/agent-api/run-lineage.js'
import type { ObjectGraph, ProjectedRun } from '../../../../src/core/agent-api/thread-projection.js'

const AT = '2026-10-22T00:00:00.000Z'

function run(id: string, status: Run['status'], threadId?: string): Run {
  return { id, status, input: null, created_at: AT, ...(threadId === undefined ? {} : { thread_id: threadId }) }
}

function subagent(id: string, threadId: string): Item {
  return { id, type: 'subagent', status: 'running', agent: { name: 'Explore' }, thread_id: threadId, mode: 'background', input: { prompt: 'search' } }
}

function question(id: string, runId: string | undefined, status: Interaction['status'] = 'pending'): Interaction {
  return { id, type: 'question', status, expires_at: AT, ...(runId === undefined ? {} : { run_id: runId }), questions: [{
    id: 'q0', question: 'Continue?', header: null, options: [], multi_select: false, allow_custom: true, multiline: false, initial_text: null,
  }] }
}

// run_main started thr_a; inside it run_child started thr_b, which holds run_grandchild.
function graph(interactions: Interaction[]): ObjectGraph {
  const main: ProjectedRun = { run: run('run_main', 'completed'), items: [subagent('itm_a', 'thr_a')] }
  const later: ProjectedRun = { run: run('run_later', 'in_progress'), items: [] }
  const threads = new Map<string, ProjectedRun[]>([
    ['thr_a', [{ run: run('run_child', 'in_progress', 'thr_a'), items: [subagent('itm_b', 'thr_b')] }]],
    ['thr_b', [{ run: run('run_grandchild', 'in_progress', 'thr_b'), items: [] }]],
    ['thr_orphan', [{ run: run('run_orphan', 'in_progress', 'thr_orphan'), items: [] }]],
  ])
  return { runs: [main, later], threads, tasks: [], interactions, claims: [] }
}

describe('run lineage', () => {
  it('climbs subagent threads to the main-thread run that started them', () => {
    expect(runLineage(graph([]), 'run_grandchild')).toEqual(['run_grandchild', 'run_child', 'run_main'])
    expect(runLineage(graph([]), 'run_main')).toEqual(['run_main'])
  })

  it('has no lineage for a thread whose starter is unknown', () => {
    expect(runLineage(graph([]), 'run_orphan')).toEqual([])
  })

  it('assigns interactions without a run to the main run in progress', () => {
    expect(interactionLineage(graph([]), question('int_1', undefined))).toEqual(['run_later'])
  })

  it('collects pending interactions of a run and of the threads it started', () => {
    const interactions = [question('int_1', 'run_grandchild'), question('int_2', 'run_later'), question('int_3', 'run_child', 'resolved')]
    expect(pendingInteractionsOf(graph(interactions), 'run_main').map(({ id }) => id)).toEqual(['int_1'])
    expect(pendingInteractionsOf(graph(interactions), 'run_child').map(({ id }) => id)).toEqual(['int_1'])
  })
})
