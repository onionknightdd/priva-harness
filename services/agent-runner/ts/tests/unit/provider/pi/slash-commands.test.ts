import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  assemblePiSlashCommands,
  listPiSlashCommands,
} from '../../../../src/provider/pi/slash-commands.js'

describe('Pi slash command catalog', () => {
  it('lets project skills cover user skills and builtin commands of the same name', () => {
    const assembled = assemblePiSlashCommands(
      [
        { name: 'compact', description: 'Project compact skill', origin: 'project' },
        { name: 'notes', description: 'User notes', origin: 'user' },
      ],
      [
        { name: 'deploy', description: 'Deploy prompt', origin: 'project', argumentHint: '<env>' },
      ],
    )

    expect(assembled).toEqual([
      {
        name: 'compact',
        description: 'Project compact skill',
        kind: 'skill',
        origin: 'project',
      },
      {
        name: 'session',
        description: 'Show session info and stats',
        kind: 'command',
        origin: 'builtin',
      },
    ])
  })

  it('loads skills and prompts from the Pi resource directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-slash-'))
    const cwd = join(root, 'repo')
    const agentDir = join(root, 'agent')
    await mkdir(join(cwd, '.pi', 'skills', 'review'), { recursive: true })
    await mkdir(join(cwd, '.pi', 'prompts'), { recursive: true })
    await mkdir(join(agentDir, 'skills', 'notes'), { recursive: true })
    await writeFile(
      join(cwd, '.pi', 'skills', 'review', 'SKILL.md'),
      '---\nname: review\ndescription: Review the change\n---\n',
    )
    await writeFile(
      join(cwd, '.pi', 'prompts', 'deploy.md'),
      '---\nname: deploy\ndescription: Deploy the app\nargument-hint: "<env>"\n---\nDeploy $1\n',
    )
    await writeFile(
      join(agentDir, 'skills', 'notes', 'SKILL.md'),
      '---\nname: notes\ndescription: Capture notes\n---\n',
    )

    const commands = await listPiSlashCommands({ cwd, agentDir })
    expect(commands.find((command) => command.name === 'review')).toBeUndefined()
    expect(commands.find((command) => command.name === 'notes')).toBeUndefined()
    expect(commands.find((command) => command.name === 'deploy')).toBeUndefined()
    expect(commands.map((command) => command.name)).toEqual(['compact', 'session'])
  })
})
