/**
 * 网站设计 token 的单一来源：色彩、字体、字号、间距、圆角、布局与动效。
 * 所有页面与组件只允许使用这里的变量，不得在页面样式里另写颜色、字号或间距的"野生数值"。
 * 新增 token 属于向后兼容；修改既有 token 的数值即视觉变更，须按 docs/standards/11-website-frontend.md 的评审流程执行。
 * 资源地址的版本参数统一写作 {version} 占位符，由 siteStyle() 替换。
 */

/** 色彩：墨（ink）与贝（shell）为两条底色主线；榧木（kaya）只用于棋盘与少量强调；印章（seal）只用于印章、选区与禁手点 */
export const colors = {
  ink: '#0b0a09',
  ink2: '#151310',
  shell: '#f3efe7',
  shell2: '#e8e2d6',
  kaya: '#d6a964',
  kaya2: '#b58443',
  seal: '#b23a2c',
  sealInk: '#fbefe6',
  inkFg: '#ece7dd',
  inkDim: '#a39b8e',
  inkFaint: '#8a8276',
  shellFg: '#141210',
  shellDim: '#5f584e',
  shellFaint: '#696155',
} as const;

/** 字体：标题用宋体（Yi Serif 为思源宋体子集），正文用系统黑体，数字与代码用等宽 */
export const fonts = {
  serif: '"Yi Serif", "Songti SC", "STSong", "Noto Serif CJK SC", "Source Han Serif SC", serif',
  sans: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", system-ui, sans-serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
} as const;

/**
 * 字号阶梯：正文与标题一律用 clamp 流式字号，不设断点突变。
 * 字重只有两档：标题 900、正文 400/500；不得引入第三档字重。
 */
export const type = {
  hero: 'clamp(48px, 8vw, 112px)', // 首屏标题
  h2: 'clamp(36px, 5.4vw, 80px)', // 章节标题
  h3: 'clamp(22px, 2vw, 28px)', // 卡片与小节标题
  lead: 'clamp(16px, 1.3vw, 18px)', // 章节导语
  body: '16px',
  small: '14px',
  caption: '13px',
} as const;

/** 行高：标题紧凑、正文舒展；文言与英文排版共用同一阶梯（多语言见规范第 5 章） */
export const leading = { title: 1.12, h3: 1.3, body: 1.75, label: 1.4 } as const;

/** 字距：中文宽字距用于栏目标签与导航；标题不额外加字距 */
export const tracking = { label: '0.42em', nav: '0.24em', btn: '0.08em', motto: '0.3em' } as const;

/** 间距阶梯：组件内部与组件之间只允许取阶梯上的值；gut 为页面左右安全边距 */
export const space = {
  gut: 'clamp(20px, 5vw, 72px)',
  max: '1280px',
  edge: 'max(var(--gut), (100vw - var(--max)) / 2)',
} as const;

/** 圆角：按钮与棋子为全圆，印章为 5px，卡片 16px，小标签 8px */
export const radius = { pill: '999px', card: '16px', tag: '8px', seal: '5px' } as const;

/** 动效：两条缓动曲线全站通用；动画只以 CSS 实现，reduced-motion 时全部关闭（pageStyle.ts 统一处理） */
export const motion = {
  ease: 'cubic-bezier(0.22, 0.8, 0.2, 1)',
  easeIo: 'cubic-bezier(0.65, 0, 0.35, 1)',
  /** 落子回弹：仅用于按钮、徽章等小元素的悬停与磁性跟随回弹，不用于区块转场 */
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
} as const;

/** 层级：内容 < 装饰 < 顶栏 < 跳转链接 */
export const zIndex = { content: 0, decor: 10, bar: 50, skip: 100 } as const;

/** 棋子渐变：编号、图例与落子预览共用，不带纹理 */
export const stones = {
  black: 'radial-gradient(circle at 34% 30%, #6a6a6a 0, #1a1a1a 55%, #000 100%)',
  white: 'radial-gradient(circle at 35% 30%, #fff 0, #eee8dc 50%, #cfc5b3 100%)',
} as const;

/** 输出 :root 的 CSS 变量定义；--overlap 与 --title 等页面级资源变量仍由 pageStyle.ts 持有 */
export function rootVars(): string {
  return `
  --ink: ${colors.ink}; --ink-2: ${colors.ink2}; --shell: ${colors.shell}; --shell-2: ${colors.shell2};
  --kaya: ${colors.kaya}; --kaya-2: ${colors.kaya2}; --seal: ${colors.seal}; --seal-ink: ${colors.sealInk};
  --ink-fg: ${colors.inkFg}; --ink-dim: ${colors.inkDim}; --ink-faint: ${colors.inkFaint};
  --shell-fg: ${colors.shellFg}; --shell-dim: ${colors.shellDim}; --shell-faint: ${colors.shellFaint};
  --serif: ${fonts.serif};
  --sans: ${fonts.sans};
  --mono: ${fonts.mono};
  --ease: ${motion.ease}; --ease-io: ${motion.easeIo}; --ease-spring: ${motion.spring};
  --type-hero: ${type.hero}; --type-h2: ${type.h2}; --type-h3: ${type.h3}; --type-lead: ${type.lead};
  --type-body: ${type.body}; --type-small: ${type.small}; --type-caption: ${type.caption};
  --leading-title: ${leading.title}; --leading-h3: ${leading.h3}; --leading-body: ${leading.body};
  --tracking-label: ${tracking.label}; --tracking-nav: ${tracking.nav}; --tracking-btn: ${tracking.btn}; --tracking-motto: ${tracking.motto};
  --gut: ${space.gut}; --max: ${space.max}; --edge: ${space.edge};
  --radius-pill: ${radius.pill}; --radius-card: ${radius.card}; --radius-tag: ${radius.tag}; --radius-seal: ${radius.seal};
  --z-bar: ${zIndex.bar}; --z-skip: ${zIndex.skip};
  --stone-b: ${stones.black};
  --stone-w: ${stones.white};`;
}
