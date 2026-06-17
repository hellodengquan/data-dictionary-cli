import * as sqlite3 from 'sqlite3';
import { Database } from 'sqlite3';
import { DatabaseConnector, TableWithSchema } from './base';
import { DatabaseConfig, TableInfo, ColumnInfo, ColumnConstraint, ForeignKeyInfo, IndexInfo, ScanConfig } from '../types';

export class SQLiteConnector extends DatabaseConnector {
  private db!: Database;
  private dbPath: string;

  constructor(config: DatabaseConfig) {
    super(config);
    this.defaultSchema = 'main';
    this.dbPath = config.filename || config.connectionString.replace(/^sqlite:\/\//, '');
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async disconnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) { resolve(); return; }
      this.db.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  private async query<T>(sql: string, params: any[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) { reject(err); } else { resolve(rows as T[]); }
      });
    });
  }

  async getAllSchemas(): Promise<string[]> {
    return ['main', 'temp'];
  }

  async listTablesInSchemas(schemas: string[], includeViews = false): Promise<TableWithSchema[]> {
    const typeFilter = includeViews ? "IN ('table', 'view')" : "= 'table'";
    const sql = `
      SELECT name, 'main' as schema_name FROM sqlite_master
      WHERE type ${typeFilter} AND name NOT LIKE 'sqlite_%'
      UNION ALL
      SELECT name, 'temp' as schema_name FROM sqlite_temp_master
      WHERE type ${typeFilter} AND name NOT LIKE 'sqlite_%'
      ORDER BY schema_name, name
    `;
    const rows = await this.query<{ name: string; schema_name: string }>(sql);
    const result: TableWithSchema[] = [];
    for (const row of rows) {
      if (schemas.includes(row.schema_name)) {
        result.push({ name: row.name, schema: row.schema_name });
      }
    }
    return result;
  }

  async getTables(scanConfig?: ScanConfig): Promise<string[]> {
    const resolved = await this.resolveSchemas(scanConfig);
    const list = await this.listTablesInSchemas(resolved, scanConfig?.includeViews);
    return list
      .filter(ts => this.shouldIncludeTable(ts.name, scanConfig))
      .map(ts => ts.name);
  }

  async getTableInfo(tableName: string, _schema?: string): Promise<TableInfo> {
    const columns = await this.getColumns(tableName);
    const foreignKeys = await this.getForeignKeys(tableName);
    const indexes = await this.getIndexes(tableName);
    const primaryKey = this.extractPrimaryKey(columns);
    const comment = await this.getTableComment(tableName);

    return {
      name: tableName,
      schema: _schema || 'main',
      comment,
      columns,
      foreignKeys,
      indexes,
      primaryKey
    };
  }

  private async getColumns(tableName: string): Promise<ColumnInfo[]> {
    const rows = await this.query<any>(`PRAGMA table_info("${tableName}")`);
    const foreignKeys = await this.getForeignKeys(tableName);
    const fkColumns = new Set(foreignKeys.map(fk => fk.columnName));

    const columns: ColumnInfo[] = rows.map((row: any) => {
      const constraints: ColumnConstraint[] = [];

      if (row.pk) {
        constraints.push({ name: `${tableName}_${row.name}_pk`, type: 'PRIMARY KEY' });
      }
      if (row.notnull || row.pk) {
        constraints.push({ name: `${tableName}_${row.name}_notnull`, type: 'NOT NULL' });
      }
      if (row.dflt_value !== null && row.dflt_value !== undefined) {
        constraints.push({ name: `${tableName}_${row.name}_default`, type: 'DEFAULT', expression: String(row.dflt_value) });
      }
      if (fkColumns.has(row.name)) {
        const fk = foreignKeys.find(f => f.columnName === row.name);
        if (fk) {
          constraints.push({
            name: fk.name,
            type: 'FOREIGN KEY',
            foreignTable: fk.foreignTableName,
            foreignColumn: fk.foreignColumnName
          });
        }
      }

      const dataType = this.normalizeType(row.type || 'TEXT');

      return {
        name: row.name,
        dataType,
        udtName: row.type,
        isNullable: !(row.notnull || row.pk),
        default: row.dflt_value ?? undefined,
        position: row.cid,
        constraints,
        comment: undefined
      };
    });

    return columns;
  }

  private async getForeignKeys(tableName: string): Promise<ForeignKeyInfo[]> {
    const rows = await this.query<any>(`PRAGMA foreign_key_list("${tableName}")`);
    const map = new Map<string | number, ForeignKeyInfo>();
    for (const row of rows) {
      const existing = map.get(row.id);
      if (existing) {
        existing.columnName += (existing.columnName ? ',' : '') + row.from;
        existing.foreignColumnName += (existing.foreignColumnName ? ',' : '') + row.to;
      } else {
        map.set(row.id, {
          name: `${tableName}_${row.from}_fkey`,
          columnName: row.from,
          foreignTableName: row.table,
          foreignColumnName: row.to,
          deleteRule: row.on_delete || 'NO ACTION',
          updateRule: row.on_update || 'NO ACTION'
        });
      }
    }
    return Array.from(map.values());
  }

  private async getIndexes(tableName: string): Promise<IndexInfo[]> {
    const list = await this.query<any>(`PRAGMA index_list("${tableName}")`);
    const indexes: IndexInfo[] = [];
    for (const row of list) {
      const info = await this.query<any>(`PRAGMA index_info("${row.name}")`);
      const sorted = info.sort((a: any, b: any) => a.seqno - b.seqno);
      const columns = sorted.map((c: any) => c.name);
      indexes.push({
        name: row.name,
        columns,
        isUnique: row.unique === 1 || row.unique === '1',
        isPrimary: row.origin === 'pk'
      });
    }
    return indexes;
  }

  private async getTableComment(tableName: string): Promise<string | undefined> {
    try {
      const rows = await this.query<{ sql: string }>(
        "SELECT sql FROM sqlite_master WHERE name = ? AND type IN ('table', 'view') UNION ALL " +
        "SELECT sql FROM sqlite_temp_master WHERE name = ? AND type IN ('table', 'view')",
        [tableName, tableName]
      );
      if (rows.length > 0 && rows[0].sql) {
        const m = rows[0].sql.match(/COMMENT\s*=\s*['"]([^'"]+)['"]/i);
        if (m) return m[1];
      }
    } catch { /* ignore */ }
    return undefined;
  }

  private extractPrimaryKey(columns: ColumnInfo[]): string[] | undefined {
    const pk = columns
      .filter(c => c.constraints.some(cc => cc.type === 'PRIMARY KEY'))
      .sort((a, b) => a.position - b.position)
      .map(c => c.name);
    return pk.length ? pk : undefined;
  }

  private normalizeType(type: string): string {
    if (!type) return 'TEXT';
    const t = String(type).toUpperCase();
    if (t.includes('INT')) return 'INTEGER';
    if (t.includes('CHAR') || t.includes('TEXT') || t.includes('CLOB')) return 'TEXT';
    if (t.includes('BLOB')) return 'BLOB';
    if (t.includes('REAL') || t.includes('FLOA') || t.includes('DOUB')) return 'REAL';
    if (t.includes('BOOL')) return 'INTEGER';
    if (t.includes('DATE') || t.includes('TIME')) return 'TEXT';
    if (t.includes('DEC') || t.includes('NUMERIC')) return 'NUMERIC';
    return type;
  }

  async getDatabaseVersion(): Promise<string> {
    const rows = await this.query<{ v: string }>('SELECT sqlite_version() as v');
    return `SQLite ${rows[0]?.v || 'unknown'}`;
  }

  async getDatabaseName(): Promise<string> {
    const parts = this.dbPath.split(/[\\/]/);
    return parts[parts.length - 1] || 'unknown';
  }
}
