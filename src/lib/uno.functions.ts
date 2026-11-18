import { createServerFn } from '@tanstack/react-start';
import { setResponseHeader } from '@tanstack/react-start/server';
import { z } from 'zod';
import { defaultRules, freshGame, move, playerView, type Game } from './uno-engine';

const rulesSchema = z.object({ cards: z.union([z.literal(7), z.literal(10), z.literal(15)]), multi: z.boolean(), stacking: z.enum(['house', 'same', 'off']), drawUntil: z.boolean(), challenges: z.boolean() });
const requestSchema = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/), code: z.string().regex(/^[A-Z0-9]{6}$/).optional(), name: z.string().trim().min(1).max(20).optional(), rules: rulesSchema.optional(), action: z.object({ type: z.enum(['create', 'join', 'view', 'start', 'play', 'draw', 'pass', 'uno', 'catch', 'challenge', 'rematch']), cards: z.array(z.string().max(40)).max(15).optional(), color: z.enum(['red', 'yellow', 'green', 'blue']).optional(), version: z.number().int().nonnegative().optional() }) });
export const gameRequest = createServerFn({ method: 'POST' }).inputValidator(requestSchema).handler(async ({ data }) => {
  setResponseHeader('Cache-Control', 'no-store');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data.token));
  const hash = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
  // These are guest-capability operations: the DB verifies the hashed secret before
  // privileged access. Browser roles have neither table access nor RPC execution.
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  try {
    const now = Date.now();
    if (data.action.type === 'create') {
      if (!data.name) return { ok: false as const, error: 'Enter a guest name.' };
      const { count, error: countError } = await supabaseAdmin.from('uno_rooms').select('code', { count: 'exact', head: true }).eq('host_hash', hash).gt('expires_at', new Date(now).toISOString());
      if (countError) throw countError;
      if ((count ?? 0) >= 12) return { ok: false as const, error: 'You have enough active rooms. Rejoin one or try tomorrow.' };
      const state = freshGame(data.name, data.rules ?? defaultRules, now);
      for (let attempt = 0; attempt < 5; attempt++) {
        const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        const code = Array.from(crypto.getRandomValues(new Uint8Array(6)), n => alphabet[n % 32]).join('');
        const { error } = await supabaseAdmin.from('uno_rooms').insert({ code, host_hash: hash, state: JSON.parse(JSON.stringify(state)) });
        if (!error) return { ok: true as const, view: playerView(state, 0, 0, code, now) };
        if (error.code !== '23505') throw error;
      }
      throw new Error('Could not create a room.');
    }
    if (!data.code) return { ok: false as const, error: 'Enter a six-character room code.' };
    const { data: raw, error } = await supabaseAdmin.rpc('uno_access', { p_code: data.code, p_hash: hash, ...(data.action.type === 'join' && data.name ? { p_name: data.name } : {}) });
    if (error) return { ok: false as const, error: 'Room expired, full, or your guest key is not valid. Check the invite.' };
    const loaded = raw as unknown as { state: Game; version: number; seat: number };
    const action = data.action.type === 'join' ? { type: 'view' as const } : { ...data.action, type: data.action.type as Exclude<typeof data.action.type, 'create' | 'join'> };
    if (action.type !== 'view' && data.action.version !== loaded.version) return { ok: false as const, error: 'The table changed. Try your move again.', view: playerView(loaded.state, loaded.seat, loaded.version, data.code, now) };
    let next: Game;
    try { next = move(loaded.state, loaded.seat, action, now); } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : 'That move is not allowed.' }; }
    // Views persist a heartbeat only every four seconds. Moves use compare-and-swap;
    // a losing concurrent request cannot overwrite a turn, challenge or UNO catch.
    if (action.type === 'view' && now - (loaded.state.players[loaded.seat]?.seen ?? 0) < 4000) return { ok: true as const, view: playerView(loaded.state, loaded.seat, loaded.version, data.code, now) };
    const { data: committed, error: commitError } = await supabaseAdmin.rpc('uno_commit', { p_code: data.code, p_hash: hash, p_version: loaded.version, p_state: JSON.parse(JSON.stringify(next)) });
    if (commitError) throw commitError;
    if (!committed) {
      const { data: fresh } = await supabaseAdmin.rpc('uno_access', { p_code: data.code, p_hash: hash });
      const latest = fresh as unknown as typeof loaded;
      return { ok: false as const, error: 'The table changed. Try your move again.', ...(latest ? { view: playerView(latest.state, latest.seat, latest.version, data.code, now) } : {}) };
    }
    return { ok: true as const, view: playerView(next, loaded.seat, loaded.version + 1, data.code, now) };
  } catch (e) {
    console.error('UNO service failure', e instanceof Error ? e.message : 'Database request failed');
    return { ok: false as const, error: 'The table could not connect. Please try again.' };
  }
});