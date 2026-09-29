// Release builds are a windowed app: no console window beside STASH.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    stash_desktop::run();
}
