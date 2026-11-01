import assert from 'node:assert/strict'
import {
  AgentScopeStorage,
  ENGRAM_REF_PREFIX,
  createIsolatedEngram,
  fromEngramRef,
  toEngramRef,
} from '../src/memory/engram-memory'

console.log('--- Iniciando pruebas de Memoria Engram-ts y AgentScopeStorage ---')

async function runTests() {
  const engram = createIsolatedEngram()
  const rootStorage = new AgentScopeStorage({
    engram,
    project: 'session-1',
    filePath: 'src/index.ts',
    scopeId: 'root_src_index_ts',
  })

  const subTasks = [
    {
      id_subtarea: 'child_1',
      descripcion: 'Revisar imports y estructura modular',
      skill_requerida: 'skill_architect' as const,
      lineStart: 1,
      lineEnd: 20,
    },
  ]

  const planHeader = await rootStorage.saveSubPlan(subTasks, 'Separación modular')
  assert.ok(planHeader.id.length > 0)
  assert.equal(planHeader.type, 'scope-plan')

  const childStorage = rootStorage.createChildScopeStorage('child_1')
  assert.equal(childStorage.depth, 1)
  assert.equal(childStorage.parentScopeId, 'root_src_index_ts')
  assert.equal(childStorage.ancestorScopeIds.has('root_src_index_ts'), true)

  const savedResult = await childStorage.saveScopeResult({
    task: subTasks[0],
    codeSlice: 'const a = 1;',
    sumarioEjecutivo: 'Módulo limpio y modular',
    findings: [
      {
        id: 'f-1',
        filePath: 'src/index.ts',
        line: 1,
        severity: 'baja',
        category: 'architecture',
        message: 'Estructura correcta',
        recommendation: 'Mantener modularidad',
      },
    ],
  })

  assert.ok(savedResult.engram_ref.startsWith(ENGRAM_REF_PREFIX))
  assert.equal(fromEngramRef(toEngramRef(savedResult.memoryId)), savedResult.memoryId)

  const reused = await rootStorage.findReusableScopeResult(subTasks[0], 'const a = 1;')
  assert.ok(reused, 'Debe reutilizar el resultado del scope desde engram-ts')
  assert.ok(reused.sumario_ejecutivo.includes('Módulo limpio'))
  assert.equal(reused.findings.length, 1)

  const loadedByRef = await rootStorage.getScopeResultByMemoryId(savedResult.engram_ref)
  assert.ok(loadedByRef)
  assert.equal(loadedByRef.id_scope, 'child_1')

  console.log('✓ Todas las pruebas de Memoria Engram-ts pasaron exitosamente.')
}

void runTests()
