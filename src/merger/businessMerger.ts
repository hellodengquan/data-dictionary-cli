import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import { DatabaseMetadata, BusinessConfig, BusinessDescription, TableInfo, ColumnInfo, ConfluenceConfig, ConfluenceAuthBearer, ConfluenceAuthOAuth2 } from '../types';

const DEFAULT_TABLE_HEADER = {
  table: ['表名', 'TableName', 'table_name', 'name'],
  tableDesc: ['说明', '业务说明', 'Description', 'description', 'desc'],
  column: ['字段', '字段名', 'Column', 'column_name', 'name', 'Field'],
  columnDesc: ['说明', '业务说明', '描述', 'Description', 'description', 'comment']
};

interface ConfluencePage {
  id: string;
  title: string;
  body?: { storage?: { value?: string } };
  children?: { page?: { results?: ConfluencePage[] } };
}

interface OAuth2TokenResponse {
  access_token: string;
  expires_in?: number;
  token_type?: string;
}

export class BusinessMerger {
  private businessConfig: BusinessConfig;
  private oauth2TokenCache: { token: string; expiresAt: number } | null = null;

  constructor(businessConfig: BusinessConfig | string) {
    if (typeof businessConfig === 'string') {
      this.businessConfig = this.loadBusinessConfig(businessConfig);
    } else {
      this.businessConfig = businessConfig;
    }
  }

  async loadRemote(): Promise<void> {
    if (this.businessConfig.confluence) {
      this.checkAndWarnTokenExpiry(this.businessConfig.confluence);
      const remote = await this.loadFromConfluence(this.businessConfig.confluence);
      this.mergeRemoteIntoLocal(remote);
    }
  }

  private checkAndWarnTokenExpiry(cfg: ConfluenceConfig): void {
    if (cfg.auth.type !== 'bearer') return;
    const bearer = cfg.auth as ConfluenceAuthBearer;
    if (!bearer.expiresAt) return;

    const expiresAt = new Date(bearer.expiresAt).getTime();
    const now = Date.now();
    const warnDays = bearer.warnDaysBefore ?? 14;
    const warnMs = warnDays * 24 * 60 * 60 * 1000;

    if (expiresAt - now <= 0) {
      console.warn(
        `[Confluence] WARN: PAT has EXPIRED (expiresAt: ${bearer.expiresAt}). ` +
        `Please rotate a new token to avoid fetch failures.`
      );
    } else if (expiresAt - now <= warnMs) {
      const daysLeft = Math.floor((expiresAt - now) / (24 * 60 * 60 * 1000));
      console.warn(
        `[Confluence] WARN: PAT will expire in ${daysLeft} day(s) ` +
        `(expiresAt: ${bearer.expiresAt}). Consider rotating it soon.`
      );
    }
  }

  private async getAuthHeaders(cfg: ConfluenceConfig): Promise<Record<string, string>> {
    const auth = cfg.auth;

    if (auth.type === 'basic') {
      const token = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
      return { 'Authorization': `Basic ${token}` };
    }

    if (auth.type === 'bearer') {
      return { 'Authorization': `Bearer ${auth.token}` };
    }

    if (auth.type === 'oauth2') {
      const accessToken = await this.getOAuth2AccessToken(auth);
      return { 'Authorization': `Bearer ${accessToken}` };
    }

    return {};
  }

  private async getOAuth2AccessToken(auth: ConfluenceAuthOAuth2): Promise<string> {
    const minTtlSeconds = auth.minTtlSeconds ?? 60;
    const now = Date.now();

    if (this.oauth2TokenCache && this.oauth2TokenCache.expiresAt - now > minTtlSeconds * 1000) {
      return this.oauth2TokenCache.token;
    }

    const body = new URLSearchParams();
    body.append('grant_type', 'client_credentials');
    body.append('client_id', auth.clientId);
    body.append('client_secret', auth.clientSecret);
    if (auth.scope) body.append('scope', auth.scope);

    const tokenResp = await this.httpRequestJson<OAuth2TokenResponse>(
      auth.tokenEndpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'User-Agent': 'data-dictionary-cli/1.0'
        },
        body: body.toString()
      },
      30_000
    );

    let expiresIn = tokenResp.expires_in ?? 3600;
    if (auth.refreshIntervalSeconds && auth.refreshIntervalSeconds > 0) {
      expiresIn = Math.min(expiresIn, auth.refreshIntervalSeconds);
    }

    const bufferSeconds = Math.min(minTtlSeconds, Math.floor(expiresIn / 2));
    const expiresAt = now + (expiresIn - bufferSeconds) * 1000;

    this.oauth2TokenCache = {
      token: tokenResp.access_token,
      expiresAt
    };

    return tokenResp.access_token;
  }

  private mergeRemoteIntoLocal(remote: BusinessDescription[]): void {
    if (!remote.length) return;
    const existing = new Map<string, BusinessDescription>();
    for (const t of this.businessConfig.tables || []) {
      existing.set(t.tableName.toLowerCase(), t);
    }
    for (const r of remote) {
      const key = r.tableName.toLowerCase();
      const local = existing.get(key);
      if (local) {
        local.description = r.description || local.description;
        local.columns = { ...(r.columns || {}), ...(local.columns || {}) };
      } else {
        existing.set(key, r);
      }
    }
    this.businessConfig.tables = Array.from(existing.values());
  }

  private httpRequestJson<T>(
    urlStr: string,
    opts: { method?: string; headers?: Record<string, string>; body?: string },
    timeoutMs = 30_000
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const u = new URL(urlStr);
      const lib = u.protocol === 'https:' ? https : http;
      const method = opts.method || 'GET';

      const req = lib.request(
        {
          hostname: u.hostname,
          port: u.port || undefined,
          path: u.pathname + u.search,
          method,
          headers: opts.headers || {},
          timeout: timeoutMs
        },
        (res) => {
          if ((res.statusCode || 0) >= 400) {
            reject(
              new Error(
                `HTTP ${res.statusCode} ${res.statusMessage || ''} for ${method} ${urlStr}`
              )
            );
            return;
          }
          let body = '';
          res.on('data', (chunk) => {
            body += chunk.toString();
          });
          res.on('end', () => {
            try {
              resolve(JSON.parse(body) as T);
            } catch (e) {
              reject(e);
            }
          });
        }
      );

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy(new Error(`Request timed out (${timeoutMs}ms): ${urlStr}`));
      });

      if (opts.body) {
        req.write(opts.body);
      }
      req.end();
    });
  }

  private async loadFromConfluence(cfg: ConfluenceConfig): Promise<BusinessDescription[]> {
    const apiBase = cfg.apiUrl.replace(/\/+$/, '');
    const authHeaders = await this.getAuthHeaders(cfg);
    const baseHeaders = {
      ...authHeaders,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'data-dictionary-cli/1.0'
    };
    const timeout = cfg.timeoutMs ?? 30_000;

    const httpGet = <T>(path: string) =>
      this.httpRequestJson<T>(`${apiBase}${path}`, { headers: baseHeaders }, timeout);

    let targetPage: ConfluencePage | undefined;

    if (cfg.pageId) {
      const expand = cfg.recursive
        ? 'body.storage,children.page,children.page.body.storage'
        : 'body.storage';
      targetPage = await httpGet<ConfluencePage>(
        `/content/${cfg.pageId}?expand=${expand}`
      );
    } else if (cfg.spaceKey) {
      const titlePattern = cfg.titlePattern || '';
      const list = await httpGet<any>(
        `/content?type=page&spaceKey=${cfg.spaceKey}` +
          `&expand=body.storage,children.page&limit=200`
      );
      const pages: ConfluencePage[] = list.results || [];

      if (titlePattern && titlePattern.includes('?<table>')) {
        const regex = new RegExp(titlePattern);
        const filtered = pages.filter((p) => regex.test(p.title));
        targetPage = {
          id: 'root',
          title: cfg.spaceKey,
          children: { page: { results: filtered } }
        };
      } else {
        targetPage = {
          id: 'root',
          title: cfg.spaceKey,
          children: { page: { results: pages } }
        };
      }
    }

    if (!targetPage) {
      return [];
    }

    const allPages: ConfluencePage[] = [];
    const maxDepth = cfg.maxDepth ?? (cfg.recursive ? 5 : 1);
    const collect = (p: ConfluencePage, depth = 0) => {
      allPages.push(p);
      if (depth >= maxDepth) return;
      const kids = p.children?.page?.results || [];
      for (const c of kids) collect(c, depth + 1);
    };
    collect(targetPage);

    const allDesc: BusinessDescription[] = [];

    for (const page of allPages) {
      const html = page.body?.storage?.value || '';
      if (!html) continue;
      const tables = this.extractTablesFromConfluenceHtml(html);
      const parsed = this.parseTablesToBusiness(tables, cfg, page.title);
      allDesc.push(...parsed);
    }

    return allDesc;
  }

  private extractTablesFromConfluenceHtml(html: string): string[][][] {
    const tables: string[][][] = [];
    const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    const cellRegex = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;

    let tMatch: RegExpExecArray | null;
    while ((tMatch = tableRegex.exec(html)) !== null) {
      const tableHtml = tMatch[1];
      const rows: string[][] = [];
      let rMatch: RegExpExecArray | null;
      while ((rMatch = rowRegex.exec(tableHtml)) !== null) {
        const rowHtml = rMatch[1];
        const cells: string[] = [];
        let cMatch: RegExpExecArray | null;
        while ((cMatch = cellRegex.exec(rowHtml)) !== null) {
          let text = cMatch[1]
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .trim();
          cells.push(text);
        }
        if (cells.length) rows.push(cells);
      }
      if (rows.length) tables.push(rows);
    }

    return tables;
  }

  private headerIndex(row: string[], candidates: string[]): number {
    const lower = row.map(c => c.trim().toLowerCase());
    for (let i = 0; i < lower.length; i++) {
      if (candidates.some(c => c.toLowerCase() === lower[i] || lower[i].includes(c.toLowerCase()))) {
        return i;
      }
    }
    return -1;
  }

  private parseTablesToBusiness(tables: string[][][], cfg: ConfluenceConfig, pageHint: string): BusinessDescription[] {
    const result: BusinessDescription[] = [];
    const headerCfg = cfg.tableHeaderRowPattern || { table: DEFAULT_TABLE_HEADER.table, column: DEFAULT_TABLE_HEADER.column };
    const tableDescHeaders = headerCfg.table.slice();
    const columnDescHeaders = [...DEFAULT_TABLE_HEADER.columnDesc];

    const pending: BusinessDescription | null = null;

    for (const table of tables) {
      if (table.length < 2) continue;
      const header = table[0];
      const tNameIdx = this.headerIndex(header, headerCfg.table);
      const tDescIdx = this.headerIndex(header, tableDescHeaders.concat(DEFAULT_TABLE_HEADER.tableDesc));
      const cNameIdx = this.headerIndex(header, headerCfg.column.concat(DEFAULT_TABLE_HEADER.column));
      const cDescIdx = this.headerIndex(header, columnDescHeaders);

      if (tNameIdx >= 0 && table[0].length <= 4) {
        for (let i = 1; i < table.length; i++) {
          const name = table[i][tNameIdx];
          if (!name) continue;
          const desc = tDescIdx >= 0 ? (table[i][tDescIdx] || '') : '';
          const cleanedName = name.replace(/[`'"【\]]/g, '').trim();
          const existing = result.find(r => r.tableName.toLowerCase() === cleanedName.toLowerCase());
          if (existing) {
            existing.description = existing.description || desc;
          } else {
            result.push({ tableName: cleanedName, description: desc, columns: {} });
          }
        }
      } else if (cNameIdx >= 0 && cDescIdx >= 0) {
        let target: BusinessDescription | undefined;

        const matchInPageName = result.find(r => pageHint.includes(r.tableName) || r.tableName.includes(pageHint.replace(/\s+/g, '')));
        if (matchInPageName) {
          target = matchInPageName;
        } else if (result.length > 0) {
          target = result[result.length - 1];
        } else {
          const nameFromTitle = pageHint.replace(/数据字典|表结构|Data\s*Dictionary|Table\s*Structure/gi, '').trim();
          if (nameFromTitle) {
            target = { tableName: nameFromTitle, columns: {} };
            result.push(target);
          }
        }

        if (!target) {
          target = pending as any;
        }

        if (target) {
          if (!target.columns) target.columns = {};
          for (let i = 1; i < table.length; i++) {
            const cname = table[i][cNameIdx];
            const cdesc = table[i][cDescIdx];
            if (!cname) continue;
            const cleanCname = cname.replace(/[`'"]/g, '').trim();
            if (cdesc) {
              target.columns[cleanCname] = cdesc;
            }
          }
        }
      }
    }

    return result.filter(b => b.description || (b.columns && Object.keys(b.columns).length > 0));
  }

  private loadBusinessConfig(configPath: string): BusinessConfig {
    const resolvedPath = path.resolve(configPath);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Business config file not found: ${resolvedPath}`);
    }

    const content = fs.readFileSync(resolvedPath, 'utf-8');
    const ext = path.extname(resolvedPath).toLowerCase();

    if (ext === '.json') {
      return JSON.parse(content);
    } else if (ext === '.yaml' || ext === '.yml') {
      return this.parseYaml(content);
    } else if (ext === '.js') {
      delete require.cache[require.resolve(resolvedPath)];
      return require(resolvedPath);
    }

    try { return JSON.parse(content); } catch { /* ignore */ }
    try { return this.parseYaml(content); } catch {
      throw new Error(`Unsupported business config format: ${ext}. Supported formats: .json, .yaml, .yml, .js`);
    }
  }

  private parseYaml(content: string): BusinessConfig {
    const lines = content.split('\n');
    const result: any = {};
    const stack: { obj: any; indent: number }[] = [];
    let currentObj: any = result;
    let currentIndent = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const indent = line.search(/\S/);
      if (indent > currentIndent) {
        stack.push({ obj: currentObj, indent: currentIndent });
        currentIndent = indent;
      } else if (indent < currentIndent) {
        while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
          const popped = stack.pop()!;
          currentObj = popped.obj;
          currentIndent = popped.indent;
        }
      }

      const colonIndex = trimmed.indexOf(':');
      if (colonIndex === -1) continue;

      const key = trimmed.substring(0, colonIndex).trim().replace(/^["']|["']$/g, '');
      let value: any = trimmed.substring(colonIndex + 1).trim();

      if (value === '' || value === '|' || value === '>') {
        const textLines: string[] = [];
        const textIndent = indent + 2;
        i++;
        while (i < lines.length) {
          const textLine = lines[i];
          if (!textLine.trim()) { textLines.push(''); i++; continue; }
          const tli = textLine.search(/\S/);
          if (tli < textIndent) { i--; break; }
          textLines.push(textLine.substring(textIndent));
          i++;
        }
        value = textLines.join('\n');
      } else if (value.startsWith('[') && value.endsWith(']')) {
        try { value = JSON.parse(value); } catch {
          value = value.substring(1, value.length - 1).split(',').map((v: string) => v.trim().replace(/^["']|["']$/g, ''));
        }
      } else if (value.startsWith('{') && value.endsWith('}')) {
        try { value = JSON.parse(value); } catch { /* ignore */ }
      } else if (value.startsWith('"') && value.endsWith('"')) {
        value = value.substring(1, value.length - 1);
      } else if (value.startsWith("'") && value.endsWith("'")) {
        value = value.substring(1, value.length - 1);
      } else if (value === 'true') { value = true; }
      else if (value === 'false') { value = false; }
      else if (value === 'null') { value = null; }
      else if (value !== '' && !isNaN(Number(value))) { value = Number(value); }

      if (key === '-') {
        const parent = stack[stack.length - 1]?.obj;
        const pkeys = Object.keys(parent || result);
        const lk = pkeys[pkeys.length - 1];
        const container = (parent && lk) ? parent : result;
        const containerKey = lk || 'items';
        if (!Array.isArray(container[containerKey])) container[containerKey] = [];
        if (typeof value === 'string' && ['', '|', '>'].includes(value)) {
          container[containerKey].push({});
          stack.push({ obj: currentObj, indent: currentIndent });
          currentObj = container[containerKey][container[containerKey].length - 1];
          currentIndent = indent + 2;
        } else {
          container[containerKey].push(value);
        }
      } else {
        if (typeof value === 'string' && ['', '|', '>'].includes(value)) {
          currentObj[key] = {};
          stack.push({ obj: currentObj, indent: currentIndent });
          currentObj = currentObj[key];
          currentIndent = indent + 2;
        } else {
          currentObj[key] = value;
        }
      }
    }

    return result as BusinessConfig;
  }

  merge(metadata: DatabaseMetadata): DatabaseMetadata {
    return {
      ...metadata,
      tables: metadata.tables.map(t => this.mergeTableBusinessInfo(t))
    };
  }

  private mergeTableBusinessInfo(table: TableInfo): TableInfo {
    const bi = this.findTableBusinessInfo(table.name);
    if (!bi) return table;

    return {
      ...table,
      columns: table.columns.map(c => this.mergeColumnBusinessInfo(c, bi)),
      businessDescription: bi.description || table.businessDescription
    };
  }

  private mergeColumnBusinessInfo(column: ColumnInfo, bi: BusinessDescription): ColumnInfo {
    const desc = bi.columns?.[column.name];
    if (!desc) return column;
    return { ...column, businessDescription: desc };
  }

  private findTableBusinessInfo(tableName: string): BusinessDescription | undefined {
    if (!this.businessConfig.tables) return undefined;
    const lower = tableName.toLowerCase();
    return this.businessConfig.tables.find(t =>
      t.tableName === tableName || t.tableName.toLowerCase() === lower
    );
  }

  getBusinessConfig(): BusinessConfig { return this.businessConfig; }
  getTitle(): string | undefined { return this.businessConfig.title; }
  getDescription(): string | undefined { return this.businessConfig.description; }
  getVersion(): string | undefined { return this.businessConfig.version; }
  getGeneratedBy(): string | undefined { return this.businessConfig.generatedBy; }
}
