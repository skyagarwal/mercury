
# Mangwale Admin Frontend (React) — Exotel + WhatsApp Orchestration GUI
**Version:** 1.0  
**Scope:** Web UI to configure and operate the Ops & Communications layer (Vendors, Riders, Orders) using **Exotel** + **WhatsApp** + App fallbacks, matching the backend spec `Mangwale_Ops_Comms_Spec.md`.

---

## 0) Objectives
- Single-pane GUI to **configure**, **monitor**, and **operate** communications and SLAs.
- No-code/low-code editors for **WhatsApp templates**, **IVR flows**, **SLA timers**, **phone number labels**, **feature flags**.
- Real-time **exceptions board**, **comms timeline**, and **bridge-call** controls.
- City-wise rollout with **RBAC**, **audit logging**, and **feature flags**.

---

## 1) Tech Stack & Conventions
- **React + Vite**, **TypeScript**
- **Tailwind CSS** + **shadcn/ui** components
- **React Router v6**, **React Query** (TanStack) for data fetching + caching
- **Zustand** or **Redux Toolkit** (choose one; examples assume RTK)
- **react-hook-form** + **zod** for forms + validation
- **Socket.IO** or native WebSocket for live events
- **i18n**: react-i18next (English, Hindi, Marathi; runtime language switch)
- **Auth**: OAuth/session + TOTP (admin), API keys for service calls
- **Icons**: lucide-react
- **Charts**: recharts
- **Maps**: Mapbox/Leaflet (env-flagged)
- **Accessibility first** (WAI-ARIA, keyboard nav)

---

## 2) Global Information Architecture (Pages)
```
/login (TOTP)
/dashboard
/operations
  /exceptions (default)
  /timeline/:orderId
  /bridge
/vendors
  /list
  /:vendorId (profile, perf, comms)
  /bulk-upload
/riders
  /list
  /:riderId (profile, perf, comms)
/orders
  /list
  /:orderId (state, comms, geo)
/configure
  /exotel (DIDs, ring rules, IVR editor)
  /whatsapp (templates, variables, testing)
  /sla (accept SLA, processing reminders, address-change confirm)
  /feature-flags (per city/vendor tier)
  /geo (provider keys, off-route rules)
  /integrations (payments, catalog, auth)
/analytics
  /vendors
  /riders
  /orders
  /comms
/admin
  /users (RBAC roles, access by city)
  /apikeys (create/rotate, scopes)
  /audit (actor-wise log)
```

---

## 3) Core UX Flows

### 3.1 Exceptions Board (Ops Default)
- Stream (WebSocket) of **SLA breaches & escalations**:
  - Vendor ignored WA → Ring → IVR → *no action*
  - Rider ignored assignment/address update
  - Off-route alerts
- Cards show: actor, order, city, SLA countdown, last action, **Quick Actions**:
  - `Send Ring Now`, `Force IVR`, `Bridge`, `Deactivate Vendor`, `Reassign Rider`
- Filters: city, vendor tier, severity, last 15/30/60 min

### 3.2 Comms Timeline (Per Order)
- Unified timeline (WA sends/delivery/read, Ring, IVR DTMF, app actions)
- Downloadable **audit PDF**
- “Re-run escalation” button, idempotent with reason

### 3.3 Bridge Console
- Form: select order (or free dial), choose parties (rider/vendor/customer), click **Bridge**
- Shows **Exotel call status** (ringing/connected), with **mute/drop** controls
- Post-action note → stored in order timeline

---

## 4) Configuration Editors

### 4.1 Exotel
**DIDs**
- Table: DID, **Label** (📦 New Order / ⏱ Reminder / 📍 Address Update), city, enabled
- Create/assign: Validate E.164, per-city routing rules

**Ring Rules**
- New Order: escalation timings (WA → Ring T+2m → IVR T+3m → Admin T+5m)
- Reminder: trigger at `prep_eta - N minutes` (default 3)
- Address Update: ring immediately, IVR if no confirm in 2m
- Rate limits (per vendor/rider/day)

**IVR Flow Editor (No-code)**
- Node types: **Say**, **Gather (DTMF)**, **Branch**, **Webhook**, **Bridge**
- Drag-n-drop; left panel node palette, right panel node config
- **Preview**: simulate DTMF presses with mocked order/vendor data
- **Publish** → versioned; rollback capable
- Validation: “All Gather nodes have next branches”
- Export JSON:
```json
{
  "id": "ivr_vendor_new_order_v3",
  "nodes": [
    {"type":"say","text":"You have a new order of rupees {{amount}}."},
    {"type":"gather","digits":1,"options": {"1":"accept","2":"reject","3":"prep"}},
    {"type":"webhook","url":"/webhooks/exotel/dtmf","context":"vendor_new_order"}
  ]
}
```

### 4.2 WhatsApp
- **Template Manager**: list/register templates, variables, languages
- Visual editor with placeholders `{{1}}`…; button mapping to backend endpoints
- **Test Send** pane: phone input, payload JSON, observe delivery/read
- **Compliance**: character limit, media attachments (if enabled)

### 4.3 SLA Policies
- Per city/vendor tier/rider tier
- **Vendor Accept SLA**: WA → Ring @2m → IVR @3m → Admin @5m
- **Processing Reminder**: N minutes before ETA; IVR on answer
- **Address Change Confirm (Rider)**: Ring immediately; IVR @2m
- Preview: Gantt chart of escalation timings

### 4.4 Feature Flags
- Toggle features by city:
  - `exotel.enabled`, `ivr.enabled`, `whatsapp.enabled`
  - `rider.offroute.check`, `ivr.bridge.enabled`
- Requires justification; logs to **audit**

### 4.5 Geo Rules
- Provider keys, per-city defaults
- Off-route thresholds (meters, minutes), polyline deviation sensitivity
- Action: `ring`, `ivr`, `admin_alert`

### 4.6 Integrations
- Payments webhook URL & secret
- Catalog base URL
- Auth provider config
- WhatsApp BSP token rotation

---

## 5) Data Fetching & State
- **React Query** for all lists/detail pages:
  - keys: `["orders", filters]`, `["vendors", id]`, `["sla-policies"]`, etc.
- **Redux Toolkit** (or Zustand) for ephemeral UI states: modals, IVR editor draft, selected city
- **WebSocket** for live exceptions & timelines:
  - subscribe: `ops.exceptions`, `order.timeline.<orderId>`
- **Optimistic updates**: For toggles (feature flags), number labels, etc.

---

## 6) Components (Key)
- `ExceptionsTable`, `ExceptionCard`, `SLAClock`
- `CommsTimeline` (stacked with icons: WA/Ring/IVR/App)
- `BridgePanel`
- `IVREditor` (Canvas + NodeSidebar)
- `TemplateEditor` (WA)
- `NumberLabelManager` (Exotel DIDs)
- `SLAPolicyForm` + Gantt Preview
- `GeoRuleForm` + Map Preview
- `FeatureFlagsPanel`
- `AuditLogTable`

---

## 7) RBAC & Permissions
- Roles: **Ops**, **Supervisor**, **Admin**, **Auditor**
- Scopes: city, vendor tier
- Gate specific actions:
  - Ops: can trigger Ring/IVR, Bridge, update SLA timers
  - Supervisor: can change policies for city
  - Admin: global settings, API keys
  - Auditor: read-only + export

---

## 8) API Contracts (Frontend → Backend)
(Aligns with backend spec; only the endpoints the GUI calls.)

- `GET /orders?state=&city=&q=&page=`
- `GET /orders/:id`
- `GET /orders/:id/timeline`
- `POST /orders/:id/address`

- `GET /vendors?city=&active=`
- `GET /vendors/:id`
- `POST /vendors/:id/activate`
- `POST /vendors/:id/deactivate`
- `GET /vendors/:id/metrics`

- `GET /riders?city=&active=`
- `GET /riders/:id`
- `POST /riders/:id/assign` (manual)
- `GET /riders/:id/metrics`

- `POST /comms/notify/vendor/order`
- `POST /comms/notify/vendor/reminder`
- `POST /comms/notify/rider/assign`
- `POST /comms/notify/rider/address-update`
- `POST /comms/bridge`
- `GET /comms/timeline/:orderId`

- `GET /configure/exotel/dids`
- `POST /configure/exotel/dids`
- `POST /configure/exotel/ring-rules`
- `POST /configure/exotel/ivr` (publish/rollback)
- `GET /configure/whatsapp/templates`
- `POST /configure/whatsapp/templates`
- `POST /configure/sla/policies`
- `GET /configure/feature-flags`
- `POST /configure/feature-flags`
- `POST /configure/geo/rules`

- `GET /analytics/vendors?city=&period=`
- `GET /analytics/riders?city=&period=`
- `GET /analytics/orders?city=&period=`
- `GET /analytics/comms?city=&period=`

- `GET /admin/users`
- `POST /admin/users`
- `GET /admin/apikeys`
- `POST /admin/apikeys`
- `GET /admin/audit?actor=&city=&from=&to=`

All POST/PATCH respond with `{ ok: true }` + updated resource on success.

---

## 9) Mock/Dev Mode
- **Env flag**: `VITE_MOCK_API=true` swaps axios baseURL to `/mock`
- Mock handlers with MSW (Mock Service Worker) simulate events:
  - SLA escalations, IVR DTMF replies, WA delivery statuses
- Local “Simulate Order” tool to generate timeline and exceptions

---

## 10) Observability & Telemetry (Frontend)
- OTEL browser traces per user action: `ops.trigger_ring`, `ops.bridge_call`
- Error boundary with Sentry
- Slow endpoint detector: toast + logs (with correlation id)
- Redaction for PII in logs

---

## 11) Accessibility & i18n
- Keyboard shortcuts (e.g., `/` focus search, `B` open Bridge panel)
- Screen reader labels for icons (WA, Ring, IVR)
- High-contrast theme option
- Language switch stored per admin user

---

## 12) Security
- CSRF-protected session for dashboard
- TOTP on login (ADMIN_REQUIRE_TOTP)
- Role + scope checks in UI (hide non-permitted controls)
- Audit every config change with diffs

---

## 13) Deployment
- Build with Vite → static assets to CDN
- Served behind **Traefik** or Nginx
- Env via `window.__CONFIG__` injection (city flags, API base)
- Versioned releases; blue/green rollout per city

---

## 14) Sample UI Data Models (TypeScript)

```ts
export type Order = {
  id: string;
  city: string;
  vendorId: string;
  riderId?: string;
  amount: number;
  state: 'pending'|'partial'|'confirmed'|'processing'|'handover'|'out_for_delivery'|'delivered'|'cancelled';
  paymentMode: 'prepaid'|'cod';
  paymentStatus: 'pending'|'partial'|'success'|'failed';
  prepEtaMinutes?: number;
  createdAt: string;
};

export type ExceptionCard = {
  id: string;
  orderId: string;
  actor: 'vendor'|'rider';
  actorId: string;
  city: string;
  type: 'vendor_accept_sla'|'processing_reminder'|'rider_assign_sla'|'address_change_confirm'|'offroute';
  dueAt: string;
  lastAction?: string;
  severity: 'low'|'med'|'high';
};
```

---

## 15) Example Forms

**SLA Policy Form**
```json
{
  "city": "Nashik",
  "vendorAccept": { "wa": 0, "ringMin": 2, "ivrMin": 3, "adminMin": 5 },
  "processingReminder": { "minutesBefore": 3, "ivrOnAnswer": true },
  "addressChange": { "ring": 0, "ivrMin": 2 }
}
```

**Exotel DID**
```json
{ "did":"+91XXXXXXXXXX", "label":"📦 New Order – Mangwale", "city":"Nashik", "enabled":true }
```

---

## 16) Test Plan (Front-End)
- Unit: reducers/selectors, form schemas, IVR editor validators
- Integration: mock server for `/comms/notify/*`, `/webhooks/*`
- E2E: Cypress flows for Exceptions → Bridge → Timeline updates
- Performance: ensure Exceptions Board handles 50 events/min smoothly

---

**This document pairs with the backend spec.** It provides your team a clear blueprint to build a production-grade **React Admin GUI** for Mangwale’s ops & comms orchestration — configurable, observable, and resilient.
