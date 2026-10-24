// Test-only preload for the localhost browser smoke. Never imported by application code.
export function installRecoveryFixture() {
  if (location.origin !== 'http://127.0.0.1:4173' || window.top !== window) return
  window.nexoLocale = 'en'
  const organizationID = '00000000-0000-4000-8000-000000000001'
  const template = {
    id: '00000000-0000-4000-8000-000000000002', organizationID,
    name: 'Synthetic recovered draft', format: 'visual',
    columns: ['participant', 'signature'], accentHex: '#262629', rowHeight: 30,
    tableTopOffset: 100, textBlocks: [], imageBlocks: [],
    footerText: 'Original unsaved synthetic work',
  }
  const recovery = { organizationID, template, baseTemplate: null }
  const snapshot = {
    schemaVersion: 1, revision: 7,
    organizations: [{ id: organizationID, name: 'Synthetic recovery space', accentHex: '#262629', timeZoneIdentifier: 'UTC' }],
    periods: [], members: [], groups: [], memberships: [], components: [], categories: [],
    events: [], attendance: [], volunteers: [], templates: [], collaborators: [],
    syncStates: [], resolvedSyncConflicts: [],
  }
  const drive = { configured: false, connected: false, account: '', error: '', spaces: [] }
  const calls = [], unexpected = []
  let pending = [], phase = 'pending'
  const reject = (message) => {
    unexpected.push(message)
    throw new Error(message)
  }
  window.webkit = { messageHandlers: { valentina: { postMessage: async (message) => {
    calls.push(structuredClone(message))
    switch (message.command) {
      case 'load': return structuredClone({ snapshot, drive, activeOrganizationID: organizationID })
      case 'activeOrganization':
        if (phase !== 'ready' || message.id !== organizationID) return reject('Unexpected synthetic space')
        return {}
      case 'recoverDraft':
        phase = 'pending'
        return new Promise((resolve, reject) => pending.push({ resolve, reject }))
      case 'draftState':
        if (phase !== 'ready') return reject('Draft write before recovery completed')
        if (message.dirty !== true || message.organizationID !== organizationID ||
            message.template?.id !== template.id || message.template?.name !== template.name ||
            message.template?.footerText !== template.footerText)
          return reject('Recovered draft was cleared or replaced')
        return {}
      default: return reject(`Unexpected synthetic bridge command: ${message.command}`)
    }
  } } } }
  window.__nexoRecoveryFixture = {
    inspect: () => structuredClone({ calls, unexpected, phase, pending: pending.length, recovery }),
    settle: (outcome) => {
      if (!['fail', 'recover'].includes(outcome) || !pending.length) throw new Error('No matching pending recovery')
      const requests = pending
      pending = []
      phase = outcome === 'fail' ? 'failed' : 'ready'
      for (const request of requests) {
        if (outcome === 'fail') request.reject(new Error('Synthetic temporary draft read failure'))
        else request.resolve(structuredClone(recovery))
      }
    },
  }
}
