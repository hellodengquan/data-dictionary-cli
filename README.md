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
   --schemas "order_domain" --tables "ord_*,pay_*" --exclude-tables "*_test_*,stg_*"
   ```
   仅在 `order_domain` 下，保留 `ord_` / `pay_` 开头的表，排除测试和 staging 表。

### ⚠️ glob 反例 & 避坑指南（运营必读）

| 反例写法 | 错因 | 后果 | 正确写法 |
|----------|------|------|----------|
| `--schemas "app_*, !app_legacy"` （逗号后带空格） | shell 会把 `!app_legacy` 当成下一个参数解析 | 后面参数整体错位，可能把密码当成输出路径 | `"app_*,!app_legacy"` 逗号后**不要加空格** |
| `--exclude-tables "!*_test_*"` （在 `--exclude-tables` 里再写 `!`前缀） | `--exclude-tables` **列表本身语义就是排除**，再写 `!` 变成"双重否定=包含"，**不会排除** | 审计表/临时表被扫描，字典体积爆炸/泄露不该出现的表 | `--exclude-tables "*_test_*,stg_*"`（去掉 `!`） |
| `--tables "users, orders, items"` （逗号后空格） | shell 把后两个解析成额外参数，或空格被保留成 pattern 的一部分 | 匹配不到" orders"这种带前置空格的表名 | `"users,orders,items"` 逗号后**不要空格** |
| `--schemas "tenant_?*_core"` （把 `?` 当多个字符） | `?` 只匹配**恰好 1 个字符**，`?*` 虽然等价于 `*` 但语义不清 | `tenant_12_core`（2位）不会被匹配 | 固定长度用 `???`，变长用 `*` |
| `--tables "*"` 又 `--exclude-tables "logs"` （精确匹配 vs 模糊混用） | `--exclude-tables` 一样支持通配符，写 `"logs"` **只能精确匹配 logs**，`users_logs` 躲过去 | 大量相关表没被排除，结果仍然巨大 | `--exclude-tables "logs,*_logs,*_log"` |
| `--schemas "public,App_*"` （大小写敏感） | Postgres 中 unquoted identifier 都是小写，schema/table 名通常全小写 | `"App_*"` 匹配不到 `app_user` | 全部写**小写**：`"public,app_*"` |
| bash 中写 `--tables *` 不加引号 | shell 会把 `*` 展开为当前目录下的文件名列表 | 参数错乱、报错找不到某个奇怪的表名 | 一定要**双引号包裹**：`--tables "*"` |
| `--schemas "/data/db/core/app_*"` （绝对路径起头） | schema 名只是个名字，不是文件路径，没有 `/` 前缀 | 永远匹配不到 | 直接写名字：`"core,app_*"` |
| `--tables "prod/sales/orders"` （路径式中间斜杠） | schema 与表名是分开配置的，不是文件路径，不要用 `/` 串联 | 永远匹配不到 | `--schemas "prod,sales" --tables "orders"` |
| `--schemas "app.legacy,app.core"` （用 `.` 分隔） | `--schemas` 只传 schema 名，不要带表名，`.` 不是分隔符 | schema 名不存在、匹配为 0 | `"app_legacy,app_core"`，表名放 `--tables` |
| `--tables "users;orders;items"` （分号分隔） | 只有逗号 `,` 是分隔符，分号会被 shell 截断 | 后面参数全被当 shell 命令执行（危险！） | 只能用逗号：`"users,orders,items"` |
| `--schemas "app_*\|!*test*"` （用 `\|` 当或） | 不支持正则 `\|`，`\|` 会被当成普通字符；且 shell 里 `\|` 有特殊含义 | 匹配不到、甚至管道截断 | 直接写逗号串联：`"app_*,!*test*"` |

> 记忆口诀：**逗号后无空格、字符串加引号、schema/table 全部小写、`!` 只出现在包含列表（--schemas / --tables）里，exclude 列表不要再双重否定。**
>
> 额外避坑三禁令：**禁绝对路径、禁中间斜杠、禁分号竖线。**

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
| 数组       | 任意维度，例：`integer[]`、`text[]`、`uuid[]`、`varchar(64)[]`、`INTEGER[][]`、`JSONB[][][]`、`ENUM[]`（递归支持 3 层及以上） |

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

// 方式 C：OAuth2 Client Credentials（企业 SSO，对 Confluence Data Center，自动 refresh）
"auth": {
  "type": "oauth2",
  "clientId": "xxxxx",
  "clientSecret": "xxxxx",
  "tokenEndpoint": "https://confluence.example.com/oauth/token",
  "scope": "READ",
  "refreshIntervalMinutes": 2.5,
  "minTtlSeconds": 30
}
```

> - PAT 快过期时 `datadict generate` 会在 stderr 打印黄色警告，明确剩余天数。
> - OAuth2 每次运行自动向 tokenEndpoint 申请新 token，无需手动更换。
>   - `refreshIntervalMinutes`：企业 SSO 短寿命 token 可配置刷新间隔，支持分钟级浮点（例：2.5 = 150 秒）
>   - `refreshIntervalSeconds`：秒级整数配置，与 minutes 同时配置时 minutes 优先
>   - `minTtlSeconds`：剩余有效期小于该秒数时强制刷新，默认 60 秒

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
| `--timezone <IANA>` | 时区，见「日期 & 时区本地化」章节 |
| `--theme light\|dark` | HTML / ERD 主题 |
| `--no-toc` / `--no-fk` / `--no-index` | 关闭目录、外键、索引 |
| `--template <path>` | 自定义 EJS 模板（仅 html） |

### Graphviz 安装说明（ERD 图依赖）

`-f erd-svg` 和 `-f erd-png` 会调用系统 `dot`（Graphviz）命令，若未安装会友好报错并指向本节，四大主包管理器一键安装：

| 序号 | 平台 / 包管理器 | 安装命令 |
|------|-----------------|----------|
| 1 | macOS（Homebrew / 🍺 brew） | `brew install graphviz` |
| 2 | Ubuntu / Debian（apt） | `sudo apt install -y graphviz` |
| 3 | RHEL / CentOS（yum / dnf） | `sudo yum install -y graphviz` |
| 4 | Windows（Chocolatey / 🍫 choco） | `choco install graphviz` |
| - | Arch / Manjaro | `sudo pacman -S graphviz` |
| - | Windows（Winget） | `winget install Graphviz.Graphviz` |
| - | 官方安装包（全平台） | <https://graphviz.org/download/> |

验证：`dot -V` 能输出版本号（≥ 2.40）即可。

---

## 五、日期 & 时区本地化

HTML 里 `生成时间` 等日期按 `--lang` 和 `--timezone` 双因子调用 `toLocaleString`：

- `--lang zh --timezone Asia/Shanghai` → `2026/06/17 14:30:00`（CST）
- `--lang en --timezone America/New_York` → `6/17/2026, 2:30:00 AM`（EST + 12h 时差示例）

### 常用时区参考

| IANA 名称 | 常用场景 |
|-----------|----------|
| `Asia/Shanghai` | 中国标准时间（UTC+8） |
| `Asia/Tokyo` | 日本标准时间（UTC+9） |
| `UTC` | 零时区（跨国团队推荐） |
| `America/New_York` | 美东时间 |
| `America/Los_Angeles` | 美西时间 |
| `Europe/London` | 英国时间 |
| `Europe/Berlin` | 中欧时间 |

> `--timezone` 未指定时，会自动通过 `Intl.DateTimeFormat().resolvedOptions().timeZone` 探测本机时区，页脚会附带 `[IANA (UTC±hh:mm)]` 标签便于审计。

### `--lang` 与 `--timezone` 优先级 & 组合规则

两者**不会冲突**，作用域完全正交：

| 参数 | 作用域 | 取值示例 | 影响点 |
|------|--------|----------|--------|
| `--lang` | 显示格式 | `zh` / `en` | locale（zh-CN / en-US）、小时制（zh=24h / en=12h）、i18n 文案 |
| `--timezone` | 时间值本身 | `Asia/Shanghai` / `UTC` / `America/New_York` | 时间做 UTC 偏移，同一时刻在不同时区显示为不同的钟表时间 |

**典型组合**：
- `--lang zh --timezone Asia/Shanghai` → `2026/06/17 14:30:00 [Asia/Shanghai (UTC+08:00)]`
- `--lang zh --timezone UTC` → `2026/06/17 06:30:00 [UTC (UTC+00:00)]`（同一时刻，显示为 UTC）
- `--lang en --timezone Asia/Shanghai` → `6/17/2026, 2:30:00 PM [Asia/Shanghai (UTC+08:00)]`（英文 12h 制 + 中文时区）
- `--lang en --timezone America/New_York` → `6/17/2026, 2:30:00 AM [America/New_York (UTC-04:00)]`

> 优先级：**显式参数 > 自动探测 > 默认值**。若同时传 `--timezone` 和运行环境的 `TZ` 环境变量，优先用 `--timezone`。

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

---

## 七、FAQ / Troubleshooting

### Q1. `-f erd-svg / erd-png` 报 `dot command not found`
装 Graphviz！见「§四 → Graphviz 安装说明」。`dot -V` 验证是否在 PATH。

### Q2. ERD 生成出来空白或只有一个点
常见原因：
1. **没外键**：所有表之间没有 FK 约束 → 连线为 0，图没意义。可以先 `-f html` 看外键部分。
2. 只有一张表：同上。
3. Graphviz 版本过旧：`dot -V` 确认版本 ≥ 2.40。

### Q3. Graphviz 报 syntax error in line xxx near '...'
某张表/字段名包含 `:`、`<`、`>`、`"` 等 graphviz 特殊字符。先重命名或在业务说明里改别名；后续版本会自动转义。

### Q4. Confluence 拉不到业务说明 / 401 Unauthorized
1. Bearer：PAT 过期？看 stderr 的黄色警告。
2. OAuth2：`clientId/secret/tokenEndpoint` 要跟企业 SSO 管理员确认，`scope` 没对会被拒绝。
3. Basic：用户名 / API Token（不是登录密码！）。
4. 确认 `apiUrl` 带 `/rest/api`，不要带页面 URL。

### Q5. glob 怎么都匹配不到我想要的 schema
对照「§一 → glob 反例 & 避坑指南」。常见 3 坑：
1. 逗号后加了空格 → 整体被拆成两个参数。
2. `*` 没加引号，被 shell 展开成文件名。
3. 大写开头 → Postgres 默认全小写，全部小写写。

### Q6. 日期时间不对（跟实际差 8 小时）
加 `--timezone Asia/Shanghai`（按你的真实时区），或改成 `--timezone UTC` 统一。

---

## License

MIT
