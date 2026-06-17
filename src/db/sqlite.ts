import * as sqlite3 from 'sqlite3';
import { Database } from 'sqlite3';
import { DatabaseConnector } from './base';
import { DatabaseConfig, TableInfo, ColumnInfo, ColumnConstraint, ForeignKeyInfo, IndexInfo, ScanConfig } from '../types';

export class SQLiteConnector extends DatabaseConnector {
  private db!: Database;
  private dbPath: string;

  constructor(config: DatabaseConfig) {
    super(config);
    this.dbPath = config.filename || config.connectionString.replace('sqlite://', '');
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
        if (err) {
          reject(err);
        } else {
          resolve(rows as T[]);
        }
      });
    });
  }

  async getTables(scanConfig?: ScanConfig): Promise<string[]> {
    const typeFilter = scanConfig?.includeViews 
      ? "IN ('table', 'view')" 
      : "= 'table'";
    
    const sql = `
      SELECT name FROM sqlite_master 
      WHERE type ${typeFilter} 
        AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `;
    
    const rows = await this.query<{ name: string }>(sql);
    const tableNames = rows.map(r => r.name);
    
    return tableNames.filter(name => this.shouldIncludeTable(name, scanConfig));
  }

  async getTableInfo(tableName: string, _schema?: string): Promise<TableInfo> {
    const columns = await this.getColumns(tableName);
    const foreignKeys = await this.getForeignKeys(tableName);
    const indexes = await this.getIndexes(tableName);
    const primaryKey = this.extractPrimaryKey(columns);
    const comment = await this.getTableComment(tableName);

    return {
      name: tableName,
      comment,
      columns,
      foreignKeys,
      indexes,
      primaryKey
    };
  }

  private async getColumns(tableName: string): Promise<ColumnInfo[]> {
    const sql = `PRAGMA table_info("${tableName}")`;
    const rows = await this.query<any>(sql);
    
    const foreignKeys = await this.getForeignKeys(tableName);
    const fkColumns = new Set(foreignKeys.map(fk => fk.columnName));
    
    const columns: ColumnInfo[] = rows.map((row: any) => {
      const constraints: ColumnConstraint[] = [];
      
      if (row.pk) {
        constraints.push({
          name: `${tableName}_${row.name}_pk`,
          type: 'PRIMARY KEY'
        });
      }
      
      if (!row.notnull && !row.pk) {
        constraints.push({
          name: `${tableName}_${row.name}_notnull`,
          type: 'NOT NULL'
        });
      }
      
      if (row.dflt_value !== null) {
        constraints.push({
          name: `${tableName}_${row.name}_default`,
          type: 'DEFAULT',
          expression: row.dflt_value
        });
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

      const dataType = this.normalizeType(row.type);
      
      return {
        name: row.name,
        dataType,
        udtName: row.type,
        isNullable: !row.notnull && !row.pk,
        default: row.dflt_value || undefined,
        position: row.cid,
        constraints,
        comment: undefined
      };
    });

    return columns;
  }

  private async getForeignKeys(tableName: string): Promise<ForeignKeyInfo[]> {
    const sql = `PRAGMA foreign_key_list("${tableName}")`;
    const rows = await this.query<any>(sql);
    
    return rows.map((row: any) => ({
      name: `${tableName}_${row.from}_fkey`,
      columnName: row.from,
      foreignTableName: row.table,
      foreignColumnName: row.to,
      deleteRule: row.on_delete || 'NO ACTION',
      updateRule: row.on_update || 'NO ACTION'
    }));
  }

  private async getIndexes(tableName: string): Promise<IndexInfo[]> {
    const sql = `PRAGMA index_list("${tableName}")`;
    const rows = await this.query<any>(sql);
    
    const indexes: IndexInfo[] = [];
    
    for (const row of rows) {
      const columnSql = `PRAGMA index_info("${row.name}")`;
      const columnRows = await this.query<any>(columnSql);
      const columns = columnRows.map((c: any) => c.name).sort((a: any, b: any) => a.seqno - b.seqno);
      
      indexes.push({
        name: row.name,
        columns,
        isUnique: row.unique === 1,
        isPrimary: row.origin === 'pk'
      });
    }
    
    return indexes;
  }

  private async getTableComment(tableName: string): Promise<string | undefined> {
    try {
      const sql = `SELECT sql FROM sqlite_master WHERE name = ? AND type IN ('table', 'view')`;
      const rows = await this.query<{ sql: string }>(sql, [tableName]);
      
      if (rows.length > 0) {
        const createSql = rows[0].sql;
        const commentMatch = createSql.match(/COMMENT\s*=\s*['"]([^'"]+)['"]/i);
        if (commentMatch) {
          return commentMatch[1];
        }
      }
    } catch {
    }
    
    return undefined;
  }

  private extractPrimaryKey(columns: ColumnInfo[]): string[] | undefined {
    const pkColumns = columns
      .filter(col => col.constraints.some(c => c.type === 'PRIMARY KEY'))
      .sort((a, b) => a.position - b.position)
      .map(col => col.name);
    
    return pkColumns.length > 0 ? pkColumns : undefined;
  }

  private normalizeType(type: string): string {
    const upperType = type.toUpperCase();
    
    if (upperType.includes('INT')) return 'INTEGER';
    if (upperType.includes('CHAR') || upperType.includes('TEXT') || upperType.includes('CLOB')) return 'TEXT';
    if (upperType.includes('BLOB')) return 'BLOB';
    if (upperType.includes('REAL') || upperType.includes('FLOA') || upperType.includes('DOUB')) return 'REAL';
    if (upperType.includes('BOOL')) return 'INTEGER';
    if (upperType.includes('DATE') || upperType.includes('TIME')) return 'TEXT';
    if (upperType.includes('DEC') || upperType.includes('NUMERIC')) return 'NUMERIC';
    
    return type;
  }

  async getDatabaseVersion(): Promise<string> {
    const rows = await this.query<{ sqlite_version: string }>('SELECT sqlite_version() as sqlite_version');
    return `SQLite ${rows[0]?.sqlite_version || 'unknown'}`;
  }

  async getDatabaseName(): Promise<string> {
    const pathParts = this.dbPath.split(/[\\/]/);
    return pathParts[pathParts.length - 1] || 'unknown';
  }
}
