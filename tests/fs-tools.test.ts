import assert from 'node:assert/strict'
import { FileProposalStatus, FsWriteMode } from '../src/enums'
import {
  approveAndApplyFileProposal,
  executeFileSystemTool,
  rejectFileProposal,
} from '../src/fs/fs-tools'
import { clearVirtualFiles, readWorkspaceFile, setVirtualFile } from '../src/fs/workspace-fs'
import { listFileProposals } from '../src/memory/app-db'

console.log('--- Iniciando pruebas de Herramientas FS y Confirmación Humana ---')

async function runTests() {
  // Test 1: CONFIRM mode (default) stages proposal without modifying file until approved
  {
    clearVirtualFiles()
    setVirtualFile('src/app.ts', 'export const version = 1;\n')

    const res = await executeFileSystemTool(
      'fs_write_file',
      {
        path: 'src/app.ts',
        content: 'export const version = 2;\n',
        reason: 'Actualizar versión a 2',
      },
      {
        sessionId: 101,
        fsWriteMode: FsWriteMode.CONFIRM,
      },
    )

    assert.equal(res.requiresHumanConfirmation, true)
    assert.ok(res.proposalId)

    const beforeApprove = await readWorkspaceFile('src/app.ts')
    assert.equal(beforeApprove.content, 'export const version = 1;\n')

    await approveAndApplyFileProposal(res.proposalId)

    const afterApprove = await readWorkspaceFile('src/app.ts')
    assert.equal(afterApprove.content, 'export const version = 2;\n')

    const proposals = await listFileProposals(101)
    const updated = proposals.find((p) => p.id === res.proposalId)
    assert.equal(updated?.status, FileProposalStatus.APPLIED)
  }

  // Test 2: Reject proposal leaves file untouched
  {
    clearVirtualFiles()
    setVirtualFile('src/app.ts', 'export const version = 1;\n')

    const res = await executeFileSystemTool(
      'fs_write_file',
      {
        path: 'src/app.ts',
        content: 'export const broken = true;\n',
      },
      {
        sessionId: 102,
        fsWriteMode: FsWriteMode.CONFIRM,
      },
    )

    await rejectFileProposal(res.proposalId!)
    const file = await readWorkspaceFile('src/app.ts')
    assert.equal(file.content, 'export const version = 1;\n')
  }

  // Test 3: AUTO mode writes directly to workspace
  {
    clearVirtualFiles()
    const res = await executeFileSystemTool(
      'fs_write_file',
      {
        path: 'src/auto.ts',
        content: 'export const autoWritten = true;\n',
      },
      {
        sessionId: 103,
        fsWriteMode: FsWriteMode.AUTO,
      },
    )

    assert.equal(res.requiresHumanConfirmation, false)
    const file = await readWorkspaceFile('src/auto.ts')
    assert.equal(file.content, 'export const autoWritten = true;\n')
  }

  console.log('✓ Todas las pruebas de Herramientas FS pasaron exitosamente.')
}

void runTests()
