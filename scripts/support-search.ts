/** 静态帮助目录的渐进增强检索；文章与查询规则继续复用 supportContent。 */
import { normalizeSupportQuery, searchSupport } from '../server/supportContent';

const form = document.querySelector<HTMLFormElement>('form.support-search');
const input = document.querySelector<HTMLInputElement>('#support-query');
const entries = Array.from(document.querySelectorAll<HTMLElement>('[data-support-entry]'));
const groups = Array.from(document.querySelectorAll<HTMLElement>('[data-support-group]'));
const empty = document.querySelector<HTMLElement>('#support-empty');
const label = document.querySelector<HTMLElement>('#support-result-label');
const caption = document.querySelector<HTMLElement>('#support-caption');
const clear = document.querySelector<HTMLAnchorElement>('#support-clear');
const count = document.querySelector<HTMLElement>('#support-result-count');

if (form && input && empty && label && caption && clear && count) {
  const render = (query: string) => {
    const normalized = normalizeSupportQuery(query);
    const matches = new Set(searchSupport(normalized).map(article => article.slug));
    input.value = normalized;
    for (const entry of entries) entry.hidden = !matches.has(entry.dataset.supportEntry ?? '');
    for (const group of groups) {
      group.hidden = !Array.from(group.querySelectorAll<HTMLElement>('[data-support-entry]')).some(entry => !entry.hidden);
    }
    empty.hidden = matches.size > 0;
    label.textContent = normalized ? `“${normalized}”的搜索结果` : '全部问题';
    caption.textContent = normalized ? '检索' : '目录';
    clear.hidden = !normalized;
    count.hidden = Boolean(normalized);
  };
  const currentQuery = () => new URL(window.location.href).searchParams.get('q') ?? '';
  form.addEventListener('submit', event => {
    event.preventDefault();
    const query = normalizeSupportQuery(input.value);
    window.history.pushState(null, '', query ? `/support?q=${encodeURIComponent(query)}` : '/support');
    render(query);
  });
  clear.addEventListener('click', event => {
    event.preventDefault();
    window.history.pushState(null, '', '/support');
    render('');
    input.focus();
  });
  window.addEventListener('popstate', () => render(currentQuery()));
  render(currentQuery());
}
