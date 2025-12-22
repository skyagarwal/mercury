import React, { useEffect, useMemo, useState } from 'react'
import { Routes, Route, Link, useNavigate } from 'react-router-dom'
import Dashboard from './Dashboard'
import Login from './Login'
import WorkflowBuilder from './WorkflowBuilder'
import { ReactFlowProvider } from 'reactflow'

export default function App() {
  const [config, setConfig] = useState<{ apis: {label:string;base:string}[], sse: string } | null>(null)
  const [token, setToken] = useState<string>('')
  const [apiBase, setApiBase] = useState<string>('')
  const nav = useNavigate()

  useEffect(() => {
    fetch('/config.json').then(r => r.json()).then(setConfig)
  }, [])

  useEffect(() => {
    if (config && !apiBase) {
      // Prefer persisted choice, else prefer '/api' if present, else first available
      const persisted = localStorage.getItem('apiBase') || ''
      const validPersisted = config.apis.some(a => a.base === persisted)
      const preferred = validPersisted ? persisted : (config.apis.find(a => a.base === '/api')?.base || config.apis[0]?.base || '/api')
      setApiBase(preferred)
    }
  }, [config])

  if (!config) return <div style={{padding:16}}>Loading…</div>

  return (
    <div>
      <header style={{display:'flex',gap:12,alignItems:'center',padding:12, borderBottom:'1px solid #1f2937'}}>
        <strong>Mangwale Exotel Console</strong>
  <Link to="/">Dashboard</Link>
  <Link to="/builder" style={{marginLeft:8}}>Workflows</Link>
        <span style={{marginLeft:'auto'}}>
          API:
          <select value={apiBase} onChange={e=>{ setApiBase(e.target.value); try { localStorage.setItem('apiBase', e.target.value) } catch {} }} style={{marginLeft:8}}>
            {config.apis.map(a => <option key={a.base} value={a.base}>{a.label}</option>)}
          </select>
        </span>
      </header>
      <Routes>
        <Route path="/" element={<Dashboard apiBase={apiBase} sse={config.sse} token={token} />} />
        <Route
          path="/builder"
          element={
            <ReactFlowProvider>
              <WorkflowBuilder apiBase={apiBase} token={token} />
            </ReactFlowProvider>
          }
        />
        <Route path="/login" element={<Login onLogin={setToken} />} />
      </Routes>
    </div>
  )
}
