use serde::{Deserialize, Serialize};

pub const DEFAULT_LOG_MAX_BYTES: u64 = 5 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ThemePreference {
    #[default]
    System,
    Light,
    Dark,
    Forest,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TableFontPreference {
    System,
    #[default]
    Monospace,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(default)]
pub struct AppSettings {
    pub theme: ThemePreference,
    pub ui_scale_percent: u16,
    pub editor_word_wrap: bool,
    pub formatter_uppercase_keywords: bool,
    pub formatter_indent_spaces: u8,
    pub connection_timeout_seconds: u16,
    pub result_tranche_rows: u32,
    pub table_page_rows: u32,
    pub table_font_family: TableFontPreference,
    pub table_font_size_px: u8,
    pub plan_hotspot_estimates_enabled: bool,
    pub history_enabled: bool,
    pub history_retention_days: u16,
    pub session_restoration_enabled: bool,
    pub automatic_reconnect_default: bool,
    pub operational_log_enabled: bool,
    pub operational_log_max_bytes: u64,
    pub operational_log_retention_days: u16,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: ThemePreference::System,
            ui_scale_percent: 100,
            editor_word_wrap: false,
            formatter_uppercase_keywords: true,
            formatter_indent_spaces: 2,
            connection_timeout_seconds: 15,
            result_tranche_rows: 10_000,
            table_page_rows: 200,
            table_font_family: TableFontPreference::Monospace,
            table_font_size_px: 13,
            plan_hotspot_estimates_enabled: false,
            history_enabled: true,
            history_retention_days: 90,
            session_restoration_enabled: true,
            automatic_reconnect_default: false,
            operational_log_enabled: true,
            operational_log_max_bytes: DEFAULT_LOG_MAX_BYTES,
            operational_log_retention_days: 7,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
pub enum SettingsValidationError {
    #[error("UI scale must be between 75% and 200%")]
    UiScale,
    #[error("formatter indentation must be between 1 and 8 spaces")]
    FormatterIndent,
    #[error("connection timeout must be between 5 and 120 seconds")]
    ConnectionTimeout,
    #[error("result tranche must be between 100 and 50,000 rows")]
    ResultTranche,
    #[error("table page must be between 25 and 1,000 rows")]
    TablePage,
    #[error("table font size must be between 10 and 20 pixels")]
    TableFontSize,
    #[error("history retention must be between 1 and 3,650 days")]
    HistoryRetention,
    #[error("operational log cap must be between 64 KiB and 5 MiB")]
    LogCap,
    #[error("operational log retention must be between 1 and 7 days")]
    LogRetention,
    #[error(
        "automatic reconnect cannot be a global default because it requires a saved credential per profile"
    )]
    ReconnectDefault,
}

impl AppSettings {
    pub fn validate(&self) -> Result<(), SettingsValidationError> {
        if !(75..=200).contains(&self.ui_scale_percent) {
            return Err(SettingsValidationError::UiScale);
        }
        if !(1..=8).contains(&self.formatter_indent_spaces) {
            return Err(SettingsValidationError::FormatterIndent);
        }
        if !(5..=120).contains(&self.connection_timeout_seconds) {
            return Err(SettingsValidationError::ConnectionTimeout);
        }
        if !(100..=50_000).contains(&self.result_tranche_rows) {
            return Err(SettingsValidationError::ResultTranche);
        }
        if !(25..=1_000).contains(&self.table_page_rows) {
            return Err(SettingsValidationError::TablePage);
        }
        if !(10..=20).contains(&self.table_font_size_px) {
            return Err(SettingsValidationError::TableFontSize);
        }
        if !(1..=3_650).contains(&self.history_retention_days) {
            return Err(SettingsValidationError::HistoryRetention);
        }
        if !(64 * 1024..=DEFAULT_LOG_MAX_BYTES).contains(&self.operational_log_max_bytes) {
            return Err(SettingsValidationError::LogCap);
        }
        if !(1..=7).contains(&self.operational_log_retention_days) {
            return Err(SettingsValidationError::LogRetention);
        }
        if self.automatic_reconnect_default {
            return Err(SettingsValidationError::ReconnectDefault);
        }
        Ok(())
    }

    #[must_use]
    pub fn reset() -> Self {
        Self::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn documented_defaults_are_valid_and_stable() {
        let settings = AppSettings::default();
        settings.validate().unwrap();
        assert_eq!(settings.theme, ThemePreference::System);
        assert_eq!(settings.connection_timeout_seconds, 15);
        assert_eq!(settings.result_tranche_rows, 10_000);
        assert_eq!(settings.table_page_rows, 200);
        assert_eq!(settings.table_font_family, TableFontPreference::Monospace);
        assert_eq!(settings.table_font_size_px, 13);
        assert!(!settings.plan_hotspot_estimates_enabled);
        assert_eq!(settings.history_retention_days, 90);
        assert_eq!(settings.operational_log_max_bytes, 5 * 1024 * 1024);
        assert_eq!(settings.operational_log_retention_days, 7);
        assert!(!settings.automatic_reconnect_default);
    }

    #[test]
    fn reset_returns_exact_defaults_without_side_effects() {
        let mut settings = AppSettings {
            theme: ThemePreference::Forest,
            ..AppSettings::default()
        };
        settings.ui_scale_percent = 125;
        assert_ne!(settings, AppSettings::default());
        assert_eq!(AppSettings::reset(), AppSettings::default());
    }

    #[test]
    fn released_settings_gain_table_typography_and_hotspot_defaults_on_load() {
        let released = serde_json::json!({
            "theme": "system",
            "ui_scale_percent": 100,
            "editor_word_wrap": false,
            "formatter_uppercase_keywords": true,
            "formatter_indent_spaces": 2,
            "connection_timeout_seconds": 15,
            "result_tranche_rows": 10_000,
            "table_page_rows": 200,
            "history_enabled": true,
            "history_retention_days": 90,
            "session_restoration_enabled": true,
            "automatic_reconnect_default": false,
            "operational_log_enabled": true,
            "operational_log_max_bytes": DEFAULT_LOG_MAX_BYTES,
            "operational_log_retention_days": 7
        });
        let settings: AppSettings = serde_json::from_value(released).unwrap();

        assert_eq!(settings.table_font_family, TableFontPreference::Monospace);
        assert_eq!(settings.table_font_size_px, 13);
        assert!(!settings.plan_hotspot_estimates_enabled);
        settings.validate().unwrap();
    }
}
