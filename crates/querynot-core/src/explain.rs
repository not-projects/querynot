use crate::sql::{SqlDialect, leading_statement_keyword, plan_execution_for_dialect};
use crate::{ErrorCategory, QueryNotError};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashMap;

pub const MAX_EXPLAIN_RAW_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_EXPLAIN_NODES: usize = 1_000;
pub const MAX_EXPLAIN_DEPTH: usize = 64;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ExplainTarget {
    pub sql: String,
    pub start: usize,
    pub end: usize,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct SqliteExplainRow {
    pub id: i64,
    pub parent: i64,
    pub auxiliary: i64,
    pub detail: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ExplainPlanNode {
    pub id: u32,
    pub parent_id: Option<u32>,
    pub depth: u32,
    pub operation: Option<String>,
    pub relation: Option<String>,
    pub alias: Option<String>,
    pub access_type: Option<String>,
    pub join_type: Option<String>,
    pub index: Option<String>,
    pub estimated_rows: Option<String>,
    pub startup_cost: Option<String>,
    pub total_cost: Option<String>,
    pub width: Option<String>,
    pub condition: Option<String>,
    pub detail: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ExplainOutput {
    pub raw_format: String,
    pub raw_payload: String,
    pub normalization_status: String,
    pub warnings: Vec<String>,
    pub nodes: Vec<ExplainPlanNode>,
}

#[derive(Debug)]
pub enum ExplainRunOutcome {
    Completed(ExplainOutput),
    Cancelled { confirmed: bool },
    Failed(QueryNotError),
}

pub fn target_explain_statement(
    document: &str,
    selection: Option<(usize, usize)>,
    cursor: usize,
    dialect: SqlDialect,
    profile_id: &str,
    session_id: &str,
    context: &str,
) -> Result<ExplainTarget, QueryNotError> {
    let plan = plan_execution_for_dialect(
        document, selection, cursor, false, dialect, profile_id, session_id, context,
    )
    .map_err(|error| QueryNotError::database(ErrorCategory::Syntax, error.to_string(), false))?;
    if plan.statements.len() != 1 {
        return Err(QueryNotError::database(
            ErrorCategory::Syntax,
            "Explain requires exactly one selected or caret statement.",
            false,
        ));
    }
    let statement = plan.statements.into_iter().next().expect("one statement");
    let Some(keyword) = leading_statement_keyword(&statement.sql) else {
        return Err(QueryNotError::database(
            ErrorCategory::Syntax,
            "Explain requires one nonempty SQL statement.",
            false,
        ));
    };
    if matches!(keyword.as_str(), "EXPLAIN" | "ANALYZE") {
        return Err(QueryNotError::database(
            ErrorCategory::UnsupportedCapability,
            "Explain accepts an unprefixed statement and never runs EXPLAIN ANALYZE.",
            false,
        ));
    }
    Ok(ExplainTarget {
        sql: statement.sql,
        start: statement.start,
        end: statement.end,
    })
}

pub fn normalize_sqlite(rows: Vec<SqliteExplainRow>) -> Result<ExplainOutput, QueryNotError> {
    let raw_payload = serde_json::to_string(&rows)
        .map_err(|_| QueryNotError::internal("SQLite explain output could not be encoded."))?;
    enforce_raw_limit(&raw_payload)?;
    if rows.len() > MAX_EXPLAIN_NODES {
        return Ok(raw_only(
            "sqlite_query_plan_rows",
            raw_payload,
            "The SQLite plan exceeded QueryNot's 1,000-node normalization limit.",
        ));
    }
    let all_ids = rows
        .iter()
        .map(|row| row.id)
        .collect::<std::collections::HashSet<_>>();
    if all_ids.len() != rows.len() {
        return Ok(raw_only(
            "sqlite_query_plan_rows",
            raw_payload,
            "The SQLite plan contains duplicate node identifiers; Raw remains available.",
        ));
    }
    let mut emitted = vec![false; rows.len()];
    let mut ordered = Vec::with_capacity(rows.len());
    let mut id_map = HashMap::new();
    while ordered.len() < rows.len() {
        let mut progressed = false;
        for (source_index, row) in rows.iter().enumerate() {
            if emitted[source_index]
                || (all_ids.contains(&row.parent) && !id_map.contains_key(&row.parent))
            {
                continue;
            }
            emitted[source_index] = true;
            id_map.insert(row.id, ordered.len() as u32);
            ordered.push(row);
            progressed = true;
        }
        if !progressed {
            return Ok(raw_only(
                "sqlite_query_plan_rows",
                raw_payload,
                "The SQLite plan contains a cyclic or unresolved parent relationship; Raw remains available.",
            ));
        }
    }
    let mut nodes = Vec::with_capacity(ordered.len());
    for (index, row) in ordered.into_iter().enumerate() {
        let parent_id = id_map.get(&row.parent).copied();
        let depth = parent_id
            .and_then(|parent| nodes.get(parent as usize))
            .map_or(0, |parent: &ExplainPlanNode| parent.depth.saturating_add(1));
        if depth as usize >= MAX_EXPLAIN_DEPTH {
            return Ok(raw_only(
                "sqlite_query_plan_rows",
                raw_payload,
                "The SQLite plan exceeded QueryNot's 64-level normalization limit.",
            ));
        }
        let facts = sqlite_detail_facts(&row.detail);
        nodes.push(ExplainPlanNode {
            id: index as u32,
            parent_id,
            depth,
            operation: facts.0,
            relation: facts.1,
            index: facts.2,
            detail: Some(row.detail.clone()),
            ..empty_node(index as u32, parent_id, depth)
        });
    }
    Ok(ExplainOutput {
        raw_format: "sqlite_query_plan_rows".to_owned(),
        raw_payload,
        normalization_status: "normalized".to_owned(),
        warnings: vec![
            "SQLite documents EXPLAIN QUERY PLAN output as unstable; Raw preserves the native rows QueryNot received."
                .to_owned(),
        ],
        nodes,
    })
}

pub fn normalize_mysql_family(
    raw_payload: String,
    product: &str,
) -> Result<ExplainOutput, QueryNotError> {
    enforce_raw_limit(&raw_payload)?;
    let value: Value = match serde_json::from_str(&raw_payload) {
        Ok(value) => value,
        Err(_) => {
            return Ok(raw_only(
                "json",
                raw_payload,
                "The engine returned JSON that QueryNot could not normalize; Raw remains available.",
            ));
        }
    };
    let mut builder = JsonPlanBuilder::default();
    builder.walk_mysql(&value, None, 0, None);
    finish_json_normalization(raw_payload, product, builder)
}

pub fn normalize_postgres(raw_payload: String) -> Result<ExplainOutput, QueryNotError> {
    enforce_raw_limit(&raw_payload)?;
    let value: Value = match serde_json::from_str(&raw_payload) {
        Ok(value) => value,
        Err(_) => {
            return Ok(raw_only(
                "json",
                raw_payload,
                "PostgreSQL returned JSON that QueryNot could not normalize; Raw remains available.",
            ));
        }
    };
    let root = value
        .as_array()
        .and_then(|items| items.first())
        .and_then(Value::as_object)
        .and_then(|object| object.get("Plan"));
    let Some(root) = root else {
        return Ok(raw_only(
            "json",
            raw_payload,
            "The PostgreSQL plan shape was not recognized; Raw remains available.",
        ));
    };
    let mut builder = JsonPlanBuilder::default();
    builder.walk_postgres(root, None, 0);
    finish_json_normalization(raw_payload, "PostgreSQL", builder)
}

fn enforce_raw_limit(raw: &str) -> Result<(), QueryNotError> {
    if raw.len() > MAX_EXPLAIN_RAW_BYTES {
        return Err(QueryNotError::database(
            ErrorCategory::UnsupportedCapability,
            "The estimated plan exceeds QueryNot's 4 MiB raw-output limit.",
            false,
        ));
    }
    Ok(())
}

fn raw_only(format: &str, raw_payload: String, warning: &str) -> ExplainOutput {
    ExplainOutput {
        raw_format: format.to_owned(),
        raw_payload,
        normalization_status: "raw_only".to_owned(),
        warnings: vec![warning.to_owned()],
        nodes: Vec::new(),
    }
}

fn finish_json_normalization(
    raw_payload: String,
    product: &str,
    builder: JsonPlanBuilder,
) -> Result<ExplainOutput, QueryNotError> {
    if let Some(reason) = builder.limit_reason {
        return Ok(raw_only("json", raw_payload, &reason));
    }
    if builder.nodes.is_empty() {
        return Ok(raw_only(
            "json",
            raw_payload,
            &format!("The {product} plan shape was not recognized; Raw remains available."),
        ));
    }
    Ok(ExplainOutput {
        raw_format: "json".to_owned(),
        raw_payload,
        normalization_status: "normalized".to_owned(),
        warnings: Vec::new(),
        nodes: builder.nodes,
    })
}

#[derive(Default)]
struct JsonPlanBuilder {
    nodes: Vec<ExplainPlanNode>,
    limit_reason: Option<String>,
}

impl JsonPlanBuilder {
    fn reserve_node(&mut self, depth: usize) -> Option<(u32, u32)> {
        if self.limit_reason.is_some() {
            return None;
        }
        if depth >= MAX_EXPLAIN_DEPTH {
            self.limit_reason = Some(
                "The plan exceeded QueryNot's 64-level normalization limit; Raw remains available."
                    .to_owned(),
            );
            return None;
        }
        if self.nodes.len() >= MAX_EXPLAIN_NODES {
            self.limit_reason = Some(
                "The plan exceeded QueryNot's 1,000-node normalization limit; Raw remains available."
                    .to_owned(),
            );
            return None;
        }
        Some((self.nodes.len() as u32, depth as u32))
    }

    fn walk_postgres(&mut self, value: &Value, parent_id: Option<u32>, depth: usize) {
        let Some(object) = value.as_object() else {
            return;
        };
        let Some((id, node_depth)) = self.reserve_node(depth) else {
            return;
        };
        let mut node = empty_node(id, parent_id, node_depth);
        node.operation = text(object, "Node Type");
        node.relation = text(object, "Relation Name");
        node.alias = text(object, "Alias");
        node.access_type = text(object, "Scan Direction");
        node.join_type = text(object, "Join Type");
        node.index = text(object, "Index Name");
        node.estimated_rows = scalar(object, "Plan Rows");
        node.startup_cost = scalar(object, "Startup Cost");
        node.total_cost = scalar(object, "Total Cost");
        node.width = scalar(object, "Plan Width");
        node.condition = first_text(
            object,
            &[
                "Filter",
                "Index Cond",
                "Recheck Cond",
                "Hash Cond",
                "Join Filter",
            ],
        );
        node.detail = first_text(object, &["Strategy", "Parent Relationship", "Subplan Name"]);
        self.nodes.push(node);
        if let Some(children) = object.get("Plans").and_then(Value::as_array) {
            for child in children {
                self.walk_postgres(child, Some(id), depth + 1);
            }
        }
    }

    fn walk_mysql(
        &mut self,
        value: &Value,
        parent_id: Option<u32>,
        depth: usize,
        structural_operation: Option<&str>,
    ) {
        if self.limit_reason.is_some() {
            return;
        }
        match value {
            Value::Array(items) => {
                for item in items {
                    self.walk_mysql(item, parent_id, depth, structural_operation);
                }
            }
            Value::Object(object) => {
                let is_node = object.contains_key("table_name")
                    || object.contains_key("operation")
                    || structural_operation.is_some();
                let (next_parent, next_depth) = if is_node {
                    let Some((id, node_depth)) = self.reserve_node(depth) else {
                        return;
                    };
                    let mut node = empty_node(id, parent_id, node_depth);
                    node.operation = text(object, "operation")
                        .or_else(|| structural_operation.map(humanize_key))
                        .or_else(|| Some("Table access".to_owned()));
                    node.relation = text(object, "table_name");
                    node.alias = text(object, "alias");
                    node.access_type = text(object, "access_type");
                    node.join_type = text(object, "join_type");
                    node.index = first_text(object, &["key", "index_name"]);
                    node.estimated_rows = first_scalar(
                        object,
                        &["rows", "estimated_rows", "rows_examined_per_scan"],
                    );
                    node.startup_cost =
                        first_scalar(object, &["startup_cost", "estimated_startup_cost"]);
                    node.total_cost = first_scalar(object, &["total_cost", "estimated_total_cost"])
                        .or_else(|| {
                            object
                                .get("cost_info")
                                .and_then(Value::as_object)
                                .and_then(|cost| {
                                    first_scalar(cost, &["query_cost", "read_cost", "eval_cost"])
                                })
                        });
                    node.width = first_scalar(object, &["width", "estimated_width"]);
                    node.condition = first_text(
                        object,
                        &["attached_condition", "condition", "index_condition"],
                    );
                    node.detail = first_text(object, &["select_type", "message"]);
                    self.nodes.push(node);
                    (Some(id), depth + 1)
                } else {
                    (parent_id, depth)
                };
                for (key, child) in object {
                    if is_mysql_fact_key(key) {
                        continue;
                    }
                    let structural = mysql_structural_operation(key);
                    self.walk_mysql(child, next_parent, next_depth, structural);
                }
            }
            _ => {}
        }
    }
}

fn empty_node(id: u32, parent_id: Option<u32>, depth: u32) -> ExplainPlanNode {
    ExplainPlanNode {
        id,
        parent_id,
        depth,
        operation: None,
        relation: None,
        alias: None,
        access_type: None,
        join_type: None,
        index: None,
        estimated_rows: None,
        startup_cost: None,
        total_cost: None,
        width: None,
        condition: None,
        detail: None,
    }
}

fn scalar(object: &Map<String, Value>, key: &str) -> Option<String> {
    object.get(key).and_then(value_scalar)
}

fn first_scalar(object: &Map<String, Value>, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| scalar(object, key))
}

fn text(object: &Map<String, Value>, key: &str) -> Option<String> {
    object.get(key).and_then(Value::as_str).map(str::to_owned)
}

fn first_text(object: &Map<String, Value>, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| text(object, key))
}

fn value_scalar(value: &Value) -> Option<String> {
    match value {
        Value::String(value) => Some(value.clone()),
        Value::Number(value) => Some(value.to_string()),
        Value::Bool(value) => Some(value.to_string()),
        _ => None,
    }
}

fn sqlite_detail_facts(detail: &str) -> (Option<String>, Option<String>, Option<String>) {
    let words = detail.split_whitespace().collect::<Vec<_>>();
    let operation = words.first().map(|word| (*word).to_owned());
    let relation = words
        .iter()
        .position(|word| matches!(*word, "SCAN" | "SEARCH"))
        .and_then(|position| words.get(position + 1))
        .filter(|word| !matches!(**word, "TABLE" | "SUBQUERY"))
        .or_else(|| {
            words
                .iter()
                .position(|word| matches!(*word, "TABLE" | "SUBQUERY"))
                .and_then(|position| words.get(position + 1))
        })
        .map(|word| word.trim_matches('`').to_owned());
    let index = words
        .iter()
        .position(|word| *word == "INDEX")
        .and_then(|position| words.get(position + 1))
        .map(|word| word.trim_matches('`').trim_end_matches(')').to_owned());
    (operation, relation, index)
}

fn humanize_key(key: &str) -> String {
    let mut result = key.replace('_', " ");
    if let Some(first) = result.get_mut(0..1) {
        first.make_ascii_uppercase();
    }
    result
}

fn mysql_structural_operation(key: &str) -> Option<&str> {
    matches!(
        key,
        "query_block"
            | "nested_loop"
            | "ordering_operation"
            | "grouping_operation"
            | "duplicates_removal"
            | "union_result"
            | "materialized_from_subquery"
            | "filesort"
    )
    .then_some(key)
}

fn is_mysql_fact_key(key: &str) -> bool {
    matches!(
        key,
        "operation"
            | "table_name"
            | "alias"
            | "access_type"
            | "join_type"
            | "key"
            | "index_name"
            | "rows"
            | "estimated_rows"
            | "rows_examined_per_scan"
            | "startup_cost"
            | "estimated_startup_cost"
            | "total_cost"
            | "estimated_total_cost"
            | "width"
            | "estimated_width"
            | "attached_condition"
            | "condition"
            | "index_condition"
            | "select_type"
            | "message"
            | "cost_info"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn targeting_selects_one_utf8_caret_statement() {
        let sql = "select 'é';\nselect 2;";
        let cursor = sql.find("2").unwrap();
        let target =
            target_explain_statement(sql, None, cursor, SqlDialect::Sqlite, "p", "s", "main")
                .unwrap();
        assert_eq!(target.sql, "select 2;");
        assert!(sql.is_char_boundary(target.start));
        assert!(sql.is_char_boundary(target.end));
    }

    #[test]
    fn targeting_rejects_multiple_and_prefixed_statements() {
        assert!(
            target_explain_statement(
                "  -- nothing to plan",
                None,
                0,
                SqlDialect::Sqlite,
                "p",
                "s",
                "main"
            )
            .is_err()
        );
        assert!(
            target_explain_statement(
                "select 1; select 2",
                Some((0, 18)),
                0,
                SqlDialect::Sqlite,
                "p",
                "s",
                "main"
            )
            .is_err()
        );
        assert!(
            target_explain_statement(
                "EXPLAIN select 1",
                None,
                3,
                SqlDialect::MySql,
                "p",
                "s",
                "db"
            )
            .is_err()
        );
        assert!(
            target_explain_statement(
                "ANALYZE select 1",
                None,
                3,
                SqlDialect::Postgres,
                "p",
                "s",
                "public"
            )
            .is_err()
        );
    }

    #[test]
    fn sqlite_rows_are_parent_before_child_and_fact_only() {
        let output = normalize_sqlite(vec![
            SqliteExplainRow {
                id: 7,
                parent: 2,
                auxiliary: 0,
                detail: "SEARCH orders USING INDEX orders_user (user_id=?)".to_owned(),
            },
            SqliteExplainRow {
                id: 2,
                parent: 0,
                auxiliary: 0,
                detail: "SCAN users".to_owned(),
            },
        ])
        .unwrap();
        assert_eq!(output.normalization_status, "normalized");
        assert_eq!(output.nodes[0].relation.as_deref(), Some("users"));
        assert_eq!(output.nodes[1].parent_id, Some(0));
        assert_eq!(output.nodes[1].relation.as_deref(), Some("orders"));
        assert_eq!(output.nodes[1].index.as_deref(), Some("orders_user"));
    }

    #[test]
    fn mysql_and_mariadb_shapes_normalize_without_recommendations() {
        let mysql_57 = r#"{"query_block":{"select_id":1,"nested_loop":[{"table":{"table_name":"users","access_type":"ALL","rows":12}},{"table":{"table_name":"orders","access_type":"ref","key":"idx_user","rows_examined_per_scan":"2"}}]}}"#;
        let output = normalize_mysql_family(mysql_57.to_owned(), "MySQL").unwrap();
        assert_eq!(output.normalization_status, "normalized");
        assert!(
            output
                .nodes
                .iter()
                .any(|node| node.relation.as_deref() == Some("orders"))
        );
        assert_eq!(
            output
                .nodes
                .iter()
                .find(|node| node.relation.as_deref() == Some("users"))
                .and_then(|node| node.estimated_rows.as_deref()),
            Some("12")
        );

        let mysql_operation_inputs = r#"{"operation":"Nested loop inner join","inputs":[{"operation":"Table scan","table_name":"users","estimated_rows":"12.0"},{"operation":"Index lookup","table_name":"orders","index_name":"idx_user","estimated_rows":2}]}"#;
        let output = normalize_mysql_family(mysql_operation_inputs.to_owned(), "MySQL").unwrap();
        assert!(
            output
                .nodes
                .iter()
                .any(|node| node.operation.as_deref() == Some("Index lookup"))
        );

        let mariadb = r#"{"query_block":{"select_id":1,"read_sorted_file":{"filesort":{"sort_key":"users.name","table":{"table_name":"users","access_type":"range","key":"PRIMARY","rows":3,"attached_condition":"users.id > 0"}}}}}"#;
        let output = normalize_mysql_family(mariadb.to_owned(), "MariaDB").unwrap();
        assert!(output.nodes.iter().any(|node| {
            node.relation.as_deref() == Some("users")
                && node.index.as_deref() == Some("PRIMARY")
                && node.condition.as_deref() == Some("users.id > 0")
        }));
    }

    #[test]
    fn postgres_numeric_estimates_remain_strings() {
        let raw = r#"[{"Plan":{"Node Type":"Index Scan","Relation Name":"users","Index Name":"users_pkey","Startup Cost":0.15,"Total Cost":8.17,"Plan Rows":1,"Plan Width":32}}]"#;
        let output = normalize_postgres(raw.to_owned()).unwrap();
        assert_eq!(output.nodes[0].estimated_rows.as_deref(), Some("1"));
        assert_eq!(output.nodes[0].total_cost.as_deref(), Some("8.17"));
    }

    #[test]
    fn malformed_and_unknown_json_succeed_as_raw_only() {
        for raw in ["{", r#"{"future_plan":{"opaque":true}}"#] {
            let output = normalize_mysql_family(raw.to_owned(), "MariaDB").unwrap();
            assert_eq!(output.normalization_status, "raw_only");
            assert!(output.nodes.is_empty());
        }
    }

    #[test]
    fn raw_size_and_complexity_limits_fail_or_fall_back() {
        let oversized = "x".repeat(MAX_EXPLAIN_RAW_BYTES + 1);
        assert!(normalize_mysql_family(oversized, "MySQL").is_err());
        let tables = (0..=MAX_EXPLAIN_NODES)
            .map(|index| serde_json::json!({"table_name": format!("t{index}")}))
            .collect::<Vec<_>>();
        let output = normalize_mysql_family(
            serde_json::to_string(&serde_json::json!({"nested_loop": tables})).unwrap(),
            "MySQL",
        )
        .unwrap();
        assert_eq!(output.normalization_status, "raw_only");

        let mut deep = serde_json::json!({"operation": "leaf"});
        for _ in 0..MAX_EXPLAIN_DEPTH {
            deep = serde_json::json!({"operation": "parent", "input": deep});
        }
        let output =
            normalize_mysql_family(serde_json::to_string(&deep).unwrap(), "MySQL").unwrap();
        assert_eq!(output.normalization_status, "raw_only");
        assert!(output.warnings[0].contains("64-level"));
    }
}
