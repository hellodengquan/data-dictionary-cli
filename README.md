# Data Dictionary CLI (datadict)

从 **SQLite** 或 **PostgreSQL** 数据库扫描 → 提取字段/类型/约束/注释/外键 → 合并本地或 Confluence 远端业务说明 → 生成 **HTML / Markdown / JSON / ERD-SVG / ERD-PNG** 五种格式的数据字典。

## 安装

```bash
npm install
npm run build
npm link        # 可选，让 datadict 命令全局可用
```

## 快速开始

```bash
# 生成示例配置（Postgres 版）
datadict init -t postgres -o datadict-config.json

# 基于配置文件生成
datadict generate --config datadict-config.json

# 直接命令行参数（SQLite）
datadict generate \
  -t sqlite -c ./example.db \
  -o ./dictionary.html \
  -f html --lang zh
```

---

## 一、扫描范围（glob 通配符语法）

`--schemas`、`--tables`、`--exclude-tables` 均支持 **glob 风格通配符** 与 **排除列表**：

| 语法  | 含义                                 | 示例匹配值                                |
|-------|--------------------------------------|-------------------------------------------|
| `*`   | 任意长度任意字符（0 或多）           | `app_*` → `app_user`、`app_`              |
| `?`   | 单个任意字符（恰好 1 个）            | `tbl_?` → `tbl_a`、`tbl_1`（不匹配 tbl_） |
| `!x`  | 排除（前缀 `!`，写在同列表任意位置） | `!*_legacy` 即排除所有带 _legacy 后缀的   |
| `[]`  | 字符集（可选）                       | `[a-z]*`  小写字母开头                    |
| `,`   | 多 pattern 分隔                      | `public,app_*,!*_test`                    |

> 命中规则：**先过包含 pattern → 再过排除 pattern → 两者同时满足的保留**。

### glob 范例（5 条）

1. **跨多业务 schema，排除 legacy**
   ```bash
   --schemas "public,app_*,!app_legacy"
   ```
   匹配：`public`、`app_order`、`app_payment`；不匹配：`app_legacy`

2. **多租户 schema 命名按 3 位 tenant id**
   ```bash
   --schemas "tenant_???_core"
   ```
   匹配：`tenant_001_core`、`tenant_abc_core`；不匹配：`tenant_1_core`

3. **只看用户相关的表**
   ```bash
   --tables "user*,account*,role*"
   ```
   匹配：`users`、`user_profile`、`account_balance`、`roles`

4. **审计日志与临时表一并排除**
   ```bash
   --exclude-tables "*_log,*_tmp,__*"
   ```
   排除：`users_log`、`session_tmp`、`__schema_migrations`

5. **组合使用：订单域 + 排除测试数据**
   ```bash
   --schemas "order_domain" --tables "ord_*,pay_*" --exclude-tables "!*_test_*,!stg_*"
   ```
   仅在 `order_domain` 下，保留 `ord_` / `pay_` 开头的表，排除测试和 staging 表。

---

## 二、PostgreSQL 高级类型识别（自动）

| 类别       | 自动识别的类型                                                                 |
|------------|--------------------------------------------------------------------------------|
| JSON/XML   | `json`、`jsonb`、`xml`                                                         |
| 标识/网络  | `uuid`、`macaddr`、`inet`、`cidr`                                              |
| 全文检索   | `tsvector`、`tsquery`                                                          |
| 键值       | `hstore`                                                                       |
| 时间/金额  | `timestamptz`、`timetz`、`interval`、`money`                                   |
| 几何/二进制| `bytea`、`point`、`geometry`                                                   |
| 枚举       | 任意 `CREATE TYPE ... AS ENUM`（**枚举值会显示在字段"说明"下，带序号**）        |
| 数组       | 任意基础类型加 `[]`，例：`integer[]`、`text[]`、`uuid[]`、`varchar(64)[]`       |

---

## 三、业务说明（本地 + Confluence 远端）

业务说明可以在 **本地 JSON** 里写，也可以 **Confluence 自动拉**，两者同时配置时会 **合并（远端缺失字段由本地兜底，远端字段优先级本地可 override）**。

### 3.1 Confluence 两种认证

```jsonc
// 方式 A：Personal Access Token（推荐，过期会自动提前 warn）
"confluence": {
  "apiUrl": "https://confluence.example.com/rest/api",
  "auth": {
    "type": "bearer",
    "token": "NTA3NzEx...（PAT 或 API Token）",
    "expiresAt": "2026-12-31T23:59:59Z",
    "warnDaysBefore": 14
  }
}

// 方式 B：Basic Auth（用户名 + 密码）
"auth": { "type": "basic", "username": "bot", "password": "xxxx" }

// 方式 C：OAuth2 Client Credentials（对 Confluence Data Center，自动 refresh）
"auth": {
  "type": "oauth2",
  "clientId": "xxxxx",
  "clientSecret": "xxxxx",
  "tokenEndpoint": "https://confluence.example.com/oauth/token",
  "scope": "READ"
}
```

> - PAT 快过期时 `datadict generate` 会在 stderr 打印黄色警告，明确剩余天数。
> - OAuth2 每次运行自动向 tokenEndpoint 申请新 token，无需手动更换。

### 3.2 两种拉取策略

| 策略        | 配置 key            | 说明                                                             |
|-------------|---------------------|------------------------------------------------------------------|
| 按 Page ID  | `pageId`            | 拉取单个页面；`recursive: true` 可递归拉取子页面                 |
| 按 Space    | `spaceKey + titlePattern` | `titlePattern` 正则需带命名组 `(?<table>...)`，用于从页标题抠表名 |

页面内容解析规则（可被 Confluence 自带 HTML 表格编辑器直接识别）：
- 列 1 = 字段名；列 2 = 业务说明（或列 1=字段名、列 3=说明亦可）
- 页内第一段 `<p><strong>[users]</strong></p>` 标记"接下来这张表格对应 users 表"

---

## 四、输出格式 & 选项

| `-f <format>` | 扩展名建议 | 说明                                                                 |
|---------------|------------|----------------------------------------------------------------------|
| `html`        | `.html`    | 可交互 HTML，含搜索/主题切换/侧栏目录，受 `--lang zh|en` 控制语言    |
| `markdown`    | `.md`      | 纯 Markdown，方便贴到 wiki                                           |
| `json`        | `.json`    | 结构化元数据，给程序消费                                             |
| `erd-svg`     | `.svg`     | 外键关系图（矢量），需本机已装 `graphviz`（`dot` 命令）              |
| `erd-png`     | `.png`     | 外键关系图（位图），同样依赖 `graphviz`                              |

### 常用参数

| 参数 | 说明 |
|------|------|
| `--lang zh\|en` | 文档语言（HTML + ERD 标签 + 日期格式） |
| `--theme light\|dark` | HTML 主题（仅 html） |
| `--no-toc` / `--no-fk` / `--no-index` | 关闭目录、外键、索引 |
| `--template <path>` | 自定义 EJS 模板（仅 html） |

---

## 五、日期本地化

HTML 里 `生成时间` 等日期按 `--lang` 调用 `toLocaleDateString` / `toLocaleString`：

- `--lang zh` → `2026/6/17 14:30:00`
- `--lang en` → `6/17/2026, 2:30:00 PM`

---

## 六、项目结构

```
src/
  types/index.ts          # 全部类型：DatabaseConfig / TableInfo / ConfluenceConfig / Lang 等
  utils/pattern.ts        # glob 解析 + 匹配
  db/
    base.ts               # DatabaseConnector 基类（多 schema 解析核心）
    sqlite.ts postgres.ts # SQLite / PG 连接器，PG 含高级类型+ENUM+数组
  merger/businessMerger.ts# 本地 + Confluence 合并，PAT 过期检查 / OAuth2 refresh
  i18n/index.ts           # I18N_ZH / I18N_EN 两本字典
  exporter/
    base.ts               # Exporter 基类，i18n/日期格式化/ERD 通用工具
    htmlExporter.ts markdownExporter.ts jsonExporter.ts
    erdExporter.ts        # Graphviz DOT → dot -Tsvg / dot -Tpng
    index.ts              # 工厂 createExporter(format)
  extractor/metadataExtractor.ts # 调 connector 得到元数据
  cli.ts                  # commander 入口
  index.ts                # DataDictionaryGenerator（扫描 → 合并 → 导出 → 写盘）
templates/html.ejs        # 默认 HTML 模板（已全量 i18n 化）
```

## License

MIT
