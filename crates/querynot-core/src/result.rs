use crate::{ExecutionId, ResultSetId, TaggedValue};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{Duration, Instant};

pub const MAX_RETAINED_ROWS: usize = 100_000;
pub const MAX_RETAINED_BYTES: usize = 128 * 1024 * 1024;
pub const MAX_BATCH_ROWS: usize = 1_000;
pub const MAX_BATCH_BYTES: usize = 2 * 1024 * 1024;
pub const MAX_RESULT_COLUMNS: usize = 4_096;
pub const MAX_COLUMN_METADATA_BYTES: usize = 256 * 1024;
pub const PAUSED_CURSOR_LIFETIME: Duration = Duration::from_secs(5 * 60);

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ResultColumn {
    pub name: String,
    pub declared_type: String,
    pub nullable: Option<bool>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ResultTerminalState {
    Completed,
    Failed,
    Cancelled,
    Disposed,
    Expired,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct ResultBatch {
    pub execution_id: ExecutionId,
    pub result_set_id: ResultSetId,
    pub sequence: u64,
    pub statement_index: u32,
    pub columns: Option<Vec<ResultColumn>>,
    pub rows: Vec<Vec<TaggedValue>>,
    pub encoded_bytes: usize,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ResultTerminal {
    pub execution_id: ExecutionId,
    pub result_set_id: ResultSetId,
    pub sequence: u64,
    pub state: ResultTerminalState,
    pub received_rows: usize,
    pub retained_bytes: usize,
    pub capped: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
pub enum ResultIntegrityError {
    #[error("unknown result set")]
    Unknown,
    #[error("result event is duplicate, late, or out of order")]
    InvalidSequence,
    #[error("result batch exceeds native row or byte bounds")]
    OversizedBatch,
    #[error("result set is already terminal")]
    Terminal,
    #[error("paused result cursor expired")]
    Expired,
    #[error("result column shape changed or a row has the wrong width")]
    InvalidShape,
}

#[derive(Clone, Debug)]
pub struct RetainedResult {
    pub execution_id: ExecutionId,
    pub result_set_id: ResultSetId,
    pub statement_index: u32,
    pub columns: Vec<ResultColumn>,
    pub rows: Vec<Vec<TaggedValue>>,
    pub retained_bytes: usize,
    pub capped: bool,
    next_sequence: u64,
    terminal: bool,
    paused_at: Option<Instant>,
}

impl RetainedResult {
    #[must_use]
    pub fn new(
        execution_id: ExecutionId,
        result_set_id: ResultSetId,
        statement_index: u32,
    ) -> Self {
        Self {
            execution_id,
            result_set_id,
            statement_index,
            columns: Vec::new(),
            rows: Vec::new(),
            retained_bytes: 0,
            capped: false,
            next_sequence: 0,
            terminal: false,
            paused_at: None,
        }
    }

    pub fn accept_batch(&mut self, batch: ResultBatch) -> Result<(), ResultIntegrityError> {
        if self.terminal {
            return Err(ResultIntegrityError::Terminal);
        }
        if batch.execution_id != self.execution_id || batch.result_set_id != self.result_set_id {
            return Err(ResultIntegrityError::Unknown);
        }
        if batch.sequence != self.next_sequence {
            return Err(ResultIntegrityError::InvalidSequence);
        }
        let column_metadata_bytes = batch.columns.as_ref().map_or(0, |columns| {
            columns.iter().fold(0usize, |total, column| {
                total
                    .saturating_add(column.name.len())
                    .saturating_add(column.declared_type.len())
                    .saturating_add(16)
            })
        });
        if batch.rows.len() > MAX_BATCH_ROWS
            || batch.encoded_bytes.saturating_add(column_metadata_bytes) > MAX_BATCH_BYTES
            || batch
                .columns
                .as_ref()
                .is_some_and(|columns| columns.len() > MAX_RESULT_COLUMNS)
            || column_metadata_bytes > MAX_COLUMN_METADATA_BYTES
        {
            return Err(ResultIntegrityError::OversizedBatch);
        }
        if batch.columns.is_none() && self.columns.is_empty() && !batch.rows.is_empty() {
            return Err(ResultIntegrityError::InvalidShape);
        }
        if let Some(columns) = batch.columns {
            if !self.columns.is_empty() && self.columns != columns {
                return Err(ResultIntegrityError::InvalidShape);
            }
            self.columns = columns;
        }
        if batch.rows.iter().any(|row| row.len() != self.columns.len()) {
            return Err(ResultIntegrityError::InvalidShape);
        }
        self.rows.extend(batch.rows);
        self.retained_bytes = self.retained_bytes.saturating_add(batch.encoded_bytes);
        self.next_sequence += 1;
        if self.rows.len() >= MAX_RETAINED_ROWS || self.retained_bytes >= MAX_RETAINED_BYTES {
            self.capped = true;
        }
        Ok(())
    }

    pub fn mark_paused(&mut self, now: Instant) -> Result<(), ResultIntegrityError> {
        if self.terminal {
            return Err(ResultIntegrityError::Terminal);
        }
        self.paused_at = Some(now);
        Ok(())
    }

    pub fn acknowledge_more(&mut self, now: Instant) -> Result<(), ResultIntegrityError> {
        if self.terminal {
            return Err(ResultIntegrityError::Terminal);
        }
        if self.is_expired(now) {
            return Err(ResultIntegrityError::Expired);
        }
        self.paused_at = None;
        Ok(())
    }

    #[must_use]
    pub fn is_expired(&self, now: Instant) -> bool {
        self.paused_at
            .is_some_and(|paused| now.saturating_duration_since(paused) >= PAUSED_CURSOR_LIFETIME)
    }

    pub fn accept_terminal(
        &mut self,
        terminal: &ResultTerminal,
    ) -> Result<(), ResultIntegrityError> {
        if self.terminal {
            return Err(ResultIntegrityError::Terminal);
        }
        if terminal.execution_id != self.execution_id
            || terminal.result_set_id != self.result_set_id
        {
            return Err(ResultIntegrityError::Unknown);
        }
        if terminal.sequence != self.next_sequence {
            return Err(ResultIntegrityError::InvalidSequence);
        }
        if terminal.received_rows != self.rows.len()
            || terminal.retained_bytes != self.retained_bytes
        {
            return Err(ResultIntegrityError::InvalidSequence);
        }
        self.terminal = true;
        self.paused_at = None;
        self.capped |= terminal.capped;
        Ok(())
    }

    #[must_use]
    pub const fn next_sequence(&self) -> u64 {
        self.next_sequence
    }
}

#[derive(Default)]
pub struct ResultRegistry {
    retained: HashMap<ResultSetId, RetainedResult>,
}

impl ResultRegistry {
    pub fn insert(&mut self, result: RetainedResult) -> Result<(), ResultIntegrityError> {
        if self.retained.contains_key(&result.result_set_id) {
            return Err(ResultIntegrityError::InvalidSequence);
        }
        self.retained.insert(result.result_set_id, result);
        Ok(())
    }

    pub fn get(&self, id: ResultSetId) -> Result<&RetainedResult, ResultIntegrityError> {
        self.retained.get(&id).ok_or(ResultIntegrityError::Unknown)
    }

    pub fn get_mut(
        &mut self,
        id: ResultSetId,
    ) -> Result<&mut RetainedResult, ResultIntegrityError> {
        self.retained
            .get_mut(&id)
            .ok_or(ResultIntegrityError::Unknown)
    }

    pub fn dispose(&mut self, id: ResultSetId) -> Result<RetainedResult, ResultIntegrityError> {
        self.retained
            .remove(&id)
            .ok_or(ResultIntegrityError::Unknown)
    }

    pub fn dispose_execution(&mut self, execution_id: ExecutionId) -> Vec<ResultSetId> {
        let ids = self
            .retained
            .iter()
            .filter_map(|(id, result)| (result.execution_id == execution_id).then_some(*id))
            .collect::<Vec<_>>();
        for id in &ids {
            self.retained.remove(id);
        }
        ids
    }
}

#[must_use]
pub fn tagged_value_size(value: &TaggedValue) -> usize {
    match value {
        TaggedValue::Null => 1,
        TaggedValue::Text(value)
        | TaggedValue::SignedInteger(value)
        | TaggedValue::UnsignedInteger(value)
        | TaggedValue::Decimal(value) => value.len().saturating_mul(6).saturating_add(16),
        TaggedValue::Bytes(value) => value
            .len()
            .saturating_add(2)
            .checked_div(3)
            .unwrap_or(usize::MAX)
            .saturating_mul(4)
            .saturating_add(16),
        TaggedValue::Float(_) => 16,
        TaggedValue::Boolean(_) => 2,
        TaggedValue::DateTime {
            raw,
            timezone_or_offset,
        } => raw
            .len()
            .saturating_add(timezone_or_offset.as_ref().map_or(0, String::len))
            .saturating_mul(6)
            .saturating_add(24),
        TaggedValue::AdapterSpecific { type_name, raw } => type_name
            .len()
            .saturating_add(raw.len())
            .saturating_mul(6)
            .saturating_add(24),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn batch(result: &RetainedResult, sequence: u64) -> ResultBatch {
        ResultBatch {
            execution_id: result.execution_id,
            result_set_id: result.result_set_id,
            sequence,
            statement_index: 0,
            columns: (sequence == 0).then(|| {
                vec![ResultColumn {
                    name: "value".to_owned(),
                    declared_type: "INTEGER".to_owned(),
                    nullable: Some(false),
                }]
            }),
            rows: vec![vec![TaggedValue::SignedInteger("1".to_owned())]],
            encoded_bytes: 32,
        }
    }

    #[test]
    fn rejects_duplicate_out_of_order_unknown_and_oversized_events() {
        let mut result = RetainedResult::new(ExecutionId::new(), ResultSetId::new(), 0);
        result.accept_batch(batch(&result, 0)).unwrap();
        assert_eq!(
            result.accept_batch(batch(&result, 0)),
            Err(ResultIntegrityError::InvalidSequence)
        );
        let mut oversized = batch(&result, 1);
        oversized.encoded_bytes = MAX_BATCH_BYTES + 1;
        assert_eq!(
            result.accept_batch(oversized),
            Err(ResultIntegrityError::OversizedBatch)
        );
        let mut hostile_columns = batch(&result, 1);
        hostile_columns.columns = Some(vec![ResultColumn {
            name: "x".repeat(MAX_COLUMN_METADATA_BYTES + 1),
            declared_type: "TEXT".to_owned(),
            nullable: None,
        }]);
        assert_eq!(
            result.accept_batch(hostile_columns),
            Err(ResultIntegrityError::OversizedBatch)
        );
        let mut foreign = batch(&result, 1);
        foreign.result_set_id = ResultSetId::new();
        assert_eq!(
            result.accept_batch(foreign),
            Err(ResultIntegrityError::Unknown)
        );
        let mut registry = ResultRegistry::default();
        let retained = RetainedResult::new(ExecutionId::new(), ResultSetId::new(), 0);
        let retained_id = retained.result_set_id;
        registry.insert(retained.clone()).unwrap();
        assert_eq!(
            registry.insert(retained),
            Err(ResultIntegrityError::InvalidSequence)
        );
        assert!(registry.get(retained_id).is_ok());
    }

    #[test]
    fn terminal_is_exactly_once_and_paused_cursor_expires() {
        let start = Instant::now();
        let mut result = RetainedResult::new(ExecutionId::new(), ResultSetId::new(), 0);
        result.mark_paused(start).unwrap();
        assert!(!result.is_expired(start + Duration::from_secs(299)));
        assert!(result.is_expired(start + Duration::from_secs(300)));
        assert_eq!(
            result.acknowledge_more(start + Duration::from_secs(300)),
            Err(ResultIntegrityError::Expired)
        );
        let terminal = ResultTerminal {
            execution_id: result.execution_id,
            result_set_id: result.result_set_id,
            sequence: 0,
            state: ResultTerminalState::Expired,
            received_rows: 0,
            retained_bytes: 0,
            capped: false,
        };
        result.accept_terminal(&terminal).unwrap();
        assert_eq!(
            result.accept_terminal(&terminal),
            Err(ResultIntegrityError::Terminal)
        );
    }
}
