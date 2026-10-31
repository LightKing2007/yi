/** 官网文书清单与草案正文：在构建时嵌入，不从运行目录读取，不作为生效的同意版本。 */
import privacy from './legal/privacy-policy.md?raw';
import terms from './legal/terms-of-service.md?raw';
import minors from './legal/minors-privacy-rules.md?raw';

/** 文书公共显示信息：目录、页脚与正文页复用；不作为认证系统的生效或同意版本配置。 */
export const AGREEMENT_INFO = {
  title: '隐私政策与服务条款',
  version: '0.1',
  updated: '2026-10-31',
  operator: '个人开发者王耀（LightKing）',
  status: '草案',
  statusNote: '尚未生效',
  introduction: '有关个人信息、服务使用与未成年人保护的文书，汇集于此。',
  notice:
    '本页为待完善草案，尚未生效。邮箱账号、账号注销、实名验证、防沉迷和监护人同意等功能尚未开放；' +
    '涉及这些功能的条款描述拟定规则，不表示相应入口已经可用。本页不作为现行联机的同意依据，浏览不会记录同意。',
};

/** 一份文书的公开名称、固定地址、目录编号与内嵌正文。 */
export interface AgreementDocument {
  slug: string;
  name: string;
  number: string;
  summary: string;
  content: string;
}

/** 中文标题与英文地址分离；只开放此清单中的文书。 */
export const AGREEMENT_DOCUMENTS: readonly AgreementDocument[] = [
  { slug: 'privacy-policy', name: '隐私政策', number: '壹', summary: '关于个人信息的处理与保护。', content: privacy },
  { slug: 'terms-of-service', name: '用户服务条款', number: '贰', summary: '关于游戏服务与使用约定。', content: terms },
  { slug: 'minors-privacy-rules', name: '未成年人个人信息保护规则', number: '叁', summary: '关于未成年人个人信息的特别保护。', content: minors },
];
