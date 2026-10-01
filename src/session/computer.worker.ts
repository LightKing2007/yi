/** 电脑在后台线程思考，界面照常流动。要取消时主线程直接结束这个线程（见 seats.ts 的 ComputerSeat） */
import { think, type ThinkRequest } from './think';

self.onmessage = (e: MessageEvent<ThinkRequest>) => {
  (self as unknown as Worker).postMessage(think(e.data));
};
