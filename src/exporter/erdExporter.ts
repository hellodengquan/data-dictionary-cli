import { Exporter, ExportContext } from './base';
import { TableInfo } from '../types';

interface LayoutedTable {
  name: string;
  schema?: string;
  columns: Array<{ name: string; type: string; pk: boolean; fk: boolean }>;
  x: number;
  y: number;
  width: number;
  height: number;
  layer: number;
  description?: string;
}

interface LayoutedRelation {
  from: { table: string; column: string; side: 'left' | 'right'; x: number; y: number };
  to: { table: string; column: string; side: 'left' | 'right'; x: number; y: number };
  cardinality: '1:1' | '1:N' | 'N:1' | 'M:N';
}

const COLORS = {
  primary: '#4f46e5',
  foreign: '#06b6d4',
  border: '#94a3b8',
  borderLight: '#e2e8f0',
  headerBg: '#4f46e5',
  headerText: '#ffffff',
  bodyBg: '#ffffff',
  bodyAlt: '#f8fafc',
  text: '#1e293b',
  textSecondary: '#475569',
  pkRow: '#eef2ff',
  fkRow: '#ecfeff',
  line: '#64748b',
  lineHighlight: '#4f46e5',
  bg: '#ffffff',
  grid: '#f1f5f9'
};

const DARK_COLORS = {
  ...COLORS,
  border: '#475569',
  borderLight: '#334155',
  bodyBg: '#1e293b',
  bodyAlt: '#0f172a',
  text: '#f1f5f9',
  textSecondary: '#cbd5e1',
  pkRow: '#312e81',
  fkRow: '#164e63',
  bg: '#0f172a',
  grid: '#1e293b'
};

export class ErdSvgExporter extends Exporter {
  protected colors = COLORS;

  constructor(ctx: ExportContext) {
    super(ctx);
    if (ctx.outputConfig.theme === 'dark') this.colors = DARK_COLORS;
  }

  async export(): Promise<string> {
    const svg = this.buildSvg();
    return svg;
  }

  protected buildSvg(): string {
    const t = this.i18n;
    const tables = this.getAllTables();
    const rels = this.collectForeignKeyRelations();
    const layout = this.computeLayout(tables, rels);
    const width = Math.max(layout.totalWidth, 800);
    const height = Math.max(layout.totalHeight, 600) + 120;
    const pad = 40;

    const parts: string[] = [];
    parts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`);
    parts.push(`  <defs>`);
    parts.push(`    <marker id="arrow-fk" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">`);
    parts.push(`      <path d="M 0 0 L 10 5 L 0 10 z" fill="${this.colors.lineHighlight}" />`);
    parts.push(`    </marker>`);
    parts.push(`    <marker id="arrow-pk" viewBox="0 0 10 10" refX="1" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">`);
    parts.push(`      <path d="M 10 0 L 0 5 L 10 10 z" fill="none" stroke="${this.colors.line}" stroke-width="2" />`);
    parts.push(`    </marker>`);
    parts.push(`    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">`);
    parts.push(`      <feDropShadow dx="0" dy="2" stdDeviation="3" flood-opacity="0.15"/>`);
    parts.push(`    </filter>`);
    parts.push(`  </defs>`);

    parts.push(`  <rect x="0" y="0" width="${width}" height="${height}" fill="${this.colors.bg}"/>`);
    parts.push(this.drawGrid(width, height));

    parts.push(`  <g transform="translate(${pad}, ${pad + 80})">`);
    for (const rel of layout.relations) {
      parts.push(this.drawRelation(rel));
    }
    parts.push(`  </g>`);

    parts.push(`  <g transform="translate(${pad}, ${pad + 80})" filter="url(#shadow)">`);
    for (const tbl of layout.tables) {
      parts.push(this.drawTable(tbl));
    }
    parts.push(`  </g>`);

    parts.push(this.drawHeader(width));
    parts.push(this.drawLegend(width, height - 60));

    parts.push(`</svg>`);
    return parts.join('\n');
  }

  protected drawGrid(w: number, h: number): string {
    const step = 40;
    const lines: string[] = [];
    lines.push(`  <g opacity="0.5">`);
    for (let x = step; x < w; x += step) {
      lines.push(`    <line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="${this.colors.grid}" stroke-width="1"/>`);
    }
    for (let y = step; y < h; y += step) {
      lines.push(`    <line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="${this.colors.grid}" stroke-width="1"/>`);
    }
    lines.push(`  </g>`);
    return lines.join('\n');
  }

  protected drawHeader(w: number): string {
    const t = this.i18n;
    const title = this.escapeHtml(this.getTitle());
    const subtitle = this.escapeHtml(t.erdTitle);
    const meta = `${this.escapeHtml(this.context.metadata.databaseName)} · ${this.context.metadata.tables.length} ${t.tables} · ${this.formatDate(this.context.metadata.generatedAt)}`;
    return `
  <g>
    <rect x="0" y="0" width="${w}" height="70" fill="${this.colors.headerBg}"/>
    <text x="40" y="30" fill="${this.colors.headerText}" font-size="20" font-weight="bold" font-family="Segoe UI, sans-serif">${title} - ${subtitle}</text>
    <text x="40" y="52" fill="${this.colors.headerText}" opacity="0.9" font-size="13" font-family="Segoe UI, sans-serif">${this.escapeHtml(meta)}</text>
  </g>`;
  }

  protected drawLegend(w: number, y: number): string {
    const t = this.i18n;
    return `
  <g transform="translate(40, ${y})">
    <text x="0" y="0" font-size="13" font-weight="bold" fill="${this.colors.text}" font-family="Segoe UI, sans-serif">${t.erdLegend}:</text>
    <rect x="80" y="-12" width="16" height="16" fill="${this.colors.pkRow}" stroke="${this.colors.border}" rx="2"/>
    <text x="104" y="2" font-size="12" fill="${this.colors.text}" font-family="Segoe UI, sans-serif">${t.primaryKey}</text>
    <rect x="180" y="-12" width="16" height="16" fill="${this.colors.fkRow}" stroke="${this.colors.border}" rx="2"/>
    <text x="204" y="2" font-size="12" fill="${this.colors.text}" font-family="Segoe UI, sans-serif">${t.foreignKey}</text>
    <line x1="300" y1="-4" x2="360" y2="-4" stroke="${this.colors.lineHighlight}" stroke-width="2" marker-end="url(#arrow-fk)"/>
    <text x="368" y="2" font-size="12" fill="${this.colors.text}" font-family="Segoe UI, sans-serif">${t.erdRelation}</text>
    <text x="${w - 300}" y="2" font-size="11" fill="${this.colors.textSecondary}" font-family="Segoe UI, sans-serif">${this.escapeHtml(t.erdNote)}</text>
  </g>`;
  }

  protected drawTable(tbl: LayoutedTable): string {
    const c = this.colors;
    const w = tbl.width;
    const h = tbl.height;
    const rowH = 26;
    const headerH = 40;

    const parts: string[] = [];
    parts.push(`<g transform="translate(${tbl.x}, ${tbl.y})">`);
    parts.push(`  <rect x="0" y="0" width="${w}" height="${h}" fill="${c.bodyBg}" stroke="${c.border}" stroke-width="1.5" rx="6"/>`);
    parts.push(`  <rect x="0" y="0" width="${w}" height="${headerH}" fill="${c.headerBg}" rx="6"/>`);
    parts.push(`  <path d="M 0 ${headerH} L ${w} ${headerH}" stroke="${c.border}" stroke-width="1.5"/>`);
    const titleText = this.escapeHtml(tbl.name + (tbl.schema ? ` (${tbl.schema})` : ''));
    parts.push(`  <text x="12" y="${headerH / 2 + 4}" fill="${c.headerText}" font-size="14" font-weight="bold" font-family="Segoe UI, Menlo, monospace">${titleText}</text>`);
    parts.push(`  <text x="${w - 12}" y="${headerH / 2 + 4}" fill="${c.headerText}" opacity="0.9" font-size="11" text-anchor="end" font-family="Segoe UI, sans-serif">${tbl.columns.length} ${this.i18n.fields}</text>`);

    for (let i = 0; i < tbl.columns.length; i++) {
      const col = tbl.columns[i];
      const y = headerH + i * rowH;
      const bg = col.pk ? c.pkRow : col.fk ? c.fkRow : (i % 2 === 0 ? c.bodyBg : c.bodyAlt);
      const last = i === tbl.columns.length - 1;

      parts.push(`  <rect x="0.5" y="${y}" width="${w - 1}" height="${rowH}" fill="${bg}" ${last ? '' : ''}/>`);
      if (!last) {
        parts.push(`  <path d="M 0 ${y + rowH} L ${w} ${y + rowH}" stroke="${c.borderLight}" stroke-width="1"/>`);
      }

      let icon = '';
      if (col.pk) icon += '🔑';
      if (col.fk) icon += '🔗';
      if (icon) icon += ' ';

      const nameX = 14;
      const nameText = this.escapeHtml(icon + col.name);
      parts.push(`  <text x="${nameX}" y="${y + rowH / 2 + 4}" fill="${c.text}" font-size="12" font-family="Segoe UI, Menlo, monospace">${nameText}</text>`);

      const typeX = w - 12;
      const typeText = this.escapeHtml(col.type);
      parts.push(`  <text x="${typeX}" y="${y + rowH / 2 + 4}" fill="${c.textSecondary}" font-size="11" text-anchor="end" font-family="Menlo, Consolas, monospace">${typeText}</text>`);
    }

    if (tbl.description) {
      const descY = h + 2;
      const descText = this.escapeHtml(tbl.description.length > 60 ? tbl.description.substring(0, 57) + '...' : tbl.description);
      parts.push(`  <text x="8" y="${h + 16}" fill="${c.textSecondary}" font-size="10" font-family="Segoe UI, sans-serif">${descText}</text>`);
    }

    parts.push(`</g>`);
    return parts.join('\n    ');
  }

  protected drawRelation(rel: LayoutedRelation): string {
    const c = this.colors;
    const { from, to } = rel;

    const dx = Math.abs(to.x - from.x);
    const offset = Math.min(dx / 2, 80);

    const x1 = from.x;
    const y1 = from.y;
    const x2 = to.x;
    const y2 = to.y;

    let path = '';
    if (Math.abs(y2 - y1) < 5 && Math.sign(x2 - x1) === Math.sign(from.side === 'right' ? 1 : -1)) {
      path = `M ${x1} ${y1} L ${x2} ${y2}`;
    } else {
      const c1x = x1 + (from.side === 'right' ? offset : -offset);
      const c2x = x2 + (to.side === 'right' ? offset : -offset);
      path = `M ${x1} ${y1} C ${c1x} ${y1}, ${c2x} ${y2}, ${x2} ${y2}`;
    }

    return `
    <path d="${path}" fill="none" stroke="${c.lineHighlight}" stroke-width="2" opacity="0.75" marker-end="url(#arrow-fk)"/>
    <circle cx="${x1}" cy="${y1}" r="4" fill="${c.bodyBg}" stroke="${c.lineHighlight}" stroke-width="2"/>
    <circle cx="${x2}" cy="${y2}" r="3.5" fill="${c.lineHighlight}"/>`;
  }

  private computeLayout(tables: TableInfo[], rels: any[]): {
    tables: LayoutedTable[]; totalWidth: number; totalHeight: number; relations: LayoutedRelation[];
  } {
    const marginX = 40;
    const marginY = 50;
    const rowH = 26;
    const headerH = 40;
    const minW = 200;
    const padX = 24;

    const nameToTable = new Map(tables.map(t => [t.name.toLowerCase(), t]));

    const inDegree = new Map<string, number>();
    const childrenMap = new Map<string, string[]>();
    for (const t of tables) { inDegree.set(t.name, 0); childrenMap.set(t.name, []); }
    for (const rel of rels) {
      if (nameToTable.has(rel.toTable.toLowerCase()) && inDegree.has(rel.fromTable)) {
        inDegree.set(rel.fromTable, (inDegree.get(rel.fromTable) || 0) + 1);
        const kids = childrenMap.get(rel.toTable) || [];
        kids.push(rel.fromTable);
        childrenMap.set(rel.toTable, kids);
      }
    }

    const layers: string[][] = [];
    const visited = new Set<string>();
    let remaining = new Map(inDegree);

    while (remaining.size) {
      const current: string[] = [];
      for (const [name, deg] of remaining) {
        if (deg === 0) current.push(name);
      }
      if (current.length === 0) {
        const first = remaining.keys().next().value as string;
        current.push(first);
      }
      layers.push(current);
      for (const name of current) {
        visited.add(name);
        remaining.delete(name);
        const kids = childrenMap.get(name) || [];
        for (const k of kids) {
          if (remaining.has(k)) {
            remaining.set(k, (remaining.get(k) || 0) - 1);
          }
        }
      }
    }

    const measureText = (text: string, size: number) => text.length * size * 0.6;

    const layouted: LayoutedTable[] = [];
    const layoutMap = new Map<string, LayoutedTable>();

    let curX = 0;
    let maxHeight = 0;

    for (let li = 0; li < layers.length; li++) {
      const layer = layers[li];
      let colMaxW = 0;
      let colY = 0;

      const columnTables: LayoutedTable[] = [];
      for (const name of layer) {
        const t = nameToTable.get(name.toLowerCase());
        if (!t) continue;
        const cols = t.columns.map(c => ({
          name: c.name,
          type: c.dataType,
          pk: c.constraints.some(cc => cc.type === 'PRIMARY KEY'),
          fk: c.constraints.some(cc => cc.type === 'FOREIGN KEY')
        }));
        const maxNameLen = Math.max(t.name.length, ...cols.map(c => c.name.length + (c.pk ? 2 : 0) + (c.fk ? 2 : 0)));
        const maxTypeLen = Math.max(...cols.map(c => c.type.length));
        const width = Math.max(minW, Math.round(measureText('W', 12) * maxNameLen + measureText('W', 11) * maxTypeLen + padX * 2));
        const height = headerH + cols.length * rowH + 2;
        const desc = t.businessDescription || t.comment;

        const lt: LayoutedTable = {
          name: t.name,
          schema: t.schema,
          columns: cols,
          x: curX,
          y: colY,
          width,
          height,
          layer: li,
          description: desc
        };
        columnTables.push(lt);
        layoutMap.set(t.name, lt);

        colMaxW = Math.max(colMaxW, width);
        colY += height + marginY;
      }

      for (const lt of columnTables) {
        lt.x = curX + Math.round((colMaxW - lt.width) / 2);
        layouted.push(lt);
      }

      curX += colMaxW + marginX * 3;
      maxHeight = Math.max(maxHeight, colY);
    }

    const getPort = (tableName: string, columnName: string, sideHint: 'left' | 'right') => {
      const t = layoutMap.get(tableName);
      if (!t) return null;
      const ci = t.columns.findIndex(c => c.name === columnName);
      if (ci < 0) {
        const alt = t.columns.findIndex(c => columnName.toLowerCase().includes(c.name.toLowerCase()));
        const idx = alt >= 0 ? alt : 0;
        return {
          x: sideHint === 'right' ? t.x + t.width : t.x,
          y: t.y + headerH + idx * rowH + rowH / 2,
          side: sideHint,
          table: t
        };
      }
      return {
        x: sideHint === 'right' ? t.x + t.width : t.x,
        y: t.y + headerH + ci * rowH + rowH / 2,
        side: sideHint,
        table: t
      };
    };

    const layoutedRels: LayoutedRelation[] = [];
    const seen = new Set<string>();

    for (const rel of rels) {
      const key = `${rel.fromTable}|${rel.fromColumn}|${rel.toTable}|${rel.toColumn}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const fromT = layoutMap.get(rel.fromTable);
      const toT = layoutMap.get(rel.toTable);
      if (!fromT || !toT) continue;

      let fromSide: 'left' | 'right' = 'right';
      let toSide: 'left' | 'right' = 'left';
      if (fromT.layer > toT.layer) { fromSide = 'left'; toSide = 'right'; }
      else if (fromT.layer === toT.layer) {
        if (fromT.x >= toT.x) { fromSide = 'left'; toSide = 'right'; }
      }

      const fp = getPort(rel.fromTable, rel.fromColumn, fromSide);
      const tp = getPort(rel.toTable, rel.toColumn, toSide);
      if (!fp || !tp) continue;

      layoutedRels.push({
        from: { table: rel.fromTable, column: rel.fromColumn, side: fp.side, x: fp.x, y: fp.y },
        to: { table: rel.toTable, column: rel.toColumn, side: tp.side, x: tp.x, y: tp.y },
        cardinality: 'N:1'
      });
    }

    return {
      tables: layouted,
      totalWidth: curX + marginX,
      totalHeight: maxHeight + marginY,
      relations: layoutedRels
    };
  }
}

export class ErdPngExporter extends ErdSvgExporter {
  async export(): Promise<string> {
    const svg = this.buildSvg();
    const svg64 = Buffer.from(svg, 'utf-8').toString('base64');
    const t = this.i18n;
    const title = this.escapeHtml(this.getTitle());

    return `<!DOCTYPE html>
<html lang="${this.lang}">
<head>
  <meta charset="UTF-8">
  <title>${title} - ERD PNG Generator</title>
  <style>
    body { margin: 0; padding: 20px; font-family: system-ui, -apple-system, Segoe UI, sans-serif; background: #f8fafc; }
    .toolbar { display: flex; gap: 12px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; }
    button { padding: 10px 18px; background: #4f46e5; color: white; border: 0; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 600; }
    button:hover { background: #4338ca; }
    .filename { padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px; font-family: monospace; }
    .status { font-size: 13px; color: #475569; }
    .preview { background: white; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); padding: 12px; overflow: auto; max-height: calc(100vh - 120px); }
    .error { background: #fef2f2; color: #b91c1c; padding: 8px 12px; border-radius: 6px; font-size: 13px; }
    h1 { margin: 0 0 4px 0; font-size: 18px; color: #0f172a; }
    .sub { color: #64748b; font-size: 13px; margin-bottom: 12px; }
  </style>
</head>
<body>
  <h1>${title} - ERD PNG Generator</h1>
  <p class="sub">${t.erdTitle}. ${t.erdNote}. Click the button below to download as PNG.</p>
  <div class="toolbar">
    <button id="download">⬇️ Download PNG</button>
    <button id="open">🖼️ Open in new tab</button>
    <input class="filename" id="fname" value="${this.escapeHtml(this.context.outputConfig.outputPath.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '') || 'erd'}.png"/>
    <span class="status" id="status">SVG ${this.i18n.colNo}: ${Math.round(svg.length / 1024)} KB</span>
  </div>
  <div class="preview" id="preview"></div>
  <script>
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const SVG_DATA = 'data:image/svg+xml;base64,${svg64}';
    const preview = document.getElementById('preview');
    const status = document.getElementById('status');

    const img = new Image();
    img.onload = () => {
      preview.appendChild(img);
      const w = img.naturalWidth, h = img.naturalHeight;
      status.textContent += ' · ' + w + ' x ' + h + ' px';
    };
    img.onerror = (e) => {
      preview.innerHTML = '<div class="error">Could not render SVG inline. Open the SVG source directly via download link below.</div>';
    };
    img.src = SVG_DATA;
    img.style.maxWidth = '100%';
    img.style.height = 'auto';

    function svgToPngDataUrl(scale) {
      return new Promise((resolve, reject) => {
        const img2 = new Image();
        img2.crossOrigin = 'anonymous';
        img2.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img2.naturalWidth * scale);
          canvas.height = Math.round(img2.naturalHeight * scale);
          const ctx = canvas.getContext('2d');
          if (!ctx) return reject(new Error('Canvas not supported'));
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img2, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/png'));
        };
        img2.onerror = reject;
        img2.src = SVG_DATA;
      });
    }

    document.getElementById('download').onclick = async () => {
      try {
        status.textContent = 'Rendering PNG (2x)...';
        const url = await svgToPngDataUrl(2);
        const a = document.createElement('a');
        a.href = url;
        a.download = document.getElementById('fname').value;
        document.body.appendChild(a);
        a.click();
        a.remove();
        status.textContent = 'PNG download initiated.';
      } catch (e) {
        status.textContent = 'Failed: ' + e.message;
      }
    };

    document.getElementById('open').onclick = async () => {
      try {
        status.textContent = 'Rendering PNG (1x)...';
        const url = await svgToPngDataUrl(1);
        window.open(url, '_blank');
      } catch (e) {
        status.textContent = 'Failed: ' + e.message;
      }
    };
  </script>
  <!-- RAW SVG SOURCE (can be opened directly in browsers / design tools): -->
  <!--
${svg.split('\n').map(l => '  ' + l).join('\n')}
  -->
</body>
</html>`;
  }
}
