import { Router } from 'express';
import { requireUser } from '../auth.js';
import { doublesPool } from '../night.js';
import { vapidPublicKey, saveSubscription, removeSubscription, push } from '../notify.js';
import { subscribe } from '../bus.js';
import { bad, int } from '../util.js';

const r = Router();

r.get('/doubles/pool', (req, res) => res.json({ pool: doublesPool(int(req.query.event)) }));

r.get('/push/key', (req, res) => res.json({ key: vapidPublicKey() }));

r.post('/push/subscribe', requireUser, (req, res) => {
  const sub = req.body;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) throw bad('Invalid subscription.');
  saveSubscription(req.user.id, sub);
  res.json({ ok: true });
});

r.post('/push/unsubscribe', requireUser, (req, res) => {
  if (req.body.endpoint) removeSubscription(String(req.body.endpoint));
  res.json({ ok: true });
});

r.post('/push/test', requireUser, async (req, res) => {
  const n = await push([req.user.id], { title: 'Notifications are on 🎉', body: "We'll tell you when you're up next.", url: '/#/' });
  res.json({ sent: n });
});

// Club-wide live channel (home page, leaderboards).
r.get('/stream', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 5000\n\n');
  const off = subscribe('club', res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); off(); });
});

export default r;
