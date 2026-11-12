import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { HttpError } from './errors.js';
import { loadSession } from './auth.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import individualRoutes from './routes/individuals.js';
import auditRoutes from './routes/audit.js';

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(rootDir, 'public'); // sign-in page and shared assets only
const appDir = path.join(rootDir, 'app'); // the outreach app itself: served only to signed-in users
const leafletDir = path.join(rootDir, 'node_modules', 'leaflet', 'dist');

function tileOrigin() {
  try {
    const u = new URL(config.mapTileUrl.replace('{s}', 'a'));
    const host = config.mapTileUrl.includes('{s}') ? u.host.replace(/^a\./, '*.') : u.host;
    return `${u.protocol}//${host}`;
  } catch {
    return null;
  }
}

/**
 * Cross-site request forgery protection. Session cookies are SameSite=Strict,
 * and in addition every state-changing API request must be JSON (which a
 * cross-site HTML form cannot send) and, if the browser sends an Origin
 * header, it must match this site.
 */
function csrfGuard(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  // DELETE requests carry no body; browsers cannot send them cross-site without CORS.
  const bodylessDelete = req.method === 'DELETE' && !req.get('content-type');
  if (!bodylessDelete && !req.is('application/json')) {
    return next(new HttpError(415, 'Requests must use Content-Type: application/json'));
  }
  const origin = req.get('origin');
  if (origin) {
    let host;
    try {
      host = new URL(origin).host;
    } catch {
      return next(new HttpError(403, 'Invalid origin'));
    }
    if (host !== req.get('host')) return next(new HttpError(403, 'Cross-origin request rejected'));
  }
  next();
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'"],
          'img-src': ["'self'", 'data:', ...(tileOrigin() ? [tileOrigin()] : [])],
          'connect-src': ["'self'"],
          'frame-ancestors': ["'none'"],
          'form-action': ["'self'"],
          'upgrade-insecure-requests': config.isProduction ? [] : null,
        },
      },
      hsts: config.isProduction ? { maxAge: 31536000, includeSubDomains: true } : false,
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  // Allow the page to ask for the device's location (for intake), nothing else.
  app.use((_req, res, next) => {
    res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=(), payment=()');
    next();
  });

  app.get('/healthz', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  const api = express.Router();
  api.use(
    rateLimit({
      windowMs: 60 * 1000,
      limit: Number(process.env.API_RATE_LIMIT || 300),
      standardHeaders: 'draft-7',
      legacyHeaders: false,
    }),
  );
  api.use(express.json({ limit: '100kb' }));
  api.use(cookieParser());
  api.use(csrfGuard);
  api.use(loadSession);
  // Client data must never be cached by browsers or proxies.
  api.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  api.use('/auth', authRoutes);
  api.use('/users', userRoutes);
  api.use('/audit', auditRoutes);
  api.use('/', individualRoutes);
  api.use((_req, _res, next) => next(new HttpError(404, 'Not found')));
  app.use('/api', api);

  // ---- Pages -------------------------------------------------------------
  // Only the sign-in page and its styling are public. The app's own pages and
  // scripts are served only to a signed-in user; everyone else is sent to /login.
  const pages = express.Router();
  pages.use(cookieParser());
  pages.use(loadSession);
  const noStore = (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  };
  pages.get('/login', noStore, (req, res) => {
    if (req.user) return res.redirect('/');
    res.sendFile(path.join(publicDir, 'login.html'));
  });
  pages.get('/', noStore, (req, res) => {
    if (!req.user) return res.redirect('/login');
    res.sendFile(path.join(appDir, 'index.html'));
  });
  pages.get('/app.js', noStore, (req, res, next) => {
    if (!req.user) return next(new HttpError(401, 'Authentication required'));
    res.sendFile(path.join(appDir, 'app.js'));
  });
  app.use(pages);
  app.use('/vendor/leaflet', express.static(leafletDir, { index: false, maxAge: '7d' }));
  app.use(express.static(publicDir, { index: false }));
  app.use((_req, _res, next) => next(new HttpError(404, 'Not found')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err.type === 'entity.parse.failed') err = new HttpError(400, 'Malformed JSON');
    if (err.type === 'entity.too.large') err = new HttpError(413, 'Request too large');
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) console.error(err);
    const body = { error: status >= 500 ? 'Internal server error' : err.message };
    if (err.details) body.details = err.details;
    res.status(status).json(body);
  });

  return app;
}
