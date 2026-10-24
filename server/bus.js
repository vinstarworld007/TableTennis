// In-process pub/sub that powers live updates (Server-Sent Events) on night pages.
const listeners = new Map(); // channel -> Set(res)

export function subscribe(channel, res) {
  if (!listeners.has(channel)) listeners.set(channel, new Set());
  listeners.get(channel).add(res);
  return () => listeners.get(channel)?.delete(res);
}

const pending = new Map();
// Coalesce bursts (e.g. a match that also updates fixtures and attendance) into one message.
export function emit(channel, type = 'changed') {
  if (pending.has(channel)) return;
  pending.set(channel, setTimeout(() => {
    pending.delete(channel);
    for (const res of listeners.get(channel) || []) res.write(`event: ${type}\ndata: {}\n\n`);
  }, 150));
}

export const emitEvent = (eventId) => {
  if (eventId) emit(`event:${eventId}`);
  emit('club');
};
