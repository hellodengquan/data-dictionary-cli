export interface ParsedPatterns {
  include: RegExp[];
  exclude: RegExp[];
}

export function parseGlobPattern(input: string): RegExp {
  let regex = '';
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    switch (c) {
      case '*':
        regex += '.*';
        i++;
        break;
      case '?':
        regex += '.';
        i++;
        break;
      case '.':
      case '+':
      case '^':
      case '$':
      case '{':
      case '}':
      case '[':
      case ']':
      case '|':
      case '(':
      case ')':
      case '\\':
        regex += '\\' + c;
        i++;
        break;
      default:
        regex += c;
        i++;
    }
  }
  return new RegExp('^' + regex + '$', 'i');
}

export function parsePatternList(rawList: string[] | undefined): ParsedPatterns {
  const result: ParsedPatterns = { include: [], exclude: [] };
  if (!rawList || rawList.length === 0) {
    return result;
  }

  for (const raw of rawList) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('!')) {
      result.exclude.push(parseGlobPattern(trimmed.slice(1)));
    } else {
      result.include.push(parseGlobPattern(trimmed));
    }
  }

  return result;
}

export function matchParsedPatterns(value: string, patterns: ParsedPatterns): boolean {
  const hasInclude = patterns.include.length > 0;
  const hasExclude = patterns.exclude.length > 0;

  if (!hasInclude && !hasExclude) {
    return true;
  }

  if (hasExclude) {
    for (const ex of patterns.exclude) {
      if (ex.test(value)) {
        return false;
      }
    }
  }

  if (hasInclude) {
    return patterns.include.some(incl => incl.test(value));
  }

  return true;
}

export function parseCommaSeparatedPatterns(raw: string): string[] {
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

export function filterByPatterns<T>(items: T[], getValue: (item: T) => string, patterns: ParsedPatterns): T[] {
  return items.filter(item => matchParsedPatterns(getValue(item), patterns));
}

export function detectWildcards(patterns: string[]): boolean {
  return patterns.some(p => p.includes('*') || p.includes('?') || p.startsWith('!'));
}
