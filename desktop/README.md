# STASH Windows mount spike

This independent Cargo workspace contains a UI-free Rust core and Windows filesystem adapter boundary. It is GPLv3-compatible: before distributing a binary that links WinFsp/the `winfsp` Rust crate, retain their notices and meet their GPLv3 source/distribution obligations.

Prerequisites for the live spike: Rust stable and WinFsp 2.1. Installing WinFsp and deploying the read-lease backend require separate explicit approval. After approval, configure an authenticated control-plane client, mount `STASH (S:)`, enumerate a metadata-backed folder in Explorer, and open/seek a cloud-only asset in Explorer plus an installed standards-compliant creative application. Disable network access and confirm a cache miss returns a bounded filesystem I/O error. Do not log or persist credentials, JWTs, object keys, or presigned URLs.

Run automated coverage with `cargo test --manifest-path desktop/Cargo.toml`.

## Manual mount proof (`mount-spike`)

`crates/mount-spike` mounts `STASH (S:)` for real, backed by a local HTTP
fixture server standing in for S3 — proves the mount mechanism itself
without needing a real AWS deployment yet. Build with
`cargo build --manifest-path desktop/Cargo.toml -p mount-spike`.

**Runtime note:** WinFsp's runtime installer does not add its `bin`
directory to `PATH`, so `winfsp-x64.dll` fails to load (the process exits
immediately with no output) unless one of the following is true when you
run the binary:

```powershell
$env:PATH += ';C:\Program Files (x86)\WinFsp\bin'
.\target\debug\mount-spike.exe
```

Then `dir S:\` and `type S:\hello.txt` (or open it in Explorer/a text
editor) to confirm the mount works. Ctrl+C unmounts and exits cleanly.
