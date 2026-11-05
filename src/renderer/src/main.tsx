import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import ConnectGate from './components/ConnectGate'
import { ThemeProvider } from './components/ThemeProvider'
import { installHeadlessApi } from './api/headless'
import './i18n'
import './index.css'

// A desktop install already has `window.electronAPI` from the preload; a page served by
// a headless daemon (WSL) gets the same object over HTTP + SSE instead. Must happen
// before anything calls into it.
const isRemoteGateway = installHeadlessApi()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <ConnectGate remote={isRemoteGateway}>
          <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <App />
          </HashRouter>
        </ConnectGate>
      </ThemeProvider>
    </ErrorBoundary>
  </React.StrictMode>
)
