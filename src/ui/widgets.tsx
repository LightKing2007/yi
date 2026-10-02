/** 界面控件：按钮、分段选择（带回弹的滑块）、滑条、输入框、棋子小图标、自动缩放的文字 */
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { sfx } from '../audio';

/** 放进容器宽度：先把字号缩到 min 为止，还放不下就截短补“…”（各语言同一按钮的文字长短差很多） */
export function Fit({ children, size, min = 11, class: cls = '' }: { children: ComponentChildren; size: number; min?: number; class?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let s = size;
    el.style.fontSize = s + 'px';
    while (s > min && el.scrollWidth > el.clientWidth + 0.5) {
      s -= 0.5;
      el.style.fontSize = s + 'px';
    }
  });
  return (
    <span ref={ref} class={'fit ' + cls} style={{ fontSize: size + 'px' }}>
      {children}
    </span>
  );
}

export function Button({
  label,
  onClick,
  primary = false,
  disabled = false,
  height = 40,
  style,
}: {
  label: string;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
  height?: number;
  style?: Record<string, string | number>;
}) {
  return (
    <button class={'btn' + (primary ? ' primary' : '')} disabled={disabled} style={{ height: height + 'px', ...style }} onClick={onClick}>
      <Fit size={15}>{label}</Fit>
    </button>
  );
}

export const Hair = ({ style }: { style?: Record<string, string | number> }) => <div class="hair" style={style} />;

export const StoneIcon = ({ color, small = false }: { color: number; small?: boolean }) => (
  <span class={`stone-icon ${color === 1 ? 'b' : 'w'}${small ? ' s' : ''}`} />
);

/** 分段选择：选中的白色滑块带一点回弹，移动时略微拉长，像一颗被拨过去的珠子；切换时有一声轻响 */
export function Seg({
  items,
  sel,
  onChange,
  height = 38,
  fontSize = 14,
}: {
  items: string[];
  sel: number;
  onChange: (i: number) => void;
  height?: number;
  fontSize?: number;
}) {
  const n = items.length;
  const st = useRef({ pos: sel, vel: 0, raf: 0, last: 0 });
  const [, force] = useState(0);
  useEffect(() => {
    const s = st.current;
    if (Math.abs(s.pos - sel) < 0.001 && Math.abs(s.vel) < 0.01) return;
    s.last = performance.now();
    const step = (t: number) => {
      const dt = Math.min((t - s.last) / 1000, 0.05);
      s.last = t;
      for (let k = 0; k < 2; k++) {
        // 两个半步，弹簧更稳
        const h = dt * 0.5;
        s.vel += (sel - s.pos) * 320 * h - s.vel * 27 * h;
        s.pos += s.vel * h;
      }
      if (Math.abs(s.pos - sel) < 0.001 && Math.abs(s.vel) < 0.01) {
        s.pos = sel;
        s.vel = 0;
        force(v => v + 1);
        return;
      }
      force(v => v + 1);
      s.raf = requestAnimationFrame(step);
    };
    cancelAnimationFrame(s.raf);
    s.raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(s.raf);
  }, [sel]);
  const { pos, vel } = st.current;
  const stretch = Math.min(Math.abs(vel) * 0.05, 0.35);
  const off = Math.min(Math.max(pos - stretch / 2, 0), n - 1 - stretch);
  return (
    <div class="seg" style={{ height: height + 'px' }}>
      <div class="knob" style={{ left: `calc(3px + (100% - 6px) * ${off / n})`, width: `calc((100% - 6px) * ${(1 + stretch) / n})` }} />
      {items.map((it, i) => {
        let w = Math.min(Math.max(1 - Math.abs(pos - i), 0), 1);
        w = w * w * (3 - 2 * w);
        return (
          <div
            key={i}
            class={'opt' + (i === sel ? ' on' : '')}
            style={{ color: `color-mix(in srgb, var(--text) ${Math.round(w * 100)}%, var(--dim))` }}
            onClick={() => {
              if (i !== sel) {
                sfx.play('tick', 0.55);
                onChange(i);
              }
            }}
          >
            <Fit size={fontSize} min={10}>
              {it}
            </Fit>
          </div>
        );
      })}
    </div>
  );
}

/** 横向滑条，值 0..1；onRelease 在松开时调用（音效音量松手试听） */
export function Slider({ value, onChange, onRelease }: { value: number; onChange: (v: number) => void; onRelease?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const setFrom = (e: PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    onChange(Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1));
  };
  return (
    <div
      class="slider"
      ref={ref}
      onPointerDown={e => {
        ref.current!.setPointerCapture(e.pointerId);
        setFrom(e);
      }}
      onPointerMove={e => {
        if (ref.current!.hasPointerCapture(e.pointerId)) setFrom(e);
      }}
      onPointerUp={e => {
        ref.current!.releasePointerCapture(e.pointerId);
        onRelease?.();
      }}
    >
      <div class="track" />
      <div class="fill" style={{ width: value * 100 + '%' }} />
      <div class="knob" style={{ left: value * 100 + '%' }} />
    </div>
  );
}

export function Field({
  value,
  onInput,
  placeholder,
  maxLength = 20,
}: {
  value: string;
  onInput: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
}) {
  return (
    <input
      class="field"
      value={value}
      placeholder={placeholder}
      maxLength={maxLength}
      spellcheck={false}
      onInput={e => onInput((e.target as HTMLInputElement).value)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur();
        e.stopPropagation();
      }}
    />
  );
}
