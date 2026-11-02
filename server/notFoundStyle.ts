/** 404 页面私有样式；终章与按钮使用共享样式，背景只引入几何库。 */
import { geometryStyle } from './geometry';
import { minify } from './pageStyle';

const STYLE = `
.not-found { min-height: 100svh; display: grid; align-items: center;
  padding: clamp(96px, 12vh, 144px) var(--gut) clamp(72px, 9vh, 108px); }
.not-found .finale-title { animation: none; }
.not-found .cta .btn { width: 180px; justify-content: center; }
.not-found .burst::before { animation: spin-plain 240s linear infinite; }
`;

export const notFoundStyle = () => minify(geometryStyle + STYLE);
