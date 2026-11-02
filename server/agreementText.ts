/** 官网文书清单与正文：在构建时嵌入，不从运行目录读取。认证系统要求同意的版本另由 YI_PRIVACY_VERSION、YI_TERMS_VERSION 配置，须与此处的版本一致。 */
import privacy from './legal/privacy-policy.md?raw';
import terms from './legal/terms-of-service.md?raw';
import minors from './legal/minors-privacy-rules.md?raw';

/** 文书公共显示信息：目录、页脚与正文页复用；不作为认证系统的生效或同意版本配置。 */
export const AGREEMENT_INFO = {
  title: '隐私政策与服务条款',
  version: '1.0',
  updated: '2026-11-02',
  operator: '个人开发者王耀（LightKing）',
  status: '正式版',
  statusNote: '自 2026 年 11 月 2 日起生效',
  introduction: '有关个人信息、服务使用与未成年人保护的文书，汇集于此。',
  notice: '注册账号与联机对战须阅读并同意《隐私政策》与《用户服务条款》；同意在客户端的注册页面作出，浏览本页不会记录同意。',
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
