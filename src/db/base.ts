import { DatabaseConfig, TableInfo, DatabaseMetadata, ScanConfig } from '../types';

export abstract class DatabaseConnector {
  protected config: DatabaseConfig;

  constructor(config: DatabaseConfig) {
    this.config = config;
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract getTables(scanConfig?: ScanConfig): Promise<string[]>;
  abstract getTableInfo(tableName: string, schema?: string): Promise<TableInfo>;
  abstract getDatabaseVersion(): Promise<string>;
  abstract getDatabaseName(): Promise<string>;

  async scanDatabase(scanConfig?: ScanConfig): Promise<DatabaseMetadata> {
    await this.connect();

    try {
      const tables = await this.getTables(scanConfig);
      const tableInfos: TableInfo[] = [];

      for (const tableName of tables) {
        const tableInfo = await this.getTableInfo(tableName, scanConfig?.schemas?.[0]);
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
      return scanConfig.tables.some(t => t === tableName || t.toLowerCase() === tableName.toLowerCase());
    }

    if (scanConfig.excludeTables && scanConfig.excludeTables.length > 0) {
      return !scanConfig.excludeTables.some(t => t === tableName || t.toLowerCase() === tableName.toLowerCase());
    }

    return true;
  }
}
