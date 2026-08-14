use crate::TaggedValue;
use crate::result::{ResultColumn, RetainedResult};
use base64::Engine;
use serde::Serialize;
use std::fs::{File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ExportFormat {
    Csv,
    Json,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExportOptions {
    pub format: ExportFormat,
    pub null_token: String,
    pub overwrite_confirmed: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
pub enum ExportError {
    #[error("an export path must have a parent directory and file name")]
    InvalidPath,
    #[error("the destination exists and overwrite was not confirmed")]
    OverwriteNotConfirmed,
    #[error("the export could not be encoded")]
    Encoding,
    #[error("the export could not be written atomically")]
    Io,
    #[error("injected export interruption")]
    InjectedInterruption,
}

pub trait ExportFault: Send + Sync {
    fn after_write(&self, bytes_written: usize) -> Result<(), ExportError>;
}

#[derive(Default)]
pub struct NoExportFault;

impl ExportFault for NoExportFault {
    fn after_write(&self, _bytes_written: usize) -> Result<(), ExportError> {
        Ok(())
    }
}

pub fn write_received_rows(
    path: &Path,
    result: &RetainedResult,
    row_indexes: &[usize],
    options: &ExportOptions,
    fault: &dyn ExportFault,
) -> Result<usize, ExportError> {
    let rows = row_indexes
        .iter()
        .map(|index| result.rows.get(*index).ok_or(ExportError::Encoding))
        .collect::<Result<Vec<_>, _>>()?;
    let bytes = match options.format {
        ExportFormat::Csv => encode_csv(&result.columns, &rows, &options.null_token),
        ExportFormat::Json => encode_json(&result.columns, &rows)?,
    };
    atomic_write(path, &bytes, options.overwrite_confirmed, fault)?;
    Ok(rows.len())
}

pub fn encode_csv(
    columns: &[ResultColumn],
    rows: &[&Vec<TaggedValue>],
    null_token: &str,
) -> Vec<u8> {
    let mut output = Vec::new();
    write_csv_record(
        &mut output,
        columns.iter().map(|column| column.name.as_str()),
        None,
    );
    for row in rows {
        let values = row.iter().map(canonical_raw_text).collect::<Vec<_>>();
        write_csv_record(
            &mut output,
            values.iter().map(String::as_str),
            Some((row, null_token)),
        );
    }
    output
}

fn write_csv_record<'a>(
    output: &mut Vec<u8>,
    fields: impl Iterator<Item = &'a str>,
    source: Option<(&[TaggedValue], &str)>,
) {
    for (index, field) in fields.enumerate() {
        if index > 0 {
            output.push(b',');
        }
        let (value, force_unquoted) = match source {
            Some((row, null_token)) if matches!(row.get(index), Some(TaggedValue::Null)) => {
                (null_token, true)
            }
            _ => (field, false),
        };
        if force_unquoted {
            output.extend_from_slice(value.as_bytes());
        } else if value.contains([',', '"', '\r', '\n']) {
            output.push(b'"');
            for byte in value.bytes() {
                if byte == b'"' {
                    output.push(b'"');
                }
                output.push(byte);
            }
            output.push(b'"');
        } else {
            output.extend_from_slice(value.as_bytes());
        }
    }
    output.extend_from_slice(b"\r\n");
}

#[derive(Serialize)]
struct JsonExport<'a> {
    format: &'static str,
    columns: Vec<JsonColumn<'a>>,
    rows: Vec<Vec<JsonValue>>,
}

#[derive(Serialize)]
struct JsonColumn<'a> {
    name: &'a str,
    declared_type: &'a str,
    nullable: Option<bool>,
}

#[derive(Serialize)]
#[serde(untagged)]
enum JsonValue {
    Null,
    Boolean(bool),
    Text(String),
    Tagged { r#type: String, value: String },
}

pub fn encode_json(
    columns: &[ResultColumn],
    rows: &[&Vec<TaggedValue>],
) -> Result<Vec<u8>, ExportError> {
    let export = JsonExport {
        format: "querynot-result-v1",
        columns: columns
            .iter()
            .map(|column| JsonColumn {
                name: &column.name,
                declared_type: &column.declared_type,
                nullable: column.nullable,
            })
            .collect(),
        rows: rows
            .iter()
            .map(|row| row.iter().map(json_value).collect())
            .collect(),
    };
    serde_json::to_vec_pretty(&export).map_err(|_| ExportError::Encoding)
}

#[must_use]
pub fn canonical_raw_text(value: &TaggedValue) -> String {
    match value {
        TaggedValue::Null => "\\N".to_owned(),
        TaggedValue::Text(value)
        | TaggedValue::SignedInteger(value)
        | TaggedValue::UnsignedInteger(value)
        | TaggedValue::Decimal(value) => value.clone(),
        TaggedValue::Bytes(value) => {
            let mut output = String::with_capacity(2 + value.len() * 2);
            output.push_str("0x");
            for byte in value {
                use std::fmt::Write as _;
                let _ = write!(output, "{byte:02X}");
            }
            output
        }
        TaggedValue::Float(value) if value.is_nan() => "NaN".to_owned(),
        TaggedValue::Float(value) if *value == f64::INFINITY => "Infinity".to_owned(),
        TaggedValue::Float(value) if *value == f64::NEG_INFINITY => "-Infinity".to_owned(),
        TaggedValue::Float(value) => value.to_string(),
        TaggedValue::Boolean(value) => value.to_string(),
        TaggedValue::DateTime { raw, .. } => raw.clone(),
        TaggedValue::AdapterSpecific { raw, .. } => raw.clone(),
    }
}

fn json_value(value: &TaggedValue) -> JsonValue {
    match value {
        TaggedValue::Null => JsonValue::Null,
        TaggedValue::Boolean(value) => JsonValue::Boolean(*value),
        TaggedValue::Text(value) => JsonValue::Text(value.clone()),
        TaggedValue::Bytes(value) => JsonValue::Tagged {
            r#type: "binary_base64".to_owned(),
            value: base64::engine::general_purpose::STANDARD.encode(value),
        },
        TaggedValue::SignedInteger(value) => JsonValue::Tagged {
            r#type: "signed_integer".to_owned(),
            value: value.clone(),
        },
        TaggedValue::UnsignedInteger(value) => JsonValue::Tagged {
            r#type: "unsigned_integer".to_owned(),
            value: value.clone(),
        },
        TaggedValue::Decimal(value) => JsonValue::Tagged {
            r#type: "decimal".to_owned(),
            value: value.clone(),
        },
        TaggedValue::Float(value) if !value.is_finite() => JsonValue::Tagged {
            r#type: "non_finite_float".to_owned(),
            value: if value.is_nan() {
                "NaN".to_owned()
            } else if *value == f64::INFINITY {
                "Infinity".to_owned()
            } else {
                "-Infinity".to_owned()
            },
        },
        TaggedValue::Float(value) => JsonValue::Tagged {
            r#type: "float".to_owned(),
            value: value.to_string(),
        },
        TaggedValue::DateTime {
            raw,
            timezone_or_offset,
        } => JsonValue::Tagged {
            r#type: match timezone_or_offset {
                Some(offset) => format!("date_time:{offset}"),
                None => "date_time:no_offset".to_owned(),
            },
            value: raw.clone(),
        },
        TaggedValue::AdapterSpecific { type_name, raw } => JsonValue::Tagged {
            r#type: format!("adapter:{type_name}"),
            value: raw.clone(),
        },
    }
}

fn atomic_write(
    destination: &Path,
    bytes: &[u8],
    overwrite_confirmed: bool,
    fault: &dyn ExportFault,
) -> Result<(), ExportError> {
    let parent = destination.parent().ok_or(ExportError::InvalidPath)?;
    let file_name = destination
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or(ExportError::InvalidPath)?;
    if destination.exists() && !overwrite_confirmed {
        return Err(ExportError::OverwriteNotConfirmed);
    }
    let temporary = temporary_path(parent, file_name);
    let result = (|| {
        let mut file = create_private(&temporary).map_err(|_| ExportError::Io)?;
        let mut written = 0;
        for chunk in bytes.chunks(64 * 1024) {
            file.write_all(chunk).map_err(|_| ExportError::Io)?;
            written += chunk.len();
            fault.after_write(written)?;
        }
        file.sync_all().map_err(|_| ExportError::Io)?;
        drop(file);
        std::fs::rename(&temporary, destination).map_err(|_| ExportError::Io)?;
        sync_directory(parent);
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result
}

pub fn write_local_bytes_atomically(
    destination: &Path,
    bytes: &[u8],
    overwrite_confirmed: bool,
) -> Result<(), ExportError> {
    atomic_write(destination, bytes, overwrite_confirmed, &NoExportFault)
}

fn temporary_path(parent: &Path, file_name: &str) -> PathBuf {
    parent.join(format!(
        ".{file_name}.querynot-{}.tmp",
        uuid::Uuid::now_v7()
    ))
}

fn create_private(path: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}

fn sync_directory(_path: &Path) {
    #[cfg(unix)]
    if let Ok(directory) = File::open(_path) {
        let _ = directory.sync_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ExecutionId, ResultSetId};
    use tempfile::tempdir;

    struct InterruptAfter(usize);

    impl ExportFault for InterruptAfter {
        fn after_write(&self, bytes_written: usize) -> Result<(), ExportError> {
            if bytes_written >= self.0 {
                Err(ExportError::InjectedInterruption)
            } else {
                Ok(())
            }
        }
    }

    fn result() -> RetainedResult {
        let mut result = RetainedResult::new(ExecutionId::new(), ResultSetId::new(), 0);
        result.columns = vec![
            ResultColumn {
                name: "duplicate".to_owned(),
                declared_type: "TEXT".to_owned(),
                nullable: Some(true),
            },
            ResultColumn {
                name: "duplicate".to_owned(),
                declared_type: "BLOB".to_owned(),
                nullable: Some(false),
            },
        ];
        result.rows = vec![
            vec![TaggedValue::Null, TaggedValue::Bytes(vec![0, 255])],
            vec![
                TaggedValue::Text("=SUM(A1:A2)\r\n\u{202e}".to_owned()),
                TaggedValue::Bytes(vec![128]),
            ],
        ];
        result
    }

    #[test]
    fn csv_is_rfc4180_shaped_and_preserves_hostile_values() {
        let result = result();
        let rows = result.rows.iter().collect::<Vec<_>>();
        let csv = String::from_utf8(encode_csv(&result.columns, &rows, "\\N")).unwrap();
        assert!(csv.starts_with("duplicate,duplicate\r\n"));
        assert!(csv.contains("\\N,0x00FF\r\n"));
        assert!(csv.contains("\"=SUM(A1:A2)\r\n\u{202e}\""));
    }

    #[test]
    fn json_keeps_duplicate_columns_and_lossless_type_tags() {
        let result = result();
        let rows = result.rows.iter().collect::<Vec<_>>();
        let json = String::from_utf8(encode_json(&result.columns, &rows).unwrap()).unwrap();
        assert_eq!(json.matches("\"name\": \"duplicate\"").count(), 2);
        assert!(json.contains("binary_base64"));
        assert!(json.contains("\"rows\": ["));
    }

    #[test]
    fn interrupted_export_preserves_existing_destination_and_cleans_temp() {
        let directory = tempdir().unwrap();
        let destination = directory.path().join("result.csv");
        std::fs::write(&destination, b"original").unwrap();
        let result = result();
        let error = write_received_rows(
            &destination,
            &result,
            &[0, 1],
            &ExportOptions {
                format: ExportFormat::Csv,
                null_token: "\\N".to_owned(),
                overwrite_confirmed: true,
            },
            &InterruptAfter(1),
        )
        .unwrap_err();
        assert_eq!(error, ExportError::InjectedInterruption);
        assert_eq!(std::fs::read(&destination).unwrap(), b"original");
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
    }
}
