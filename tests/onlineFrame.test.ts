/** 联机每帧的检查（src/online/frame.ts）：页面在后台时 requestAnimationFrame 会停下，另由定时器驱动重连、心跳与各种时限 */
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('后台定时器', () => {
  it('加载时登记每 250 毫秒一次的定时器；定时器到点即按注入的时钟做一次每帧的检查', async () => {
    vi.resetModules();
    const timers: { run: () => void; ms: number }[] = [];
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((run: () => void, ms?: number) => {
      timers.push({ run, ms: ms ?? 0 });
      return 0;
    }) as typeof setInterval);
    const clock = await import('../src/core/clock');
    const { Phase, st } = await import('../src/online/state');
    await import('../src/online/frame');
    const tick = timers.find(timer => timer.ms === 250);
    expect(tick).toBeDefined();
    // 重连后在 resumeBy 之前没收到原来的对局：到点的检查应当放弃这一局、回到大厅
    clock.setClock(() => 100);
    st.phase = Phase.Playing;
    st.resumeBy = 50;
    tick?.run();
    clock.setClock(null);
    expect([st.resumeBy, st.phase]).toEqual([0, Phase.Lobby]);
  });
});
