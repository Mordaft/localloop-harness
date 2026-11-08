import { compiledSDLCGraph } from '../src/agent/sdlc-graph'

async function runDependencyEvaluationTests() {
  console.log('--- Iniciando prueba de Evaluación de Dependencias y Paso a Fase 4 (HITL 2) ---')

  const threadId = 'dep-test-' + Date.now()
  const threadConfig = { configurable: { thread_id: threadId } }

  // 1. Iniciar sesión y llegar a HITL 1 (Fase 0)
  const initial = await compiledSDLCGraph.invoke(
    {
      sessionId: 888,
      threadId,
      messages: [{ role: 'user' as const, content: 'Sistema de facturación con pasarela y notificación' }],
    },
    threadConfig,
  )

  if (initial.currentPhase !== '0_DISCOVERY_RIGOR') {
    throw new Error(`Se esperaba 0_DISCOVERY_RIGOR, obtenido ${initial.currentPhase}`)
  }

  // 2. Reanudar con 4 componentes donde el 4to depende de los 3 anteriores con espacios y nombres/IDs variados
  const p0Payload = {
    discoveryInputValid: true,
    phase1FrameworkAgreed: true,
    marketArchStandard: 'C4_AND_CLEAN_ARCHITECTURE',
    phase0Data: {
      step1: {
        rawBusinessLanguageText: 'Plataforma con 4 componentes dependientes en serie y paralelo',
        needsList: [{ id: 'N-1', description: 'Flujo completo', expectedImpact: 'Eficiencia' }],
      },
      step2: {
        marketStandard: 'C4_AND_CLEAN_ARCHITECTURE',
        currentSituation: { title: 'Legacy', description: 'Legacy', limitationsOrCapabilities: [] },
        desiredSituation: { title: 'Clean', description: 'Clean', limitationsOrCapabilities: [] },
      },
      step3: {
        featureComponentMappings: [
          {
            componentId: 'comp_core',
            name: 'Módulo Núcleo',
            action: 'CREATE' as const,
            targetState: 'DESIRED' as const,
            description: 'Reglas y entidades centrales.',
            dependsOn: [],
          },
          {
            componentId: 'comp_payment_service',
            name: 'Servicio de Pago',
            action: 'CREATE' as const,
            targetState: 'DESIRED' as const,
            description: 'Procesamiento de transacciones.',
            dependsOn: ['comp_core'],
          },
          {
            componentId: 'comp_notification_service',
            name: 'Servicio de Notificación',
            action: 'CREATE' as const,
            targetState: 'DESIRED' as const,
            description: 'Envío de recibos y avisos.',
            dependsOn: ['comp_core'],
          },
          {
            componentId: 'comp_google_ads_slot',
            name: 'Ads Placeholder',
            action: 'CREATE' as const,
            targetState: 'DESIRED' as const,
            description: 'Banner publicitario dependiente de todos los servicios previos.',
            // Probamos dependencias con espacios, mayúsculas y nombres para verificar la resiliencia
            dependsOn: [' comp_core ', 'COMP_PAYMENT_SERVICE', 'Servicio de Notificación'],
          },
        ],
      },
    },
    useCases: [
      {
        id: 'UC-1',
        title: 'Ciclo Completo de Transacción y Publicidad',
        actor: 'Cliente',
        happyPath: ['Núcleo procesa', 'Pago ejecuta', 'Notificación envía', 'Ads muestra'],
        exceptions: [],
        expectedBusinessOutcome: 'Operación completa y trazable.',
        acceptanceCriteriaGherkin: 'Given todo listo, When ejecuta, Then todo OK.',
      },
    ],
  }

  console.log('[Test] Reanudando ejecución del grafo tras HITL 1...')
  await compiledSDLCGraph.updateState(threadConfig, p0Payload)
  const resultAfterComponents = await compiledSDLCGraph.invoke(null, threadConfig)

  console.log(`✓ Fase alcanzada: ${resultAfterComponents.currentPhase}`)
  console.log(`✓ Estado de componentes:`, Object.fromEntries(
    Object.entries(resultAfterComponents.componentsGraph).map(([k, v]: any) => [k, v.status]),
  ))

  // Verificar que los 4 componentes están en estado VERIFIED
  for (const cId of ['comp_core', 'comp_payment_service', 'comp_notification_service', 'comp_google_ads_slot']) {
    const comp = resultAfterComponents.componentsGraph[cId]
    if (!comp || comp.status !== 'VERIFIED') {
      throw new Error(`Componente ${cId} debería estar VERIFIED, pero está en: ${comp?.status}`)
    }
  }

  // Verificar que el grafo avanzó a Fase 4 (E2E & Auditoría de Negocio)
  if (resultAfterComponents.currentPhase !== '4_E2E_BUSINESS_AUDIT') {
    throw new Error(`Se esperaba fase 4_E2E_BUSINESS_AUDIT, obtenido: ${resultAfterComponents.currentPhase}`)
  }

  // Verificar que el último mensaje contiene la solicitud formal de aprobación para el usuario
  const lastMsg = resultAfterComponents.messages[resultAfterComponents.messages.length - 1]
  if (!lastMsg.content.includes('Aprobación Formal de Negocio')) {
    throw new Error(`El mensaje final debe contener 'Aprobación Formal de Negocio', contenido: ${lastMsg.content.slice(0, 100)}`)
  }
  console.log('✓ Se ha alcanzado Fase 4 y se ha pausado en HITL 2 para aprobación del usuario.')

  // 3. Simular que el usuario aprueba formalmente
  console.log('[Test] Simulando aprobación del usuario para pasar a Fase 6...')
  await compiledSDLCGraph.updateState(threadConfig, {
    businessApproval: {
      approved: true,
      stakeholderComments: 'Aprobación formal concedida por Dirección Técnica.',
      evaluatedAt: new Date().toISOString(),
    },
  })
  const completionResult = await compiledSDLCGraph.invoke(null, threadConfig)
  if (completionResult.currentPhase !== 'COMPLETED') {
    throw new Error(`Se esperaba estado COMPLETED tras aprobación, obtenido: ${completionResult.currentPhase}`)
  }
  console.log('✓ Cierre exitoso y proyección documental en Fase 6 completada.')
  console.log('--- Todas las pruebas de dependencias y Fase 4 pasaron con éxito ---')
}

runDependencyEvaluationTests().catch((err) => {
  console.error('Error en pruebas de dependencias:', err)
  process.exit(1)
})

