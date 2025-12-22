import React from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import App from './ui/App'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <Routes>
        <Route path="/*" element={<App />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </HashRouter>
  </React.StrictMode>
)
