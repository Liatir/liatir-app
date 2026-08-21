//! The Native Tools environment that ships inside the application.
//!
//! Every process-backed Native Tool lives in one relocatable conda prefix built
//! from `native-tools-env/pixi.toml`, so a user installs nothing and cannot end
//! up running a different build of `samtools` than the one this release was
//! tested against.
//!
//! It ships as a single `native-tools-<subdir>.tar.gz` and is unpacked once, on
//! first use, into a directory named after that archive's own SHA-256 — not the
//! lock's, which would not change when the build changes what it packs. It is not shipped as
//! a directory of files, for a measured reason: a conda prefix is over a
//! thousand symlinks, the Tauri bundler resolves each one into a full copy, and
//! doing that turned a 203 MB environment into 438 MB inside the `.app` — 196 MB
//! of the same libraries written out again. `libopenblas` alone appeared seven
//! times. Unpacking with `tar` keeps the symlinks, the execute bits, and the
//! size.
//!
//! Windows unpacks inside WSL2 instead of on Windows, and that is not a detail:
//! bioconda publishes no `win-64` builds at all and five of these six tools have
//! no Windows build anywhere, so the Windows application ships the `linux-64`
//! environment and reaches it the way Gate 6 already reaches Nextflow. Unpacking
//! into the Linux filesystem rather than onto NTFS is what preserves those same
//! symlinks and execute bits, and it avoids paying the `/mnt/c` 9p cost on every
//! library load.

use serde::Serialize;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

/// Tools the bundled environment provides.
///
/// Kept in step with `BUNDLED_ENVIRONMENT_TOOL_IDS` in `packages/liatir-core`;
/// `tests/unit/native-tools-environment.test.ts` fails if the two drift apart.
pub(crate) const BUNDLED_TOOLS: [&str; 6] = [
    "samtools",
    "bcftools",
    "seqkit",
    "fastp",
    "bwa",
    "minimap2",
];

const RESOURCE_DIR: &str = "native-tools";
/// Written inside the tree before it is moved into place, so a prefix that is
/// visible under its final name is a prefix that finished unpacking.
const COMPLETION_MARKER: &str = ".liatir-complete";

/// Serialises the unpack. Two Jobs spawned at once on a fresh installation would
/// otherwise both extract into the same staging directory.
static UNPACK: Mutex<()> = Mutex::new(());

/// The conda subdir this build ships, or `None` on a host with no environment.
pub(crate) fn subdir() -> Option<&'static str> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => Some("osx-arm64"),
        ("linux", "x86_64") => Some("linux-64"),
        // Windows ships the Linux environment and reaches it through WSL2.
        ("windows", "x86_64") => Some("linux-64"),
        _ => None,
    }
}

pub(crate) fn is_bundled_tool(name: &str) -> bool {
    BUNDLED_TOOLS.contains(&name)
}

/// Where the bundled resources are on this machine.
///
/// The development fallback is what lets `npm run dev` use the same environment
/// the installer will ship, instead of quietly falling back to whatever is on
/// the maintainer's `PATH` — which is how a tool version difference between a
/// developer machine and a release gets discovered by a user.
fn resource_root(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(directory) = app.path().resource_dir() {
        let candidate = directory.join(RESOURCE_DIR);
        if candidate.exists() {
            return Some(candidate);
        }
    }
    #[cfg(debug_assertions)]
    {
        let candidate = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join(RESOURCE_DIR);
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

fn archive_path(app: &AppHandle) -> Option<PathBuf> {
    let path = resource_root(app)?.join(format!("native-tools-{}.tar.gz", subdir()?));
    path.is_file().then_some(path)
}

/// What the build recorded: the archive's own digest, the lock digest, and every
/// pinned tool version. This is the sidecar beside the archive, not the manifest
/// inside the prefix — only the sidecar carries `archiveSha256`.
fn manifest(app: &AppHandle) -> Option<Value> {
    let sidecar = format!("{}.json", archive_path(app)?.to_string_lossy());
    serde_json::from_str(&std::fs::read_to_string(sidecar).ok()?).ok()
}

/// The identity of the environment that shipped, validated as hex because it
/// names a directory.
///
/// This is the archive's digest and deliberately not the lock's. The lock pins
/// tool *versions*; the archive is the bytes those versions were packed into, so
/// a change to what the build packs — pruning, layout — moves this while the lock
/// digest stays put. Naming the directory after the lock would then leave the
/// completion marker of an older release in place and the application would keep
/// running the environment that release unpacked, never the one it shipped. That
/// is the same drift the bundle exists to remove, arriving from inside.
fn environment_digest(app: &AppHandle) -> Result<String, String> {
    let digest = manifest(app)
        .as_ref()
        .and_then(|manifest| manifest.get("archiveSha256"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    if digest.len() != 64 || !digest.chars().all(|character| character.is_ascii_hexdigit()) {
        return Err("The Native Tools environment manifest has no usable archive digest.".into());
    }
    Ok(digest)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeToolsEnvironment {
    /// `native`, `wsl2`, or `none` when this host has no bundled environment.
    pub execution: String,
    pub available: bool,
    pub subdir: Option<String>,
    pub tools: Vec<String>,
    /// The build manifest, verbatim, when one was found.
    pub manifest: Option<Value>,
    pub error: Option<String>,
}

/// Report what the application is actually carrying, for the Dependencies screen.
#[tauri::command]
pub fn lia_native_tools_environment(app: AppHandle) -> NativeToolsEnvironment {
    let Some(subdir) = subdir() else {
        return NativeToolsEnvironment {
            execution: "none".into(),
            available: false,
            subdir: None,
            tools: vec![],
            manifest: None,
            error: Some(format!(
                "No Native Tools environment is built for {}/{}.",
                std::env::consts::OS,
                std::env::consts::ARCH
            )),
        };
    };
    let manifest = manifest(&app);
    NativeToolsEnvironment {
        execution: if cfg!(target_os = "windows") { "wsl2" } else { "native" }.into(),
        available: manifest.is_some(),
        subdir: Some(subdir.into()),
        tools: BUNDLED_TOOLS.iter().map(|name| (*name).to_string()).collect(),
        error: manifest
            .is_none()
            .then(|| "The bundled Native Tools environment is missing from this build.".to_string()),
        manifest,
    }
}

/// Report a bundled tool to the dependency check: its path, if it has one on
/// this platform, and the version the build recorded.
///
/// Answered from the manifest rather than by running the tool, which keeps the
/// startup dependency sweep instant and offline — and keeps it from triggering
/// the first-use unpack just to answer a question the manifest already answers.
pub(crate) fn bundled_dependency(app: &AppHandle, binary: &str) -> Option<(Option<String>, String)> {
    if !is_bundled_tool(binary) {
        return None;
    }
    let version = manifest(app)?
        .get("tools")?
        .as_array()?
        .iter()
        .find(|tool| tool.get("id").and_then(Value::as_str) == Some(binary))?
        .get("version")?
        .as_str()?
        .to_string();
    Some((host_binary_path(app, binary), version))
}

/// The tool's path on this machine, when it has one.
///
/// On Windows the prefix only exists inside WSL2, so there is no host path to
/// report and claiming one would be a lie. Elsewhere it is real, but only once
/// something has unpacked it.
#[cfg(not(target_os = "windows"))]
fn host_binary_path(app: &AppHandle, binary: &str) -> Option<String> {
    let path = unpacked_root(app).ok()?.join("bin").join(binary);
    path.exists().then(|| path.to_string_lossy().to_string())
}

#[cfg(target_os = "windows")]
fn host_binary_path(_app: &AppHandle, _binary: &str) -> Option<String> {
    None
}

/// What the Jobs backend should actually execute.
pub(crate) struct ResolvedCommand {
    pub program: String,
    pub args: Vec<String>,
}

/// Resolve a spawn request against the bundled environment.
///
/// `Ok(None)` means this tool is not ours to provide, and the caller falls
/// through to the managed-bin registry and then to `PATH`. An `Err` means the
/// tool *is* ours and the environment could not be reached, which must surface
/// rather than silently degrade into running whatever the host happens to have
/// installed — the exact confusion the bundle exists to end.
pub(crate) fn resolve(
    app: &AppHandle,
    cmd: &str,
    args: &[String],
) -> Result<Option<ResolvedCommand>, String> {
    if !is_bundled_tool(cmd) || archive_path(app).is_none() {
        return Ok(None);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let binary = ensure_unpacked(app)?.join("bin").join(cmd);
        if !binary.exists() {
            return Err(format!(
                "{cmd} is part of the bundled Native Tools environment, but is missing from {}.",
                binary.display()
            ));
        }
        Ok(Some(ResolvedCommand {
            program: binary.to_string_lossy().to_string(),
            args: args.to_vec(),
        }))
    }

    #[cfg(target_os = "windows")]
    {
        wsl_plan::reject_unreachable_paths(args)?;
        let distribution = windows::distribution()?;
        let prefix = windows::ensure_unpacked(app, &distribution)?;
        let positions = wsl_plan::path_argument_positions(args);
        let mapped = if positions.is_empty() {
            Vec::new()
        } else {
            let hosts: Vec<String> = positions.iter().map(|index| args[*index].clone()).collect();
            crate::helpers::wsl::map_host_paths_to_wsl(&distribution, &hosts)?
        };
        let args = wsl_plan::substitute_mapped_paths(args, &positions, &mapped)?;
        Ok(Some(wsl_plan::tool_command(&distribution, &prefix, cmd, &args)))
    }
}

/// Unpack the environment during startup so the first tool run does not pay for
/// it. Failure is reported and not fatal: the application is still usable, and
/// the first spawn will try again and surface the real error to the user who
/// asked for that tool.
pub fn prepare_in_background(app: &AppHandle) {
    if subdir().is_none() || archive_path(app).is_none() {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(not(target_os = "windows"))]
        let outcome = ensure_unpacked(&app).map(|_| ());
        #[cfg(target_os = "windows")]
        let outcome = windows::distribution()
            .and_then(|distribution| windows::ensure_unpacked(&app, &distribution))
            .map(|_| ());
        if let Err(error) = outcome {
            eprintln!("[native-tools] environment not ready: {error}");
        }
    });
}

/// Where an unpacked environment lives for this build.
#[cfg(not(target_os = "windows"))]
fn unpacked_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join(RESOURCE_DIR)
        .join(environment_digest(app)?))
}

/// Unpack once per lock digest, and never half-way.
///
/// The completion marker goes inside the tree before it is moved into place, so
/// an interrupted first run leaves a `.partial` directory the next attempt
/// discards and can never leave a half-extracted prefix that looks ready.
/// Keying on the archive digest means any application update that ships a
/// different environment lands beside the old one rather than overwriting one a
/// running Job is still executing from.
///
/// Integrity is left to gzip's own CRC — a truncated or corrupted archive fails
/// `tar -xzf` — and to the application signature that covers the archive.
#[cfg(not(target_os = "windows"))]
fn ensure_unpacked(app: &AppHandle) -> Result<PathBuf, String> {
    let root = unpacked_root(app)?;
    if root.join(COMPLETION_MARKER).is_file() {
        return Ok(root);
    }
    let _serialised = UNPACK.lock().map_err(|_| "Native Tools unpack lock poisoned")?;
    if root.join(COMPLETION_MARKER).is_file() {
        return Ok(root);
    }

    let archive = archive_path(app)
        .ok_or("The bundled Native Tools environment is missing from this installation.")?;
    let subdir = subdir().ok_or("No Native Tools environment is built for this host.")?;
    let staging = root.with_extension("partial");
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging)
        .map_err(|error| format!("Could not prepare the Native Tools directory: {error}"))?;

    let output = std::process::Command::new("tar")
        .arg("-xzf")
        .arg(&archive)
        .arg("-C")
        .arg(&staging)
        .output()
        .map_err(|error| format!("Could not run tar to unpack the Native Tools: {error}"))?;
    if !output.status.success() {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(format!(
            "Could not unpack the Native Tools: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    let unpacked = staging.join(subdir);
    std::fs::write(unpacked.join(COMPLETION_MARKER), b"")
        .map_err(|error| format!("Could not finalise the Native Tools directory: {error}"))?;
    let _ = std::fs::remove_dir_all(&root);
    std::fs::rename(&unpacked, &root)
        .map_err(|error| format!("Could not install the Native Tools directory: {error}"))?;
    let _ = std::fs::remove_dir_all(&staging);
    prune_other_digests(&root);
    Ok(root)
}

/// Remove environments from earlier releases. Only ever called right after a new
/// one was unpacked, which is only ever on a freshly started process, so nothing
/// can be executing from the directories being removed.
#[cfg(not(target_os = "windows"))]
fn prune_other_digests(current: &std::path::Path) {
    let Some(parent) = current.parent() else { return };
    let Ok(entries) = std::fs::read_dir(parent) else { return };
    for entry in entries.flatten() {
        if entry.path() != current {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

/// How a bundled tool becomes a `wsl.exe` command line.
///
/// Deliberately free of `#[cfg]` and of any call into WSL, because this is the
/// part that decides which of a user's arguments are files and where they end up
/// — and a macOS or Linux developer must be able to run its tests. What is left
/// on the Windows side is only the question of whether `wsl.exe` and `wslpath`
/// behave as documented, which no amount of cross-platform testing could answer.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
mod wsl_plan {
    use super::ResolvedCommand;
    use crate::helpers::wsl::{is_mappable_windows_path, wsl_command_args};

    /// Which arguments name a file, and therefore have to cross into WSL.
    ///
    /// Liatir builds every tool invocation itself and passes each file as its own
    /// absolute path, so "starts with a drive letter" identifies exactly the
    /// arguments that are files. Everything else — subcommands, flags, thread
    /// counts, `bcftools` filter expressions — is passed through untouched, which
    /// is what stops an expression from being mangled into a path.
    pub(super) fn path_argument_positions(args: &[String]) -> Vec<usize> {
        args.iter()
            .enumerate()
            .filter(|(_, value)| is_mappable_windows_path(value))
            .map(|(index, _)| index)
            .collect()
    }

    /// Refuse a location WSL2 cannot reach, before anything is launched.
    ///
    /// `wslpath` has no answer for a UNC or extended-length path, so without this
    /// the argument would travel to Linux untouched and the user would get the
    /// tool's own `stat \\server\share\reads.fastq: no such file or directory` —
    /// true, but not an answer a non-technical user can act on.
    ///
    /// Two leading backslashes is the whole test, and deliberately so: it is what
    /// a Windows file picker produces for a network location, and no subcommand,
    /// flag, thread count or `bcftools` filter expression begins that way.
    pub(super) fn reject_unreachable_paths(args: &[String]) -> Result<(), String> {
        match args.iter().find(|value| value.starts_with(r"\\")) {
            None => Ok(()),
            Some(argument) => Err(format!(
                "Liatir cannot open files from a network location on Windows: {argument}\n\
                 Copy the file to a drive on this computer, such as C:, and run the tool again."
            )),
        }
    }

    /// Put the translated paths back in the slots they came from.
    pub(super) fn substitute_mapped_paths(
        args: &[String],
        positions: &[usize],
        mapped: &[String],
    ) -> Result<Vec<String>, String> {
        if positions.len() != mapped.len() {
            return Err("WSL2 returned a different number of paths than were sent.".into());
        }
        let mut result = args.to_vec();
        for (slot, index) in positions.iter().enumerate() {
            result[*index] = mapped[slot].clone();
        }
        Ok(result)
    }

    pub(super) fn tool_command(
        distribution: &str,
        prefix: &str,
        cmd: &str,
        args: &[String],
    ) -> ResolvedCommand {
        let mut command = vec![format!("{prefix}/bin/{cmd}")];
        command.extend(args.iter().cloned());
        ResolvedCommand {
            program: "wsl.exe".into(),
            args: wsl_command_args(Some(distribution), &command),
        }
    }
}

#[cfg(target_os = "windows")]
mod windows {
    use super::{archive_path, environment_digest, subdir, COMPLETION_MARKER, UNPACK};
    use crate::helpers::wsl::{
        combined_output, map_host_paths_to_wsl, run_wsl, valid_wsl_distribution,
    };
    use tauri::AppHandle;

    /// The same unpack discipline as the native one, expressed as a fixed shell
    /// program because the filesystem it writes to is inside WSL2 and only WSL2
    /// can create those symlinks and execute bits.
    ///
    /// Every value is a positional argument, never interpolated into the program
    /// text: `$1` is a validated hex digest, `$2` a path `wslpath` produced, `$3`
    /// a compile-time constant, `$4` the marker name.
    ///
    /// The closing loop is what `prune_other_digests` does natively, and it was
    /// missing here: without it every superseded environment stayed in the Linux
    /// home for good, half a gigabyte at a time. It runs only after a fresh
    /// unpack, so nothing can be executing from what it removes.
    const UNPACK_PROGRAM: &str = r#"
set -eu
root="$HOME/.local/share/liatir/native-tools"
target="$root/$1"
if [ -f "$target/$4" ]; then
  printf '%s\n' "$target"
  exit 0
fi
rm -rf "$target.partial"
mkdir -p "$target.partial"
tar -xzf "$2" -C "$target.partial"
: > "$target.partial/$3/$4"
rm -rf "$target"
mkdir -p "$root"
mv "$target.partial/$3" "$target"
rm -rf "$target.partial"
for other in "$root"/*; do
  if [ -e "$other" ] && [ "$other" != "$target" ]; then
    rm -rf "$other"
  fi
done
printf '%s\n' "$target"
"#;

    /// The distribution `wsl.exe` would use, unless one is pinned for tests.
    pub(super) fn distribution() -> Result<String, String> {
        if let Ok(pinned) = std::env::var("LIATIR_WSL_DISTRIBUTION") {
            let pinned = pinned.trim().to_string();
            if !pinned.is_empty() {
                if !valid_wsl_distribution(&pinned) {
                    return Err("LIATIR_WSL_DISTRIBUTION contains unsupported characters.".into());
                }
                return Ok(pinned);
            }
        }
        let output = run_wsl(
            None,
            &[
                "/bin/sh".into(),
                "-c".into(),
                "printf '%s' \"$WSL_DISTRO_NAME\"".into(),
            ],
        )?;
        if !output.status.success() {
            return Err(format!(
                "Liatir needs WSL2 to run its bioinformatics tools on Windows, and could not start it: {}",
                combined_output(&output)
            ));
        }
        let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !valid_wsl_distribution(&name) {
            return Err(
                "WSL2 is installed but did not report a usable default distribution.".into(),
            );
        }
        Ok(name)
    }

    pub(super) fn ensure_unpacked(
        app: &AppHandle,
        distribution: &str,
    ) -> Result<String, String> {
        let _serialised = UNPACK.lock().map_err(|_| "Native Tools unpack lock poisoned")?;
        let subdir = subdir().ok_or("No Native Tools environment is built for this host.")?;
        let archive = archive_path(app)
            .ok_or("The bundled Native Tools environment is missing from this installation.")?;
        let digest = environment_digest(app)?;
        let archive_in_wsl =
            map_host_paths_to_wsl(distribution, &[archive.to_string_lossy().to_string()])?
                .remove(0);

        let output = run_wsl(
            Some(distribution),
            &[
                "/bin/sh".into(),
                "-c".into(),
                UNPACK_PROGRAM.into(),
                "liatir".into(),
                digest,
                archive_in_wsl,
                subdir.into(),
                COMPLETION_MARKER.into(),
            ],
        )?;
        if !output.status.success() {
            return Err(format!(
                "Liatir could not prepare its bioinformatics tools inside WSL2: {}",
                combined_output(&output)
            ));
        }
        let prefix = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !prefix.starts_with('/') {
            return Err("WSL2 did not report where the Native Tools were unpacked.".into());
        }
        Ok(prefix)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claims_only_the_tools_the_environment_actually_builds() {
        assert!(is_bundled_tool("samtools"));
        assert!(is_bundled_tool("bwa"));
        // FastQC runs as WASM in-process and SnpEff is a Java runtime; neither is
        // in the conda environment, so neither may be resolved from it.
        assert!(!is_bundled_tool("fastqc"));
        assert!(!is_bundled_tool("snpeff"));
        assert!(!is_bundled_tool("java"));
        assert!(!is_bundled_tool("nextflow"));
    }

    /// A real Windows `bwa mem` line: two of five arguments are files.
    #[test]
    fn translates_the_file_arguments_and_nothing_else() {
        let args: Vec<String> = ["mem", "-t", "8", r"C:\bio\ref.fa", r"C:\bio\R1.fastq"]
            .iter()
            .map(|value| value.to_string())
            .collect();
        let positions = wsl_plan::path_argument_positions(&args);
        assert_eq!(positions, vec![3, 4]);

        let mapped = vec![
            "/mnt/c/bio/ref.fa".to_string(),
            "/mnt/c/bio/R1.fastq".to_string(),
        ];
        let translated = wsl_plan::substitute_mapped_paths(&args, &positions, &mapped).unwrap();
        assert_eq!(
            translated,
            vec!["mem", "-t", "8", "/mnt/c/bio/ref.fa", "/mnt/c/bio/R1.fastq"],
        );
    }

    /// A network location fails before WSL2 is started, with an instruction
    /// rather than the tool's own `stat` error.
    #[test]
    fn refuses_a_network_location_liatir_cannot_reach() {
        let args = vec![
            "stats".to_string(),
            r"\\server\share\reads.fastq".to_string(),
        ];
        let error = wsl_plan::reject_unreachable_paths(&args).unwrap_err();
        assert!(error.contains(r"\\server\share\reads.fastq"));
        assert!(error.contains("Copy the file to a drive on this computer"));
        // The extended-length form starts the same way and is equally unmappable.
        assert!(wsl_plan::reject_unreachable_paths(&[r"\\?\C:\bio\ref.fa".to_string()]).is_err());
    }

    /// What must keep working: everything Liatir actually passes.
    #[test]
    fn lets_ordinary_arguments_and_drive_paths_through() {
        let args: Vec<String> = [
            "view",
            "-i",
            "QUAL>20 && DP>10",
            "-t",
            "8",
            r"C:\bio\calls.vcf",
            "D:/data/ref.fa",
        ]
        .iter()
        .map(|value| value.to_string())
        .collect();
        assert!(wsl_plan::reject_unreachable_paths(&args).is_ok());
    }

    /// The argument that must never be treated as a path.
    #[test]
    fn leaves_a_filter_expression_alone() {
        let args: Vec<String> = ["view", "-i", "QUAL>20 && DP>10", r"C:\bio\calls.vcf"]
            .iter()
            .map(|value| value.to_string())
            .collect();
        assert_eq!(wsl_plan::path_argument_positions(&args), vec![3]);
    }

    #[test]
    fn refuses_a_mapping_that_does_not_line_up_with_what_was_sent() {
        let args = vec![r"C:\a".to_string(), r"C:\b".to_string()];
        let positions = wsl_plan::path_argument_positions(&args);
        // Two paths went out, one came back: substituting would silently move the
        // second file's argument onto the first file.
        assert!(wsl_plan::substitute_mapped_paths(&args, &positions, &["/mnt/c/a".into()]).is_err());
    }

    #[test]
    fn runs_the_tool_from_the_unpacked_prefix_inside_the_distribution() {
        let command = wsl_plan::tool_command(
            "Ubuntu-24.04",
            "/home/bio/.local/share/liatir/native-tools/abc",
            "samtools",
            &["sort".to_string(), "/mnt/c/bio/reads.bam".to_string()],
        );
        assert_eq!(command.program, "wsl.exe");
        assert_eq!(
            command.args,
            vec![
                "--distribution",
                "Ubuntu-24.04",
                "--exec",
                "/home/bio/.local/share/liatir/native-tools/abc/bin/samtools",
                "sort",
                "/mnt/c/bio/reads.bam",
            ],
        );
    }

    #[test]
    fn ships_the_linux_environment_to_windows_and_a_native_one_elsewhere() {
        // The mapping is what makes the WSL2 decision visible in one place.
        assert_eq!(
            subdir().is_some(),
            matches!(
                (std::env::consts::OS, std::env::consts::ARCH),
                ("macos", "aarch64") | ("linux", "x86_64") | ("windows", "x86_64"),
            )
        );
    }
}
