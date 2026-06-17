import { Client, ClientConfig } from 'pg';
import { DatabaseConnector } from './base';
import { DatabaseConfig, TableInfo, ColumnInfo, ColumnConstraint, ForeignKeyInfo, IndexInfo, ScanConfig } from '../types';

export class PostgresConnector extends DatabaseConnector {
  private client!: Client;
  private defaultSchema = 'public';

  constructor(config: DatabaseConfig) {
    super(config);
  }

  private getClientConfig(): ClientConfig {
    if (this.config.connectionString) {
      return { connectionString: this.config.connectionString };
    }
    return {
      host: this.config.host || 'localhost',
      port: this.config.port || 5432,
      database: this.config.database,
      user: this.config.user,
      password: this.config.password
    };
  }

  async connect(): Promise<void> {
    this.client = new Client(this.getClientConfig());
    await this.client.connect();
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.end();
    }
  }

  private async query<T>(sql: string, params: any[] = []): Promise<T[]> {
    const result = await this.client.query(sql, params);
    return result.rows as T[];
  }

  async getTables(scanConfig?: ScanConfig): Promise<string[]> {
    const schemas = scanConfig?.schemas && scanConfig.schemas.length > 0 
      ? scanConfig.schemas 
      : [this.defaultSchema];
    
    const schemaPlaceholders = schemas.map((_, i) => `$${i + 1}`).join(',');
    const params = [...schemas];
    
    let typeCondition = "t.table_type = 'BASE TABLE'";
    if (scanConfig?.includeViews) {
      typeCondition = "t.table_type IN ('BASE TABLE', 'VIEW')";
    }
    
    const sql = `
      SELECT 
        t.table_name,
        t.table_schema
      FROM information_schema.tables t
      WHERE t.table_schema IN (${schemaPlaceholders})
        AND ${typeCondition}
        AND t.table_name NOT LIKE 'pg_%'
        AND t.table_name NOT LIKE 'sql_%'
      ORDER BY t.table_schema, t.table_name
    `;
    
    const rows = await this.query<{ table_name: string; table_schema: string }>(sql, params);
    const tableNames = rows.map(r => r.table_name);
    
    return tableNames.filter(name => this.shouldIncludeTable(name, scanConfig));
  }

  async getTableInfo(tableName: string, schema?: string): Promise<TableInfo> {
    const tableSchema = schema || this.defaultSchema;
    
    const [columns, foreignKeys, indexes, comment] = await Promise.all([
      this.getColumns(tableName, tableSchema),
      this.getForeignKeys(tableName, tableSchema),
      this.getIndexes(tableName, tableSchema),
      this.getTableComment(tableName, tableSchema)
    ]);
    
    const primaryKey = this.extractPrimaryKey(columns);
    
    return {
      name: tableName,
      schema: tableSchema,
      comment: comment || undefined,
      columns,
      foreignKeys,
      indexes,
      primaryKey
    };
  }

  private async getColumns(tableName: string, schema: string): Promise<ColumnInfo[]> {
    const sql = `
      SELECT 
        c.column_name,
        c.data_type,
        c.udt_name,
        c.is_nullable,
        c.column_default,
        c.character_maximum_length,
        c.numeric_precision,
        c.numeric_scale,
        c.ordinal_position,
        pg_catalog.col_description(c.table_name::regclass::oid, c.ordinal_position) as column_comment,
        tc.constraint_type,
        kcu.constraint_name
      FROM information_schema.columns c
      LEFT JOIN information_schema.key_column_usage kcu 
        ON c.table_schema = kcu.table_schema 
        AND c.table_name = kcu.table_name 
        AND c.column_name = kcu.column_name
      LEFT JOIN information_schema.table_constraints tc 
        ON kcu.constraint_name = tc.constraint_name 
        AND kcu.table_schema = tc.table_schema
      WHERE c.table_schema = $1 
        AND c.table_name = $2
      ORDER BY c.ordinal_position
    `;
    
    const rows = await this.query<any>(sql, [schema, tableName]);
    const columnMap = new Map<string, any>();
    
    for (const row of rows) {
      if (!columnMap.has(row.column_name)) {
        columnMap.set(row.column_name, {
          ...row,
          constraints: [] as string[]
        });
      }
      if (row.constraint_type) {
        columnMap.get(row.column_name).constraints.push(row.constraint_type);
      }
    }
    
    const uniqueConstraints = await this.getUniqueConstraints(tableName, schema);
    const checkConstraints = await this.getCheckConstraints(tableName, schema);
    const foreignKeys = await this.getForeignKeys(tableName, schema);
    const fkColumns = new Set(foreignKeys.map(fk => fk.columnName));
    
    const columns: ColumnInfo[] = [];
    
    for (const col of columnMap.values()) {
      const constraints: ColumnConstraint[] = [];
      
      if (col.constraints.includes('PRIMARY KEY')) {
        constraints.push({
          name: col.constraint_name || `${tableName}_${col.column_name}_pkey`,
          type: 'PRIMARY KEY'
        });
      }
      
      if (col.is_nullable === 'NO') {
        constraints.push({
          name: `${tableName}_${col.column_name}_notnull`,
          type: 'NOT NULL'
        });
      }
      
      if (col.column_default) {
        constraints.push({
          name: `${tableName}_${col.column_name}_default`,
          type: 'DEFAULT',
          expression: col.column_default
        });
      }
      
      if (uniqueConstraints.has(col.column_name)) {
        constraints.push({
          name: uniqueConstraints.get(col.column_name) || `${tableName}_${col.column_name}_unique`,
          type: 'UNIQUE'
        });
      }
      
      if (checkConstraints.has(col.column_name)) {
        const checkExpr = checkConstraints.get(col.column_name);
        constraints.push({
          name: `${tableName}_${col.column_name}_check`,
          type: 'CHECK',
          expression: checkExpr
        });
      }
      
      if (fkColumns.has(col.column_name)) {
        const fk = foreignKeys.find(f => f.columnName === col.column_name);
        if (fk) {
          constraints.push({
            name: fk.name,
            type: 'FOREIGN KEY',
            foreignTable: fk.foreignTableName,
            foreignColumn: fk.foreignColumnName
          });
        }
      }
      
      columns.push({
        name: col.column_name,
        dataType: col.data_type,
        udtName: col.udt_name,
        isNullable: col.is_nullable === 'YES',
        default: col.column_default || undefined,
        characterMaximumLength: col.character_maximum_length || undefined,
        numericPrecision: col.numeric_precision || undefined,
        numericScale: col.numeric_scale || undefined,
        position: col.ordinal_position,
        comment: col.column_comment || undefined,
        constraints
      });
    }
    
    return columns.sort((a, b) => a.position - b.position);
  }

  private async getUniqueConstraints(tableName: string, schema: string): Promise<Map<string, string>> {
    const sql = `
      SELECT 
        kcu.column_name,
        tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu 
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.table_schema = $1
        AND tc.table_name = $2
        AND tc.constraint_type = 'UNIQUE'
    `;
    
    const rows = await this.query<{ column_name: string; constraint_name: string }>(sql, [schema, tableName]);
    const result = new Map<string, string>();
    
    for (const row of rows) {
      result.set(row.column_name, row.constraint_name);
    }
    
    return result;
  }

  private async getCheckConstraints(tableName: string, schema: string): Promise<Map<string, string>> {
    const sql = `
      SELECT 
        kcu.column_name,
        cc.check_clause
      FROM information_schema.table_constraints tc
      JOIN information_schema.check_constraints cc 
        ON tc.constraint_name = cc.constraint_name
        AND tc.table_schema = cc.constraint_schema
      LEFT JOIN information_schema.key_column_usage kcu 
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.table_schema = $1
        AND tc.table_name = $2
        AND tc.constraint_type = 'CHECK'
    `;
    
    const rows = await this.query<{ column_name: string; check_clause: string }>(sql, [schema, tableName]);
    const result = new Map<string, string>();
    
    for (const row of rows) {
      if (row.column_name) {
        result.set(row.column_name, row.check_clause);
      }
    }
    
    return result;
  }

  private async getForeignKeys(tableName: string, schema: string): Promise<ForeignKeyInfo[]> {
    const sql = `
      SELECT
        tc.constraint_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name,
        rc.delete_rule,
        rc.update_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu 
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu 
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.constraint_schema = tc.table_schema
      JOIN information_schema.referential_constraints rc 
        ON tc.constraint_name = rc.constraint_name
        AND tc.table_schema = rc.constraint_schema
      WHERE tc.table_schema = $1
        AND tc.table_name = $2
        AND tc.constraint_type = 'FOREIGN KEY'
      ORDER BY kcu.ordinal_position
    `;
    
    const rows = await this.query<any>(sql, [schema, tableName]);
    
    return rows.map(row => ({
      name: row.constraint_name,
      columnName: row.column_name,
      foreignTableName: row.foreign_table_name,
      foreignColumnName: row.foreign_column_name,
      deleteRule: row.delete_rule,
      updateRule: row.update_rule
    }));
  }

  private async getIndexes(tableName: string, schema: string): Promise<IndexInfo[]> {
    const sql = `
      SELECT
        i.indexname AS index_name,
        i.indexdef AS index_def,
        pg_am.amname AS index_type,
        i.indisunique AS is_unique,
        i.indisprimary AS is_primary,
        array_agg(a.attname ORDER BY array_position(i.indkey, a.attnum)) AS columns
      FROM pg_indexes idx
      JOIN pg_index i ON idx.indexname = i.indexrelid::regclass::text
      JOIN pg_class t ON idx.tablename = t.relname
      JOIN pg_am ON i.indexrelid::regclass::oid = pg_am.oid
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(i.indkey)
      WHERE idx.schemaname = $1
        AND idx.tablename = $2
      GROUP BY i.indexname, i.indexdef, pg_am.amname, i.indisunique, i.indisprimary
      ORDER BY i.indisprimary DESC, i.indexname
    `;
    
    try {
      const rows = await this.query<any>(sql, [schema, tableName]);
      
      return rows.map(row => ({
        name: row.index_name,
        columns: row.columns,
        isUnique: row.is_unique,
        isPrimary: row.is_primary
      }));
    } catch {
      const fallbackSql = `
        SELECT
          indexname AS index_name,
          indexdef AS index_def
        FROM pg_indexes
        WHERE schemaname = $1 AND tablename = $2
        ORDER BY indexname
      `;
      
      const fallbackRows = await this.query<{ index_name: string; index_def: string }>(fallbackSql, [schema, tableName]);
      
      return fallbackRows.map(row => {
        const uniqueMatch = row.index_def.match(/UNIQUE/);
        const columnMatch = row.index_def.match(/\(([^)]+)\)/);
        const columns = columnMatch 
          ? columnMatch[1].split(',').map(c => c.trim().replace(/^"|"$/g, '')) 
          : [];
        
        return {
          name: row.index_name,
          columns,
          isUnique: !!uniqueMatch,
          isPrimary: row.index_name.includes('_pkey') || row.index_name.includes('_pk')
        };
      });
    }
  }

  private async getTableComment(tableName: string, schema: string): Promise<string | undefined> {
    const sql = `
      SELECT obj_description(($1 || '.' || $2)::regclass::oid) AS table_comment
    `;
    
    const rows = await this.query<{ table_comment: string }>(sql, [schema, tableName]);
    return rows[0]?.table_comment || undefined;
  }

  private extractPrimaryKey(columns: ColumnInfo[]): string[] | undefined {
    const pkColumns = columns
      .filter(col => col.constraints.some(c => c.type === 'PRIMARY KEY'))
      .sort((a, b) => a.position - b.position)
      .map(col => col.name);
    
    return pkColumns.length > 0 ? pkColumns : undefined;
  }

  async getDatabaseVersion(): Promise<string> {
    const rows = await this.query<{ version: string }>('SELECT version()');
    const versionStr = rows[0]?.version || 'unknown';
    const match = versionStr.match(/PostgreSQL\s+([\d.]+)/);
    return match ? `PostgreSQL ${match[1]}` : versionStr;
  }

  async getDatabaseName(): Promise<string> {
    const rows = await this.query<{ current_database: string }>('SELECT current_database()');
    return rows[0]?.current_database || 'unknown';
  }
}
