import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource
} from '@codemirror/autocomplete';

export interface SqlCompletionTable {
  namespace: string;
  name: string;
  columns: readonly string[];
}

export interface SqlCompletionTableIdentity {
  namespace: string;
  name: string;
}

export interface SqlContextCompletionConfig {
  dialect: string;
  engine: string;
  exactVersion: string;
  tables: readonly SqlCompletionTable[];
  selectedTable: SqlCompletionTableIdentity | null;
}

type CompletionArea = 'expression' | 'column-list' | 'relation' | 'other';

type SqlToken = {
  value: string;
  lower: string;
  from: number;
  to: number;
  kind: 'word' | 'quoted' | 'string' | 'comment' | 'symbol' | 'number';
  closed: boolean;
};

type TableReference = {
  namespace: string | null;
  name: string;
  alias: string | null;
};

type CompletionAnalysis = {
  area: CompletionArea;
  from: number;
  qualifier: string | null;
  references: TableReference[];
};

const commonFunctions = [
  'abs',
  'avg',
  'coalesce',
  'count',
  'lower',
  'max',
  'min',
  'nullif',
  'sum',
  'trim',
  'upper'
] as const;

const sqliteFunctions = [
  'changes',
  'char',
  'concat',
  'concat_ws',
  'cume_dist',
  'date',
  'datetime',
  'dense_rank',
  'first_value',
  'format',
  'glob',
  'group_concat',
  'hex',
  'ifnull',
  'iif',
  'instr',
  'json',
  'json_array',
  'json_array_length',
  'json_error_position',
  'json_extract',
  'json_group_array',
  'json_group_object',
  'json_insert',
  'json_object',
  'json_patch',
  'json_quote',
  'json_remove',
  'json_replace',
  'json_set',
  'json_type',
  'json_valid',
  'julianday',
  'lag',
  'last_insert_rowid',
  'last_value',
  'lead',
  'length',
  'like',
  'likelihood',
  'likely',
  'ltrim',
  'nth_value',
  'ntile',
  'octet_length',
  'percent_rank',
  'printf',
  'quote',
  'random',
  'randomblob',
  'rank',
  'replace',
  'round',
  'row_number',
  'rtrim',
  'sign',
  'soundex',
  'sqlite_source_id',
  'sqlite_version',
  'strftime',
  'string_agg',
  'substr',
  'substring',
  'time',
  'timediff',
  'total',
  'total_changes',
  'typeof',
  'unicode',
  'unhex',
  'unixepoch',
  'unlikely',
  'zeroblob'
] as const;

// This is the common built-in surface across QueryNot's MySQL 5.7+
// and MariaDB 10.11/11.4 adapter matrix. Version-specific additions live
// below so an older connected engine is not offered syntax it cannot run.
const mysqlFamilyFunctions = [
  'acos',
  'adddate',
  'addtime',
  'ascii',
  'asin',
  'atan',
  'atan2',
  'bin',
  'bit_and',
  'bit_count',
  'bit_or',
  'bit_xor',
  'ceil',
  'ceiling',
  'char_length',
  'character_length',
  'concat',
  'concat_ws',
  'connection_id',
  'conv',
  'convert_tz',
  'cos',
  'cot',
  'crc32',
  'curdate',
  'current_date',
  'current_time',
  'current_timestamp',
  'curtime',
  'database',
  'date',
  'date_add',
  'date_format',
  'date_sub',
  'datediff',
  'day',
  'dayname',
  'dayofmonth',
  'dayofweek',
  'dayofyear',
  'degrees',
  'elt',
  'exp',
  'export_set',
  'extract',
  'field',
  'find_in_set',
  'floor',
  'format',
  'from_base64',
  'from_days',
  'from_unixtime',
  'get_format',
  'greatest',
  'group_concat',
  'hex',
  'if',
  'ifnull',
  'inet_aton',
  'inet_ntoa',
  'insert',
  'instr',
  'isnull',
  'json_array',
  'json_array_append',
  'json_array_insert',
  'json_contains',
  'json_contains_path',
  'json_depth',
  'json_extract',
  'json_insert',
  'json_keys',
  'json_length',
  'json_object',
  'json_quote',
  'json_remove',
  'json_replace',
  'json_search',
  'json_set',
  'json_type',
  'json_unquote',
  'json_valid',
  'last_day',
  'last_insert_id',
  'lcase',
  'least',
  'left',
  'length',
  'ln',
  'locate',
  'log',
  'log10',
  'log2',
  'lpad',
  'ltrim',
  'makedate',
  'maketime',
  'md5',
  'microsecond',
  'minute',
  'mod',
  'month',
  'monthname',
  'now',
  'oct',
  'octet_length',
  'ord',
  'period_add',
  'period_diff',
  'pi',
  'pow',
  'power',
  'quarter',
  'quote',
  'radians',
  'rand',
  'repeat',
  'replace',
  'reverse',
  'right',
  'round',
  'rpad',
  'rtrim',
  'sec_to_time',
  'second',
  'sha1',
  'sha2',
  'sign',
  'sin',
  'soundex',
  'space',
  'sqrt',
  'std',
  'stddev',
  'stddev_pop',
  'stddev_samp',
  'str_to_date',
  'strcmp',
  'substr',
  'substring',
  'substring_index',
  'sysdate',
  'tan',
  'time',
  'time_format',
  'time_to_sec',
  'timediff',
  'timestamp',
  'timestampadd',
  'timestampdiff',
  'to_base64',
  'to_days',
  'to_seconds',
  'truncate',
  'ucase',
  'unhex',
  'unix_timestamp',
  'user',
  'utc_date',
  'utc_time',
  'utc_timestamp',
  'uuid',
  'var_pop',
  'var_samp',
  'variance',
  'version',
  'week',
  'weekday',
  'weekofyear',
  'year',
  'yearweek'
] as const;

const windowFunctions = [
  'cume_dist',
  'dense_rank',
  'first_value',
  'lag',
  'last_value',
  'lead',
  'nth_value',
  'ntile',
  'percent_rank',
  'rank',
  'row_number'
] as const;

const mysql8Functions = [
  'bin_to_uuid',
  'json_arrayagg',
  'json_objectagg',
  'regexp_instr',
  'regexp_like',
  'regexp_replace',
  'regexp_substr',
  'uuid_to_bin'
] as const;

const mariaDbFunctions = [
  'json_compact',
  'json_detailed',
  'json_equals',
  'json_exists',
  'json_loose',
  'json_normalize',
  'json_query',
  'json_value'
] as const;

const relationKeywords = new Set([
  'describe',
  'desc',
  'from',
  'into',
  'join',
  'table',
  'update'
]);

const expressionKeywords = new Set([
  'by',
  'else',
  'having',
  'limit',
  'offset',
  'on',
  'returning',
  'select',
  'set',
  'then',
  'values',
  'when',
  'where'
]);

const aliasStopWords = new Set([
  'cross',
  'except',
  'fetch',
  'for',
  'full',
  'group',
  'having',
  'inner',
  'intersect',
  'join',
  'left',
  'limit',
  'offset',
  'on',
  'order',
  'outer',
  'returning',
  'right',
  'set',
  'union',
  'values',
  'where'
]);

const fromClauseEndWords = new Set([
  'except',
  'fetch',
  'for',
  'group',
  'having',
  'intersect',
  'limit',
  'offset',
  'order',
  'returning',
  'set',
  'union',
  'values',
  'where'
]);

function tokenizeSql(sql: string): SqlToken[] {
  const tokens: SqlToken[] = [];
  let index = 0;
  while (index < sql.length) {
    const character = sql[index];
    if (/\s/u.test(character)) {
      index += 1;
      continue;
    }
    const from = index;
    if ((character === '-' && sql[index + 1] === '-') || character === '#') {
      index += character === '#' ? 1 : 2;
      while (index < sql.length && sql[index] !== '\n') index += 1;
      const value = sql.slice(from, index);
      tokens.push({
        value,
        lower: value.toLocaleLowerCase(),
        from,
        to: index,
        kind: 'comment',
        closed: index < sql.length
      });
      continue;
    }
    if (character === '/' && sql[index + 1] === '*') {
      index += 2;
      let depth = 1;
      while (index < sql.length && depth > 0) {
        if (sql[index] === '/' && sql[index + 1] === '*') {
          depth += 1;
          index += 2;
        } else if (sql[index] === '*' && sql[index + 1] === '/') {
          depth -= 1;
          index += 2;
        } else {
          index += 1;
        }
      }
      const value = sql.slice(from, index);
      tokens.push({
        value,
        lower: value.toLocaleLowerCase(),
        from,
        to: index,
        kind: 'comment',
        closed: depth === 0
      });
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      const quote = character;
      index += 1;
      let closed = false;
      while (index < sql.length) {
        if (sql[index] === '\\') {
          index = Math.min(index + 2, sql.length);
        } else if (sql[index] === quote) {
          if (sql[index + 1] === quote) {
            index += 2;
          } else {
            index += 1;
            closed = true;
            break;
          }
        } else {
          index += 1;
        }
      }
      const value = sql.slice(from, index);
      tokens.push({
        value,
        lower: value.toLocaleLowerCase(),
        from,
        to: index,
        kind: quote === "'" ? 'string' : 'quoted',
        closed
      });
      continue;
    }
    if (/[A-Za-z_$]/u.test(character)) {
      index += 1;
      while (index < sql.length && /[\w$]/u.test(sql[index])) index += 1;
      const value = sql.slice(from, index);
      tokens.push({
        value,
        lower: value.toLocaleLowerCase(),
        from,
        to: index,
        kind: 'word',
        closed: true
      });
      continue;
    }
    if (/\d/u.test(character)) {
      index += 1;
      while (index < sql.length && /[\d.]/u.test(sql[index])) index += 1;
      const value = sql.slice(from, index);
      tokens.push({
        value,
        lower: value,
        from,
        to: index,
        kind: 'number',
        closed: true
      });
      continue;
    }
    index += 1;
    tokens.push({
      value: character,
      lower: character,
      from,
      to: index,
      kind: 'symbol',
      closed: true
    });
  }
  return tokens;
}

function identifierName(token: SqlToken): string | null {
  if (token.kind === 'word') return token.value;
  if (token.kind !== 'quoted' || token.value.length < 2) return null;
  const quote = token.value[0];
  return token.value
    .slice(1, token.closed ? -1 : undefined)
    .replaceAll(`${quote}${quote}`, quote);
}

function statementRange(tokens: readonly SqlToken[], cursor: number) {
  let from = 0;
  let to = Number.POSITIVE_INFINITY;
  for (const token of tokens) {
    if (token.kind !== 'symbol' || token.value !== ';') continue;
    if (token.to <= cursor) from = token.to;
    else if (token.from >= cursor) {
      to = token.from;
      break;
    }
  }
  return { from, to };
}

function qualifierBefore(tokens: readonly SqlToken[], from: number) {
  const before = tokens.filter((token) => token.to <= from);
  if (before.at(-1)?.value !== '.') return null;
  return before.length > 1 ? identifierName(before[before.length - 2]) : null;
}

function completionArea(
  tokens: readonly SqlToken[],
  statementFrom: number,
  completionFrom: number,
  qualifier: string | null
): CompletionArea {
  const before = tokens.filter(
    (token) =>
      token.from >= statementFrom &&
      token.to <= completionFrom &&
      token.kind !== 'comment' &&
      token.kind !== 'string'
  );
  let area: CompletionArea = 'other';
  let expectsRelation = false;
  let statementCommand = '';
  let pendingOrderOrGroup = false;
  let depth = 0;

  for (const token of before) {
    const identifier = identifierName(token);
    if (!statementCommand && identifier) statementCommand = token.lower;
    if (token.value === '(') {
      depth += 1;
      if (
        statementCommand === 'insert' &&
        area === 'relation' &&
        !expectsRelation
      ) {
        area = 'column-list';
      }
      continue;
    }
    if (token.value === ')') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (token.value === ',' && area === 'relation') {
      expectsRelation = true;
      continue;
    }
    if (!identifier) continue;

    if (relationKeywords.has(token.lower)) {
      area = 'relation';
      expectsRelation = true;
      pendingOrderOrGroup = false;
      continue;
    }
    if (token.lower === 'order' || token.lower === 'group') {
      area = 'other';
      expectsRelation = false;
      pendingOrderOrGroup = true;
      continue;
    }
    if (
      expressionKeywords.has(token.lower) &&
      (token.lower !== 'by' || pendingOrderOrGroup)
    ) {
      area = 'expression';
      expectsRelation = false;
      pendingOrderOrGroup = false;
      continue;
    }
    pendingOrderOrGroup = false;
    if (area === 'relation' && expectsRelation && depth >= 0) {
      expectsRelation = false;
    }
  }

  if (area === 'relation') {
    return expectsRelation || qualifier ? 'relation' : 'other';
  }
  return area;
}

function readIdentifierPath(tokens: readonly SqlToken[], start: number) {
  const parts: string[] = [];
  let index = start;
  let expectsIdentifier = true;
  for (; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (expectsIdentifier) {
      const identifier = identifierName(token);
      if (!identifier) break;
      parts.push(identifier);
      expectsIdentifier = false;
    } else if (token.value === '.') {
      expectsIdentifier = true;
    } else {
      break;
    }
  }
  return { parts, next: index };
}

function tableReferences(
  tokens: readonly SqlToken[],
  statementFrom: number,
  statementTo: number
) {
  const statementTokens = tokens.filter(
    (token) =>
      token.from >= statementFrom &&
      token.to <= statementTo &&
      token.kind !== 'comment' &&
      token.kind !== 'string'
  );
  const references: TableReference[] = [];
  let fromDepth: number | null = null;
  let depth = 0;
  for (let index = 0; index < statementTokens.length; index += 1) {
    const token = statementTokens[index];
    if (token.value === '(') {
      depth += 1;
      continue;
    }
    if (token.value === ')') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (
      fromDepth !== null &&
      depth === fromDepth &&
      fromClauseEndWords.has(token.lower)
    ) {
      fromDepth = null;
    }
    const trigger = token.lower;
    const commaSeparatedTable =
      token.value === ',' && fromDepth !== null && depth === fromDepth;
    if (
      !['from', 'into', 'join', 'update'].includes(trigger) &&
      !commaSeparatedTable
    )
      continue;
    if (trigger === 'from') fromDepth = depth;
    const path = readIdentifierPath(statementTokens, index + 1);
    if (path.parts.length === 0) continue;
    if (
      statementTokens[path.next]?.value === '(' &&
      (trigger === 'from' || trigger === 'join' || commaSeparatedTable)
    ) {
      continue;
    }
    let alias: string | null = null;
    let aliasIndex = path.next;
    if (statementTokens[aliasIndex]?.lower === 'as') aliasIndex += 1;
    const possibleAlias = statementTokens[aliasIndex];
    const aliasName = possibleAlias ? identifierName(possibleAlias) : null;
    if (aliasName && !aliasStopWords.has(possibleAlias.lower))
      alias = aliasName;
    references.push({
      namespace:
        path.parts.length > 1 ? path.parts[path.parts.length - 2] : null,
      name: path.parts[path.parts.length - 1],
      alias
    });
  }
  return references;
}

function analyzeCompletion(
  context: CompletionContext,
  allowQuotedIdentifier = false
): CompletionAnalysis | null {
  const sql = context.state.doc.toString();
  const word = context.matchBefore(/[\w$]*/u);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  const tokens = tokenizeSql(sql);
  const containing = tokens.find(
    (token) =>
      (token.kind === 'comment' ||
        token.kind === 'string' ||
        (!allowQuotedIdentifier && token.kind === 'quoted')) &&
      token.from < context.pos &&
      (context.pos < token.to || (!token.closed && context.pos === token.to))
  );
  if (containing) return null;
  const range = statementRange(tokens, context.pos);
  const qualifier = qualifierBefore(tokens, word.from);
  return {
    area: completionArea(tokens, range.from, word.from, qualifier),
    from: word.from,
    qualifier,
    references: tableReferences(tokens, range.from, range.to)
  };
}

function sameIdentifier(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: 'accent' }) === 0;
}

function resolveTable(
  reference: TableReference,
  tables: readonly SqlCompletionTable[]
) {
  return tables.find(
    (table) =>
      sameIdentifier(table.name, reference.name) &&
      (!reference.namespace ||
        sameIdentifier(table.namespace, reference.namespace))
  );
}

function selectedCompletionTable(config: SqlContextCompletionConfig) {
  if (!config.selectedTable) return null;
  return (
    config.tables.find(
      (table) =>
        sameIdentifier(table.namespace, config.selectedTable!.namespace) &&
        sameIdentifier(table.name, config.selectedTable!.name)
    ) ?? null
  );
}

function columnCompletions(
  analysis: CompletionAnalysis,
  config: SqlContextCompletionConfig
) {
  const resolved = analysis.references.flatMap((reference) => {
    const table = resolveTable(reference, config.tables);
    return table ? [{ reference, table }] : [];
  });
  const qualified = analysis.qualifier
    ? resolved.filter(
        ({ reference, table }) =>
          (reference.alias &&
            sameIdentifier(reference.alias, analysis.qualifier!)) ||
          sameIdentifier(table.name, analysis.qualifier!)
      )
    : resolved;
  const sources =
    qualified.length > 0
      ? qualified
      : analysis.references.length === 0 && !analysis.qualifier
        ? (() => {
            const table = selectedCompletionTable(config);
            return table
              ? [
                  {
                    table,
                    reference: {
                      namespace: table.namespace,
                      name: table.name,
                      alias: null
                    }
                  }
                ]
              : [];
          })()
        : [];
  const options = new Map<string, Completion>();
  for (const { reference, table } of sources) {
    for (const label of table.columns) {
      const key = label.toLocaleLowerCase();
      const existing = options.get(key);
      options.set(key, {
        label,
        type: 'property',
        detail: existing
          ? 'column in multiple statement tables'
          : analysis.references.length === 0
            ? `${table.namespace}.${table.name} · selected table column`
            : `${reference.alias ?? table.name} · column`,
        boost: 30
      });
    }
  }
  return [...options.values()];
}

function functionNames(config: SqlContextCompletionConfig) {
  const mariaDb = config.engine.toLocaleLowerCase().includes('mariadb');
  if (config.dialect !== 'mysql') {
    return [...new Set([...commonFunctions, ...sqliteFunctions])];
  }
  const majorVersion = Number.parseInt(config.exactVersion, 10);
  return [
    ...new Set([
      ...commonFunctions,
      ...mysqlFamilyFunctions,
      ...(mariaDb || majorVersion >= 8 ? windowFunctions : []),
      ...(mariaDb ? mariaDbFunctions : []),
      ...(!mariaDb && majorVersion >= 8 ? mysql8Functions : [])
    ])
  ];
}

function applyFunction(label: string): NonNullable<Completion['apply']> {
  return (view, _completion, from, to) => {
    const followedByParenthesis = view.state.sliceDoc(to, to + 1) === '(';
    const insert = followedByParenthesis ? label : `${label}()`;
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + label.length + 1 }
    });
  };
}

function functionCompletions(config: SqlContextCompletionConfig) {
  const engine =
    config.engine || (config.dialect === 'mysql' ? 'MySQL' : 'SQLite');
  return functionNames(config).map<Completion>((label) => ({
    label,
    type: 'function',
    detail: `${engine} function`,
    apply: applyFunction(label),
    boost: 15
  }));
}

export function sqlContextCompletionSource(
  config: SqlContextCompletionConfig
): CompletionSource {
  const functions = functionCompletions(config);
  return (context): CompletionResult | null => {
    const analysis = analyzeCompletion(context);
    if (
      !analysis ||
      (analysis.area !== 'expression' && analysis.area !== 'column-list')
    ) {
      return null;
    }
    const columns = columnCompletions(analysis, config);
    const aliases = analysis.qualifier
      ? []
      : analysis.references.flatMap((reference) =>
          reference.alias
            ? [
                {
                  label: reference.alias,
                  type: 'variable',
                  detail: 'current-statement alias',
                  boost: 20
                } satisfies Completion
              ]
            : []
        );
    const availableFunctions =
      analysis.area === 'expression' && !analysis.qualifier ? functions : [];
    const options = [...columns, ...aliases, ...availableFunctions];
    return options.length
      ? { from: analysis.from, options, validFor: /^[\w$]*$/u }
      : null;
  };
}

export function relationCompletionSource(
  source: CompletionSource
): CompletionSource {
  return (context) => {
    const analysis = analyzeCompletion(context, true);
    return analysis?.area === 'relation' ? source(context) : null;
  };
}
