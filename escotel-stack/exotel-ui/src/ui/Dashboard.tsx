import React, { useEffect, useRef, useState } from 'react'

export default function Dashboard({ apiBase, sse, token }: { apiBase: string, sse: string, token: string }) {
  const [health, setHealth] = useState<any>(null)
  const [sms, setSms] = useState<any>(null)
  const [call, setCall] = useState<any>(null)
  const [events, setEvents] = useState<any[]>([])

  useEffect(() => {
    fetch('/health').then(r=>r.json()).then(setHealth)
  }, [])

  useEffect(() => {
    const es = new EventSource(sse)
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data?.type === 'snapshot') setEvents(data.events || [])
        else setEvents(prev => [data, ...prev].slice(0, 100))
      } catch {}
    }
    return () => es.close()
  }, [sse])

  const headers = token ? { 'Content-Type':'application/json', 'x-ui-auth': token } : { 'Content-Type':'application/json' }

  async function doSms() {
    const From = (document.getElementById('sms-from') as HTMLInputElement).value
    const To = (document.getElementById('sms-to') as HTMLInputElement).value
    const Body = (document.getElementById('sms-body') as HTMLInputElement).value
    const r = await fetch(apiBase + '/sms', { method:'POST', headers, body: JSON.stringify({ From, To, Body }) })
    setSms(await r.json())
  }
  async function doCall() {
    const From = (document.getElementById('call-from') as HTMLInputElement).value
    const To = (document.getElementById('call-to') as HTMLInputElement).value
    const CallerId = (document.getElementById('call-callerid') as HTMLInputElement).value
    const StatusCallback = location.origin + '/exotel/webhooks/call-status'
    const r = await fetch(apiBase + '/call/connect', { method:'POST', headers, body: JSON.stringify({ From, To, CallerId, StatusCallback }) })
    setCall(await r.json())
  }

  return (
    <div style={{padding:16}}>
      <section>
        <h3>Health</h3>
        <pre>{JSON.stringify(health, null, 2)}</pre>
        <button onClick={()=>fetch('/health').then(r=>r.json()).then(setHealth)}>Refresh</button>
        <button onClick={()=>fetch(apiBase + '/auth/check').then(r=>r.json()).then(setHealth)} style={{marginLeft:8}}>Check Exotel Auth</button>
      </section>

      <section>
        <h3>Send SMS</h3>
        <input id="sms-from" placeholder="From" />
        <input id="sms-to" placeholder="To" />
        <input id="sms-body" placeholder="Body" />
        <button onClick={doSms}>Send</button>
        <pre>{JSON.stringify(sms, null, 2)}</pre>
      </section>

      <section>
        <h3>Connect Call</h3>
        <input id="call-from" placeholder="From" />
        <input id="call-to" placeholder="To" />
        <input id="call-callerid" placeholder="CallerId" />
        <button onClick={doCall}>Connect</button>
        <pre>{JSON.stringify(call, null, 2)}</pre>
      </section>

      <section>
        <h3>Recent Events (live)</h3>
        <pre style={{maxHeight:300,overflow:'auto'}}>{JSON.stringify(events, null, 2)}</pre>
      </section>
    </div>
  )
}
