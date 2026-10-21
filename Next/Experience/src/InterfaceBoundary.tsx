import { t as tr } from './i18n'
import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { native, nativeAvailable } from './workspace'

/** A rendering failure must leave a recovery action instead of an empty window. */
export class InterfaceBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
    if (nativeAvailable) void native('interfaceError', { message: error.message }).catch(() => {})
  }
  render() {
    if (this.state.failed)
      return (
        <main className="interface-recovery">
          <h1>{tr('No se pudo mostrar Nexo')}</h1>
          <p>{tr('Tus datos guardados se conservan.')}</p>
          <button className="button primary" onClick={() => window.location.reload()}>
            {tr('Volver a abrir')}
          </button>
        </main>
      )
    return this.props.children
  }
}
