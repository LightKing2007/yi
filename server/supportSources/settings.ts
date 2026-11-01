/** 设置、数据、反馈与隐私类帮助文章，保持目录中的显示顺序。 */
import saveSettings from '../support/save-settings.md?raw';
import updateData from '../support/update-data.md?raw';
import offlinePlay from '../support/offline-play.md?raw';
import errorLogs from '../support/error-logs.md?raw';
import reportIssue from '../support/report-issue.md?raw';
import securityVulnerability from '../support/security-vulnerability.md?raw';
import onlinePrivacy from '../support/online-privacy.md?raw';

/** 设置、数据、反馈与隐私类 Markdown 源文件及问题地址。 */
export const SOURCES: readonly (readonly [string, string])[] = [
  ['save-settings', saveSettings],
  ['update-data', updateData],
  ['offline-play', offlinePlay],
  ['error-logs', errorLogs],
  ['report-issue', reportIssue],
  ['security-vulnerability', securityVulnerability],
  ['online-privacy', onlinePrivacy],
];
