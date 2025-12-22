import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  Connection,
  Edge,
  Node,
  Handle,
  Position,
  NodeProps,
} from 'reactflow'
import 'reactflow/dist/style.css'

type BuilderProps = { apiBase: string; token: string }

type NodeKind = 'trigger' | 'delay' | 'http' | 'sms' | 'call' | 'condition' | 'end'

type NodeData = {
  label: string
  type: NodeKind
  config?: any
}

const initialNodes: Node<NodeData>[] = [
  {
    id: 'trigger',
    position: { x: 120, y: 80 },
    data: { label: 'Trigger', type: 'trigger', config: { event: 'order.status' } },
    type: 'custom',
  },
  { id: 'end', position: { x: 700, y: 80 }, data: { label: 'End', type: 'end' }, type: 'custom' },
]

export default function WorkflowBuilder({ apiBase, token }: BuilderProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<NodeData>(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge[]>([])
  const [selected, setSelected] = useState<Node<NodeData> | null>(null)
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set())
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<Set<string>>(new Set())

  const [id, setId] = useState('order-status-v1')
  const [title, setTitle] = useState('Order Status Orchestration')
  const [desc, setDesc] = useState('Calls rider/vendor and sends SMS based on status')

  // History for undo/redo
  type Snapshot = { nodes: Node<NodeData>[]; edges: Edge[] }
  const [history, setHistory] = useState<Snapshot[]>([{ nodes: initialNodes, edges: [] }])
  const [historyIndex, setHistoryIndex] = useState(0)
  const applyingHistoryRef = useRef(false)

  const headers: Record<string, string> = token
    ? { 'Content-Type': 'application/json', 'x-ui-auth': token }
    : { 'Content-Type': 'application/json' }

  const onConnect = useCallback((params: Edge | Connection) => setEdges((eds) => addEdge(params, eds)), [])

  const schema = useMemo(() => ({ nodes, edges }), [nodes, edges])

  // Simple validation
  const [validation, setValidation] = useState<Record<string, string>>({})
  const validate = useCallback((ns: Node<NodeData>[]) => {
    const errs: Record<string, string> = {}
    for (const n of ns) {
      const cfg = n.data?.config || {}
      switch (n.data?.type) {
        case 'delay':
          if (!(typeof cfg.minutes === 'number' && cfg.minutes > 0)) errs[n.id] = 'Minutes must be > 0'
          break
        case 'http':
          if (!cfg.url) errs[n.id] = 'URL is required'
          break
        case 'sms':
          if (!cfg.to || !cfg.body) errs[n.id] = 'To and Body are required'
          break
        case 'call':
          if (!cfg.from || !cfg.to) errs[n.id] = 'From and To are required'
          break
        case 'condition':
          if (!cfg.expr) errs[n.id] = 'Expression is required'
          break
      }
    }
    return errs
  }, [])

  useEffect(() => {
    setSelected(null)
  }, [id])

  // Recompute validation and decorate nodes with invalid style
  useEffect(() => {
    const errs = validate(nodes)
    setValidation(errs)
    // Decorate nodes with border to highlight invalid
    const invalidIds = new Set(Object.keys(errs))
    if (invalidIds.size === 0) return
    applyingHistoryRef.current = true
    setNodes((ns) =>
      ns.map((n) =>
        invalidIds.has(n.id)
          ? { ...n, style: { ...(n.style || {}), border: '2px solid #ef4444', borderRadius: 6 } }
          : { ...n, style: { ...(n.style || {}), border: '1px solid #374151', borderRadius: 6 } }
      )
    )
    setTimeout(() => (applyingHistoryRef.current = false), 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes])

  // Debounced snapshot push to history on graph change
  useEffect(() => {
    const t = setTimeout(() => {
      if (applyingHistoryRef.current) return
      setHistory((h) => {
        const next = h.slice(0, historyIndex + 1)
        const snap: Snapshot = { nodes, edges }
        // Limit history length to 50
        const limited = [...next, snap].slice(-50)
        setHistoryIndex(limited.length - 1)
        return limited
      })
    }, 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges])

  const undo = useCallback(() => {
    setHistory((h) => {
      if (historyIndex <= 0) return h
      const idx = historyIndex - 1
      applyingHistoryRef.current = true
      const snap = h[idx]
      setNodes(snap.nodes)
      setEdges(snap.edges)
      setHistoryIndex(idx)
      // allow state to settle before re-enabling snapshotting
      setTimeout(() => (applyingHistoryRef.current = false), 0)
      return h
    })
  }, [historyIndex, setNodes, setEdges])

  const redo = useCallback(() => {
    setHistory((h) => {
      if (historyIndex >= h.length - 1) return h
      const idx = historyIndex + 1
      applyingHistoryRef.current = true
      const snap = h[idx]
      setNodes(snap.nodes)
      setEdges(snap.edges)
      setHistoryIndex(idx)
      setTimeout(() => (applyingHistoryRef.current = false), 0)
      return h
    })
  }, [historyIndex, setNodes, setEdges])

  async function save() {
    const errs = validate(nodes)
    if (Object.keys(errs).length) {
      alert('Fix validation errors before saving')
      return
    }
    const r = await fetch(`${apiBase}/v1/workflows`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ id, title, description: desc, schema }),
    })
    const j = await r.json()
    alert('Saved: ' + (j?.id || 'unknown'))
  }

  async function load() {
    const r = await fetch(`${apiBase}/v1/workflows/${encodeURIComponent(id)}`, { headers })
    if (r.status !== 200) {
      let msg = `Load failed (${r.status})`
      try { const t = await r.text(); msg += `\n${t.slice(0, 200)}` } catch {}
      alert(msg)
      return
    }
    const j = await r.json()
    setTitle(j.title)
    setDesc(j.description || '')
    if (j.schema?.nodes && j.schema?.edges) {
      setNodes(j.schema.nodes)
      setEdges(j.schema.edges)
    }
  }

  // Drag and drop support
  const rf = useReactFlow()
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      const type = event.dataTransfer.getData('application/reactflow') as NodeKind
      if (!type) return

      const bounds = (event.target as HTMLElement).closest('.react-flow')?.getBoundingClientRect()
      const position = rf.project({
        x: event.clientX - (bounds?.left || 0),
        y: event.clientY - (bounds?.top || 0),
      })

      const newId = `${type}-${Math.random().toString(36).slice(2, 7)}`
      const labelMap: Record<NodeKind, string> = {
        trigger: 'Trigger',
        delay: 'Delay',
        http: 'HTTP',
        sms: 'SMS',
        call: 'Call',
        condition: 'Condition',
        end: 'End',
      }
      setNodes((ns) => ns.concat([{ id: newId, position, data: { label: labelMap[type], type, config: {} }, type: 'custom' } as any]))
    },
    [rf, setNodes]
  )

  // Keyboard shortcuts: Delete, Undo/Redo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Undo/Redo
      const isMac = navigator.platform.toLowerCase().includes('mac')
      const mod = isMac ? e.metaKey : e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      // Delete selection
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedNodeIds.size || selectedEdgeIds.size) {
          e.preventDefault()
          // Remove selected nodes and their incident edges
          setNodes((ns) => ns.filter((n) => !selectedNodeIds.has(n.id)))
          setEdges((es) =>
            es.filter(
              (ed) =>
                !selectedEdgeIds.has(ed.id) && !selectedNodeIds.has(ed.source) && !selectedNodeIds.has(ed.target)
            )
          )
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedNodeIds, selectedEdgeIds, undo, redo, setNodes, setEdges])

  // Connection validation rules
  const isValidConnection = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target) return false
      if (conn.source === conn.target) return false // no self loops
      const byId = new Map(nodes.map((n) => [n.id, n]))
      const src = byId.get(conn.source)
      const tgt = byId.get(conn.target)
      if (!src || !tgt) return false
      // No incoming edges to trigger
      if (tgt.data?.type === 'trigger') return false
      // No outgoing edges from end
      if (src.data?.type === 'end') return false
      // Optional: prevent duplicate identical edges
      const exists = edges.some(
        (e) =>
          e.source === conn.source &&
          e.target === conn.target &&
          (e.sourceHandle || '') === (conn.sourceHandle || '') &&
          (e.targetHandle || '') === (conn.targetHandle || '')
      )
      if (exists) return false
      return true
    },
    [nodes, edges]
  )

  // Custom node with explicit handles
  const CustomNode = useCallback((props: NodeProps<NodeData>) => {
    const { id: nid, data } = props
    const invalid = !!validation[nid]
    const commonBox: React.CSSProperties = {
      padding: '8px 10px',
      borderRadius: 8,
      background: '#111827',
      color: '#e5e7eb',
      border: invalid ? '2px solid #ef4444' : '1px solid #374151',
      minWidth: 120,
      textAlign: 'center',
      boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
    }
    return (
      <div style={commonBox}>
        {data.type !== 'trigger' && <Handle type="target" position={Position.Left} />}
        <div style={{ fontWeight: 600, fontSize: 12 }}>{data.label}</div>
        {data.type === 'condition' ? (
          <div style={{ display: 'flex', gap: 6, marginTop: 6, justifyContent: 'center' }}>
            <div style={{ fontSize: 10, color: '#9ca3af' }}>true</div>
            <div style={{ fontSize: 10, color: '#9ca3af' }}>false</div>
          </div>
        ) : null}
        {data.type !== 'end' && data.type !== 'condition' && <Handle type="source" position={Position.Right} />}
        {data.type === 'condition' && (
          <>
            <Handle type="source" id="true" position={Position.Right} style={{ top: '35%' }} />
            <Handle type="source" id="false" position={Position.Right} style={{ top: '65%' }} />
          </>
        )}
      </div>
    )
  }, [validation])

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr 320px', height: 'calc(100vh - 56px)' }}>
      {/* Palette */}
      <div style={{ borderRight: '1px solid #1f2937', padding: 8, overflow: 'auto' }}>
        <h4>Palette</h4>
        <p style={{ fontSize: 12, color: '#6b7280' }}>Drag onto the canvas</p>
        {(['trigger', 'delay', 'http', 'sms', 'call', 'condition', 'end'] as NodeKind[]).map((t) => (
          <div
            key={t}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/reactflow', t)
              e.dataTransfer.effectAllowed = 'move'
            }}
            style={{ padding: '6px 8px', margin: '6px 0', border: '1px dashed #374151', borderRadius: 6, cursor: 'grab' }}
          >
            {t.toUpperCase()}
          </div>
        ))}
      </div>

      {/* Canvas */}
      <div>
        <div style={{ display: 'flex', gap: 8, padding: 8, alignItems: 'center', borderBottom: '1px solid #1f2937' }}>
          <button
            onClick={() => {
              if (!confirm('Start a new workflow? Unsaved changes will be lost.')) return
              const newId = `untitled-${Math.random().toString(36).slice(2, 6)}`
              setId(newId)
              setTitle('Untitled Workflow')
              setDesc('')
              setNodes(initialNodes)
              setEdges([])
              setSelected(null)
              setSelectedNodeIds(new Set())
              setSelectedEdgeIds(new Set())
              // reset history
              applyingHistoryRef.current = true
              setHistory([{ nodes: initialNodes, edges: [] }])
              setHistoryIndex(0)
              setTimeout(() => (applyingHistoryRef.current = false), 0)
            }}
          >
            New
          </button>
          <button
            onClick={() => {
              const count = selectedNodeIds.size + selectedEdgeIds.size
              if (count === 0) return
              if (count > 1 && !confirm(`Delete ${count} selected items?`)) return
              setNodes((ns) => ns.filter((n) => !selectedNodeIds.has(n.id)))
              setEdges((es) =>
                es.filter(
                  (ed) =>
                    !selectedEdgeIds.has(ed.id) && !selectedNodeIds.has(ed.source) && !selectedNodeIds.has(ed.target)
                )
              )
              setSelected(null)
              setSelectedNodeIds(new Set())
              setSelectedEdgeIds(new Set())
            }}
          >
            Delete
          </button>
          <input value={id} onChange={(e) => setId(e.target.value)} placeholder="workflow id" style={{ width: 200 }} />
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="title" style={{ flex: 1 }} />
          <button onClick={save}>Save</button>
          <button onClick={load}>Load</button>
          <button onClick={() => rf.fitView()}>Fit</button>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: '#6b7280' }}>
            Tips: Ctrl+Z/Shift+Ctrl+Z undo/redo, Delete to remove
          </span>
        </div>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          fitView
          onNodeClick={(_, n) => setSelected(n as any)}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onSelectionChange={({ nodes: sn, edges: se }) => {
            setSelected(sn[0] as any || null)
            setSelectedNodeIds(new Set(sn.map((n) => n.id)))
            setSelectedEdgeIds(new Set(se.map((e) => e.id)))
          }}
          isValidConnection={isValidConnection}
          nodeTypes={{ custom: CustomNode }}
        >
          <MiniMap />
          <Controls />
          <Background gap={16} />
        </ReactFlow>
      </div>

      {/* Inspector */}
      <div style={{ borderLeft: '1px solid #1f2937', padding: 8, overflow: 'auto' }}>
        <h3>Inspector</h3>
        {!selected && <div>Select a node</div>}
        {selected && (
          <div>
            <div>
              <strong>{selected.data.label}</strong> <em>({selected.data.type})</em>
            </div>
            {validation[selected.id] && (
              <div style={{ color: '#ef4444', fontSize: 12, margin: '6px 0' }}>{validation[selected.id]}</div>
            )}
            {selected.data.type === 'delay' && (
              <div>
                <label>
                  Minutes:{' '}
                  <input
                    type="number"
                    value={selected.data.config?.minutes || 0}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      setNodes((ns) =>
                        ns.map((n) => (n.id === selected.id ? { ...n, data: { ...n.data, config: { ...n.data.config, minutes: v } } } : n))
                      )
                    }}
                    style={validation[selected.id] ? { borderColor: '#ef4444' } : undefined}
                  />
                </label>
              </div>
            )}

            {selected.data.type === 'http' && (
              <div>
                <label>
                  URL:{' '}
                  <input
                    value={selected.data.config?.url || ''}
                    onChange={(e) => {
                      const v = e.target.value
                      setNodes((ns) =>
                        ns.map((n) => (n.id === selected.id ? { ...n, data: { ...n.data, config: { ...n.data.config, url: v } } } : n))
                      )
                    }}
                    style={validation[selected.id] ? { borderColor: '#ef4444' } : undefined}
                  />
                </label>
                <label style={{ display: 'block' }}>
                  Method:{' '}
                  <input
                    value={selected.data.config?.method || 'GET'}
                    onChange={(e) => {
                      const v = e.target.value
                      setNodes((ns) =>
                        ns.map((n) => (n.id === selected.id ? { ...n, data: { ...n.data, config: { ...n.data.config, method: v } } } : n))
                      )
                    }}
                  />
                </label>
              </div>
            )}

            {selected.data.type === 'sms' && (
              <div>
                <label>
                  To:{' '}
                  <input
                    value={selected.data.config?.to || ''}
                    onChange={(e) => {
                      const v = e.target.value
                      setNodes((ns) =>
                        ns.map((n) => (n.id === selected.id ? { ...n, data: { ...n.data, config: { ...n.data.config, to: v } } } : n))
                      )
                    }}
                    style={validation[selected.id] ? { borderColor: '#ef4444' } : undefined}
                  />
                </label>
                <label style={{ display: 'block' }}>
                  Body:{' '}
                  <input
                    value={selected.data.config?.body || ''}
                    onChange={(e) => {
                      const v = e.target.value
                      setNodes((ns) =>
                        ns.map((n) => (n.id === selected.id ? { ...n, data: { ...n.data, config: { ...n.data.config, body: v } } } : n))
                      )
                    }}
                    style={validation[selected.id] ? { borderColor: '#ef4444' } : undefined}
                  />
                </label>
              </div>
            )}

            {selected.data.type === 'call' && (
              <div>
                <label>
                  From:{' '}
                  <input
                    value={selected.data.config?.from || ''}
                    onChange={(e) => {
                      const v = e.target.value
                      setNodes((ns) =>
                        ns.map((n) => (n.id === selected.id ? { ...n, data: { ...n.data, config: { ...n.data.config, from: v } } } : n))
                      )
                    }}
                    style={validation[selected.id] ? { borderColor: '#ef4444' } : undefined}
                  />
                </label>
                <label style={{ display: 'block' }}>
                  To:{' '}
                  <input
                    value={selected.data.config?.to || ''}
                    onChange={(e) => {
                      const v = e.target.value
                      setNodes((ns) =>
                        ns.map((n) => (n.id === selected.id ? { ...n, data: { ...n.data, config: { ...n.data.config, to: v } } } : n))
                      )
                    }}
                    style={validation[selected.id] ? { borderColor: '#ef4444' } : undefined}
                  />
                </label>
                <label style={{ display: 'block' }}>
                  CallerId:{' '}
                  <input
                    value={selected.data.config?.callerId || ''}
                    onChange={(e) => {
                      const v = e.target.value
                      setNodes((ns) =>
                        ns.map((n) => (n.id === selected.id ? { ...n, data: { ...n.data, config: { ...n.data.config, callerId: v } } } : n))
                      )
                    }}
                  />
                </label>
              </div>
            )}

            {selected.data.type === 'condition' && (
              <div>
                <label>
                  Expression (JS):{' '}
                  <input
                    value={selected.data.config?.expr || ''}
                    onChange={(e) => {
                      const v = e.target.value
                      setNodes((ns) =>
                        ns.map((n) => (n.id === selected.id ? { ...n, data: { ...n.data, config: { ...n.data.config, expr: v } } } : n))
                      )
                    }}
                    style={validation[selected.id] ? { borderColor: '#ef4444' } : undefined}
                  />
                </label>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

