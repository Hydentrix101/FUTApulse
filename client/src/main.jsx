import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import PwaExperience from './components/PwaExperience.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <>
      <App />
      <PwaExperience />
    </>
  </StrictMode>,
)
