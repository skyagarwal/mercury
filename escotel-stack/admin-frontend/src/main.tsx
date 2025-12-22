import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'

function Dashboard() { return <h1>Dashboard</h1> }
function Operations() { return <h1>Operations</h1> }
function Vendors() { return <h1>Vendors</h1> }
function Riders() { return <h1>Riders</h1> }
function Orders() { return <h1>Orders</h1> }
function Configure() { return <h1>Configure</h1> }

function App() {
  return (
    <BrowserRouter>
      <nav style={{ display: 'flex', gap: 12 }}>
        <Link to="/">Dashboard</Link>
        <Link to="/operations">Operations</Link>
        <Link to="/vendors">Vendors</Link>
        <Link to="/riders">Riders</Link>
        <Link to="/orders">Orders</Link>
        <Link to="/configure">Configure</Link>
      </nav>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/operations" element={<Operations />} />
        <Route path="/vendors" element={<Vendors />} />
        <Route path="/riders" element={<Riders />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/configure" element={<Configure />} />
      </Routes>
    </BrowserRouter>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
