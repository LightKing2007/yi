/** 启动、画面与声音类帮助文章，保持目录中的显示顺序。 */
import blackScreenWebgl from '../support/black-screen-webgl.md?raw';
import interfaceSize from '../support/interface-size.md?raw';
import chineseGlyphs from '../support/chinese-glyphs.md?raw';
import noAudio from '../support/no-audio.md?raw';
import animationMotion from '../support/animation-motion.md?raw';

/** 启动、画面与声音类 Markdown 源文件及问题地址。 */
export const SOURCES: readonly (readonly [string, string])[] = [
  ['black-screen-webgl', blackScreenWebgl],
  ['interface-size', interfaceSize],
  ['chinese-glyphs', chineseGlyphs],
  ['no-audio', noAudio],
  ['animation-motion', animationMotion],
];
