use sha2::{Digest, Sha256};
use std::{
    env, fs,
    path::{Path, PathBuf},
};

fn main() {
    let mut files = Vec::new();
    collect_files(Path::new("web/dist"), &mut files);
    let mut digest = Sha256::new();
    for file in files {
        println!("cargo:rerun-if-changed={}", file.display());
        digest.update(file.to_string_lossy().as_bytes());
        digest.update([0]);
        digest.update(fs::read(file).unwrap());
        digest.update([0]);
    }
    println!("cargo:rerun-if-changed=web/dist");
    let output = format!(
        "const _EMBEDDED_ASSETS_FINGERPRINT: &str = {:?};\n",
        format!("{:x}", digest.finalize())
    );
    fs::write(
        PathBuf::from(env::var_os("OUT_DIR").unwrap()).join("embedded_assets_fingerprint.rs"),
        output,
    )
    .unwrap();
}

fn collect_files(directory: &Path, files: &mut Vec<PathBuf>) {
    let mut entries = fs::read_dir(directory)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect::<Vec<_>>();
    entries.sort();
    for entry in entries {
        if entry.is_dir() {
            collect_files(&entry, files);
        } else {
            files.push(entry);
        }
    }
}
