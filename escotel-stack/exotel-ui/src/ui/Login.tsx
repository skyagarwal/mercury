import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'

export default function Login({ onLogin }: { onLogin: (t: string)=>void }) {
  const [pwd, setPwd] = useState('')
  const nav = useNavigate()
  function submit(e: React.FormEvent) {
    e.preventDefault()
    onLogin(pwd)
    nav('/')
  }
  return (
    <form onSubmit={submit} style={{padding:16}}>
      <h3>Login</h3>
      <input type="password" placeholder="UI password" value={pwd} onChange={e=>setPwd(e.target.value)} />
      <button type="submit">Continue</button>
    </form>
  )
}
