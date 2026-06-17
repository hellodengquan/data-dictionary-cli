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
  isArray?: boolean;
  arrayItemType?: string;
  arrayDimensions?: number;
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

export type ConfluenceAuthType = 'basic' | 'bearer' | 'oauth2';

export interface ConfluenceAuthBasic {
  type: 'basic';
  username: string;
  password: string;
}

export interface ConfluenceAuthBearer {
  type: 'bearer';
  token: string;
  expiresAt?: string;
  warnDaysBefore?: number;
}

export interface ConfluenceAuthOAuth2 {
  type: 'oauth2';
  clientId: string;
  clientSecret: string;
  tokenEndpoint: string;
  scope?: string;
  refreshIntervalMinutes?: number;
  refreshIntervalSeconds?: number;
  minTtlSeconds?: number;
}

export type ConfluenceAuth = ConfluenceAuthBasic | ConfluenceAuthBearer | ConfluenceAuthOAuth2;

export interface ConfluenceConfig {
  apiUrl: string;
  auth: ConfluenceAuth;
  pageId?: string;
  spaceKey?: string;
  titlePattern?: string;
  recursive?: boolean;
  maxDepth?: number;
  tableHeaderRowPattern?: {
    table: string[];
    column: string[];
  };
  timeoutMs?: number;
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
  timezone?: string;
  dateFormat?: Intl.DateTimeFormatOptions;
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
