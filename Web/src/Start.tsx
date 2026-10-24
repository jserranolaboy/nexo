import { t as tr } from './i18n'
import { ArrowRight, Cloud, Upload, Trash2 } from 'lucide-react'
import { Mark } from './ui'

type Actions = { create: () => void; connect: () => void; restore: () => void }

export function FirstOpening({
  native,
  demo,
  trash,
  ...actions
}: Actions & { native: boolean; demo: () => void; trash?: () => void }) {
  return (
    <main className="first-opening" aria-label={tr('Bienvenida a Nexo')}>
      <div className="opening-content">
        <div className="opening-emblem" aria-hidden="true">
          <Mark size={68} />
        </div>
        <h1>Nexo</h1>
        <div className="opening-options">
          <button className="opening-primary" onClick={native ? actions.create : demo}>
            <span>{native ? tr('Crear espacio') : tr('Explorar ejemplo')}</span>
            <ArrowRight size={20} />
          </button>
          {native && (
            <div className="opening-secondary">
              <button onClick={actions.connect}>
                <Cloud size={20} />
                <span>{tr('Abrir desde Drive')}</span>
              </button>
              <button onClick={actions.restore}>
                <Upload size={20} />
                <span>{tr('Importar copia')}</span>
              </button>
            </div>
          )}
        </div>
        {trash && (
          <button className="text-button opening-trash" onClick={trash}>
            <Trash2 size={16} />
            {tr('Papelera')}
          </button>
        )}
      </div>
    </main>
  )
}
