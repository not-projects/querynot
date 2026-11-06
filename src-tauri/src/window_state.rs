use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::{
    Mutex,
    atomic::{AtomicBool, Ordering},
};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, Window, WindowEvent};

#[derive(Clone, Copy, Deserialize, Serialize)]
struct Geometry {
    version: u8,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    maximized: bool,
}

struct WindowState {
    path: PathBuf,
    geometry: Mutex<Geometry>,
    restoring: AtomicBool,
}

pub(crate) fn initialize(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };
    let path = app.path().app_data_dir()?.join("window-state.json");
    let size = window.as_ref().size()?;
    let position = window.outer_position().unwrap_or_default();
    let fallback = Geometry {
        version: 1,
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        maximized: false,
    };
    let saved = fs::symlink_metadata(&path)
        .ok()
        .filter(|metadata| metadata.is_file() && metadata.len() <= 4096)
        .and_then(|_| fs::read(&path).ok())
        .and_then(|bytes| serde_json::from_slice::<Geometry>(&bytes).ok())
        .filter(|geometry| {
            geometry.version == 1
                && (1..=32768).contains(&geometry.width)
                && (1..=32768).contains(&geometry.height)
        });
    app.manage(WindowState {
        path,
        geometry: Mutex::new(saved.unwrap_or(fallback)),
        restoring: AtomicBool::new(saved.is_some()),
    });
    if let Some(geometry) = saved {
        // GTK's client-side decorations are allocated after setup. Restore
        // after that first layout so monitor bounds include their real size.
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            let dispatch_handle = handle.clone();
            let _ = handle.run_on_main_thread(move || restore(&dispatch_handle, geometry));
        });
    }
    Ok(())
}

fn restore(app: &AppHandle, mut geometry: Geometry) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let size = window.as_ref().size().unwrap_or(PhysicalSize::new(0, 0));
    let allocated_size = window.inner_size().unwrap_or(size);
    let outer_size = window.outer_size().unwrap_or(allocated_size);
    let decoration_width = outer_size
        .width
        .max(allocated_size.width)
        .saturating_sub(size.width);
    let decoration_height = outer_size
        .height
        .max(allocated_size.height)
        .saturating_sub(size.height);
    if let Ok(monitors) = window.available_monitors() {
        let monitor = monitors
            .iter()
            .filter(|monitor| {
                monitor.work_area().size.width > 0 && monitor.work_area().size.height > 0
            })
            .max_by_key(|monitor| {
                let area = monitor.work_area();
                let left = i64::from(geometry.x).max(i64::from(area.position.x));
                let top = i64::from(geometry.y).max(i64::from(area.position.y));
                let right = (i64::from(geometry.x) + i64::from(geometry.width))
                    .min(i64::from(area.position.x) + i64::from(area.size.width));
                let bottom = (i64::from(geometry.y) + i64::from(geometry.height))
                    .min(i64::from(area.position.y) + i64::from(area.size.height));
                (right - left).max(0) * (bottom - top).max(0)
            });
        if let Some(monitor) = monitor {
            let area = monitor.work_area();
            let min_width = (720.0_f64 * monitor.scale_factor()).ceil() as u32;
            let min_height = (540.0_f64 * monitor.scale_factor()).ceil() as u32;
            geometry.width = geometry.width.clamp(
                min_width,
                area.size
                    .width
                    .saturating_sub(decoration_width)
                    .max(min_width),
            );
            geometry.height = geometry.height.clamp(
                min_height,
                area.size
                    .height
                    .saturating_sub(decoration_height)
                    .max(min_height),
            );
            geometry.x = i64::from(geometry.x).clamp(
                i64::from(area.position.x),
                i64::from(area.position.x)
                    + i64::from(
                        area.size
                            .width
                            .saturating_sub(geometry.width.saturating_add(decoration_width)),
                    ),
            ) as i32;
            geometry.y = i64::from(geometry.y).clamp(
                i64::from(area.position.y),
                i64::from(area.position.y)
                    + i64::from(
                        area.size
                            .height
                            .saturating_sub(geometry.height.saturating_add(decoration_height)),
                    ),
            ) as i32;
        }
    }
    if let Ok(mut current) = app.state::<WindowState>().geometry.lock() {
        *current = geometry;
    }
    let _ = window.set_size(PhysicalSize::new(geometry.width, geometry.height));
    let _ = window.set_position(PhysicalPosition::new(geometry.x, geometry.y));
    if geometry.maximized {
        let _ = window.maximize();
    }
    app.state::<WindowState>()
        .restoring
        .store(false, Ordering::Release);
}

pub(crate) fn on_event(window: &Window, event: &WindowEvent) {
    if window.label() != "main" {
        return;
    }
    let Some(state) = window.try_state::<WindowState>() else {
        return;
    };
    if matches!(
        event,
        WindowEvent::Moved(_) | WindowEvent::Resized(_) | WindowEvent::CloseRequested { .. }
    ) {
        capture(window, &state);
    }
    if matches!(
        event,
        WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed
    ) {
        persist(&state);
    }
}

fn capture(window: &Window, state: &WindowState) {
    if state.restoring.load(Ordering::Acquire) {
        return;
    }
    if window.is_minimized().unwrap_or(false) || window.is_fullscreen().unwrap_or(false) {
        return;
    }
    let Ok(mut geometry) = state.geometry.lock() else {
        return;
    };
    geometry.maximized = window.is_maximized().unwrap_or(geometry.maximized);
    if geometry.maximized {
        return;
    }
    // On GTK the window allocation includes client-side decorations, while
    // set_size targets the WebView client area. Persist that same client area
    // so repeated restores do not add titlebar/shadow dimensions.
    if let Some(webview) = window.app_handle().get_webview_window(window.label())
        && let Ok(size) = webview.as_ref().size()
        && size.width > 0
        && size.height > 0
    {
        geometry.width = size.width;
        geometry.height = size.height;
    }
    if let Ok(position) = window.outer_position() {
        geometry.x = position.x;
        geometry.y = position.y;
    }
}

fn persist(state: &WindowState) {
    let Ok(geometry) = state.geometry.lock().map(|geometry| *geometry) else {
        return;
    };
    let Ok(bytes) = serde_json::to_vec(&geometry) else {
        return;
    };
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |duration| duration.as_nanos());
    let temporary = state
        .path
        .with_extension(format!("{}.{}.tmp", std::process::id(), nonce));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let Ok(mut file) = options.open(&temporary) else {
        return;
    };
    let written = file
        .write_all(&bytes)
        .and_then(|()| file.sync_all())
        .is_ok();
    drop(file);
    if written {
        let _ = fs::rename(&temporary, &state.path);
    }
    let _ = fs::remove_file(temporary);
}
