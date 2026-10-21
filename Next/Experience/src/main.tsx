import './i18n'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'motion/react'
import './styles.css'
import './mobile.css'
import './refinements.css'
import './appearance.css'
import './paging.css'
import './start.css'
import './attendance.css'
import './spaces.css'
import './studio-mobile.css'
import './release.css'
import './fields.css'
import './nexo.css'
import './viewport'
import { isIOS } from './platform'
import { WorkspaceProvider, nativeAvailable } from './workspace'
import { App } from './App'
import { InterfaceBoundary } from './InterfaceBoundary'
if (nativeAvailable) document.documentElement.classList.add('native')
if (isIOS) document.documentElement.classList.add('native-ios')
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MotionConfig reducedMotion="user">
      <InterfaceBoundary>
        <WorkspaceProvider>
          <App />
        </WorkspaceProvider>
      </InterfaceBoundary>
    </MotionConfig>
  </React.StrictMode>,
)
