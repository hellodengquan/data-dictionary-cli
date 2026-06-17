import { DatabaseConfig, DatabaseType } from '../types';
import { DatabaseConnector } from './base';
import { SQLiteConnector } from './sqlite';
import { PostgresConnector } from './postgres';

export function createDatabaseConnector(config: DatabaseConfig): DatabaseConnector {
  switch (config.type) {
    case 'sqlite':
      return new SQLiteConnector(config);
    case 'postgres':
      return new PostgresConnector(config);
    default:
      throw new Error(`Unsupported database type: ${config.type}. Supported types are: sqlite, postgres`);
  }
}

export { DatabaseConnector } from './base';
export { SQLiteConnector } from './sqlite';
export { PostgresConnector } from './postgres';
export type { DatabaseType };
