use crate::result::tagged_value_size;
use crate::sqlite::{SchemaObjectDetail, SchemaObjectKind};
use crate::{MutationPlanId, QueryNotError, TaggedValue};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub const MAX_TABLE_OPERATIONS: usize = 1_000;
pub const MAX_OFFSET_ROWS: u64 = 10_000;
pub const MAX_EDITABLE_ORIGINAL_BYTES: usize = 4 * 1024;
pub const MAX_TABLE_CELL_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_TABLE_PAGE_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_TABLE_METADATA_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_TABLE_PLAN_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_TABLE_COLUMNS: usize = 2_048;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TableDialect {
    Sqlite,
    MySql,
    Postgres,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TableEditorKind {
    Text,
    Integer,
    Decimal,
    Float,
    Boolean,
    DateTime,
    EnumLike,
    ReadOnly,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct TableColumn {
    pub name: String,
    pub declared_type: String,
    pub nullable: bool,
    pub primary_key_position: u32,
    pub has_default: bool,
    pub generated: bool,
    pub editor: TableEditorKind,
    pub editable: bool,
    pub read_only_reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct TableIdentity {
    pub source: String,
    pub columns: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct TableDefinition {
    pub namespace: String,
    pub table: String,
    pub columns: Vec<TableColumn>,
    pub identity: Option<TableIdentity>,
    pub editable: bool,
    pub read_only_reason: Option<String>,
}

impl TableDefinition {
    #[must_use]
    pub fn from_detail(
        detail: &SchemaObjectDetail,
        read_only_connection: bool,
        safe_mutations: bool,
    ) -> Self {
        let columns = detail
            .columns
            .iter()
            .map(|column| {
                let (editor, type_reason) = editor_for_type(&column.declared_type);
                let read_only_reason = if column.generated {
                    Some("Server-generated and computed values are read-only.".to_owned())
                } else {
                    type_reason
                };
                TableColumn {
                    name: column.name.clone(),
                    declared_type: column.declared_type.clone(),
                    nullable: column.nullable,
                    primary_key_position: column.primary_key_position,
                    has_default: column.default_expression.is_some() || column.generated,
                    generated: column.generated,
                    editable: !column.generated && editor != TableEditorKind::ReadOnly,
                    editor,
                    read_only_reason,
                }
            })
            .collect::<Vec<_>>();
        let identity = usable_identity(detail, &columns);
        let read_only_reason = if detail.object.kind != SchemaObjectKind::Table {
            Some("Views are browsable but read-only in the initial release.".to_owned())
        } else if read_only_connection {
            Some("This connection is read-only or outside the validated write matrix.".to_owned())
        } else if !safe_mutations {
            Some("The active adapter did not advertise safe table mutations.".to_owned())
        } else if identity.is_none() {
            Some(
                "This table has no primary key or non-null declared unique key; hidden row identifiers are never used."
                    .to_owned(),
            )
        } else {
            None
        };
        Self {
            namespace: detail.object.namespace.clone(),
            table: detail.object.name.clone(),
            columns,
            identity,
            editable: read_only_reason.is_none(),
            read_only_reason,
        }
    }

    fn column_index(&self, name: &str) -> Result<usize, QueryNotError> {
        self.columns
            .iter()
            .position(|column| column.name == name)
            .ok_or_else(|| QueryNotError::authorization("A table column is unknown or stale."))
    }
}

fn usable_identity(detail: &SchemaObjectDetail, columns: &[TableColumn]) -> Option<TableIdentity> {
    if detail.object.kind != SchemaObjectKind::Table {
        return None;
    }
    let mut primary = columns
        .iter()
        .filter(|column| column.primary_key_position > 0)
        .collect::<Vec<_>>();
    primary.sort_by_key(|column| column.primary_key_position);
    if !primary.is_empty() {
        return Some(TableIdentity {
            source: "primary_key".to_owned(),
            columns: primary.iter().map(|column| column.name.clone()).collect(),
        });
    }
    detail
        .indexes
        .iter()
        .filter(|index| {
            index.unique && !index.partial && !index.has_expressions && !index.columns.is_empty()
        })
        .find_map(|index| {
            let usable = index.columns.iter().all(|name| {
                columns
                    .iter()
                    .find(|column| column.name == *name)
                    .is_some_and(|column| !column.nullable && !column.generated)
            });
            usable.then(|| TableIdentity {
                source: "unique_key".to_owned(),
                columns: index.columns.clone(),
            })
        })
}

fn editor_for_type(declared_type: &str) -> (TableEditorKind, Option<String>) {
    let upper = declared_type.trim().to_ascii_uppercase();
    if upper.is_empty() {
        return (
            TableEditorKind::ReadOnly,
            Some("The adapter did not report a supported editable type.".to_owned()),
        );
    }
    if upper.contains("BLOB")
        || upper.contains("BINARY")
        || upper.contains("BYTEA")
        || upper.contains("CLOB")
        || upper.contains("LONGTEXT")
        || upper.contains("MEDIUMTEXT")
        || upper.contains("TINYTEXT")
        || upper.contains("JSON")
    {
        return (
            TableEditorKind::ReadOnly,
            Some(
                "Binary, LOB, JSON, truncated, and adapter-specific values are read-only."
                    .to_owned(),
            ),
        );
    }
    if upper.starts_with("ENUM(") || upper.starts_with("SET(") {
        return (TableEditorKind::EnumLike, None);
    }
    if upper.contains("BOOL") || upper == "BIT" || upper.starts_with("BIT(1)") {
        return (TableEditorKind::Boolean, None);
    }
    if upper.contains("INT") || upper == "YEAR" {
        return (TableEditorKind::Integer, None);
    }
    if upper.contains("DECIMAL") || upper.contains("NUMERIC") {
        return (TableEditorKind::Decimal, None);
    }
    if upper.contains("REAL") || upper.contains("FLOAT") || upper.contains("DOUBLE") {
        return (TableEditorKind::Float, None);
    }
    if upper.contains("DATE") || upper.contains("TIME") {
        return (TableEditorKind::DateTime, None);
    }
    if upper.contains("CHAR") || upper.contains("TEXT") || upper.contains("STRING") {
        return (TableEditorKind::Text, None);
    }
    (
        TableEditorKind::ReadOnly,
        Some("The adapter did not report a supported editable type.".to_owned()),
    )
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FilterOperator {
    Equal,
    NotEqual,
    LessThan,
    LessOrEqual,
    GreaterThan,
    GreaterOrEqual,
    Contains,
    StartsWith,
    IsNull,
    IsNotNull,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct TableFilter {
    pub column: String,
    pub operator: FilterOperator,
    pub value: Option<TaggedValue>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SortDirection {
    Ascending,
    Descending,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct TableSort {
    pub column: String,
    pub direction: SortDirection,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct BrowseInput {
    pub filters: Vec<TableFilter>,
    pub sorts: Vec<TableSort>,
    pub cursor: Vec<TaggedValue>,
    pub offset: u64,
    pub page_size: u32,
}

#[derive(Clone, Debug, PartialEq)]
pub struct BrowsePlan {
    pub sql: String,
    pub parameters: Vec<TaggedValue>,
    pub order_column_indexes: Vec<usize>,
    pub page_size: usize,
    pub keyset: bool,
    pub unstable: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct TablePage {
    pub definition: TableDefinition,
    pub rows: Vec<Vec<TaggedValue>>,
    pub has_more: bool,
    pub next_cursor: Vec<TaggedValue>,
    pub next_offset: u64,
    pub unstable: bool,
}

pub fn validate_table_page_values(rows: &[Vec<TaggedValue>]) -> Result<(), QueryNotError> {
    let mut page_bytes = 0_usize;
    for value in rows.iter().flatten() {
        let value_bytes = tagged_value_size(value);
        if value_bytes > MAX_TABLE_CELL_BYTES {
            return Err(QueryNotError::database(
                crate::ErrorCategory::UnsupportedCapability,
                "A table cell exceeds the 4 MiB safe browsing boundary. Use an explicit query to inspect that value.",
                false,
            ));
        }
        page_bytes = page_bytes.saturating_add(value_bytes);
        if page_bytes > MAX_TABLE_PAGE_BYTES {
            return Err(QueryNotError::database(
                crate::ErrorCategory::UnsupportedCapability,
                "The table page exceeds the 16 MiB safe browsing boundary. Reduce the page size or add a bound filter.",
                false,
            ));
        }
    }
    Ok(())
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MutationApplyResult {
    pub affected_rows: u64,
    pub refreshed: bool,
}

pub fn plan_browse(
    definition: &TableDefinition,
    dialect: TableDialect,
    input: &BrowseInput,
) -> Result<BrowsePlan, QueryNotError> {
    validate_table_definition(definition)?;
    if !(25..=1_000).contains(&input.page_size)
        || input.filters.len() > 32
        || input.sorts.len() > 16
        || input.offset > MAX_OFFSET_ROWS
    {
        return Err(QueryNotError::authorization(
            "Table paging, filter, or sort limits were exceeded.",
        ));
    }
    let quote = |value: &str| quote_identifier(dialect, value);
    let qualified = format!(
        "{}.{}",
        quote(&definition.namespace),
        quote(&definition.table)
    );
    let projection = definition
        .columns
        .iter()
        .map(|column| quote(&column.name))
        .collect::<Vec<_>>()
        .join(", ");
    let mut predicates = Vec::new();
    let mut parameters = Vec::new();
    for filter in &input.filters {
        let index = definition.column_index(&filter.column)?;
        let column = &definition.columns[index];
        let quoted = quote(&column.name);
        match filter.operator {
            FilterOperator::IsNull => {
                require_no_filter_value(filter)?;
                predicates.push(format!("{quoted} IS NULL"));
            }
            FilterOperator::IsNotNull => {
                require_no_filter_value(filter)?;
                predicates.push(format!("{quoted} IS NOT NULL"));
            }
            FilterOperator::Contains | FilterOperator::StartsWith => {
                if !matches!(
                    column.editor,
                    TableEditorKind::Text | TableEditorKind::EnumLike
                ) {
                    return Err(QueryNotError::authorization(
                        "Contains filters are available only for text-like columns.",
                    ));
                }
                let text = filter_text_value(filter)?;
                let escaped = text
                    .replace('!', "!!")
                    .replace('%', "!%")
                    .replace('_', "!_");
                parameters.push(TaggedValue::Text(
                    if filter.operator == FilterOperator::Contains {
                        format!("%{escaped}%")
                    } else {
                        format!("{escaped}%")
                    },
                ));
                let marker = parameter_marker(dialect, parameters.len());
                predicates.push(format!("{quoted} LIKE {marker} ESCAPE '!'"));
            }
            operator => {
                let value = filter.value.clone().ok_or_else(|| {
                    QueryNotError::authorization("This filter requires a typed value.")
                })?;
                validate_value(column, &value)?;
                if value == TaggedValue::Null {
                    predicates.push(match operator {
                        FilterOperator::Equal => format!("{quoted} IS NULL"),
                        FilterOperator::NotEqual => format!("{quoted} IS NOT NULL"),
                        _ => {
                            return Err(QueryNotError::authorization(
                                "NULL supports only equal, not-equal, is-null, and is-not-null filters.",
                            ));
                        }
                    });
                    continue;
                }
                parameters.push(value);
                let marker = parameter_marker(dialect, parameters.len());
                let comparison = match operator {
                    FilterOperator::Equal => null_safe_equal(dialect, &quoted, &marker),
                    FilterOperator::NotEqual => {
                        format!("NOT ({})", null_safe_equal(dialect, &quoted, &marker))
                    }
                    FilterOperator::LessThan => format!("{quoted} < {marker}"),
                    FilterOperator::LessOrEqual => format!("{quoted} <= {marker}"),
                    FilterOperator::GreaterThan => format!("{quoted} > {marker}"),
                    FilterOperator::GreaterOrEqual => format!("{quoted} >= {marker}"),
                    _ => unreachable!("null and text operators were handled above"),
                };
                predicates.push(comparison);
            }
        }
    }

    let mut order = Vec::<(usize, SortDirection)>::new();
    let mut seen = HashSet::new();
    for sort in &input.sorts {
        let index = definition.column_index(&sort.column)?;
        if definition.columns[index].editor == TableEditorKind::ReadOnly {
            return Err(QueryNotError::database(
                crate::ErrorCategory::UnsupportedCapability,
                "Server sorting is unavailable for binary, LOB, truncated, or adapter-unknown columns.",
                false,
            ));
        }
        if !seen.insert(index) {
            return Err(QueryNotError::authorization(
                "A table sort column may appear only once.",
            ));
        }
        order.push((index, sort.direction));
    }
    let keyset = definition.identity.is_some();
    if let Some(identity) = &definition.identity {
        for name in &identity.columns {
            let index = definition.column_index(name)?;
            if seen.insert(index) {
                order.push((index, SortDirection::Ascending));
            }
        }
        if !input.cursor.is_empty() {
            if input.cursor.len() != order.len() {
                return Err(QueryNotError::authorization(
                    "The table page cursor is stale for the active sort.",
                ));
            }
            predicates.push(keyset_predicate(
                definition,
                dialect,
                &order,
                &input.cursor,
                &mut parameters,
            )?);
        }
    } else if !input.cursor.is_empty() {
        return Err(QueryNotError::authorization(
            "Read-only offset paging does not accept a keyset cursor.",
        ));
    }
    if order.is_empty() {
        order.extend(
            definition
                .columns
                .iter()
                .enumerate()
                .take(1)
                .map(|(index, _)| (index, SortDirection::Ascending)),
        );
    }
    let mut sql = format!("SELECT {projection} FROM {qualified}");
    if !predicates.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&predicates.join(" AND "));
    }
    sql.push_str(" ORDER BY ");
    sql.push_str(
        &order
            .iter()
            .map(|(index, direction)| {
                format!(
                    "{} {}",
                    quote(&definition.columns[*index].name),
                    if *direction == SortDirection::Ascending {
                        "ASC"
                    } else {
                        "DESC"
                    }
                )
            })
            .collect::<Vec<_>>()
            .join(", "),
    );
    parameters.push(TaggedValue::UnsignedInteger(
        (u64::from(input.page_size) + 1).to_string(),
    ));
    sql.push_str(" LIMIT ");
    sql.push_str(&parameter_marker(dialect, parameters.len()));
    if !keyset {
        parameters.push(TaggedValue::UnsignedInteger(input.offset.to_string()));
        sql.push_str(" OFFSET ");
        sql.push_str(&parameter_marker(dialect, parameters.len()));
    }
    let plan_bytes = sql
        .len()
        .saturating_add(parameters.iter().map(tagged_value_size).sum::<usize>());
    if plan_bytes > MAX_TABLE_PLAN_BYTES {
        return Err(QueryNotError::authorization(
            "The structured table browse plan exceeds the 16 MiB native safety boundary.",
        ));
    }
    Ok(BrowsePlan {
        sql,
        parameters,
        order_column_indexes: order.into_iter().map(|(index, _)| index).collect(),
        page_size: input.page_size as usize,
        keyset,
        unstable: !keyset,
    })
}

fn keyset_predicate(
    definition: &TableDefinition,
    dialect: TableDialect,
    order: &[(usize, SortDirection)],
    cursor: &[TaggedValue],
    parameters: &mut Vec<TaggedValue>,
) -> Result<String, QueryNotError> {
    let mut alternatives = Vec::new();
    for current in 0..order.len() {
        let mut parts = Vec::new();
        for prefix in 0..current {
            let column = &definition.columns[order[prefix].0];
            validate_cursor_value(&cursor[prefix])?;
            let quoted = quote_identifier(dialect, &column.name);
            if cursor[prefix] == TaggedValue::Null {
                parts.push(format!("{quoted} IS NULL"));
            } else {
                parameters.push(cursor[prefix].clone());
                parts.push(format!(
                    "{quoted} = {}",
                    parameter_marker(dialect, parameters.len())
                ));
            }
        }
        let column = &definition.columns[order[current].0];
        let direction = order[current].1;
        let value = &cursor[current];
        validate_cursor_value(value)?;
        let quoted = quote_identifier(dialect, &column.name);
        let comparison = match (direction, value == &TaggedValue::Null) {
            (SortDirection::Ascending, true) => format!("{quoted} IS NOT NULL"),
            (SortDirection::Descending, true) => "0 = 1".to_owned(),
            (SortDirection::Ascending, false) => {
                parameters.push(value.clone());
                format!("{quoted} > {}", parameter_marker(dialect, parameters.len()))
            }
            (SortDirection::Descending, false) => {
                parameters.push(value.clone());
                format!(
                    "({quoted} < {} OR {quoted} IS NULL)",
                    parameter_marker(dialect, parameters.len())
                )
            }
        };
        parts.push(comparison);
        alternatives.push(format!("({})", parts.join(" AND ")));
    }
    Ok(format!("({})", alternatives.join(" OR ")))
}

fn validate_cursor_value(value: &TaggedValue) -> Result<(), QueryNotError> {
    match value {
        TaggedValue::Null | TaggedValue::Boolean(_) => Ok(()),
        TaggedValue::SignedInteger(value) if value.parse::<i64>().is_ok() => Ok(()),
        TaggedValue::UnsignedInteger(value) if value.parse::<u64>().is_ok() => Ok(()),
        TaggedValue::Decimal(value)
            if value.len() <= 1_024 && value.parse::<sqlx::types::BigDecimal>().is_ok() =>
        {
            Ok(())
        }
        TaggedValue::Float(value) if value.is_finite() => Ok(()),
        TaggedValue::Text(value) | TaggedValue::DateTime { raw: value, .. }
            if value.len() <= MAX_TABLE_CELL_BYTES && !value.contains('\0') =>
        {
            Ok(())
        }
        TaggedValue::Bytes(value) if value.len() <= MAX_TABLE_CELL_BYTES => Ok(()),
        _ => Err(QueryNotError::authorization(
            "A table page cursor contains an unsupported, malformed, or oversized value.",
        )),
    }
}

fn require_no_filter_value(filter: &TableFilter) -> Result<(), QueryNotError> {
    if filter.value.is_some() {
        Err(QueryNotError::authorization(
            "NULL filters do not accept a value.",
        ))
    } else {
        Ok(())
    }
}

fn filter_text_value(filter: &TableFilter) -> Result<String, QueryNotError> {
    match filter.value.as_ref() {
        Some(TaggedValue::Text(value))
            if value.len() <= 4 * 1024 * 1024 && !value.contains('\0') =>
        {
            Ok(value.clone())
        }
        _ => Err(QueryNotError::authorization(
            "This text filter requires a text value.",
        )),
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub enum MutationCellMode {
    Value(TaggedValue),
    DatabaseDefault,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct MutationCell {
    pub column: String,
    pub mode: MutationCellMode,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MutationKind {
    Insert,
    Update,
    Delete,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct MutationInput {
    pub kind: MutationKind,
    pub original: Vec<TaggedValue>,
    pub cells: Vec<MutationCell>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct BoundMutation {
    pub kind: MutationKind,
    pub sql: String,
    pub parameters: Vec<TaggedValue>,
    pub expected_rows: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct MutationPlan {
    pub id: MutationPlanId,
    pub namespace: String,
    pub table: String,
    pub staging_revision: u64,
    pub operations: Vec<BoundMutation>,
}

pub fn plan_mutations(
    definition: &TableDefinition,
    dialect: TableDialect,
    staging_revision: u64,
    inputs: &[MutationInput],
) -> Result<MutationPlan, QueryNotError> {
    validate_table_definition(definition)?;
    if !definition.editable {
        return Err(QueryNotError::database(
            crate::ErrorCategory::UnsupportedCapability,
            definition
                .read_only_reason
                .clone()
                .unwrap_or_else(|| "This table is read-only.".to_owned()),
            false,
        ));
    }
    if inputs.is_empty() || inputs.len() > MAX_TABLE_OPERATIONS {
        return Err(QueryNotError::authorization(
            "A mutation preview requires between one and 1,000 staged operations.",
        ));
    }
    let input_bytes = inputs
        .iter()
        .map(|input| {
            input
                .original
                .iter()
                .map(tagged_value_size)
                .chain(input.cells.iter().filter_map(|cell| match &cell.mode {
                    MutationCellMode::Value(value) => Some(tagged_value_size(value)),
                    MutationCellMode::DatabaseDefault => None,
                }))
                .sum::<usize>()
        })
        .fold(0_usize, usize::saturating_add);
    if input_bytes > MAX_TABLE_PLAN_BYTES {
        return Err(QueryNotError::authorization(
            "The staged values exceed the 16 MiB native mutation boundary.",
        ));
    }
    let identity = definition.identity.as_ref().ok_or_else(|| {
        QueryNotError::authorization("Safe mutations require a usable declared row identity.")
    })?;
    let qualified = format!(
        "{}.{}",
        quote_identifier(dialect, &definition.namespace),
        quote_identifier(dialect, &definition.table)
    );
    let mut operations = Vec::with_capacity(inputs.len());
    let mut plan_bytes = 0_usize;
    for input in inputs {
        let operation = match input.kind {
            MutationKind::Insert => {
                if !input.original.is_empty() {
                    return Err(QueryNotError::authorization(
                        "An inserted row cannot claim an original database value.",
                    ));
                }
                plan_insert(definition, dialect, &qualified, &input.cells)?
            }
            MutationKind::Update => {
                validate_original(definition, identity, &input.original)?;
                plan_update(
                    definition,
                    identity,
                    dialect,
                    &qualified,
                    &input.original,
                    &input.cells,
                )?
            }
            MutationKind::Delete => {
                validate_original(definition, identity, &input.original)?;
                if !input.cells.is_empty() {
                    return Err(QueryNotError::authorization(
                        "A staged deletion cannot contain replacement values.",
                    ));
                }
                plan_delete(definition, identity, dialect, &qualified, &input.original)?
            }
        };
        plan_bytes = plan_bytes
            .saturating_add(operation.sql.len())
            .saturating_add(
                operation
                    .parameters
                    .iter()
                    .map(tagged_value_size)
                    .sum::<usize>(),
            );
        if plan_bytes > MAX_TABLE_PLAN_BYTES {
            return Err(QueryNotError::authorization(
                "The staged mutation plan exceeds the 16 MiB native safety boundary.",
            ));
        }
        operations.push(operation);
    }
    Ok(MutationPlan {
        id: MutationPlanId::new(),
        namespace: definition.namespace.clone(),
        table: definition.table.clone(),
        staging_revision,
        operations,
    })
}

fn validate_table_definition(definition: &TableDefinition) -> Result<(), QueryNotError> {
    if definition.columns.is_empty() || definition.columns.len() > MAX_TABLE_COLUMNS {
        return Err(QueryNotError::database(
            crate::ErrorCategory::UnsupportedCapability,
            "This table exceeds the supported 2,048-column browsing boundary.",
            false,
        ));
    }
    let metadata_bytes = definition
        .namespace
        .len()
        .saturating_add(definition.table.len())
        .saturating_add(
            definition
                .columns
                .iter()
                .map(|column| column.name.len().saturating_add(column.declared_type.len()))
                .sum::<usize>(),
        );
    if metadata_bytes > MAX_TABLE_METADATA_BYTES {
        return Err(QueryNotError::database(
            crate::ErrorCategory::UnsupportedCapability,
            "This table's metadata exceeds the 4 MiB safe table-data boundary.",
            false,
        ));
    }
    Ok(())
}

fn plan_insert(
    definition: &TableDefinition,
    dialect: TableDialect,
    qualified: &str,
    cells: &[MutationCell],
) -> Result<BoundMutation, QueryNotError> {
    let mut seen = HashSet::new();
    let mut values_by_column = vec![None; definition.columns.len()];
    for cell in cells {
        let index = definition.column_index(&cell.column)?;
        if !seen.insert(index)
            || (definition.columns[index].generated
                && !matches!(cell.mode, MutationCellMode::DatabaseDefault))
        {
            return Err(QueryNotError::authorization(
                "An insert column is duplicated or assigns a server-generated value.",
            ));
        }
        values_by_column[index] = Some(cell.mode.clone());
    }
    let mut names = Vec::new();
    let mut placeholders = Vec::new();
    let mut parameters = Vec::new();
    for (index, column) in definition.columns.iter().enumerate() {
        let mode = values_by_column[index].as_ref().ok_or_else(|| {
            QueryNotError::authorization(format!(
                "Column {} is missing an explicit value, NULL, or database-default choice.",
                column.name
            ))
        })?;
        match mode {
            MutationCellMode::Value(value) => {
                validate_value(column, value)?;
                names.push(quote_identifier(dialect, &column.name));
                if value == &TaggedValue::Null {
                    placeholders.push("NULL".to_owned());
                } else {
                    parameters.push(value.clone());
                    placeholders.push(parameter_marker(dialect, parameters.len()));
                }
            }
            MutationCellMode::DatabaseDefault if column.has_default || column.generated => {}
            MutationCellMode::DatabaseDefault => {
                return Err(QueryNotError::authorization(format!(
                    "Column {} has no database default; choose an explicit value or NULL.",
                    column.name
                )));
            }
        }
    }
    let sql = if names.is_empty() {
        match dialect {
            TableDialect::Sqlite | TableDialect::Postgres => {
                format!("INSERT INTO {qualified} DEFAULT VALUES")
            }
            TableDialect::MySql => format!("INSERT INTO {qualified} () VALUES ()"),
        }
    } else {
        format!(
            "INSERT INTO {qualified} ({}) VALUES ({})",
            names.join(", "),
            placeholders.join(", ")
        )
    };
    Ok(BoundMutation {
        kind: MutationKind::Insert,
        sql,
        parameters,
        expected_rows: 1,
    })
}

fn plan_update(
    definition: &TableDefinition,
    identity: &TableIdentity,
    dialect: TableDialect,
    qualified: &str,
    original: &[TaggedValue],
    cells: &[MutationCell],
) -> Result<BoundMutation, QueryNotError> {
    if cells.is_empty() {
        return Err(QueryNotError::authorization(
            "A staged update must change at least one editable column.",
        ));
    }
    let mut seen = HashSet::new();
    let mut assignments = Vec::new();
    let mut parameters = Vec::new();
    for cell in cells {
        let index = definition.column_index(&cell.column)?;
        let column = &definition.columns[index];
        if !seen.insert(index) || !column.editable {
            return Err(QueryNotError::authorization(
                "An update column is duplicated or read-only.",
            ));
        }
        match &cell.mode {
            MutationCellMode::Value(value) => {
                validate_value(column, value)?;
                let expression = if value == &TaggedValue::Null {
                    "NULL".to_owned()
                } else {
                    parameters.push(value.clone());
                    parameter_marker(dialect, parameters.len())
                };
                assignments.push(format!(
                    "{} = {expression}",
                    quote_identifier(dialect, &column.name)
                ));
            }
            MutationCellMode::DatabaseDefault => {
                return Err(QueryNotError::authorization(
                    "Database-default mode is available only for new rows.",
                ));
            }
        }
    }
    let (predicate, predicate_values) =
        optimistic_predicate(definition, identity, dialect, original, parameters.len())?;
    parameters.extend(predicate_values);
    Ok(BoundMutation {
        kind: MutationKind::Update,
        sql: format!(
            "UPDATE {qualified} SET {} WHERE {predicate}",
            assignments.join(", ")
        ),
        parameters,
        expected_rows: 1,
    })
}

fn plan_delete(
    definition: &TableDefinition,
    identity: &TableIdentity,
    dialect: TableDialect,
    qualified: &str,
    original: &[TaggedValue],
) -> Result<BoundMutation, QueryNotError> {
    let (predicate, parameters) = optimistic_predicate(definition, identity, dialect, original, 0)?;
    Ok(BoundMutation {
        kind: MutationKind::Delete,
        sql: format!("DELETE FROM {qualified} WHERE {predicate}"),
        parameters,
        expected_rows: 1,
    })
}

fn optimistic_predicate(
    definition: &TableDefinition,
    identity: &TableIdentity,
    dialect: TableDialect,
    original: &[TaggedValue],
    parameter_offset: usize,
) -> Result<(String, Vec<TaggedValue>), QueryNotError> {
    let identity_indexes = identity
        .columns
        .iter()
        .map(|name| definition.column_index(name))
        .collect::<Result<HashSet<_>, _>>()?;
    let indexes = definition
        .columns
        .iter()
        .enumerate()
        .filter_map(|(index, column)| {
            (identity_indexes.contains(&index) || column.editable).then_some(index)
        })
        .collect::<Vec<_>>();
    if indexes.iter().any(|index| {
        matches!(
            original[*index],
            TaggedValue::Bytes(_) | TaggedValue::AdapterSpecific { .. }
        )
    }) {
        return Err(QueryNotError::database(
            crate::ErrorCategory::UnsupportedCapability,
            "This row contains an uncompareable original value and remains read-only.",
            false,
        ));
    }
    let mut predicates = Vec::new();
    let mut parameters = Vec::new();
    for index in indexes {
        let quoted = quote_identifier(dialect, &definition.columns[index].name);
        if original[index] == TaggedValue::Null {
            predicates.push(format!("{quoted} IS NULL"));
        } else {
            parameters.push(original[index].clone());
            let marker = parameter_marker(dialect, parameter_offset + parameters.len());
            predicates.push(null_safe_equal(dialect, &quoted, &marker));
        }
    }
    Ok((predicates.join(" AND "), parameters))
}

fn validate_original(
    definition: &TableDefinition,
    identity: &TableIdentity,
    original: &[TaggedValue],
) -> Result<(), QueryNotError> {
    if original.len() != definition.columns.len() {
        return Err(QueryNotError::authorization(
            "The staged row shape is stale for the current table metadata.",
        ));
    }
    let identity_columns = identity.columns.iter().collect::<HashSet<_>>();
    for (index, value) in original.iter().enumerate() {
        let column = &definition.columns[index];
        if column.editable || identity_columns.contains(&column.name) {
            validate_comparable_original(value)?;
        }
    }
    Ok(())
}

fn validate_comparable_original(value: &TaggedValue) -> Result<(), QueryNotError> {
    match value {
        TaggedValue::Null | TaggedValue::Boolean(_) => Ok(()),
        TaggedValue::SignedInteger(value) => value.parse::<i64>().map(|_| ()).map_err(|_| {
            QueryNotError::authorization("An original signed integer is not safely comparable.")
        }),
        TaggedValue::UnsignedInteger(value) => value.parse::<u64>().map(|_| ()).map_err(|_| {
            QueryNotError::authorization("An original unsigned integer is not safely comparable.")
        }),
        TaggedValue::Decimal(value)
            if value.len() <= 1_024 && value.parse::<sqlx::types::BigDecimal>().is_ok() =>
        {
            Ok(())
        }
        TaggedValue::Float(value) if value.is_finite() => Ok(()),
        TaggedValue::Text(value) | TaggedValue::DateTime { raw: value, .. }
            if value.len() <= MAX_EDITABLE_ORIGINAL_BYTES && !value.contains('\0') =>
        {
            Ok(())
        }
        TaggedValue::Bytes(_) | TaggedValue::AdapterSpecific { .. } => {
            Err(QueryNotError::authorization(
                "A binary or adapter-specific original value is not safely comparable for editing.",
            ))
        }
        _ => Err(QueryNotError::authorization(
            "An original value is malformed or exceeds the safe comparison boundary.",
        )),
    }
}

pub fn validate_value(column: &TableColumn, value: &TaggedValue) -> Result<(), QueryNotError> {
    if value == &TaggedValue::Null {
        if column.nullable {
            return Ok(());
        }
        return Err(QueryNotError::authorization(format!(
            "Column {} does not accept NULL.",
            column.name
        )));
    }
    let valid = match column.editor {
        TableEditorKind::Text => matches!(value, TaggedValue::Text(_)),
        TableEditorKind::Integer => matches!(
            value,
            TaggedValue::SignedInteger(_) | TaggedValue::UnsignedInteger(_)
        ),
        TableEditorKind::Decimal => matches!(value, TaggedValue::Decimal(_)),
        TableEditorKind::Float => matches!(value, TaggedValue::Float(number) if number.is_finite()),
        TableEditorKind::Boolean => matches!(value, TaggedValue::Boolean(_)),
        TableEditorKind::DateTime => {
            matches!(value, TaggedValue::DateTime { raw, .. } if valid_date_time(&column.declared_type, raw))
        }
        TableEditorKind::EnumLike => {
            matches!(value, TaggedValue::Text(raw) if valid_enum_like(&column.declared_type, raw))
        }
        TableEditorKind::ReadOnly => false,
    };
    if !valid {
        return Err(QueryNotError::authorization(format!(
            "The staged value for {} does not match its {} editor.",
            column.name,
            editor_name(column.editor)
        )));
    }
    match value {
        TaggedValue::SignedInteger(text) => {
            text.parse::<i64>()
                .map_err(|_| invalid_numeric(&column.name))?;
        }
        TaggedValue::UnsignedInteger(text) => {
            text.parse::<u64>()
                .map_err(|_| invalid_numeric(&column.name))?;
        }
        TaggedValue::Decimal(text) => {
            if text.len() > 1_024 || text.parse::<sqlx::types::BigDecimal>().is_err() {
                return Err(invalid_numeric(&column.name));
            }
        }
        TaggedValue::Text(text)
        | TaggedValue::DateTime { raw: text, .. }
        | TaggedValue::AdapterSpecific { raw: text, .. }
            if text.len() > 4 * 1024 * 1024 || text.bytes().any(|byte| byte == 0) =>
        {
            return Err(QueryNotError::authorization(
                "A staged text value exceeds the safe editor boundary.",
            ));
        }
        _ => {}
    }
    Ok(())
}

fn valid_date_time(declared_type: &str, raw: &str) -> bool {
    if !raw.is_ascii() {
        return false;
    }
    let upper = declared_type.trim().to_ascii_uppercase();
    if upper.contains("DATETIME") || upper.contains("TIMESTAMP") {
        if raw.len() < 19 || !matches!(raw.as_bytes().get(10), Some(b' ' | b'T')) {
            return false;
        }
        let date = &raw[..10];
        let mut time = &raw[11..];
        if let Some(stripped) = time.strip_suffix('Z') {
            time = stripped;
        } else if time.len() > 8
            && let Some(offset_at) = time[8..].find(['+', '-']).map(|index| index + 8)
        {
            let offset = &time[offset_at + 1..];
            if !valid_offset(offset) {
                return false;
            }
            time = &time[..offset_at];
        }
        return valid_date(date) && valid_clock(time, 23);
    }
    if upper.contains("DATE") {
        return valid_date(raw);
    }
    if upper.contains("TIME") {
        return valid_clock(raw.strip_prefix('-').unwrap_or(raw), 838);
    }
    false
}

fn valid_date(raw: &str) -> bool {
    if !raw.is_ascii()
        || raw.len() != 10
        || raw.as_bytes().get(4) != Some(&b'-')
        || raw.as_bytes().get(7) != Some(&b'-')
    {
        return false;
    }
    let Ok(year) = raw[..4].parse::<u32>() else {
        return false;
    };
    let Ok(month) = raw[5..7].parse::<u32>() else {
        return false;
    };
    let Ok(day) = raw[8..].parse::<u32>() else {
        return false;
    };
    let leap = year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400));
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    (1..=days).contains(&day)
}

fn valid_clock(raw: &str, maximum_hour: u32) -> bool {
    if !raw.is_ascii() {
        return false;
    }
    let (clock, fraction) = raw
        .split_once('.')
        .map_or((raw, None), |(clock, fraction)| (clock, Some(fraction)));
    if fraction.is_some_and(|fraction| {
        fraction.is_empty()
            || fraction.len() > 6
            || !fraction.bytes().all(|byte| byte.is_ascii_digit())
    }) {
        return false;
    }
    let mut parts = clock.split(':');
    let (Some(hour), Some(minute), Some(second), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return false;
    };
    if hour.is_empty()
        || hour.len() > 3
        || minute.len() != 2
        || second.len() != 2
        || !hour.bytes().all(|byte| byte.is_ascii_digit())
        || !minute.bytes().all(|byte| byte.is_ascii_digit())
        || !second.bytes().all(|byte| byte.is_ascii_digit())
    {
        return false;
    }
    hour.parse::<u32>().is_ok_and(|hour| hour <= maximum_hour)
        && minute.parse::<u32>().is_ok_and(|minute| minute <= 59)
        && second.parse::<u32>().is_ok_and(|second| second <= 59)
}

fn valid_offset(raw: &str) -> bool {
    if !raw.is_ascii() || raw.len() != 5 || raw.as_bytes().get(2) != Some(&b':') {
        return false;
    }
    raw[..2].parse::<u32>().is_ok_and(|hour| hour <= 23)
        && raw[3..].parse::<u32>().is_ok_and(|minute| minute <= 59)
}

fn valid_enum_like(declared_type: &str, raw: &str) -> bool {
    let Some((is_set, options)) = enum_like_options(declared_type) else {
        return false;
    };
    if is_set && raw.is_empty() {
        return true;
    }
    let values = if is_set {
        raw.split(',').collect::<Vec<_>>()
    } else {
        vec![raw]
    };
    values
        .iter()
        .all(|value| options.iter().any(|option| option == value))
}

fn enum_like_options(declared_type: &str) -> Option<(bool, Vec<String>)> {
    let trimmed = declared_type.trim();
    let upper = trimmed.to_ascii_uppercase();
    let (is_set, prefix_len) = if upper.starts_with("ENUM(") {
        (false, 5)
    } else if upper.starts_with("SET(") {
        (true, 4)
    } else {
        return None;
    };
    if !trimmed.ends_with(')') {
        return None;
    }
    let body = &trimmed[prefix_len..trimmed.len() - 1];
    let characters = body.chars().collect::<Vec<_>>();
    let mut index = 0;
    let mut options = Vec::new();
    while index < characters.len() {
        while index < characters.len() && characters[index].is_whitespace() {
            index += 1;
        }
        if characters.get(index) != Some(&'\'') {
            return None;
        }
        index += 1;
        let mut value = String::new();
        let mut closed = false;
        while index < characters.len() {
            match characters[index] {
                '\\' if index + 1 < characters.len() => {
                    value.push(characters[index + 1]);
                    index += 2;
                }
                '\'' if characters.get(index + 1) == Some(&'\'') => {
                    value.push('\'');
                    index += 2;
                }
                '\'' => {
                    index += 1;
                    closed = true;
                    break;
                }
                character => {
                    value.push(character);
                    index += 1;
                }
            }
        }
        if !closed {
            return None;
        }
        options.push(value);
        while index < characters.len() && characters[index].is_whitespace() {
            index += 1;
        }
        if index == characters.len() {
            break;
        }
        if characters[index] != ',' {
            return None;
        }
        index += 1;
        while index < characters.len() && characters[index].is_whitespace() {
            index += 1;
        }
        if index == characters.len() {
            return None;
        }
    }
    (!options.is_empty()).then_some((is_set, options))
}

fn invalid_numeric(column: &str) -> QueryNotError {
    QueryNotError::authorization(format!(
        "The staged numeric value for {column} is invalid or out of range."
    ))
}

fn editor_name(editor: TableEditorKind) -> &'static str {
    match editor {
        TableEditorKind::Text => "text",
        TableEditorKind::Integer => "integer",
        TableEditorKind::Decimal => "decimal",
        TableEditorKind::Float => "floating-point",
        TableEditorKind::Boolean => "boolean",
        TableEditorKind::DateTime => "date/time",
        TableEditorKind::EnumLike => "enum-like",
        TableEditorKind::ReadOnly => "read-only",
    }
}

fn null_safe_equal(dialect: TableDialect, quoted: &str, marker: &str) -> String {
    match dialect {
        TableDialect::Sqlite => format!("{quoted} IS {marker}"),
        TableDialect::MySql => format!("{quoted} <=> {marker}"),
        TableDialect::Postgres => format!("{quoted} IS NOT DISTINCT FROM {marker}"),
    }
}

fn parameter_marker(dialect: TableDialect, position: usize) -> String {
    match dialect {
        TableDialect::Sqlite | TableDialect::MySql => "?".to_owned(),
        TableDialect::Postgres => format!("${position}"),
    }
}

#[must_use]
pub fn quote_identifier(dialect: TableDialect, value: &str) -> String {
    match dialect {
        TableDialect::Sqlite | TableDialect::Postgres => {
            format!("\"{}\"", value.replace('"', "\"\""))
        }
        TableDialect::MySql => format!("`{}`", value.replace('`', "``")),
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TableEditState {
    Clean,
    Staged,
    Previewing,
    Applying,
    Conflicted,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TableEditAction {
    Stage,
    Preview,
    Apply,
    Applied,
    Conflict,
    ReturnToEdit,
    Discard,
}

impl TableEditState {
    pub fn transition(self, action: TableEditAction) -> Result<Self, QueryNotError> {
        use TableEditAction as A;
        use TableEditState as S;
        match (self, action) {
            (S::Clean, A::Stage) => Ok(S::Staged),
            (S::Staged | S::Conflicted, A::Stage | A::ReturnToEdit) => Ok(S::Staged),
            (S::Staged, A::Preview) => Ok(S::Previewing),
            (S::Previewing, A::Apply) => Ok(S::Applying),
            (S::Applying, A::Applied) => Ok(S::Clean),
            (S::Applying, A::Conflict) => Ok(S::Conflicted),
            (S::Staged | S::Previewing | S::Conflicted, A::Discard) => Ok(S::Clean),
            _ => Err(QueryNotError::authorization(
                "This table-edit state transition is not allowed.",
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sqlite::{SchemaColumn, SchemaIndex, SchemaObject};

    fn detail() -> SchemaObjectDetail {
        SchemaObjectDetail {
            object: SchemaObject {
                namespace: "main".to_owned(),
                name: "users\"; DROP TABLE audit; --".to_owned(),
                kind: SchemaObjectKind::Table,
            },
            columns: vec![
                SchemaColumn {
                    name: "id".to_owned(),
                    declared_type: "INTEGER".to_owned(),
                    nullable: false,
                    primary_key_position: 1,
                    default_expression: None,
                    generated: false,
                },
                SchemaColumn {
                    name: "display_name".to_owned(),
                    declared_type: "TEXT".to_owned(),
                    nullable: true,
                    primary_key_position: 0,
                    default_expression: None,
                    generated: false,
                },
            ],
            foreign_keys: Vec::new(),
            indexes: vec![SchemaIndex {
                name: "pk".to_owned(),
                unique: true,
                origin: "pk".to_owned(),
                columns: vec!["id".to_owned()],
                partial: false,
                has_expressions: false,
            }],
            definition: None,
            routines_supported: false,
        }
    }

    #[test]
    fn identity_filter_sort_and_adversarial_identifiers_are_native_planned() {
        let definition = TableDefinition::from_detail(&detail(), false, true);
        assert!(definition.editable);
        assert_eq!(definition.identity.as_ref().unwrap().source, "primary_key");
        let plan = plan_browse(
            &definition,
            TableDialect::Sqlite,
            &BrowseInput {
                filters: vec![TableFilter {
                    column: "display_name".to_owned(),
                    operator: FilterOperator::Contains,
                    value: Some(TaggedValue::Text("x%' OR 1=1 --".to_owned())),
                }],
                sorts: Vec::new(),
                cursor: Vec::new(),
                offset: 0,
                page_size: 200,
            },
        )
        .unwrap();
        assert!(plan.sql.contains("users\"\"; DROP TABLE audit; --"));
        assert!(!plan.sql.contains("OR 1=1"));
        assert!(plan.sql.contains("LIKE ? ESCAPE '!'"));
        assert_eq!(
            plan.parameters[0],
            TaggedValue::Text("%x!%' OR 1=1 --%".to_owned())
        );
        assert!(plan.keyset);
    }

    #[test]
    fn postgres_plans_use_numbered_parameters_and_double_quoted_identifiers() {
        let definition = TableDefinition::from_detail(&detail(), false, true);
        let browse = plan_browse(
            &definition,
            TableDialect::Postgres,
            &BrowseInput {
                filters: vec![TableFilter {
                    column: "display_name".to_owned(),
                    operator: FilterOperator::Contains,
                    value: Some(TaggedValue::Text("Ada".to_owned())),
                }],
                sorts: Vec::new(),
                cursor: Vec::new(),
                offset: 0,
                page_size: 200,
            },
        )
        .unwrap();
        assert!(browse.sql.contains("LIKE $1 ESCAPE '!'"));
        assert!(browse.sql.contains("LIMIT $2"));
        assert!(browse.sql.contains("\"users\"\"; DROP TABLE audit; --\""));

        let mutation = plan_mutations(
            &definition,
            TableDialect::Postgres,
            9,
            &[MutationInput {
                kind: MutationKind::Update,
                original: vec![
                    TaggedValue::SignedInteger("1".to_owned()),
                    TaggedValue::Text("before".to_owned()),
                ],
                cells: vec![MutationCell {
                    column: "display_name".to_owned(),
                    mode: MutationCellMode::Value(TaggedValue::Text("after".to_owned())),
                }],
            }],
        )
        .unwrap();
        assert!(mutation.operations[0].sql.contains("= $1"));
        assert!(
            mutation.operations[0]
                .sql
                .contains("IS NOT DISTINCT FROM $2")
        );
        assert!(
            mutation.operations[0]
                .sql
                .contains("IS NOT DISTINCT FROM $3")
        );
    }

    #[test]
    fn oversized_cells_pages_and_original_values_fail_closed() {
        assert!(
            validate_table_page_values(&[vec![TaggedValue::Text(
                "x".repeat(MAX_TABLE_CELL_BYTES + 1)
            )]])
            .is_err()
        );
        let one_mebibyte = "x".repeat(1024 * 1024);
        let page = (0..17)
            .map(|_| vec![TaggedValue::Text(one_mebibyte.clone())])
            .collect::<Vec<_>>();
        assert!(validate_table_page_values(&page).is_err());

        let definition = TableDefinition::from_detail(&detail(), false, true);
        assert!(
            plan_mutations(
                &definition,
                TableDialect::Sqlite,
                1,
                &[MutationInput {
                    kind: MutationKind::Update,
                    original: vec![
                        TaggedValue::SignedInteger("1".to_owned()),
                        TaggedValue::Text("x".repeat(MAX_EDITABLE_ORIGINAL_BYTES + 1)),
                    ],
                    cells: vec![MutationCell {
                        column: "display_name".to_owned(),
                        mode: MutationCellMode::Value(TaggedValue::Text("safe".to_owned())),
                    }],
                }],
            )
            .is_err()
        );
    }

    #[test]
    fn update_preview_binds_values_and_compares_every_editable_original() {
        let definition = TableDefinition::from_detail(&detail(), false, true);
        let plan = plan_mutations(
            &definition,
            TableDialect::Sqlite,
            4,
            &[MutationInput {
                kind: MutationKind::Update,
                original: vec![
                    TaggedValue::SignedInteger("1".to_owned()),
                    TaggedValue::Text("before".to_owned()),
                ],
                cells: vec![MutationCell {
                    column: "display_name".to_owned(),
                    mode: MutationCellMode::Value(TaggedValue::Text(
                        "after'); DROP TABLE users; --".to_owned(),
                    )),
                }],
            }],
        )
        .unwrap();
        assert_eq!(plan.staging_revision, 4);
        assert_eq!(plan.operations[0].parameters.len(), 3);
        assert!(!plan.operations[0].sql.contains("DROP TABLE users"));
        assert_eq!(plan.operations[0].sql.matches(" IS ?").count(), 2);
    }

    #[test]
    fn inserts_require_an_explicit_mode_and_a_real_server_default() {
        let definition = TableDefinition::from_detail(&detail(), false, true);
        let missing_column = MutationInput {
            kind: MutationKind::Insert,
            original: Vec::new(),
            cells: vec![MutationCell {
                column: "id".to_owned(),
                mode: MutationCellMode::Value(TaggedValue::SignedInteger("1".to_owned())),
            }],
        };
        assert!(plan_mutations(&definition, TableDialect::Sqlite, 1, &[missing_column]).is_err());

        let forged_default = MutationInput {
            kind: MutationKind::Insert,
            original: Vec::new(),
            cells: vec![
                MutationCell {
                    column: "id".to_owned(),
                    mode: MutationCellMode::Value(TaggedValue::SignedInteger("1".to_owned())),
                },
                MutationCell {
                    column: "display_name".to_owned(),
                    mode: MutationCellMode::DatabaseDefault,
                },
            ],
        };
        assert!(plan_mutations(&definition, TableDialect::Sqlite, 2, &[forged_default]).is_err());
    }

    #[test]
    fn views_nullable_unique_keys_lobs_and_invalid_transitions_fail_safe() {
        let mut fixture = detail();
        fixture.object.kind = SchemaObjectKind::View;
        fixture.columns[0].primary_key_position = 0;
        fixture.columns[0].nullable = true;
        fixture.indexes[0].columns = vec!["id".to_owned()];
        fixture.columns.push(SchemaColumn {
            name: "payload".to_owned(),
            declared_type: "BLOB".to_owned(),
            nullable: true,
            primary_key_position: 0,
            default_expression: None,
            generated: false,
        });
        let definition = TableDefinition::from_detail(&fixture, false, true);
        assert!(!definition.editable);
        assert!(definition.identity.is_none());
        assert_eq!(definition.columns[2].editor, TableEditorKind::ReadOnly);
        assert!(
            TableEditState::Clean
                .transition(TableEditAction::Apply)
                .is_err()
        );
    }

    #[test]
    fn partial_and_expression_unique_indexes_never_authorize_edits() {
        for unsafe_index in ["partial", "expression"] {
            let mut fixture = detail();
            fixture.columns[0].primary_key_position = 0;
            fixture.indexes[0].partial = unsafe_index == "partial";
            fixture.indexes[0].has_expressions = unsafe_index == "expression";
            let definition = TableDefinition::from_detail(&fixture, false, true);
            assert!(definition.identity.is_none());
            assert!(!definition.editable);
        }
    }

    #[test]
    fn typed_temporal_and_enum_values_fail_closed_before_planning() {
        let date_column = TableColumn {
            name: "created_at".to_owned(),
            declared_type: "DATETIME(6)".to_owned(),
            nullable: false,
            primary_key_position: 0,
            has_default: false,
            generated: false,
            editor: TableEditorKind::DateTime,
            editable: true,
            read_only_reason: None,
        };
        assert!(
            validate_value(
                &date_column,
                &TaggedValue::DateTime {
                    raw: "2024-02-29 23:59:59.123456".to_owned(),
                    timezone_or_offset: None,
                }
            )
            .is_ok()
        );
        assert!(
            validate_value(
                &date_column,
                &TaggedValue::DateTime {
                    raw: "2023-02-29 25:00:00".to_owned(),
                    timezone_or_offset: None,
                }
            )
            .is_err()
        );

        let enum_column = TableColumn {
            name: "state".to_owned(),
            declared_type: "enum('ready','it\\'s done')".to_owned(),
            editor: TableEditorKind::EnumLike,
            ..date_column
        };
        assert!(validate_value(&enum_column, &TaggedValue::Text("it's done".to_owned())).is_ok());
        assert!(validate_value(&enum_column, &TaggedValue::Text("unknown".to_owned())).is_err());
        let malformed_enum_column = TableColumn {
            declared_type: "enum('ready',,'done')".to_owned(),
            ..enum_column
        };
        assert!(
            validate_value(
                &malformed_enum_column,
                &TaggedValue::Text("ready".to_owned())
            )
            .is_err()
        );
    }
}
