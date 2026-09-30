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
