export function getConfig() {
  const {
    EXOTEL_API_KEY,
    EXOTEL_API_TOKEN,
    EXOTEL_SID,
    EXOTEL_SUBDOMAIN,
    EXOTEL_REGION,
    NODE_ENV,
  } = process.env;

  const missing = [];
  if (!EXOTEL_API_KEY) missing.push('EXOTEL_API_KEY');
  if (!EXOTEL_API_TOKEN) missing.push('EXOTEL_API_TOKEN');
  if (!EXOTEL_SID) missing.push('EXOTEL_SID');
  if (missing.length) {
    console.warn(`Missing env vars: ${missing.join(', ')}. Some endpoints may not work until set.`);
  }

  return {
    exotel: {
      apiKey: (EXOTEL_API_KEY || '').trim(),
      apiToken: (EXOTEL_API_TOKEN || '').trim(),
      sid: (EXOTEL_SID || '').trim(),
      subdomain: (EXOTEL_SUBDOMAIN || 'api').trim(),
      region: (EXOTEL_REGION || '').trim(),
    },
    nodeEnv: NODE_ENV || 'production',
  };
}
