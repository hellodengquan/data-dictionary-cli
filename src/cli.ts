#!/usr/bin/env node

import { Command } from 'commander';
import * as chalk from 'chalk';
import * as ora from 'ora';
import * as path from 'path';
import * as fs from 'fs';
import { DataDictionaryGenerator } from './index';
import { 
  GeneratorConfig, 
  DatabaseConfig, 
  ScanConfig, 
  OutputConfig,
  BusinessConfig,
  DatabaseType
} from './types';

const program = new Command();

program
  .name('datadict')
  .description('数据字典生成工具 - 从 SQLite 或 PostgreSQL 数据库生成数据字典')
  .version('1.0.0');

program
  .command('generate')
  .description('生成数据字典')
  .requiredOption('-t, --type <type>', '数据库类型: sqlite 或 postgres')
  .requiredOption('-c, --connection <connection>', '数据库连接字符串或文件路径')
  .option('-o, --output <path>', '输出文件路径', 'dictionary.html')
  .option('-f, --format <format>', '输出格式: html, markdown, json, erd-svg, erd-png', 'html')
  .option('--host <host>', '数据库主机地址', 'localhost')
  .option('--port <port>', '数据库端口', '5432')
  .option('--database <database>', '数据库名称')
  .option('--user <user>', '数据库用户名')
  .option('--password <password>', '数据库密码')
  .option('--tables <tables>', '指定要扫描的表，用逗号分隔，支持通配符和排除列表(!前缀)')
  .option('--exclude-tables <tables>', '指定要排除的表，用逗号分隔，支持通配符')
  .option('--schemas <schemas>', '指定要扫描的 schema，用逗号分隔，支持通配符(*,?)和排除列表(!前缀)。示例: app_*,!app_legacy', 'public')
  .option('--include-views', '是否包含视图', false)
  .option('--title <title>', '文档标题')
  .option('--no-toc', '不生成目录')
  .option('--no-fk', '不显示外键信息')
  .option('--no-index', '不显示索引信息')
  .option('--lang <lang>', '文档语言: zh(中文) 或 en(英文)', 'zh')
  .option('--timezone <tz>', '时区 IANA name，例如 Asia/Shanghai、America/New_York、UTC。默认自动探测。')
  .option('--theme <theme>', 'HTML 主题: light 或 dark', 'light')
  .option('--template <path>', '自定义 EJS 模板路径')
  .option('--business-config <path>', '业务说明配置文件路径')
  .option('--confluence-api-url <url>', 'Confluence API 基础地址，例如 https://confluence.example.com/rest/api')
  .option('--confluence-username <user>', 'Confluence 用户名 (Basic Auth)')
  .option('--confluence-token <token>', 'Confluence API Token 或 Personal Access Token (Bearer)')
  .option('--confluence-password <pass>', 'Confluence 密码 (与用户名配合使用 Basic Auth)')
  .option('--confluence-page-id <id>', 'Confluence 页面 ID (按页拉取说明)')
  .option('--confluence-space-key <key>', 'Confluence 空间 Key (按空间搜索页面)')
  .option('--config <path>', '使用配置文件')
  .action(async (options) => {
    const spinner = ora('正在生成数据字典...').start();
    
    try {
      let config: GeneratorConfig;
      
      if (options.config) {
        spinner.text = '正在加载配置文件...';
        const configPath = path.resolve(options.config);
        if (!fs.existsSync(configPath)) {
          throw new Error(`配置文件不存在: ${configPath}`);
        }
        const configContent = fs.readFileSync(configPath, 'utf-8');
        config = JSON.parse(configContent);
      } else {
        config = buildConfigFromOptions(options);
      }
      
      spinner.text = '正在扫描数据库...';
      const generator = new DataDictionaryGenerator(config);
      
      const content = await generator.generate();
      
      spinner.succeed(chalk.green(`数据字典已成功生成: ${config.output.outputPath}`));
      
      const outputSize = fs.statSync(config.output.outputPath).size;
      console.log(chalk.gray(`文件大小: ${(outputSize / 1024).toFixed(2)} KB`));
      
    } catch (error) {
      spinner.fail(chalk.red('生成失败'));
      console.error(chalk.red('\n错误详情:'));
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

function buildConfigFromOptions(options: any): GeneratorConfig {
  const dbType = options.type as DatabaseType;
  
  const database: DatabaseConfig = {
    type: dbType,
    connectionString: options.connection
  };
  
  if (dbType === 'postgres') {
    database.host = options.host;
    database.port = parseInt(options.port);
    database.database = options.database;
    database.user = options.user;
    database.password = options.password;
  } else if (dbType === 'sqlite') {
    database.filename = options.connection;
  }

  const scan: ScanConfig = {};
  
  if (options.tables) {
    scan.tables = options.tables.split(',').map((t: string) => t.trim());
  }
  
  if (options.excludeTables) {
    scan.excludeTables = options.excludeTables.split(',').map((t: string) => t.trim());
  }
  
  if (options.schemas) {
    scan.schemas = options.schemas.split(',').map((s: string) => s.trim());
  }
  
  if (options.includeViews) {
    scan.includeViews = options.includeViews;
  }

  const output: OutputConfig = {
    format: options.format,
    outputPath: path.resolve(options.output),
    title: options.title,
    includeForeignKeys: options.fk !== false,
    includeIndexes: options.index !== false,
    tableOfContents: options.toc !== false,
    theme: options.theme,
    template: options.template ? path.resolve(options.template) : undefined,
    lang: options.lang,
    timezone: options.timezone
  };

  let business: BusinessConfig | undefined;

  if (options.businessConfig) {
    const businessConfigPath = path.resolve(options.businessConfig);
    if (!fs.existsSync(businessConfigPath)) {
      throw new Error(`业务配置文件不存在: ${businessConfigPath}`);
    }
    const businessContent = fs.readFileSync(businessConfigPath, 'utf-8');
    business = JSON.parse(businessContent);
  }

  const hasConfluenceParams = !!(
    options.confluenceApiUrl &&
    (options.confluencePageId || options.confluenceSpaceKey)
  );

  if (hasConfluenceParams) {
    if (!business) business = { tables: [] };
    if (!business.tables) business.tables = [];

    const confluence: any = {
      apiUrl: options.confluenceApiUrl
    };

    if (options.confluenceToken) {
      confluence.auth = { type: 'bearer', token: options.confluenceToken };
    } else if (options.confluenceUsername) {
      confluence.auth = {
        type: 'basic',
        username: options.confluenceUsername,
        password: options.confluencePassword || ''
      };
    }

    if (options.confluencePageId) {
      confluence.pageId = options.confluencePageId;
    }
    if (options.confluenceSpaceKey) {
      confluence.spaceKey = options.confluenceSpaceKey;
    }

    business.confluence = confluence as any;
  }

  return {
    database,
    scan,
    output,
    business
  };
}

program
  .command('init')
  .description('创建示例配置文件')
  .option('-o, --output <path>', '输出路径', 'datadict-config.json')
  .option('-t, --type <type>', '数据库类型: sqlite 或 postgres', 'sqlite')
  .action((options) => {
    const outputPath = path.resolve(options.output);
    const exampleConfig = createExampleConfig(options.type);
    
    fs.writeFileSync(outputPath, JSON.stringify(exampleConfig, null, 2));
    console.log(chalk.green(`示例配置文件已创建: ${outputPath}`));
  });

function createExampleConfig(dbType: string): any {
  const commonScan = {
    tables: [],
    excludeTables: [],
    schemas: [
      'public',
      'app_*',
      '!app_legacy',
      'tenant_???_core'
    ],
    includeViews: false,
    _schemasComment: '支持通配符:*任意长度,?单字符; 用!开头表示排除列表; 示例: app_*,!app_legacy'
  };

  const commonOutput = {
    format: 'html',
    outputPath: './dictionary.html',
    title: '示例数据字典',
    includeForeignKeys: true,
    includeIndexes: true,
    tableOfContents: true,
    theme: 'light',
    lang: 'zh'
  };

  const commonBusiness = {
    title: '示例数据字典',
    description: '这是一个示例数据字典，用于展示数据字典生成工具的功能。',
    version: '1.0.0',
    generatedBy: '数据字典生成工具',
    tables: [
      {
        tableName: 'users',
        description: '用户表，存储系统的所有用户信息',
        columns: {
          id: '用户唯一标识，自增主键',
          username: '用户名，用于登录',
          email: '用户邮箱，用于找回密码和接收通知',
          created_at: '记录创建时间'
        }
      }
    ],
    confluence: {
      apiUrl: 'https://confluence.example.com/rest/api',
      auth: {
        type: 'bearer',
        token: 'your-personal-access-token'
      },
      pageId: '12345678',
      recursive: true,
      titlePattern: '^\\[(?<table>[a-zA-Z0-9_]+)\\]',
      _comment: '按 pageId 或 spaceKey 拉取 Confluence 中的说明文档，解析 HTML 表格并合并到本地业务说明'
    }
  };

  if (dbType === 'sqlite') {
    return {
      database: {
        type: 'sqlite',
        connectionString: 'sqlite://./example.db',
        filename: './example.db'
      },
      scan: commonScan,
      output: commonOutput,
      business: commonBusiness
    };
  } else {
    return {
      database: {
        type: 'postgres',
        connectionString: 'postgresql://user:password@localhost:5432/dbname',
        host: 'localhost',
        port: 5432,
        database: 'dbname',
        user: 'user',
        password: 'password',
        _advancedTypesComment: '自动识别 JSONB / UUID / ENUM / TIMESTAMPTZ / HSTORE / MACADDR / INET / CIDR / JSON / XML / TSVECTOR / TSQUERY / MONEY / INTERVAL / BYTEA / POINT / GEOMETRY 等 Postgres 高级类型'
      },
      scan: commonScan,
      output: commonOutput,
      business: commonBusiness
    };
  }
}

program
  .command('list-tables')
  .description('列出数据库中的所有表')
  .requiredOption('-t, --type <type>', '数据库类型: sqlite 或 postgres')
  .requiredOption('-c, --connection <connection>', '数据库连接字符串或文件路径')
  .option('--host <host>', '数据库主机地址', 'localhost')
  .option('--port <port>', '数据库端口', '5432')
  .option('--database <database>', '数据库名称')
  .option('--user <user>', '数据库用户名')
  .option('--password <password>', '数据库密码')
  .option('--schemas <schemas>', '指定要扫描的 schema，用逗号分隔，支持通配符和排除列表(!前缀)', 'public')
  .option('--include-views', '是否包含视图', false)
  .action(async (options) => {
    const spinner = ora('正在连接数据库...').start();
    
    try {
      const { createDatabaseConnector } = await import('./db');
      
      const dbConfig: DatabaseConfig = {
        type: options.type as DatabaseType,
        connectionString: options.connection
      };
      
      if (options.type === 'postgres') {
        dbConfig.host = options.host;
        dbConfig.port = parseInt(options.port);
        dbConfig.database = options.database;
        dbConfig.user = options.user;
        dbConfig.password = options.password;
      } else if (options.type === 'sqlite') {
        dbConfig.filename = options.connection;
      }
      
      const connector = createDatabaseConnector(dbConfig);
      await connector.connect();
      
      spinner.text = '正在获取表列表...';
      const scanConfig: ScanConfig = {
        schemas: options.schemas ? options.schemas.split(',').map((s: string) => s.trim()) : undefined,
        includeViews: options.includeViews
      };
      
      const tables = await connector.getTables(scanConfig);
      await connector.disconnect();
      
      spinner.succeed(`找到 ${tables.length} 个表:`);
      console.log('');
      
      tables.forEach((table, index) => {
        console.log(chalk.cyan(`${index + 1}. ${table}`));
      });
      
    } catch (error) {
      spinner.fail(chalk.red('获取表列表失败'));
      console.error(chalk.red('\n错误详情:'));
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program.parse(process.argv);

if (process.argv.slice(2).length === 0) {
  program.outputHelp();
}
