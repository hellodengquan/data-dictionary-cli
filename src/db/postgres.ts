import { Client, ClientConfig } from 'pg';
import { DatabaseConnector, TableWithSchema } from './base';
import { DatabaseConfig, TableInfo, ColumnInfo, ColumnConstraint, ForeignKeyInfo, IndexInfo, ScanConfig, EnumValue } from '../types';

const POSTGRES_ADVANCED_TYPES: Record<string, string> = {
  'json': 'JSON',
  'jsonb': 'JSONB',
  'uuid': 'UUID',
  'xml': 'XML',
  'inet': 'INET',
  'cidr': 'CIDR',
  'macaddr': 'MACADDR',
  'macaddr8': 'MACADDR8',
  'tsvector': 'TSVECTOR',
  'tsquery': 'TSQUERY',
  'bytea': 'BYTEA',
  'interval': 'INTERVAL',
  'money': 'MONEY',
  'geography': 'GEOGRAPHY',
  'geometry': 'GEOMETRY',
  'ltree': 'LTREE',
  'hstore': 'HSTORE',
  'pg_lsn': 'PG_LSN',
  'txid_snapshot': 'TXID_SNAPSHOT'
};

export class PostgresConnector extends DatabaseConnector {
  private client!: Client;
  private enumCache = new Map<string, EnumValue[]>();

  constructor(config: DatabaseConfig) {
    super(config);
    this.defaultSchema = 'public';
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
    if (this.client) { await this.client.end(); }
  }

  private async query<T>(sql: string, params: any[] = []): Promise<T[]> {
    const result = await this.client.query(sql, params);
    return result.rows as T[];
  }

  async getAllSchemas(): Promise<string[]> {
    const rows = await this.query<{ schema_name: string }>(
      "SELECT schema_name FROM information_schema.schemata " +
      "WHERE schema_name NOT LIKE 'pg_%' AND schema_name <> 'information_schema' " +
      "ORDER BY schema_name"
    );
    return rows.map(r => r.schema_name);
  }

  async listTablesInSchemas(schemas: string[], includeViews = false): Promise<TableWithSchema[]> {
    if (!schemas.length) return [];
    const placeholders = schemas.map((_, i) => `$${i + 1}`).join(',');
    const typeCondition = includeViews
      ? "t.table_type IN ('BASE TABLE', 'VIEW', 'MATERIALIZED VIEW')"
      : "t.table_type IN ('BASE TABLE', 'MATERIALIZED VIEW')";

    const sql = `
      SELECT t.table_name, t.table_schema
      FROM information_schema.tables t
      WHERE t.table_schema IN (${placeholders})
        AND ${typeCondition}
        AND t.table_name NOT LIKE 'pg_%'
        AND t.table_name NOT LIKE 'sql_%'
      ORDER BY t.table_schema, t.table_name
    `;
    const rows = await this.query<{ table_name: string; table_schema: string }>(sql, schemas);
    return rows.map(r => ({ name: r.table_name, schema: r.table_schema }));
  }

  async getTables(scanConfig?: ScanConfig): Promise<string[]> {
    const resolved = await this.resolveSchemas(scanConfig);
    const list = await this.listTablesInSchemas(resolved, scanConfig?.includeViews);
    return list
      .filter(ts => this.shouldIncludeTable(ts.name, scanConfig))
      .map(ts => ts.name);
  }

  async getTableInfo(tableName: string, schema?: string): Promise<TableInfo> {
    const tableSchema = schema || this.defaultSchema;

    const [columns, foreignKeys, indexes, comment] = await Promise.all([
      this.getColumns(tableName, tableSchema),
      this.getForeignKeys(tableName, tableSchema),
      this.getIndexes(tableName, tableSchema),
      this.getTableComment(tableName, tableSchema)
    ]);

    return {
      name: tableName,
      schema: tableSchema,
      comment: comment || undefined,
      columns,
      foreignKeys,
      indexes,
      primaryKey: this.extractPrimaryKey(columns)
    };
  }

  private async preloadEnums(schema: string): Promise<void> {
    if (this.enumCache.size > 0) return;
    const rows = await this.query<any>(`
      SELECT
        t.typname AS enum_type,
        e.enumlabel AS enum_value,
        e.enumsortorder AS sort_order
      FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
      JOIN pg_namespace n ON t.typnamespace = n.oid
      WHERE n.nspname = $1
      ORDER BY t.typname, e.enumsortorder
    `, [schema]);
    for (const row of rows) {
      const arr = this.enumCache.get(row.enum_type) || [];
      arr.push({ name: row.enum_value });
      this.enumCache.set(row.enum_type, arr);
    }
  }

  private async getColumns(tableName: string, schema: string): Promise<ColumnInfo[]> {
    await this.preloadEnums(schema);

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
        pg_catalog.col_description(quote_ident(c.table_schema) || '.' || quote_ident(c.table_name)::regclass::oid, c.ordinal_position) AS column_comment,
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
        columnMap.set(row.column_name, { ...row, constraintTypes: [] as string[], constraintNames: new Map<string, string>() });
      }
      if (row.constraint_type) {
        const entry = columnMap.get(row.column_name);
        entry.constraintTypes.push(row.constraint_type);
        entry.constraintNames.set(row.constraint_type, row.constraint_name);
      }
    }

    const [uniqueConstraints, checkConstraints, foreignKeys] = await Promise.all([
      this.getUniqueConstraints(tableName, schema),
      this.getCheckConstraints(tableName, schema),
      this.getForeignKeys(tableName, schema)
    ]);
    const fkColumns = new Set(foreignKeys.map(fk => fk.columnName));

    const columns: ColumnInfo[] = [];

    for (const col of columnMap.values()) {
      const constraints: ColumnConstraint[] = [];
      const udt = String(col.udt_name || '').toLowerCase();
      const rawType = String(col.data_type || '');

      let effectiveDataType = rawType;
      if (POSTGRES_ADVANCED_TYPES[udt]) {
        effectiveDataType = POSTGRES_ADVANCED_TYPES[udt];
      } else if (rawType === 'USER-DEFINED' && this.enumCache.has(udt)) {
        effectiveDataType = `ENUM (${this.enumCache.get(udt)!.map(e => "'" + e.name + "'").join(', ')})`;
      } else if (rawType === 'USER-DEFINED') {
        effectiveDataType = udt.toUpperCase();
      } else if (rawType === 'ARRAY') {
        effectiveDataType = `${udt.replace(/^_/, '').toUpperCase()}[]`;
      }

      if (col.constraintTypes.includes('PRIMARY KEY')) {
        constraints.push({
          name: col.constraintNames.get('PRIMARY KEY') || `${tableName}_pkey`,
          type: 'PRIMARY KEY'
        });
      }
      if (col.is_nullable === 'NO') {
        constraints.push({ name: `${tableName}_${col.column_name}_notnull`, type: 'NOT NULL' });
      }
      if (col.column_default) {
        constraints.push({ name: `${tableName}_${col.column_name}_default`, type: 'DEFAULT', expression: col.column_default });
      }
      if (uniqueConstraints.has(col.column_name)) {
        constraints.push({
          name: uniqueConstraints.get(col.column_name)!,
          type: 'UNIQUE'
        });
      }
      if (checkConstraints.has(col.column_name)) {
        constraints.push({
          name: `${tableName}_${col.column_name}_check`,
          type: 'CHECK',
          expression: checkConstraints.get(col.column_name)
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

      const colInfo: ColumnInfo = {
        name: col.column_name,
        dataType: effectiveDataType,
        udtName: col.udt_name,
        isNullable: col.is_nullable === 'YES',
        default: col.column_default || undefined,
        characterMaximumLength: col.character_maximum_length || undefined,
        numericPrecision: col.numeric_precision || undefined,
        numericScale: col.numeric_scale || undefined,
        position: col.ordinal_position,
        comment: col.column_comment || undefined,
        constraints
      };

      if (this.enumCache.has(udt)) {
        colInfo.enumValues = this.enumCache.get(udt)!;
      }

      columns.push(colInfo);
    }

    return columns.sort((a, b) => a.position - b.position);
  }

  private async getUniqueConstraints(tableName: string, schema: string): Promise<Map<string, string>> {
    const rows = await this.query<{ column_name: string; constraint_name: string }>(`
      SELECT kcu.column_name, tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      WHERE tc.table_schema = $1 AND tc.table_name = $2 AND tc.constraint_type = 'UNIQUE'
    `, [schema, tableName]);
    const result = new Map<string, string>();
    for (const row of rows) result.set(row.column_name, row.constraint_name);
    return result;
  }

  private async getCheckConstraints(tableName: string, schema: string): Promise<Map<string, string>> {
    const rows = await this.query<{ column_name: string; check_clause: string }>(`
      SELECT kcu.column_name, cc.check_clause
      FROM information_schema.table_constraints tc
      JOIN information_schema.check_constraints cc
        ON tc.constraint_name = cc.constraint_name AND tc.table_schema = cc.constraint_schema
      LEFT JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      WHERE tc.table_schema = $1 AND tc.table_name = $2 AND tc.constraint_type = 'CHECK'
    `, [schema, tableName]);
    const result = new Map<string, string>();
    for (const row of rows) if (row.column_name) result.set(row.column_name, row.check_clause);
    return result;
  }

  private async getForeignKeys(tableName: string, schema: string): Promise<ForeignKeyInfo[]> {
    const rows = await this.query<any>(`
      SELECT
        tc.constraint_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name,
        rc.delete_rule,
        rc.update_rule,
        kcu.ordinal_position
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.table_schema
      JOIN information_schema.referential_constraints rc
        ON tc.constraint_name = rc.constraint_name AND tc.table_schema = rc.constraint_schema
      WHERE tc.table_schema = $1 AND tc.table_name = $2 AND tc.constraint_type = 'FOREIGN KEY'
      ORDER BY tc.constraint_name, kcu.ordinal_position
    `, [schema, tableName]);
    const merged = new Map<string, ForeignKeyInfo>();
    for (const row of rows) {
      const existing = merged.get(row.constraint_name);
      if (existing) {
        existing.columnName += ',' + row.column_name;
        existing.foreignColumnName += ',' + row.foreign_column_name;
      } else {
        merged.set(row.constraint_name, {
          name: row.constraint_name,
          columnName: row.column_name,
          foreignTableName: row.foreign_table_name,
          foreignColumnName: row.foreign_column_name,
          deleteRule: row.delete_rule,
          updateRule: row.update_rule
        });
      }
    }
    return Array.from(merged.values());
  }

  private async getIndexes(tableName: string, schema: string): Promise<IndexInfo[]> {
    const rows = await this.query<any>(`
      SELECT
        i.relname AS index_name,
        ix.indisunique AS is_unique,
        ix.indisprimary AS is_primary,
        array_agg(a.attname ORDER BY array_position(ix.indkey, a.attnum)) AS columns
      FROM pg_index ix
      JOIN pg_class t ON t.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
      WHERE n.nspname = $1 AND t.relname = $2
      GROUP BY i.relname, ix.indisunique, ix.indisprimary
      ORDER BY ix.indisprimary DESC, i.relname
    `, [schema, tableName]);
    return rows.map(r => ({
      name: r.index_name,
      columns: Array.isArray(r.columns) ? r.columns : [],
      isUnique: !!r.is_unique,
      isPrimary: !!r.is_primary
    }));
  }

  private async getTableComment(tableName: string, schema: string): Promise<string | undefined> {
    const rows = await this.query<{ comment: string }>(
      `SELECT obj_description(($1::text || '.' || $2::text)::regclass::oid) AS comment`,
      [schema, tableName]
    );
    return rows[0]?.comment || undefined;
  }

  private extractPrimaryKey(columns: ColumnInfo[]): string[] | undefined {
    const pk = columns
      .filter(c => c.constraints.some(cc => cc.type === 'PRIMARY KEY'))
      .sort((a, b) => a.position - b.position)
      .map(c => c.name);
    return pk.length ? pk : undefined;
  }

  async getDatabaseVersion(): Promise<string> {
    const rows = await this.query<{ v: string }>('SELECT version() AS v');
    const m = rows[0]?.v?.match(/PostgreSQL\s+([\d.]+)/);
    return m ? `PostgreSQL ${m[1]}` : (rows[0]?.v || 'unknown');
  }

  async getDatabaseName(): Promise<string> {
    const rows = await this.query<{ d: string }>('SELECT current_database() AS d');
    return rows[0]?.d || 'unknown';
  }
}
