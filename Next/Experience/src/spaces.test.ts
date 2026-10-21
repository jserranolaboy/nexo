import { describe, expect, it } from 'vitest'
import { makeDemo } from './demo'
import { simulateAction } from './domain'

describe('Papelera de espacios', () => {
  it('conserva todos los registros y restaura la misma asociación', () => {
    const before = makeDemo(),
      org = before.organizations[0]
    const action = {
      kind: 'setOrganizationDeleted',
      organizationID: org.id,
      expectedName: org.name,
    }
    const removed = simulateAction(before, { ...action, deleted: true, expectedDeleted: false })
    expect(removed.organizations[0].deletedAt).toBeTruthy()
    for (const field of [
      'members',
      'events',
      'attendance',
      'volunteers',
      'templates',
      'groups',
      'memberships',
    ] as const)
      expect(removed[field]).toEqual(before[field])
    const restored = simulateAction(removed, { ...action, deleted: false, expectedDeleted: true })
    expect(restored.organizations[0].id).toBe(org.id)
    expect(restored.organizations[0].deletedAt).toBeNull()
    expect(before.organizations[0].deletedAt).toBeUndefined()
  })
  it('rechaza confirmaciones obsoletas y ediciones de espacios eliminados', () => {
    const before = makeDemo(),
      org = before.organizations[0]
    const action = {
      kind: 'setOrganizationDeleted',
      organizationID: org.id,
      deleted: true,
      expectedDeleted: false,
      expectedName: org.name,
    }
    const removed = simulateAction(before, action)
    expect(() => simulateAction(removed, action)).toThrow('El espacio cambió')
    expect(() => simulateAction(before, { ...action, expectedName: 'Otro nombre' })).toThrow(
      'El espacio cambió',
    )
    expect(() =>
      simulateAction(removed, { kind: 'addMember', organizationID: org.id, name: 'Prueba' }),
    ).toThrow('Papelera')
    const event = removed.events.find((e) => e.organizationID === org.id)!
    expect(() =>
      simulateAction(removed, { kind: 'cancelEvent', eventID: event.id, cancelled: true }),
    ).toThrow('Papelera')
  })
})
