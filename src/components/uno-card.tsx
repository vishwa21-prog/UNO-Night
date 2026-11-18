import { Button } from '@/components/ui/button';
import type { Card } from '@/lib/uno-engine';
const symbols: Record<string, string> = { skip: '⊘', reverse: '⇄', wild: '✦' };
export function UnoCard({ card, back = false, selected = false, order, onClick, disabled = false, stack = false }: { card?: Card | undefined; back?: boolean; selected?: boolean; order?: number | undefined; onClick?: (() => void) | undefined; disabled?: boolean; stack?: boolean }) {
  const value = back ? 'UNO' : symbols[card?.value ?? ''] ?? card?.value ?? '✦';
  const contents = <>{!back && <span className="card-corner">{value}</span>}<span className="card-center">{value}</span>{!back && <span className="card-corner bottom">{value}</span>}{order && <span className="order-tag">{order}</span>}</>;
  const className = `playing-card ${back ? 'back' : card?.color ?? 'wild'} ${selected ? 'selected' : ''} ${stack ? 'draw-stack' : ''}`;
  return onClick ? <Button variant="ghost" disabled={disabled} className={className} onClick={onClick} aria-pressed={selected} aria-label={back ? 'Draw card' : `${card?.color} ${card?.value}${order ? `, selected ${order}` : ''}`}>{contents}</Button> : <div className={className} aria-label={back ? 'Face-down card' : `${card?.color} ${card?.value}`}>{contents}</div>;
}