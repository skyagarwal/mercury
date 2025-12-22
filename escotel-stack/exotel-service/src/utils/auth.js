export function requireUiAuth(req, res, next) {
  const secret = process.env.UI_PASSWORD;
  if (!secret) return next(); // auth disabled
  const provided = req.header('x-ui-auth');
  if (provided && provided === secret) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}
