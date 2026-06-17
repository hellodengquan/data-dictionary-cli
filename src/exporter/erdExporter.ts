import * as child_process from 'child_process';
import { Exporter, ExportContext } from './base';
import { TableInfo, ColumnConstraint } from '../types';

const ERD_THEMES = {
  light: {
    bgcolor: '#ffffff',
    headerBg: '#4f46e5',
    headerText: '#ffffff',
    bodyBg: '#ffffff',
    bodyAlt: '#f8fafc',
    border: '#94a3b8',
    text: '#1e293b',
    textSecondary: '#475569',
    pkBg: '#eef2ff',
    fkBg: '#ecfeff',
    edgeColor: '#64748b',
    edgeHighlight: '#4f46e5',
    font: 'Helvetica, "Microsoft YaHei", "PingFang SC", sans-serif'
  },
  dark: {
    bgcolor: '#0f172a',
    headerBg: '#3730a3',
    headerText: '#ffffff',
    bodyBg: '#1e293b',
    bodyAlt: '#0f172a',
    border: '#475569',
    text: '#f1f5f9',
    textSecondary: '#cbd5e1',
    pkBg: '#312e81',
    fkBg: '#164e63',
    edgeColor: '#64748b',
    edgeHighlight: '#818cf8',
    font: 'Helvetica, "Microsoft YaHei", "PingFang SC", sans-serif'
  }
};

type ErdTheme = keyof typeof ERD_THEMES;

export abstract class GraphvizErdExporter extends Exporter {
  protected theme: ErdTheme;

  constructor(ctx: ExportContext) {
    super(ctx);
    this.theme = (ctx.outputConfig.theme === 'dark' ? 'dark' : 'light') as ErdTheme;
  }

  abstract export(): Promise<string | Buffer>;

  protected async renderWithDot(dot: string, format: 'svg' | 'png'): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      let dotBin = 'dot';
      if (process.platform === 'win32') dotBin = 'dot.exe';

      const proc = child_process.spawn(dotBin, [`-T${format}`], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      const chunks: Buffer[] = [];
      const errChunks: Buffer[] = [];

      proc.stdout.on('data', (c) => chunks.push(c));
      proc.stderr.on('data', (c) => errChunks.push(c));

      proc.on('error', (err: any) => {
        if (err.code === 'ENOENT') {
          reject(
            new Error(
              `[ERD] 'dot' command not found. Please install Graphviz first:\n` +
                `  macOS:   brew install graphviz\n` +
                `  Ubuntu:  apt install graphviz\n` +
                `  Windows: choco install graphviz\n` +
                `  Or download from https://graphviz.org/download/`
            )
          );
        } else {
          reject(err);
        }
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          const errMsg = Buffer.concat(errChunks).toString('utf-8').trim();
          reject(new Error(`Graphviz dot failed (exit ${code}): ${errMsg || 'unknown error'}`));
          return;
        }
        resolve(Buffer.concat(chunks));
      });

      proc.stdin.write(dot);
      proc.stdin.end();
    });
  }

  protected buildDot(): string {
    const colors = ERD_THEMES[this.theme];
    const tables = this.context.metadata.tables;
    const t = this.i18n;

    const lines: string[] = [];
    lines.push(`digraph ERD {`);
    lines.push(`  graph [`);
    lines.push(`    rankdir = "LR",`);
    lines.push(`    bgcolor = "${colors.bgcolor}",`);
    lines.push(`    fontname = "${colors.font}",`);
    lines.push(`    fontsize = 11,`);
    lines.push(`    label = "${this.escapeDot(this.getTitle())}",`);
    lines.push(`    labelloc = "t",`);
    lines.push(`    labeljust = "l",`);
    lines.push(`    nodesep = 0.6,`);
    lines.push(`    ranksep = 1.2,`);
    lines.push(`    splines = "splines"`);
    lines.push(`  ];`);
    lines.push(``);
    lines.push(`  node [`);
    lines.push(`    shape = "plaintext",`);
    lines.push(`    fontname = "${colors.font}",`);
    lines.push(`    fontsize = 11`);
    lines.push(`  ];`);
    lines.push(``);
    lines.push(`  edge [`);
    lines.push(`    color = "${colors.edgeColor}",`);
    lines.push(`    fontname = "${colors.font}",`);
    lines.push(`    fontsize = 10,`);
    lines.push(`    fontcolor = "${colors.textSecondary}",`);
    lines.push(`    arrowhead = "open",`);
    lines.push(`    arrowsize = 0.8,`);
    lines.push(`    penwidth = 1.2`);
    lines.push(`  ];`);
    lines.push(``);

    for (const table of tables) {
      lines.push(this.buildTableNode(table));
      lines.push(``);
    }

    const seenEdges = new Set<string>();
    for (const table of tables) {
      for (const fk of table.foreignKeys) {
        const edgeKey = [table.name, fk.columnName, fk.foreignTableName, fk.foreignColumnName].join('|');
        if (seenEdges.has(edgeKey)) continue;
        seenEdges.add(edgeKey);

        const fkTable = tables.find((t) => t.name === fk.foreignTableName);
        const pkCount = fkTable?.primaryKey?.length ?? 1;
        const isOneToMany = pkCount >= 1 && !table.primaryKey?.includes(fk.columnName);
        const label = isOneToMany ? 'N : 1' : '1 : 1';

        lines.push(
          `  "${this.escapeDot(table.name)}":"${this.escapeDot(fk.columnName)}" ` +
            `-> "${this.escapeDot(fk.foreignTableName)}":"${this.escapeDot(fk.foreignColumnName)}" ` +
            `[ label = "${label}", arrowhead = "vee", taillabel = "" ];`
        );
      }
    }

    lines.push(`}`);
    return lines.join('\n');
  }

  private buildTableNode(table: TableInfo): string {
    const colors = ERD_THEMES[this.theme];
    const t = this.i18n;

    const headerLabel = table.schema ? `${table.schema}.${table.name}` : table.name;
    const cols = table.columns;

    const rows: string[] = [];

    rows.push(
      `<TR><TD BGCOLOR="${colors.headerBg}" HREF="#" ` +
        `ALIGN="CENTER"><FONT COLOR="${colors.headerText}" POINT-SIZE="12"><B>${this.escapeHtml(
          headerLabel
        )}</B></FONT></TD></TR>`
    );

    if (table.businessDescription || table.comment) {
      const desc = this.escapeHtml(table.businessDescription || table.comment || '');
      rows.push(
        `<TR><TD BGCOLOR="${colors.bodyAlt}" ALIGN="LEFT">` +
          `<FONT COLOR="${colors.textSecondary}" POINT-SIZE="9">${desc}</FONT></TD></TR>`
      );
    }

    for (const col of cols) {
      const isPk = col.constraints.some((c) => c.type === 'PRIMARY KEY');
      const isFk = col.constraints.some((c) => c.type === 'FOREIGN KEY');
      let bg = colors.bodyBg;
      if (isPk) bg = colors.pkBg;
      else if (isFk) bg = colors.fkBg;

      const icon = isPk ? '🔑 ' : isFk ? '🔗 ' : '';
      const typeLabel = this.shortenType(col.dataType);

      rows.push(
        `<TR><TD BGCOLOR="${bg}" ALIGN="LEFT" PORT="${this.escapeHtml(col.name)}">` +
          `<FONT COLOR="${colors.text}" POINT-SIZE="10">` +
          `${this.escapeHtml(icon + col.name)}` +
          `<FONT COLOR="${colors.textSecondary}">  ${this.escapeHtml(typeLabel)}</FONT>` +
          `</FONT></TD></TR>`
      );
    }

    const label = `<
<TABLE BORDER="0" CELLBORDER="1" CELLSPACING="0" CELLPADDING="4">
  ${rows.join('\n  ')}
</TABLE>
>`;

    return `  "${this.escapeDot(table.name)}" [ label = ${label} ];`;
  }

  private shortenType(type: string): string {
    if (!type) return '';
    if (type.length <= 20) return type;
    const m = type.match(/^([A-Za-z]+)/);
    if (m) return m[1];
    return type.substring(0, 18) + '…';
  }

  private escapeDot(s: string): string {
    return String(s || '').replace(/"/g, '\\"');
  }

  private escapeHtml(s: string): string {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  protected getConstraintsDisplay(constraints: ColumnConstraint[]): string {
    return constraints
      .filter((c) => c.type !== 'PRIMARY KEY' && c.type !== 'FOREIGN KEY')
      .map((c) => c.type)
      .join(', ');
  }

  protected isPrimaryKey(column: any): boolean {
    return column.constraints?.some((c: any) => c.type === 'PRIMARY KEY') || false;
  }

  protected isForeignKey(column: any): boolean {
    return column.constraints?.some((c: any) => c.type === 'FOREIGN KEY') || false;
  }
}

export class ErdSvgExporter extends GraphvizErdExporter {
  async export(): Promise<string> {
    const dot = this.buildDot();
    const buf = await this.renderWithDot(dot, 'svg');
    return buf.toString('utf-8');
  }
}

export class ErdPngExporter extends GraphvizErdExporter {
  async export(): Promise<Buffer> {
    const dot = this.buildDot();
    return this.renderWithDot(dot, 'png');
  }
}
