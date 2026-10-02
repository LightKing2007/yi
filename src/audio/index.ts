/** 声音的对外接口：音效与背景音乐（合成器在 sfx.ts / music.ts） */
export type SfxId = 'clack' | 'rewind' | 'bowl' | 'win' | 'goend' | 'tick';

type Impl = {
  play(id: SfxId, vol?: number, rate?: number, pan?: number): void;
  clack(strength: number): void;
  duck(): void;
};

let impl: Impl = { play() {}, clack() {}, duck() {} };

export function setAudioImpl(i: Impl) {
  impl = i;
}

export const sfx = {
  play: (id: SfxId, vol = 1, rate = 1, pan = 0) => impl.play(id, vol, rate, pan),
  clack: (strength: number) => impl.clack(strength),
  /** 终局音效响起时把背景音乐压低一会儿 */
  duck: () => impl.duck(),
};
