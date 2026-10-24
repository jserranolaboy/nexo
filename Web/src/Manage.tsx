import { t as tr } from './i18n'
import { useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { id } from './domain'
import type { ID, Snapshot } from './domain'
import { useWorkspace } from './workspace'
import { InlineText, Sheet } from './kit'

function AddLine({ label, onAdd }: { label: string; onAdd: (name: string) => Promise<unknown> }) {
  const [name, setName] = useState(''),
    [open, setOpen] = useState(false),
    [saving, setSaving] = useState(false)
  const submitting = useRef(false)
  const add = async () => {
    if (submitting.current) return
    const next = name.trim()
    if (!next) return setOpen(false)
    submitting.current = true
    setSaving(true)
    try {
      await onAdd(next)
      setName('')
    } catch {
      // The workspace reports the error; retain the name for a deliberate retry.
    } finally {
      submitting.current = false
      setSaving(false)
    }
  }
  if (!open)
    return (
      <button className="nx-add-line" onClick={() => setOpen(true)}>
        <Plus size={16} />
        {label}
      </button>
    )
  return (
    <form
      className="nx-add-line is-open"
      onSubmit={(e) => {
        e.preventDefault()
        void add()
      }}
    >
      <input
        autoFocus
        value={name}
        readOnly={saving}
        maxLength={200}
        placeholder={label}
        aria-label={label}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => !submitting.current && !name.trim() && setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            if (!submitting.current) setOpen(false)
          }
        }}
      />
      <button className="nx-button small primary" disabled={saving || !name.trim()}>
        {tr('Añadir')}
      </button>
    </form>
  )
}

/** Components and their categories, edited where they are listed. */
export function ComponentsSheet({
  s,
  orgID,
  open,
  focus,
  close,
}: {
  s: Snapshot
  orgID: ID
  open: boolean
  focus?: ID | null
  close: () => void
}) {
  const { mutate } = useWorkspace()
  const components = s.components.filter((c) => c.organizationID === orgID)
  const rename = (entity: string, itemID: ID) => (name: string) =>
    mutate({ kind: 'rename', entity, id: itemID, name }, tr('Nombre actualizado'))
  return (
    <Sheet open={open} onClose={close} title={tr('Componentes')}>
      <div className="nx-manage">
        {components.map((c) => (
          <section key={c.id} className={`nx-manage-block ${focus === c.id ? 'focus' : ''}`}>
            <InlineText as="h3" value={c.name} label={tr('Nombre del componente')} onSave={rename('component', c.id)} />
            <div className="nx-manage-items">
              {s.categories
                .filter((x) => x.componentID === c.id)
                .map((x) => (
                  <InlineText key={x.id} className="nx-chip editable" value={x.name} label={tr('Nombre de la categoría')} onSave={rename('category', x.id)} />
                ))}
              <AddLine
                label={tr('Categoría')}
                onAdd={(name) => mutate({ kind: 'addCategory', id: id(), componentID: c.id, name }, tr('Categoría creada'))}
              />
            </div>
          </section>
        ))}
        <AddLine
          label={tr('Nuevo componente')}
          onAdd={(name) => mutate({ kind: 'addComponent', id: id(), organizationID: orgID, name }, tr('Componente creado'))}
        />
      </div>
    </Sheet>
  )
}

export function GroupsSheet({
  s,
  orgID,
  open,
  close,
}: {
  s: Snapshot
  orgID: ID
  open: boolean
  close: () => void
}) {
  const { mutate } = useWorkspace()
  const groups = s.groups.filter((g) => g.organizationID === orgID)
  return (
    <Sheet open={open} onClose={close} title={tr('Grupos')}>
      <div className="nx-manage">
        <div className="nx-group">
          {groups.map((g) => {
            const n = s.members.filter(
              (m) => m.isActive && s.memberships.some((x) => x.memberID === m.id && x.groupID === g.id && !x.endsAt),
            ).length
            return (
              <div className="nx-group-row" key={g.id}>
                <InlineText
                  className="nx-grow"
                  value={g.name}
                  label={tr('Nombre del grupo')}
                  onSave={(name) => mutate({ kind: 'rename', entity: 'group', id: g.id, name }, tr('Nombre actualizado'))}
                />
                <span className="nx-muted-label">{n}</span>
              </div>
            )
          })}
        </div>
        <AddLine
          label={tr('Nuevo grupo')}
          onAdd={(name) => mutate({ kind: 'addGroup', id: id(), organizationID: orgID, name }, tr('Grupo creado'))}
        />
      </div>
    </Sheet>
  )
}
