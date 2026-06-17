import { DatabaseConfig, TableInfo, DatabaseMetadata, ScanConfig } from '../types';
import { parsePatternList, matchParsedPatterns, detectWildcards } from '../utils/pattern';

export interface TableWithSchema {
  name: string;
  schema: string;
}

export abstract class DatabaseConnector {
  protected config: DatabaseConfig;
  protected defaultSchema = 'public';

  constructor(config: DatabaseConfig) {
    this.config = config;
    if (config.type === 'sqlite') {
      this.defaultSchema = 'main';
    }
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;

  abstract getAllSchemas(): Promise<string[]>;

  abstract listTablesInSchemas(schemas: string[], includeViews?: boolean): Promise<TableWithSchema[]>;

  abstract getTableInfo(tableName: string, schema?: string): Promise<TableInfo>;

  abstract getDatabaseVersion(): Promise<string>;
  abstract getDatabaseName(): Promise<string>;

  async resolveSchemas(scanConfig?: ScanConfig): Promise<string[]> {
    const rawSchemas = scanConfig?.schemas && scanConfig.schemas.length > 0
      ? scanConfig.schemas
      : [this.defaultSchema];

    const hasWildcards = detectWildcards(rawSchemas);

    if (!hasWildcards) {
      return rawSchemas.filter(s => !s.startsWith('!'));
    }

    const allSchemas = await this.getAllSchemas();
    const patterns = parsePatternList(rawSchemas);

    return allSchemas
      .filter(s => matchParsedPatterns(s, patterns))
      .sort();
  }

  async scanDatabase(scanConfig?: ScanConfig): Promise<DatabaseMetadata> {
    await this.connect();

    try {
      const resolvedSchemas = await this.resolveSchemas(scanConfig);
      const includeViews = scanConfig?.includeViews ?? false;

      const allTables = await this.listTablesInSchemas(resolvedSchemas, includeViews);

      const filteredTables = allTables.filter(ts => {
        if (!this.shouldIncludeTable(ts.name, scanConfig)) {
          return false;
        }
        return true;
      });

      const tableInfos: TableInfo[] = [];
      for (const ts of filteredTables) {
        const tableInfo = await this.getTableInfo(ts.name, ts.schema);
        if (!tableInfo.schema) {
          tableInfo.schema = ts.schema;
        }
        tableInfos.push(tableInfo);
      }

      const metadata: DatabaseMetadata = {
        databaseName: await this.getDatabaseName(),
        databaseType: this.config.type,
        generatedAt: new Date().toISOString(),
        tables: tableInfos,
        version: await this.getDatabaseVersion()
      };

      return metadata;
    } finally {
      await this.disconnect();
    }
  }

  protected shouldIncludeTable(tableName: string, scanConfig?: ScanConfig): boolean {
    if (!scanConfig) {
      return true;
    }

    if (scanConfig.tables && scanConfig.tables.length > 0) {
      const patterns = parsePatternList(scanConfig.tables);
      if (!matchParsedPatterns(tableName, patterns)) {
        return false;
      }
    }

    if (scanConfig.excludeTables && scanConfig.excludeTables.length > 0) {
      const patterns = parsePatternList(scanConfig.excludeTables.map(t => t.startsWith('!') ? t : '!' + t));
      if (!matchParsedPatterns(tableName, patterns)) {
        return false;
      }
    }

    return true;
  }
}
