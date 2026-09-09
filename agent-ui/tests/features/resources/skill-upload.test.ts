import assert from 'node:assert/strict'
import { test } from 'node:test'

import { MAX_SKILL_ARCHIVE_BYTES, validateSkillArchive } from '../../../src/features/resources/skill-upload.ts'

test('accepts supported skill archives including compound and uppercase extensions at the size limit', () => {
  for (const name of ['skill.zip', 'skill.skill', 'skill.tar', 'skill.tar.gz', 'skill.tgz', 'SKILL.TAR.GZ', '中文.ZIP']) {
    assert.equal(validateSkillArchive({ name, size: MAX_SKILL_ARCHIVE_BYTES }), undefined, name)
  }
})

test('rejects unsupported files and archives that exceed the upload limit', () => {
  for (const name of ['SKILL.md', 'skill.zip.exe', 'skill.gz', 'skill.tar.gzip']) {
    assert.equal(validateSkillArchive({ name, size: 10 }), 'resources.archiveType', name)
  }
  assert.equal(validateSkillArchive({ name: 'skill.zip', size: MAX_SKILL_ARCHIVE_BYTES + 1 }), 'resources.archiveSize')
})
