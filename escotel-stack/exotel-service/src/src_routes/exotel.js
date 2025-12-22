import express from 'express';
import axios from 'axios';
import { getConfig } from '../utils/config.js';
import { publish } from '../utils/mq.js';
import { redact } from '../utils/security.js';
import { requireUiAuth } from '../utils/auth.js';
import { bus, emitEvent } from '../utils/events.js';

const router = express.Router();
const recent = [];
const RECENT_LIMIT = 50;

function exotelBaseUrl() {
  const cfg = getConfig();
  const { sid, region, subdomain } = cfg.exotel;
  if (region) return `https://${subdomain}.${region}.exotel.com/v1/Accounts/${sid}`;
  return `https://${subdomain}.exotel.com/v1/Accounts/${sid}`;
}

function auth() {
  const cfg = getConfig();
  return { username: cfg.exotel.apiKey, password: cfg.exotel.apiToken };
}

// Auth check (non-billable): retrieve account details
router.get('/auth/check', async (req, res) => {
  try {
    const url = `${exotelBaseUrl()}.json`;
    const { data, status } = await axios.get(url, { auth: auth(), timeout: 8000 });
    const account = data?.Accounts?.[0] || data?.Account || data;
    return res.status(status).json({ ok: true, accountSid: account?.Sid || account?.sid });
  } catch (err) {
    const status = err.response?.status || 500;
    const raw = err.response?.data || err.message;
    const safe = redact(raw);
    return res.status(status).json({ ok: false, error: safe });
  }
});

router.post('/sms', requireUiAuth, async (req, res) => {
  const { To, Body, From } = req.body;
  if (!To || !Body || !From) {
    return res.status(400).json({ error: 'Missing required fields: To, From, Body' });
  }
  try {
    const url = `${exotelBaseUrl()}/Sms/send.json`;
    const params = new URLSearchParams({ From, To, Body });
    const { data, status } = await axios.post(url, params, { auth: auth() });
  emitEvent({ type: 'exotel.sms.sent', at: new Date().toISOString(), request: { To, From }, response: data });
  return res.status(status).json(data);
  } catch (err) {
    const status = err.response?.status || 500;
    const raw = err.response?.data || err.message;
    const safe = redact(raw);
    return res.status(status).json({ error: safe });
  }
});

router.post('/call/connect', requireUiAuth, async (req, res) => {
  const { From, To, CallerId, TimeLimit, TimeOut, StatusCallback } = req.body;
  if (!From || !To || !CallerId) {
    return res.status(400).json({ error: 'Missing required fields: From, To, CallerId' });
  }
  try {
    const url = `${exotelBaseUrl()}/Calls/connect.json`;
    const params = new URLSearchParams({ From, To, CallerId });
    if (TimeLimit) params.append('TimeLimit', String(TimeLimit));
    if (TimeOut) params.append('TimeOut', String(TimeOut));
    if (StatusCallback) params.append('StatusCallback', StatusCallback);
    const { data, status } = await axios.post(url, params, { auth: auth() });
  emitEvent({ type: 'exotel.call.connect', at: new Date().toISOString(), request: { From, To, CallerId }, response: data });
  return res.status(status).json(data);
  } catch (err) {
    const status = err.response?.status || 500;
    const raw = err.response?.data || err.message;
    const safe = redact(raw);
    return res.status(status).json({ error: safe });
  }
});

// Exotel call status webhook (will be called by Exotel)
// Exotel posts form-encoded payloads; accept both form and JSON
router.post('/webhooks/call-status', express.urlencoded({ extended: true }), express.json(), async (req, res) => {
  try {
    const event = {
      source: 'exotel',
      type: 'call.status',
      receivedAt: new Date().toISOString(),
      payload: req.body,
      headers: { 'x-forwarded-for': req.headers['x-forwarded-for'], host: req.headers.host },
    };
  recent.unshift(event);
    if (recent.length > RECENT_LIMIT) recent.pop();
  emitEvent({ type: 'exotel.webhook.call-status', at: new Date().toISOString(), event });
    await publish('exotel.call.status', event);
    return res.status(202).json({ accepted: true });
  } catch (err) {
    return res.status(500).json({ accepted: false, error: 'Failed to enqueue' });
  }
});

router.get('/webhooks/recent', (req, res) => {
  res.json({ events: recent });
});

// Server-Sent Events stream of webhook/events
router.get('/webhooks/events/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  // send recent snapshot first
  send({ type: 'snapshot', events: recent });

  const onEvt = (evt) => send(evt);
  bus.on('event', onEvt);

  req.on('close', () => {
    bus.off('event', onEvt);
  });
});

export default router;
