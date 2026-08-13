use serde::{Deserialize, Serialize};
use std::hash::{Hash, Hasher};

const MAX_SQL_BYTES: usize = 4 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct SqlStatement {
    pub index: u32,
    pub start: usize,
    pub end: usize,
    pub sql: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SafetyReason {
    Drop,
    Truncate,
    MissingPredicate,
    IneffectivePredicate,
    UncertainPredicate,
    AmbiguousBoundaries,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct SafetyFlag {
    pub statement_index: u32,
    pub start: usize,
    pub end: usize,
    pub statement_type: String,
    pub object_name: Option<String>,
    pub reason: SafetyReason,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ExecutionPlan {
    pub statements: Vec<SqlStatement>,
    pub safety_flags: Vec<SafetyFlag>,
    pub fingerprint: String,
}

#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
pub enum SqlPlanError {
    #[error("SQL text is empty")]
    Empty,
    #[error("SQL text exceeds the 4 MiB command boundary")]
    TooLarge,
    #[error("selection or cursor is outside the SQL document")]
    InvalidRange,
    #[error("statement boundaries are ambiguous; select the intended text or use Run all")]
    Ambiguous,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum LexState {
    Code,
    SingleQuote,
    DoubleQuote,
    Backtick,
    Bracket,
    LineComment,
    BlockComment,
}

pub fn plan_execution(
    document: &str,
    selection: Option<(usize, usize)>,
    cursor: usize,
    run_all: bool,
    profile_id: &str,
    session_id: &str,
    context: &str,
) -> Result<ExecutionPlan, SqlPlanError> {
    if document.len() > MAX_SQL_BYTES {
        return Err(SqlPlanError::TooLarge);
    }
    if cursor > document.len() || !document.is_char_boundary(cursor) {
        return Err(SqlPlanError::InvalidRange);
    }

    let all = split_statements(document)?;
    let statements = if let Some((start, end)) = selection.filter(|(start, end)| start != end) {
        if start > end
            || end > document.len()
            || !document.is_char_boundary(start)
            || !document.is_char_boundary(end)
        {
            return Err(SqlPlanError::InvalidRange);
        }
        let Some((trimmed_start, trimmed_end)) = trim_range(document, start, end) else {
            return Err(SqlPlanError::Empty);
        };
        let selected = &document[trimmed_start..trimmed_end];
        split_statements(selected)?
            .into_iter()
            .enumerate()
            .map(|(index, statement)| SqlStatement {
                index: index as u32,
                start: trimmed_start + statement.start,
                end: trimmed_start + statement.end,
                sql: statement.sql,
            })
            .collect()
    } else if run_all || all.len() == 1 {
        all
    } else {
        let found = all
            .into_iter()
            .find(|statement| cursor >= statement.start && cursor <= statement.end)
            .ok_or(SqlPlanError::Ambiguous)?;
        vec![SqlStatement { index: 0, ..found }]
    };
    if statements.is_empty() {
        return Err(SqlPlanError::Empty);
    }

    let safety_flags = statements
        .iter()
        .filter_map(classify_destructive)
        .collect::<Vec<_>>();
    let fingerprint =
        execution_fingerprint(profile_id, session_id, context, &statements, &safety_flags);
    Ok(ExecutionPlan {
        statements,
        safety_flags,
        fingerprint,
    })
}

pub fn split_statements(document: &str) -> Result<Vec<SqlStatement>, SqlPlanError> {
    if document.len() > MAX_SQL_BYTES {
        return Err(SqlPlanError::TooLarge);
    }
    let bytes = document.as_bytes();
    let mut state = LexState::Code;
    let mut index = 0;
    let mut start = 0;
    let mut statements = Vec::new();
    while index < bytes.len() {
        let current = bytes[index];
        let next = bytes.get(index + 1).copied();
        match state {
            LexState::Code => match (current, next) {
                (b'\'', _) => state = LexState::SingleQuote,
                (b'"', _) => state = LexState::DoubleQuote,
                (b'`', _) => state = LexState::Backtick,
                (b'[', _) => state = LexState::Bracket,
                (b'-', Some(b'-')) => {
                    state = LexState::LineComment;
                    index += 1;
                }
                (b'/', Some(b'*')) => {
                    state = LexState::BlockComment;
                    index += 1;
                }
                (b';', _) => {
                    if let Some((trimmed_start, trimmed_end)) =
                        trim_range(document, start, index + 1)
                    {
                        statements.push(SqlStatement {
                            index: statements.len() as u32,
                            start: trimmed_start,
                            end: trimmed_end,
                            sql: document[trimmed_start..trimmed_end].to_owned(),
                        });
                    }
                    start = index + 1;
                }
                _ => {}
            },
            LexState::SingleQuote => {
                if current == b'\'' {
                    if next == Some(b'\'') {
                        index += 1;
                    } else {
                        state = LexState::Code;
                    }
                }
            }
            LexState::DoubleQuote => {
                if current == b'"' {
                    if next == Some(b'"') {
                        index += 1;
                    } else {
                        state = LexState::Code;
                    }
                }
            }
            LexState::Backtick => {
                if current == b'`' {
                    if next == Some(b'`') {
                        index += 1;
                    } else {
                        state = LexState::Code;
                    }
                }
            }
            LexState::Bracket => {
                if current == b']' {
                    state = LexState::Code;
                }
            }
            LexState::LineComment => {
                if current == b'\n' || current == b'\r' {
                    state = LexState::Code;
                }
            }
            LexState::BlockComment => {
                if current == b'*' && next == Some(b'/') {
                    state = LexState::Code;
                    index += 1;
                }
            }
        }
        index += 1;
    }
    if !matches!(state, LexState::Code | LexState::LineComment) {
        return Err(SqlPlanError::Ambiguous);
    }
    if let Some((trimmed_start, trimmed_end)) = trim_range(document, start, document.len()) {
        statements.push(SqlStatement {
            index: statements.len() as u32,
            start: trimmed_start,
            end: trimmed_end,
            sql: document[trimmed_start..trimmed_end].to_owned(),
        });
    }
    Ok(statements)
}

#[must_use]
pub fn leading_statement_keyword(sql: &str) -> Option<String> {
    code_tokens(sql)
        .first()
        .map(|token| token.to_ascii_uppercase())
}

#[must_use]
pub fn execution_is_provably_read_only(plan: &ExecutionPlan) -> bool {
    plan.statements.iter().all(|statement| {
        matches!(
            leading_statement_keyword(&statement.sql).as_deref(),
            Some("SELECT" | "VALUES" | "EXPLAIN")
        )
    })
}

fn trim_range(document: &str, start: usize, end: usize) -> Option<(usize, usize)> {
    let value = &document[start..end];
    let leading = value.len() - value.trim_start().len();
    let trailing = value.trim_end().len();
    (leading < trailing).then_some((start + leading, start + trailing))
}

fn classify_destructive(statement: &SqlStatement) -> Option<SafetyFlag> {
    let tokens = code_tokens(&statement.sql);
    let first = tokens.first()?.to_ascii_uppercase();
    let statement_type = first.clone();
    let object_name = match first.as_str() {
        "DROP" | "TRUNCATE" => tokens
            .iter()
            .skip(1)
            .find(|token| {
                !matches!(
                    token.to_ascii_uppercase().as_str(),
                    "TABLE" | "VIEW" | "INDEX" | "IF" | "EXISTS"
                )
            })
            .cloned(),
        "DELETE" => tokens
            .iter()
            .position(|token| token.eq_ignore_ascii_case("FROM"))
            .and_then(|index| tokens.get(index + 1))
            .cloned(),
        "UPDATE" => tokens.get(1).cloned(),
        _ => None,
    };
    let reason = match first.as_str() {
        "DROP" => SafetyReason::Drop,
        "TRUNCATE" => SafetyReason::Truncate,
        "UPDATE" | "DELETE" => {
            let Some(where_index) = tokens
                .iter()
                .position(|token| token.eq_ignore_ascii_case("WHERE"))
            else {
                return Some(flag(
                    statement,
                    statement_type,
                    object_name,
                    SafetyReason::MissingPredicate,
                ));
            };
            match predicate_effectiveness(&tokens[where_index + 1..]) {
                PredicateEffectiveness::Effective => return None,
                PredicateEffectiveness::Ineffective => SafetyReason::IneffectivePredicate,
                PredicateEffectiveness::Uncertain => SafetyReason::UncertainPredicate,
            }
        }
        _ => return None,
    };
    Some(flag(statement, statement_type, object_name, reason))
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PredicateEffectiveness {
    Effective,
    Ineffective,
    Uncertain,
}

fn predicate_effectiveness(tokens: &[String]) -> PredicateEffectiveness {
    let normalized = tokens
        .iter()
        .map(|token| token.to_ascii_uppercase())
        .filter(|token| token != ";")
        .collect::<Vec<_>>();
    let trimmed = normalized
        .as_slice()
        .strip_prefix(&["(".to_owned()])
        .unwrap_or(&normalized);
    let trimmed = trimmed.strip_suffix(&[")".to_owned()]).unwrap_or(trimmed);
    if trimmed.is_empty() {
        return PredicateEffectiveness::Uncertain;
    }
    let joined = trimmed.join("");
    if matches!(
        joined.as_str(),
        "TRUE" | "1=1" | "+1=+1" | "1IS1" | "NOTFALSE"
    ) {
        return PredicateEffectiveness::Ineffective;
    }
    if trimmed.iter().any(|token| token == "OR") {
        return PredicateEffectiveness::Uncertain;
    }
    if let Some(and_index) = trimmed.iter().position(|token| token == "AND") {
        let left = predicate_effectiveness(&trimmed[..and_index]);
        let right = predicate_effectiveness(&trimmed[and_index + 1..]);
        return if matches!(
            (left, right),
            (
                PredicateEffectiveness::Effective,
                PredicateEffectiveness::Effective
            )
        ) {
            PredicateEffectiveness::Effective
        } else if left == PredicateEffectiveness::Ineffective
            && right == PredicateEffectiveness::Ineffective
        {
            PredicateEffectiveness::Ineffective
        } else {
            PredicateEffectiveness::Uncertain
        };
    }
    if trimmed.len() >= 3 {
        let left = &trimmed[0];
        let operator = &trimmed[1];
        let right = &trimmed[2];
        let comparison = matches!(
            operator.as_str(),
            "=" | "==" | "!=" | "<>" | "<" | ">" | "<=" | ">=" | "LIKE" | "GLOB"
        );
        let left_identifier = is_identifier(left);
        let right_identifier = is_identifier(right);
        if comparison && left_identifier && right_identifier && left == right {
            return PredicateEffectiveness::Ineffective;
        }
        if comparison && (left_identifier || right_identifier) {
            return PredicateEffectiveness::Effective;
        }
        if left_identifier
            && operator == "IS"
            && matches!(right.as_str(), "NULL" | "TRUE" | "FALSE")
        {
            return PredicateEffectiveness::Effective;
        }
        if left_identifier && operator == "IN" && trimmed[2..].contains(&"(".to_owned()) {
            return PredicateEffectiveness::Effective;
        }
    }
    PredicateEffectiveness::Uncertain
}

fn is_identifier(token: &str) -> bool {
    !token.is_empty()
        && token != "?"
        && token != "NULL"
        && token != "TRUE"
        && token != "FALSE"
        && !token
            .chars()
            .all(|character| character.is_ascii_digit() || matches!(character, '+' | '-' | '.'))
        && token
            .chars()
            .all(|character| character.is_alphanumeric() || matches!(character, '_' | '.'))
}

fn flag(
    statement: &SqlStatement,
    statement_type: String,
    object_name: Option<String>,
    reason: SafetyReason,
) -> SafetyFlag {
    SafetyFlag {
        statement_index: statement.index,
        start: statement.start,
        end: statement.end,
        statement_type,
        object_name,
        reason,
    }
}

fn code_tokens(sql: &str) -> Vec<String> {
    let bytes = sql.as_bytes();
    let mut state = LexState::Code;
    let mut index = 0;
    let mut current = String::new();
    let mut tokens = Vec::new();
    let flush = |current: &mut String, tokens: &mut Vec<String>| {
        if !current.is_empty() {
            tokens.push(std::mem::take(current));
        }
    };
    while index < bytes.len() {
        let byte = bytes[index];
        let next = bytes.get(index + 1).copied();
        match state {
            LexState::Code => match (byte, next) {
                (b'\'', _) => {
                    flush(&mut current, &mut tokens);
                    state = LexState::SingleQuote;
                    tokens.push("?".to_owned());
                }
                (b'"', _) => {
                    flush(&mut current, &mut tokens);
                    state = LexState::DoubleQuote;
                }
                (b'`', _) => {
                    flush(&mut current, &mut tokens);
                    state = LexState::Backtick;
                }
                (b'[', _) => {
                    flush(&mut current, &mut tokens);
                    state = LexState::Bracket;
                }
                (b'-', Some(b'-')) => {
                    flush(&mut current, &mut tokens);
                    state = LexState::LineComment;
                    index += 1;
                }
                (b'/', Some(b'*')) => {
                    flush(&mut current, &mut tokens);
                    state = LexState::BlockComment;
                    index += 1;
                }
                _ if byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.') => {
                    current.push(byte as char);
                }
                _ if !byte.is_ascii_whitespace() => {
                    flush(&mut current, &mut tokens);
                    tokens.push((byte as char).to_string());
                }
                _ => flush(&mut current, &mut tokens),
            },
            LexState::SingleQuote => {
                if byte == b'\'' {
                    if next == Some(b'\'') {
                        index += 1;
                    } else {
                        state = LexState::Code;
                    }
                }
            }
            LexState::DoubleQuote => {
                if byte == b'"' {
                    state = LexState::Code;
                } else {
                    current.push(byte as char);
                }
            }
            LexState::Backtick => {
                if byte == b'`' {
                    state = LexState::Code;
                } else {
                    current.push(byte as char);
                }
            }
            LexState::Bracket => {
                if byte == b']' {
                    state = LexState::Code;
                } else {
                    current.push(byte as char);
                }
            }
            LexState::LineComment => {
                if byte == b'\n' || byte == b'\r' {
                    state = LexState::Code;
                }
            }
            LexState::BlockComment => {
                if byte == b'*' && next == Some(b'/') {
                    state = LexState::Code;
                    index += 1;
                }
            }
        }
        index += 1;
    }
    flush(&mut current, &mut tokens);
    tokens
}

fn execution_fingerprint(
    profile_id: &str,
    session_id: &str,
    context: &str,
    statements: &[SqlStatement],
    flags: &[SafetyFlag],
) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    profile_id.hash(&mut hasher);
    session_id.hash(&mut hasher);
    context.hash(&mut hasher);
    statements.hash(&mut hasher);
    flags.hash(&mut hasher);
    format!("execution-v1-{:016x}", hasher.finish())
}

impl Hash for SqlStatement {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.index.hash(state);
        self.start.hash(state);
        self.end.hash(state);
        self.sql.hash(state);
    }
}

impl Hash for SafetyFlag {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.statement_index.hash(state);
        self.start.hash(state);
        self.end.hash(state);
        self.statement_type.hash(state);
        self.object_name.hash(state);
        (self.reason as u8).hash(state);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn statement_selection_respects_quotes_comments_and_trailing_delimiters() {
        let sql = "SELECT ';' AS value; -- ; ignored\nSELECT 2;";
        let statements = split_statements(sql).unwrap();
        assert_eq!(statements.len(), 2);
        let delimiter = sql.find(';').unwrap();
        let plan = plan_execution(sql, None, delimiter, false, "p", "s", "main").unwrap();
        assert_eq!(plan.statements[0].sql, "SELECT ';' AS value;");
        let second = plan_execution(sql, None, sql.len(), false, "p", "s", "main").unwrap();
        assert!(second.statements[0].sql.contains("SELECT 2"));
    }

    #[test]
    fn nonempty_selection_wins_and_run_all_is_separate() {
        let sql = "SELECT 1; SELECT 2;";
        let selected = plan_execution(sql, Some((10, 19)), 0, false, "p", "s", "main").unwrap();
        assert_eq!(selected.statements.len(), 1);
        assert_eq!(selected.statements[0].sql, "SELECT 2;");
        let all = plan_execution(sql, None, 0, true, "p", "s", "main").unwrap();
        assert_eq!(all.statements.len(), 2);
    }

    #[test]
    fn multi_statement_selection_preserves_order_and_document_ranges() {
        let sql = "SELECT 0;\n  SELECT 1; SELECT 2;\nSELECT 3;";
        let start = sql.find("SELECT 1").unwrap();
        let end = sql.find("\nSELECT 3").unwrap();
        let plan = plan_execution(sql, Some((start, end)), start, false, "p", "s", "main").unwrap();
        assert_eq!(plan.statements.len(), 2);
        assert_eq!(plan.statements[0].start, start);
        assert_eq!(plan.statements[1].sql, "SELECT 2;");
    }

    #[test]
    fn classifier_is_conservative_for_uncertain_predicates_and_names_targets() {
        let sql = "DELETE FROM records WHERE random(); UPDATE records SET value = 1 WHERE id = 7; DROP TABLE IF EXISTS archive;";
        let plan = plan_execution(sql, None, 0, true, "p", "s", "main").unwrap();
        assert_eq!(plan.safety_flags.len(), 2);
        assert_eq!(
            plan.safety_flags[0].reason,
            SafetyReason::UncertainPredicate
        );
        assert_eq!(plan.safety_flags[0].object_name.as_deref(), Some("records"));
        assert_eq!(plan.safety_flags[1].object_name.as_deref(), Some("archive"));
    }

    #[test]
    fn destructive_classifier_flags_all_uncertain_or_unbounded_statements() {
        let sql = "DROP TABLE x; UPDATE x SET value = 1; DELETE FROM x WHERE 1 = 1; UPDATE x SET value = 2 WHERE id = 7;";
        let plan = plan_execution(sql, None, 0, true, "p", "s", "main").unwrap();
        assert_eq!(plan.safety_flags.len(), 3);
        assert_eq!(plan.safety_flags[0].reason, SafetyReason::Drop);
        assert_eq!(plan.safety_flags[1].reason, SafetyReason::MissingPredicate);
        assert_eq!(
            plan.safety_flags[2].reason,
            SafetyReason::IneffectivePredicate
        );
    }

    #[test]
    fn approval_fingerprint_changes_with_text_context_or_session() {
        let plan = |sql: &str, session: &str, context: &str| {
            plan_execution(sql, None, 0, true, "profile", session, context)
                .unwrap()
                .fingerprint
        };
        assert_ne!(
            plan("DROP TABLE x", "a", "main"),
            plan("DROP TABLE y", "a", "main")
        );
        assert_ne!(
            plan("DROP TABLE x", "a", "main"),
            plan("DROP TABLE x", "b", "main")
        );
        assert_ne!(
            plan("DROP TABLE x", "a", "main"),
            plan("DROP TABLE x", "a", "temp")
        );
    }

    #[test]
    fn unknown_transaction_read_only_gate_is_conservative() {
        for sql in [
            "SELECT 1",
            "-- comment\n VALUES (1)",
            "EXPLAIN DELETE FROM t",
        ] {
            let plan = plan_execution(sql, None, 0, true, "p", "s", "main").unwrap();
            assert!(execution_is_provably_read_only(&plan), "{sql}");
        }
        for sql in [
            "WITH values_cte AS (SELECT 1) SELECT * FROM values_cte",
            "PRAGMA user_version",
            "INSERT INTO t VALUES (1)",
            "UPDATE t SET value = 1 WHERE id = 2",
        ] {
            let plan = plan_execution(sql, None, 0, true, "p", "s", "main").unwrap();
            assert!(!execution_is_provably_read_only(&plan), "{sql}");
        }
    }
}
