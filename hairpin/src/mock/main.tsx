import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MockPage } from './MockPage'

createRoot(document.getElementById('mock-root')!).render(
  <StrictMode>
    <MockPage />
  </StrictMode>
)
