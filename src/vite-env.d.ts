/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 在线服务器地址，例如 wss://yi.lightking.com.cn/ws */
  readonly VITE_YI_SERVER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** 版本号（构建时从 package.json 注入） */
declare const __APP_VERSION__: string;
/** 构建时的提交号（只有服务端与桌面版主进程有，见 scripts/build-node.mjs） */
declare const __APP_COMMIT__: string;
/** 下载页面的资源：文件名 → base64 内容（构建时嵌入，只有服务端引用，见 scripts/page-assets.mjs） */
declare const __PAGE_ASSETS__: Record<string, string>;
