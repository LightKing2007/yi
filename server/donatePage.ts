/** 支持作者：两行标题、真实运营成本与长期维护；收款渠道未配置时不展示付款按钮。 */
import { donateStyle } from './donateStyle';
import { shell } from './page';
import { btn, factTags, secHead } from './webUi';

/** 确认真实收款渠道后填入 https 地址；留空时只展示接入状态，不制造假捐赠入口。 */
export const DONATION_URL = '';
const PROJECT = 'https://github.com/LightKing2007/yi';
const HEART_ICON =
  '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z"/></svg>';

/** 仅用于页脚：爱心始终正立，沿各自的垂直轨道上浮；大小、景深、周期与相位不同。 */
const HEARTS = [
  '--x:2%;--size:34px;--y:18%;--duration:19s;--delay:-11s;--opacity:.2;--heart:#815057',
  '--x:7%;--size:52px;--y:-8%;--duration:27s;--delay:-22s;--opacity:.12;--heart:#9b6569',
  '--x:12%;--size:24px;--y:52%;--duration:16s;--delay:-5s;--opacity:.28;--heart:#a87376',
  '--x:17%;--size:38px;--y:4%;--duration:23s;--delay:-17s;--opacity:.16;--heart:#73464d',
  '--x:22%;--size:28px;--y:64%;--duration:18s;--delay:-13s;--opacity:.24;--heart:#966067',
  '--x:27%;--size:46px;--y:-12%;--duration:29s;--delay:-9s;--opacity:.11;--heart:#a36d71',
  '--x:32%;--size:22px;--y:38%;--duration:15s;--delay:-12s;--opacity:.3;--heart:#ae777a',
  '--x:37%;--size:60px;--y:8%;--duration:25s;--delay:-21s;--opacity:.1;--heart:#7e4c53',
  '--x:42%;--size:26px;--y:56%;--duration:17s;--delay:-3s;--opacity:.25;--heart:#986168',
  '--x:47%;--size:40px;--y:-6%;--duration:24s;--delay:-19s;--opacity:.14;--heart:#a46d72',
  '--x:52%;--size:32px;--y:28%;--duration:16s;--delay:-14s;--opacity:.27;--heart:#ad7679',
  '--x:57%;--size:54px;--y:2%;--duration:22s;--delay:-7s;--opacity:.12;--heart:#835159',
  '--x:62%;--size:20px;--y:68%;--duration:15s;--delay:-6s;--opacity:.3;--heart:#b27d80',
  '--x:67%;--size:44px;--y:42%;--duration:26s;--delay:-24s;--opacity:.14;--heart:#9c656b',
  '--x:72%;--size:28px;--y:10%;--duration:18s;--delay:-8s;--opacity:.24;--heart:#8c585f',
  '--x:77%;--size:50px;--y:-14%;--duration:30s;--delay:-20s;--opacity:.11;--heart:#a36d71',
  '--x:82%;--size:24px;--y:48%;--duration:16s;--delay:-4s;--opacity:.28;--heart:#ae777a',
  '--x:87%;--size:36px;--y:22%;--duration:21s;--delay:-15s;--opacity:.2;--heart:#815057',
  '--x:92%;--size:58px;--y:-4%;--duration:28s;--delay:-23s;--opacity:.1;--heart:#9b6569',
  '--x:96%;--size:22px;--y:62%;--duration:15s;--delay:-10s;--opacity:.3;--heart:#b27d80',
  '--x:14%;--size:18px;--y:26%;--duration:17s;--delay:-16s;--opacity:.24;--heart:#986168',
  '--x:79%;--size:20px;--y:72%;--duration:19s;--delay:-2s;--opacity:.26;--heart:#ad7679',
];

function heartOcean() {
  return `<div class="heart-ocean" aria-hidden="true">${HEARTS.map(style => `<i style="${style}"></i>`).join('')}</div>`;
}

function hero() {
  return `<section class="donate-hero ink" id="top"><div class="donate-hero-in"><div class="donate-copy">
<span class="label">支持作者 · 让喜欢长久一点</span><h1><span class="donate-title-line">一杯咖啡，</span><span class="donate-title-line">让这盘棋继续下去</span></h1>
<p class="donate-lead">弈是一款免费下载的个人项目。如果你喜欢它，并愿意支持服务器、域名和后续维护，可以请作者喝一杯咖啡。捐赠完全自愿；不捐赠也能继续使用全部功能。</p>
<div class="cta">${btn({ href: '#support', text: '了解捐赠说明', icon: HEART_ICON })}${btn({ href: PROJECT, text: '关注项目', ghost: true, external: true })}</div>
${factTags(['完全自愿', '不影响任何功能', '不附带特权'])}</div></div></section>`;
}

function purpose() {
  const costs = [
    ['01', '联机服务', '用于匹配、排位与好友房间的日常运行，包括落子同步、断线重连与棋局校验所需的服务器。'],
    ['02', '网站与下载', '用于域名、网站与下载服务，让安装、更新和帮助文档始终有可靠的入口。'],
    ['03', '时间与维护', '用于修复问题、适配系统、完善规则与体验，也包括版本构建和日常维护。'],
  ]
    .map(([number, title, text]) => `<article class="cost-card rv"><div class="cost-top"><span>${number}</span></div><h3>${title}</h3><p>${text}</p></article>`)
    .join('');
  return `<section class="donate-purpose shell reveal-circle" id="purpose">${secHead({
    index: 1,
    label: '支持的去向',
    title: '捐赠会用在哪里',
    lede: '弈目前由作者一人开发与维护。收到的支持主要用于以下实际用途。',
  })}<div class="cost-grid">${costs}</div><blockquote class="donate-quote rv">“一杯咖啡，<br>也是一次对长期维护的支持。”</blockquote></section>`;
}

function donationAction() {
  return DONATION_URL
    ? btn({ href: DONATION_URL, text: '请作者喝杯咖啡', icon: HEART_ICON, external: true })
    : '<span class="donate-pending">捐赠渠道接入中</span>';
}

function support() {
  const principles = [
    ['自愿', '不弹出催促，不设置捐赠墙；你可以根据自己的意愿与能力决定是否支持。'],
    ['同权', '无论是否捐赠，棋规、功能、段位与联机机会都不会有所不同。'],
    ['用途', '支持主要用于服务器、域名、网站下载与后续维护，不兑换游戏内物品或虚拟权益。'],
  ]
    .map(([title, text], index) => `<div class="principle rv"><span>0${index + 1}</span><h3>${title}</h3><p>${text}</p></div>`)
    .join('');
  return `<section class="donate-support ink" id="support">${secHead({
    index: 2,
    label: '支持的约定',
    title: '自愿支持，不附带任何权益',
    lede: '是否捐赠完全由你决定。无论是否捐赠，弈的功能、棋规、段位与联机机会都保持相同。',
  })}<div class="principles">${principles}</div>
<div class="donate-panel rv"><div><span class="label">捐赠方式</span><h3>如果你愿意，可以在这里支持弈。</h3><p>收款方式确认后会在这里开放。不捐赠也没有关系；使用、反馈问题或向朋友推荐，同样是很有价值的帮助。</p></div>
<div class="donate-panel-action">${donationAction()}${btn({ href: PROJECT, text: '在 GitHub 关注', ghost: true, external: true })}</div></div></section>`;
}

function questions() {
  const items = [
    ['捐赠后，会获得专属功能或段位吗？', '不会。捐赠不附带任何游戏特权，不影响功能、棋规、匹配、排位或联机机会。每位棋友都在同一方棋盘上对弈。'],
    ['不捐赠，也可以一直使用吗？', '当然。是否支持完全取决于你的意愿与能力。继续使用、反馈问题、向朋友推荐，同样是对项目很重要的帮助。'],
    ['一份支持具体会用来做什么？', '主要用于联机服务器、域名与网站下载等运营成本，以及项目后续的维护和更新。它不会兑换成游戏内物品或虚拟权益。'],
  ]
    .map(
      ([question, answer], index) =>
        `<details class="donate-question"${index === 0 ? ' open' : ''}><summary><span>0${index + 1}</span><h3>${question}</h3><i aria-hidden="true"></i></summary><p>${answer}</p></details>`,
    )
    .join('');
  return `<section class="donate-faq shell reveal-circle" id="questions">${secHead({
    index: 3,
    label: '常见问题',
    title: '关于捐赠，你可能想问',
    lede: '关于自愿、功能权益与资金用途的说明。',
  })}<div class="donate-questions">${items}</div></section>`;
}

function finale() {
  return `<section class="donate-finale ink reveal-circle" id="thanks">
<div class="donate-finale-in"><span class="label">写在最后</span><h2>谢谢你，<br><span>让热爱继续。</span></h2>
<p>感谢你使用弈。无论是否捐赠，都谢谢你对这个个人项目的关注。</p>
<div class="cta">${donationAction()}${btn({ href: '/', text: '回到棋室', ghost: true })}</div></div></section>`;
}

/** 生成支持作者页；页面不依赖脚本，全部内容、导航与说明均可直接阅读。 */
export function donatePage(assetVersion: string) {
  return shell({
    title: '弈 · 支持作者',
    description: '为“弈”的作者买一杯咖啡，支持服务器、域名、网站下载与长期维护。捐赠完全自愿，不影响任何游戏功能，也不附带特权。',
    assetVersion,
    nav: [
      ['#purpose', '支持去向'],
      ['#support', '支持约定'],
      ['#questions', '常见问题'],
      ['/support', '帮助与支持'],
    ],
    current: '/donate',
    style: donateStyle(),
    body: hero() + purpose() + support() + questions() + finale(),
    footerVisual: heartOcean(),
  });
}
