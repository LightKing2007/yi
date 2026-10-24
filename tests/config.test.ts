/** 服务端配置（server/config.ts，ARC-042）：默认值、各项的解析与校验、不合法时逐项报出变量名与期望的格式 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EXIT_CONFIG, loadConfig, parseConfig, startEntry } from '../server/config';
import { PROTO_VERSION } from '../src/shared/protocol';

const CWD = '/srv/yi';

/** 只取出校验失败的变量名 */
const failed = (argv: string[], env: Record<string, string>) => parseConfig(argv, env, CWD).errors.map(item => item.variable);

describe('服务端配置的解析', () => {
  it('什么都不设时取默认值：端口 8443、存档在工作目录下、日志级别 info', () => {
    expect(parseConfig([], {}, CWD)).toEqual({
      config: {
        version: false,
        command: 'serve',
        port: 8443,
        host: undefined,
        dbFile: '/srv/yi/yi.db',
        backupDir: '/srv/yi/backup',
        latest: undefined,
        download: undefined,
        files: undefined,
        logLevel: 'info',
        journal: false,
      },
      errors: [],
    });
  });

  it('线上的配置逐项解析：相对路径按工作目录解析', () => {
    const env = {
      HOST: '127.0.0.1',
      YI_DB: 'state/yi.db',
      YI_BACKUP_DIR: 'saved',
      YI_LATEST: '2.0.7',
      YI_DOWNLOAD: 'https://yi.lightking.com.cn/',
      YI_FILES: 'download',
      YI_LOG_LEVEL: 'warn',
      JOURNAL_STREAM: '8:12345',
    };
    expect(parseConfig(['8443'], env, CWD)).toEqual({
      config: {
        version: false,
        command: 'serve',
        port: 8443,
        host: '127.0.0.1',
        dbFile: '/srv/yi/state/yi.db',
        backupDir: '/srv/yi/saved',
        latest: '2.0.7',
        download: 'https://yi.lightking.com.cn/',
        files: '/srv/yi/download',
        logLevel: 'warn',
        journal: true,
      },
      errors: [],
    });
  });
});

describe('backup 命令', () => {
  it('第一个参数为 backup 时备份数据库，不解析端口；备份目录默认在数据库所在目录下', () => {
    const { config, errors } = parseConfig(['backup'], { PORT: 'x', YI_DB: '/var/lib/yi/yi.db' }, CWD);
    expect([config.command, config.backupDir, errors]).toEqual(['backup', '/var/lib/yi/backup', []]);
    expect(parseConfig(['8443'], {}, CWD).config.command).toBe('serve');
  });

  it('backup 之后带其他参数时报错', () => {
    expect(failed(['backup', '8443'], {})).toEqual(['命令行参数']);
  });
});

describe('服务端配置的优先级与空值', () => {
  it('命令行中的端口优先于 PORT；没有命令行参数时用 PORT', () => {
    expect(parseConfig(['9001'], { PORT: '9002' }, CWD).config.port).toBe(9001);
    expect(parseConfig([], { PORT: '9002' }, CWD).config.port).toBe(9002);
  });

  it('空串与未设置一样', () => {
    const { config, errors } = parseConfig([], { PORT: '', HOST: '', YI_LATEST: '', YI_DOWNLOAD: '', YI_FILES: '', YI_DB: '', YI_LOG_LEVEL: '' }, CWD);
    expect(errors).toEqual([]);
    expect(config).toEqual(parseConfig([], {}, CWD).config);
  });
});

describe('服务端配置的校验', () => {
  it('端口必须是 1 至 65535 的整数，命令行与 PORT 分别报出', () => {
    for (const bad of ['abc', '0', '65536', '80.5', ' 80', '0x50', '-1']) {
      expect(failed([], { PORT: bad }), bad).toEqual(['PORT']);
      expect(failed([bad], {}), bad).toEqual(['命令行参数（端口）']);
    }
    expect(failed(['65535'], {})).toEqual([]);
    expect(failed(['1'], {})).toEqual([]);
  });

  it('监听地址为 IP 地址或主机名', () => {
    for (const ok of ['0.0.0.0', '::1', 'localhost', 'yi.lightking.com.cn']) expect(failed([], { HOST: ok }), ok).toEqual([]);
    for (const bad of ['bad host', '-yi.com', 'yi..com', 'http://yi.com']) expect(failed([], { HOST: bad }), bad).toEqual(['HOST']);
  });

  it('最新版本号为“主版本.次版本.修订号”，下载地址为 http 或 https 网址', () => {
    for (const bad of ['2.0', 'v2.0.7', '2.0.7-beta']) expect(failed([], { YI_LATEST: bad }), bad).toEqual(['YI_LATEST']);
    for (const bad of ['ftp://yi.com/', 'yi.lightking.com.cn', 'javascript:alert(1)']) expect(failed([], { YI_DOWNLOAD: bad }), bad).toEqual(['YI_DOWNLOAD']);
    expect(failed([], { YI_DOWNLOAD: 'http://yi.lightking.com.cn:8443/' })).toEqual([]);
  });

  it('多项不合法时全部报出，各附期望的格式；不合法的项取默认值', () => {
    const { config, errors } = parseConfig(['x'], { YI_LOG_LEVEL: 'verbose', YI_LATEST: 'latest', HOST: 'a b' }, CWD);
    expect(errors.map(item => item.variable)).toEqual(['命令行参数（端口）', 'HOST', 'YI_LATEST', 'YI_LOG_LEVEL']);
    expect(errors.find(item => item.variable === 'YI_LOG_LEVEL')?.expected).toBe('error、warn、info、debug 之一');
    expect(errors.every(item => item.expected.length > 0)).toBe(true);
    expect(config.port).toBe(8443);
    expect(config.logLevel).toBe('info');
  });
});

describe('服务端配置的读取', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('--version 只打出版本号：不报配置错误，其余参数照常解析', () => {
    const { config, errors } = parseConfig(['--version', '9001'], { PORT: 'abc', YI_LOG_LEVEL: 'verbose' }, CWD);
    expect(config.version).toBe(true);
    expect(config.port).toBe(9001);
    expect(errors).toEqual([]);
  });

  it('loadConfig 读取本进程的命令行参数与环境变量；配置错误的退出码为 78', () => {
    const argv = process.argv;
    process.argv = ['node', 'server.cjs', '9003'];
    for (const name of ['PORT', 'HOST', 'YI_DB', 'YI_DOWNLOAD', 'YI_FILES', 'YI_LOG_LEVEL']) vi.stubEnv(name, ''); // 不受运行测试的环境影响
    vi.stubEnv('YI_LATEST', '2.0.8');
    try {
      const { config, errors } = loadConfig();
      expect(errors).toEqual([]);
      expect(config.port).toBe(9003);
      expect(config.latest).toBe('2.0.8');
    } finally {
      process.argv = argv;
    }
    expect(EXIT_CONFIG).toBe(78);
  });
});

describe('服务启动日志', () => {
  it('说明文字按配置写出监听地址、最新客户端与安装包目录，并附端口、协议版本范围与数据库文件', () => {
    const full = parseConfig([], { HOST: '127.0.0.1', YI_LATEST: '3.0.0', YI_FILES: '/opt/yi/current/download' }, CWD).config;
    expect(startEntry(full, [8443])).toEqual({
      msg: '弈 联机服务端已启动，地址 127.0.0.1，最新客户端 3.0.0，安装包目录 /opt/yi/current/download',
      ports: [8443],
      protoRange: [PROTO_VERSION, PROTO_VERSION],
      dbFile: '/srv/yi/yi.db',
    });
    expect(startEntry(parseConfig([], {}, CWD).config, [9000]).msg).toBe('弈 联机服务端已启动');
  });
});
