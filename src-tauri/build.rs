fn main() {
    println!("cargo:rerun-if-env-changed=QUERYNOT_UPDATER_PUBLIC_KEY");
    tauri_build::build();
}
