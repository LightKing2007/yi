/** 界面控件：按钮、分段选择（带回弹的滑块）、滑条、输入框与密码框、六格验证码、复选框、提示条、棋子小图标、按设计字号排版的文字 */
import { signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { logWarn } from '../app/native';
import { sfx } from '../audio';
import { T, TF } from '../i18n';
import { backspaceCells, fillCells, type CellsEdit } from './codeCells';

/** 开发模式下已报告过的文字：同一处只报告一次 */
const reported = new Set<string>();
/** 等字体加载完、入场动画结束后再量，免得把后备字体或动画中的宽度当成放不下 */
const SETTLE_MS = 500;
/** 宽高按整数像素取值，留出半个像素的舍入误差 */
const ROUNDING_PX = 0.5;

/** 开发模式：文字放不下时报告（开发时日志接口打印到控制台）。单行看宽度；两行看高度（超出两行时被截断） */
function reportOverflow(el: HTMLElement, lines: number) {
  const text = el.textContent ?? '';
  const over = lines === 1 ? el.scrollWidth > el.clientWidth + ROUNDING_PX : el.scrollHeight > el.clientHeight + ROUNDING_PX;
  if (!over || reported.has(text)) return;
  reported.add(text);
  logWarn('fit', `放不下：${text}`);
}

/**
 * 按设计字号排版的文字（I18N-022）：严禁缩小字号。lines 为 1 时只占一行（按钮、选项、标题、标签），为 2 时至多两行（说明性文字）。
 * 放不下时截断补“…”只是兜底；开发模式下经日志接口报告“[fit] 放不下”，画面检查据此发现需要改写译文或调整布局的地方（I18N-020）
 */
export function Fit({ children, size, lines = 1, class: cls = '' }: { children: ComponentChildren; size: number; lines?: 1 | 2; class?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const checked = useRef<string | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!import.meta.env.DEV || !el || checked.current === el.textContent) return;
    checked.current = el.textContent; // 面板每帧都会重绘，文字变了才重新检查
    // 只是开发时的报告，失败了也不影响界面，所以不等待
    void document.fonts.ready.then(() => setTimeout(() => reportOverflow(el, lines), SETTLE_MS));
  });
  return (
    <span ref={ref} class={'fit ' + (lines === 2 ? 'two ' : '') + cls} style={{ fontSize: size + 'px' }}>
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
            <Fit size={fontSize}>{it}</Fit>
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

/** 输入框。onEnter 给出时按回车调用它（提交表单），否则回车与 Esc 都只是让输入框失去焦点 */
export function Field({
  value,
  onInput,
  placeholder,
  maxLength = 20,
  type = 'text',
  autoComplete = 'off',
  label,
  onEnter,
  trailing,
}: {
  value: string;
  onInput: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
  type?: 'text' | 'email' | 'password';
  autoComplete?: string;
  /** 读屏软件读出的名称（输入框上方另有可见的标签时与之相同） */
  label?: string;
  onEnter?: () => void;
  /** 输入框右端的小按钮（如“显示”密码） */
  trailing?: ComponentChildren;
}) {
  const input = (
    <input
      class="field"
      type={type as 'text'} // preact 的无障碍类型按 type 区分可用的属性，三种取值的属性在此相同
      value={value}
      placeholder={placeholder}
      maxLength={maxLength}
      spellcheck={false}
      autoComplete={autoComplete}
      aria-label={label}
      onInput={e => onInput((e.target as HTMLInputElement).value)}
      onKeyDown={e => {
        if (e.key === 'Enter' && onEnter) onEnter();
        else if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur();
        e.stopPropagation();
      }}
    />
  );
  return trailing ? (
    <div class="field-wrap">
      {input}
      {trailing}
    </div>
  ) : (
    input
  );
}

/** 输入框上方的标签 */
export const FieldLabel = ({ text }: { text: string }) => (
  <div class="field-label">
    <Fit size={14}>{text}</Fit>
  </div>
);

/** 密码输入框：右端的“显示”切换明文 */
export function PasswordField({
  value,
  onInput,
  placeholder,
  label,
  autoComplete,
  onEnter,
}: {
  value: string;
  onInput: (v: string) => void;
  placeholder?: string;
  label: string;
  autoComplete: 'current-password' | 'new-password';
  onEnter?: () => void;
}) {
  const [shown, setShown] = useState(false);
  const toggle = (
    <button type="button" class="field-toggle" aria-pressed={shown} onClick={() => setShown(was => !was)}>
      <Fit size={12.5}>{T(shown ? '隐藏' : '显示')}</Fit>
    </button>
  );
  return (
    <Field
      value={value}
      onInput={onInput}
      placeholder={placeholder}
      maxLength={PASSWORD_INPUT_MAX}
      type={shown ? 'text' : 'password'}
      autoComplete={autoComplete}
      label={label}
      onEnter={onEnter}
      trailing={toggle}
    />
  );
}
/** 密码输入框的码元上限：服务端按 UTF-8 不超过 1024 字节，这里只防粘贴进过长的内容 */
const PASSWORD_INPUT_MAX = 256;

/**
 * 六格验证码（项目所有者 2026-11-01 定稿）：规则见 codeCells.ts。值为各格数字连起来的字符串，未填的格为空；
 * 填满时调用 onComplete（如自动进入下一步）
 */
export function CodeCells({ value, onChange, onComplete }: { value: string; onChange: (code: string) => void; onComplete?: (code: string) => void }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const cells = Array.from({ length: CODE_CELLS }, (_, i) => (value[i] ?? '').trim()); // 未填的格在值中以空格占位
  const apply = (edit: CellsEdit) => {
    const code = edit.cells
      .map(cell => cell || ' ')
      .join('')
      .trimEnd();
    onChange(code);
    const el = refs.current[edit.focus];
    el?.focus();
    el?.select();
    if (/^\d+$/.test(code) && code.length === CODE_CELLS) onComplete?.(code);
  };
  return (
    <div class="cells" role="group" aria-label={T('验证码')}>
      {cells.map((cell, i) => (
        <input
          key={i}
          ref={el => {
            refs.current[i] = el;
          }}
          class="cell"
          value={cell}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={TF('第 %d 位，共 %d 位', i + 1, CODE_CELLS)}
          onFocus={event => (event.target as HTMLInputElement).select()}
          onPaste={event => {
            event.preventDefault();
            apply(fillCells(cells, i, event.clipboardData?.getData('text') ?? ''));
          }}
          onInput={event => {
            const ev = event as InputEvent,
              el = event.target as HTMLInputElement;
            // 逐键输入时以新键入的一位覆盖本格；自动填充等一次插入多位时从本格起依次分配
            const typed = ev.inputType === 'insertText' && ev.data?.length === 1 ? ev.data : el.value;
            el.value = cell; // 先还原，结果由 apply 统一写回
            apply(fillCells(cells, i, typed));
          }}
          onKeyDown={event => {
            event.stopPropagation();
            if (event.key === 'Backspace' || event.key === 'Delete') {
              event.preventDefault();
              apply(event.key === 'Delete' ? { cells: cells.map((other, j) => (j === i ? '' : other)), focus: i } : backspaceCells(cells, i));
            } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault();
              const to = refs.current[Math.max(0, Math.min(CODE_CELLS - 1, i + (event.key === 'ArrowLeft' ? -1 : 1)))];
              to?.focus();
            } else if (event.key === 'Escape') (event.target as HTMLInputElement).blur();
          }}
        />
      ))}
    </div>
  );
}
/** 验证码的位数 */
const CODE_CELLS = 6;

/** 复选框：label 中可以带链接（链接点击不切换勾选） */
export function Check({ checked, onChange, children }: { checked: boolean; onChange: (checked: boolean) => void; children: ComponentChildren }) {
  return (
    <label class="check">
      <input type="checkbox" checked={checked} onChange={event => onChange((event.target as HTMLInputElement).checked)} />
      <span class="box" aria-hidden="true" />
      <span class="check-text">{children}</span>
    </label>
  );
}

/** 面板底部的提示条（如“已复制到剪贴板”）：showToast 后出现，TOAST_MS 后淡出；连续调用时重新计时 */
const toastState = signal({ text: '', at: -Infinity });
/** 提示条停留的时长 */
const TOAST_MS = 1600;

/** 弹出提示条；text 为原文，显示时经 T() 换成当前语言 */
export function showToast(text: string) {
  toastState.value = { text, at: performance.now() };
}

/** 提示条本身，放在面板底部“返回”按钮之上 */
export function Toast() {
  const { text, at } = toastState.value;
  const [, force] = useState(0);
  const left = at + TOAST_MS - performance.now();
  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => force(count => count + 1), left);
    return () => clearTimeout(id);
  }, [at]);
  return (
    <div class={'toast' + (left > 0 ? ' show' : '')} role="status" aria-live="polite">
      {left > 0 && text ? T(text) : ''}
    </div>
  );
}
