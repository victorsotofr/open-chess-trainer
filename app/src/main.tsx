import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import './index.css'
import { router } from './router'
import { AppDataProvider } from './app/data'
import { ConfirmProvider } from './components/Confirm'
import { installErrorLog } from './lib/errors'

installErrorLog()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppDataProvider>
      <ConfirmProvider>
        <RouterProvider router={router} />
      </ConfirmProvider>
    </AppDataProvider>
  </StrictMode>,
)
