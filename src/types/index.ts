export type DatabaseType = 'sqlite' | 'postgres';

export interface DatabaseConfig {
  type: DatabaseType;
  connectionString: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  filename?: string;
}

export interface ColumnConstraint {
  name: string;
  type: 'PRIMARY KEY' | 'FOREIGN KEY' | 'UNIQUE' | 'NOT NULL' | 'CHECK' | 'DEFAULT';
  expression?: string;
  foreignTable?: string;
  foreignColumn?: string;
}

export interface EnumValue {
  name: string;
  label?: string;
}

export interface ColumnInfo {
  name: string;
  dataType: string;
  udtName?: string;
  isNullable: boolean;
  default?: string;
  characterMaximumLength?: number;
  numericPrecision?: number;
  numericScale?: number;
  position: number;
  comment?: string;
  constraints: ColumnConstraint[];
  businessDescription?: string;
  enumValues?: EnumValue[];
}

export interface ForeignKeyInfo {
  name: string;
  columnName: string;
  foreignTableName: string;
  foreignColumnName: string;
  deleteRule?: string;
  updateRule?: string;
}

export interface IndexInfo {
  name: string;
  columns: string[];
  isUnique: boolean;
  isPrimary: boolean;
}

export interface TableInfo {
  name: string;
  schema?: string;
  comment?: string;
  columns: ColumnInfo[];
  foreignKeys: ForeignKeyInfo[];
  indexes: IndexInfo[];
  primaryKey?: string[];
  businessDescription?: string;
}

export interface DatabaseMetadata {
  databaseName: string;
  databaseType: DatabaseType;
  generatedAt: string;
  tables: TableInfo[];
  version?: string;
}

export interface BusinessDescription {
  tableName: string;
  description?: string;
  columns?: Record<string, string>;
}

export interface ConfluenceConfig {
  baseUrl: string;
  apiToken: string;
  user?: string;
  spaceKey?: string;
  pageId?: string;
  pageTitlePattern?: string;
  tableHeaderRowPattern?: {
    table: string[];
    column: string[];
  };
}

export interface BusinessConfig {
  title?: string;
  description?: string;
  version?: string;
  tables?: BusinessDescription[];
  generatedBy?: string;
  confluence?: ConfluenceConfig;
}

export interface OutputConfig {
  format: 'html' | 'markdown' | 'json' | 'erd-svg' | 'erd-png';
  outputPath: string;
  title?: string;
  includeForeignKeys?: boolean;
  includeIndexes?: boolean;
  tableOfContents?: boolean;
  theme?: 'light' | 'dark';
  template?: string;
  lang?: 'zh' | 'en';
}

export interface ScanConfig {
  tables?: string[];
  excludeTables?: string[];
  schemas?: string[];
  includeViews?: boolean;
}

export interface GeneratorConfig {
  database: DatabaseConfig;
  scan?: ScanConfig;
  output: OutputConfig;
  business?: BusinessConfig;
}
