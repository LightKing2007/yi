/** 电脑在后台线程思考，界面照常流动 */
import { goThink, type GoSnap } from '../core/goAI';
import { gomokuMove, type GomokuSnap } from '../core/gomokuAI';

export type AiRequest = { id: number; kind: 'gomoku'; snap: GomokuSnap; level: number } | { id: number; kind: 'go'; snap: GoSnap; level: number };
export interface AiReply { id: number; x: number; y: number }

self.onmessage = (e: MessageEvent<AiRequest>) => {
  const r = e.data;
  const m = r.kind === 'go' ? goThink(r.snap, r.level) : gomokuMove(r.snap, r.level) ?? { x: -1, y: -1 };
  (self as unknown as Worker).postMessage({ id: r.id, x: m.x, y: m.y } satisfies AiReply);
};
