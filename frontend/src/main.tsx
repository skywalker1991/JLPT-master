import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import { SettingsProvider } from './context/SettingsContext'
import { ToastProvider } from './context/ToastContext'
import './index.css'
import App from './App.tsx'

// Picks up a new deploy on the next launch rather than stranding the home-screen
// app on whatever version it was installed with.
registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <SettingsProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </SettingsProvider>
    </BrowserRouter>
  </StrictMode>,
)
