export type Color = 'red' | 'yellow' | 'green' | 'blue';
export type Card = { id: string; color: Color | 'wild'; value: string };
export type Rules = { cards: 7 | 10 | 15; multi: boolean; stacking: 'house' | 'same' | 'off'; drawUntil: boolean; challenges: boolean };
export const defaultRules: Rules = { cards: 7, multi: true, stacking: 'house', drawUntil: true, challenges: true };
export type Player = { name: string; hand: Card[]; seen: number };
export type Game = {
  status: 'waiting' | 'playing' | 'finished'; players: Player[]; rules: Rules;
  deck: Card[]; discard: Card[]; color: Color; turn: number; penalty: number;
  challenge: { offender: number; illegal: boolean; previousPenalty: number } | null;
  uno: { player: number; until: number } | null; drawn: string | null;
  winner: number | null; pendingWinner: number | null; round: number; history: string[];
};
export type Action = { type: 'view' | 'start' | 'play' | 'draw' | 'pass' | 'uno' | 'catch' | 'challenge' | 'rematch'; cards?: string[] | undefined; color?: Color | undefined; version?: number | undefined };
export function freshGame(name: string, rules: Rules, now: number): Game {
  return { status: 'waiting', players: [{ name, hand: [], seen: now }], rules, deck: [], discard: [], color: 'red', turn: 0, penalty: 0, challenge: null, uno: null, drawn: null, winner: null, pendingWinner: null, round: 0, history: ['Room created. The table is yours.'] };
}
export function makeDeck(): Card[] {
  const deck: Card[] = [];
  for (const color of ['red', 'yellow', 'green', 'blue'] as Color[]) {
    for (let number = 0; number <= 9; number++) for (let copy = 0; copy < (number === 0 ? 1 : 2); copy++) deck.push({ id: `${color}-${number}-${copy}`, color, value: String(number) });
    for (const value of ['skip', 'reverse', '+2']) for (let copy = 0; copy < 2; copy++) deck.push({ id: `${color}-${value}-${copy}`, color, value });
  }
  for (const value of ['wild', '+4']) for (let copy = 0; copy < 4; copy++) deck.push({ id: `wild-${value}-${copy}`, color: 'wild', value });
  return deck;
}
// Web Crypto rejection sampling avoids biased shuffles and works on Workers.
export function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const range = i + 1, limit = Math.floor(4294967296 / range) * range;
    let n: number;
    do { n = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0; } while (n >= limit);
    const j = n % range; const a = result[i], b = result[j];
    if (a !== undefined && b !== undefined) { result[i] = b; result[j] = a; }
  }
  return result;
}
function record(g: Game, text: string) { g.history = [...g.history.slice(-29), text]; }
function take(g: Game, seat: number, count: number) {
  const player = g.players[seat]; if (!player) throw new Error('Player missing');
  const cards: Card[] = [];
  for (let n = 0; n < count; n++) {
    if (!g.deck.length && g.discard.length > 1) {
      const top = g.discard.at(-1); if (!top) break;
      g.deck = shuffle(g.discard.slice(0, -1)); g.discard = [top];
      record(g, 'Discard pile reshuffled.');
    }
    const card = g.deck.pop(); if (!card) break;
    player.hand.push(card); cards.push(card);
  }
  if (player.hand.length !== 1 && g.uno?.player === seat) g.uno = null;
  return cards;
}
export function playable(g: Pick<Game, 'discard' | 'color' | 'penalty' | 'rules'>, card: Card): boolean {
  const top = g.discard.at(-1);
  if (!top) return false;
  if (g.penalty) return g.rules.stacking !== 'off' && ['+2', '+4'].includes(card.value) && (g.rules.stacking === 'house' || card.value === top.value);
  return card.color === 'wild' || card.color === g.color || card.value === top.value;
}
function finish(g: Game, winner: number) { g.status = 'finished'; g.winner = winner; g.pendingWinner = null; g.uno = null; record(g, `${g.players[winner]?.name} wins round ${g.round}!`); }
export function move(original: Game, seat: number, action: Action, now: number): Game {
  const g: Game = structuredClone(original);
  const player = g.players[seat]; if (!player) throw new Error('Player missing');
  if (action.type === 'view') { player.seen = now; return g; }
  if (action.type === 'start' || action.type === 'rematch') {
    if (seat !== 0) throw new Error('Only the room creator can deal.');
    if (g.players.length !== 2) throw new Error('Wait for your friend to join.');
    if ((action.type === 'start' && g.status !== 'waiting') || (action.type === 'rematch' && g.status !== 'finished')) throw new Error('This round is already in progress.');
    g.deck = shuffle(makeDeck()); g.discard = []; g.penalty = 0; g.challenge = null; g.uno = null; g.drawn = null; g.winner = null; g.pendingWinner = null; g.round++; g.status = 'playing';
    for (const p of g.players) p.hand = [];
    for (let i = 0; i < g.rules.cards; i++) { take(g, 0, 1); take(g, 1, 1); }
    let first = g.deck.pop();
    while (first?.color === 'wild') { g.deck.unshift(first); first = g.deck.pop(); }
    if (!first) throw new Error('Could not deal.');
    g.discard = [first]; g.color = first.color; g.turn = g.round % 2;
    if (first.value === 'skip' || first.value === 'reverse') g.turn = 1 - g.turn;
    if (first.value === '+2') g.penalty = 2;
    g.history = [`Round ${g.round}: ${g.rules.cards} cards each.`, `Opening card: ${first.color} ${first.value}. ${g.players[g.turn]?.name} goes first.`];
    return g;
  }
  if (g.status !== 'playing') throw new Error('No active round.');
  if (action.type === 'uno') {
    if (player.hand.length !== 1) throw new Error('Shout UNO when you have one card.');
    if (g.uno?.player === seat) g.uno = null;
    record(g, `${player.name} shouts UNO!`); return g;
  }
  if (action.type === 'catch') {
    if (!g.uno || g.uno.player === seat || now > g.uno.until) throw new Error('No missed UNO to catch.');
    const caught = g.uno.player; take(g, caught, 2); g.uno = null;
    record(g, `${player.name} catches ${g.players[caught]?.name}: draw 2!`); return g;
  }
  if (g.turn !== seat) throw new Error('It is not your turn.');
  if (action.type === 'challenge') {
    if (!g.challenge || !g.rules.challenges) throw new Error('There is no +4 to challenge.');
    const c = g.challenge; g.challenge = null; g.uno = null; g.drawn = null;
    if (c.illegal) {
      take(g, c.offender, 4); g.penalty = c.previousPenalty; g.pendingWinner = null;
      record(g, `${player.name} wins the challenge! ${g.players[c.offender]?.name} draws 4. ${g.penalty ? `${g.penalty} earlier penalty remains.` : 'Keep your turn.'}`);
    } else {
      const amount = g.penalty + 2; take(g, seat, amount); g.penalty = 0; g.turn = 1 - seat;
      record(g, `${player.name}'s challenge fails: draw ${amount} and lose the turn.`);
      if (g.pendingWinner !== null) finish(g, g.pendingWinner);
    }
    return g;
  }
  if (action.type === 'draw') {
    if (g.drawn) throw new Error('Play your drawn card or pass.');
    g.uno = null;
    if (g.penalty) {
      const amount = g.penalty; take(g, seat, amount); g.penalty = 0; g.challenge = null; g.turn = 1 - seat;
      record(g, `${player.name} accepts the penalty and draws ${amount}.`);
      if (g.pendingWinner !== null) finish(g, g.pendingWinner);
      return g;
    }
    let count = 0; let last: Card | undefined;
    do { last = take(g, seat, 1)[0]; if (!last) break; count++; } while (g.rules.drawUntil && !playable(g, last));
    if (last && playable(g, last)) g.drawn = last.id; else g.turn = 1 - seat;
    record(g, `${player.name} draws ${count} ${count === 1 ? 'card' : 'cards'}${g.drawn ? '.' : ' and passes.'}`);
    return g;
  }
  if (action.type === 'pass') {
    if (!g.drawn) throw new Error('Draw before passing.');
    g.drawn = null; g.turn = 1 - seat; g.uno = null; record(g, `${player.name} passes.`); return g;
  }
  if (action.type !== 'play') throw new Error('Unknown action.');
  const ids = action.cards ?? [];
  if (!ids.length || new Set(ids).size !== ids.length) throw new Error('Choose distinct cards to play.');
  const cards = ids.map(id => { const c = player.hand.find(item => item.id === id); if (!c) throw new Error('That card is not in your hand.'); return c; });
  const first = cards[0], last = cards.at(-1); if (!first || !last) throw new Error('Choose a card.');
  if (g.drawn && (cards.length !== 1 || first.id !== g.drawn)) throw new Error('Only the card you just drew can be played.');
  if (cards.length > 1 && (!g.rules.multi || !/^\d$/.test(first.value) || cards.some(c => c.value !== first.value))) throw new Error('Multiple cards must have the same number.');
  if (!playable(g, first)) throw new Error(g.penalty ? 'Stack a draw card or accept the penalty.' : 'Match the current color or symbol, or play a Wild.');
  if (last.color === 'wild' && !action.color) throw new Error('Choose a color for your Wild.');
  // Snapshot legality BEFORE removing the +4, based on the active color, never the selected next color.
  const illegal = first.value === '+4' && player.hand.some(c => c.color === g.color);
  const previousPenalty = g.penalty;
  if (g.pendingWinner !== null) { finish(g, g.pendingWinner); return g; } // Stacking accepts a final +4 rather than challenging it.
  g.uno = null; g.challenge = null; g.drawn = null;
  player.hand = player.hand.filter(c => !ids.includes(c.id));
  g.discard.push(...cards); g.color = last.color === 'wild' ? action.color ?? 'red' : last.color;
  g.turn = 1 - seat;
  if (last.value === 'skip' || last.value === 'reverse') g.turn = seat;
  if (last.value === '+2' || last.value === '+4') g.penalty += last.value === '+2' ? 2 : 4;
  if (last.value === '+4' && g.rules.challenges) g.challenge = { offender: seat, illegal, previousPenalty };
  if (player.hand.length === 1) g.uno = { player: seat, until: now + 5000 };
  record(g, `${player.name} plays ${cards.map(c => `${c.color === 'wild' ? '' : c.color + ' '}${c.value}`).join(' → ')}${last.color === 'wild' ? ` → ${g.color}` : ''}${last.value === 'skip' || last.value === 'reverse' ? '. Play again!' : '.'}`);
  if (!player.hand.length) { if (g.challenge) g.pendingWinner = seat; else finish(g, seat); }
  return g;
}
export type View = Omit<Game, 'deck' | 'players' | 'challenge'> & { players: { name: string; count: number; online: boolean }[]; hand: Card[]; challenge: boolean; seat: number; version: number; code: string; deckCount: number };
export function playerView(g: Game, seat: number, version: number, code: string, now: number): View {
  const { deck, players, challenge, ...safe } = g;
  return { ...safe, discard: g.discard.slice(-1), players: players.map(p => ({ name: p.name, count: p.hand.length, online: now - p.seen < 12000 })), hand: players[seat]?.hand ?? [], challenge: !!challenge, seat, version, code, deckCount: deck.length };
}