export function allowedOrigins() {
  const raw = process.env.CORS_ALLOWED_ORIGINS;
  if (!raw || raw.trim() === '') return '*';
  const list = raw.split(',').map(s => s.trim()).filter(Boolean);
  return function originCheck(origin, callback) {
    if (!origin) return callback(null, true);
    if (list.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'), false);
  };
}

export function redact(obj) {
  if (!obj) return obj;
  const str = JSON.stringify(obj);
  return str
    .replaceAll(process.env.EXOTEL_API_KEY || '', '***')
    .replaceAll(process.env.EXOTEL_API_TOKEN || '', '***');
}
