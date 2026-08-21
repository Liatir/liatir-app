//! The WSL2 boundary.
//!
//! Windows has no build of most of the scientific software Liatir runs, so the
//! Windows app reaches Linux ones through WSL2. Two capabilities need that road —
//! External Workflows (Nextflow, since Gate 6) and the bundled Native Tools
//! environment — and they must cross it the same way, because everything
//! dangerous about the crossing is in the details: which paths are allowed to
//! leave Windows, how they are translated, and how the translation is checked.
//!
//! The pure functions here are compiled on every platform so their tests run on
//! every platform. Only the calls into `wsl.exe` are Windows-only, which is why
//! `helpers/mod.rs` allows dead code for this module off Windows.

#[cfg(target_os = "windows")]
use std::io::Write;
#[cfg(target_os = "windows")]
use std::process::{Command, Output, Stdio};

/// Accept only distribution names WSL itself can name on a command line.
///
/// This value reaches `wsl.exe --distribution`, so anything outside this set is
/// rejected rather than quoted: the point is that no user-controlled string ever
/// has a chance to become an argument of its own.
pub(crate) fn valid_wsl_distribution(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, ' ' | '_' | '-' | '.')
        })
}

/// Build the `wsl.exe` argument list for a command to run inside a distribution.
///
/// `--exec` matters: it runs the program directly instead of handing the line to
/// a login shell, so no argument is ever re-parsed for globs, quotes or
/// separators on the Linux side.
pub(crate) fn wsl_command_args(distribution: Option<&str>, command: &[String]) -> Vec<String> {
    let mut args = Vec::with_capacity(command.len() + 3);
    if let Some(distribution) = distribution {
        args.push("--distribution".into());
        args.push(distribution.into());
    }
    args.push("--exec".into());
    args.extend(command.iter().cloned());
    args
}

/// A Windows path that `wslpath` can map: drive letter, colon, separator.
///
/// UNC and extended-length (`\\?\`) forms are refused rather than passed
/// through, because `wslpath` cannot map them to a Linux path and the tool would
/// otherwise fail later with a "no such file" that names a path the user never
/// typed.
pub(crate) fn is_mappable_windows_path(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/')
        && !value.contains('\0')
        && !value.contains('\r')
        && !value.contains('\n')
}

/// The fixed shell program that converts staged paths, one per line of stdin.
///
/// `wslpath` accepts one path at a time and the program is a constant, so no
/// path content can become shell code. `IFS= read -r` keeps spaces and
/// backslashes intact, which Windows paths are full of.
pub(crate) const WSLPATH_PROGRAM: &str =
    "while IFS= read -r path; do\n  wslpath -a -u \"$path\" || exit $?\ndone";

/// Check a batch of mapped paths before anything is allowed to use them.
///
/// The count check is the important one: `wslpath` writes one line per input, so
/// a short read would otherwise shift every later path onto the wrong file — a
/// silent mismapping between two real files, which is far worse than an error.
pub(crate) fn validate_mapped_paths(mapped: &[String], expected: usize) -> Result<(), String> {
    if mapped.len() != expected
        || mapped
            .iter()
            .any(|path| !path.starts_with('/') || path.contains('\0'))
    {
        return Err("WSL2 returned an invalid path mapping for the staged run.".into());
    }
    Ok(())
}

#[cfg(target_os = "windows")]
pub(crate) fn run_wsl(distribution: Option<&str>, command: &[String]) -> Result<Output, String> {
    Command::new("wsl.exe")
        .args(wsl_command_args(distribution, command))
        .output()
        .map_err(|error| format!("Could not start WSL2 through wsl.exe: {error}"))
}

#[cfg(target_os = "windows")]
pub(crate) fn run_wsl_with_input(
    distribution: Option<&str>,
    command: &[String],
    input: &[u8],
) -> Result<Output, String> {
    let mut child = Command::new("wsl.exe")
        .args(wsl_command_args(distribution, command))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Could not start WSL2 through wsl.exe: {error}"))?;
    let write_result = child
        .stdin
        .take()
        .ok_or_else(|| "Could not open WSL2 standard input.".to_string())
        .and_then(|mut stdin| {
            stdin
                .write_all(input)
                .map_err(|error| format!("Could not send staged paths to WSL2: {error}"))
        });
    let output = child
        .wait_with_output()
        .map_err(|error| format!("Could not wait for WSL2 path conversion: {error}"))?;
    write_result?;
    Ok(output)
}

#[cfg(target_os = "windows")]
pub(crate) fn combined_output(output: &Output) -> String {
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    if stderr.trim().is_empty() {
        stdout.trim().to_string()
    } else if stdout.trim().is_empty() {
        stderr.trim().to_string()
    } else {
        format!("{}\n{}", stdout.trim(), stderr.trim())
    }
}

/// Translate absolute Windows paths into their Linux equivalents inside WSL2.
///
/// Asking `wslpath` instead of rewriting `C:\` into `/mnt/c` in Rust is the
/// whole point: mount points are configurable per machine, so the only authority
/// on where a Windows drive appears is the distribution itself.
#[cfg(target_os = "windows")]
pub(crate) fn map_host_paths_to_wsl(
    distribution: &str,
    host_paths: &[String],
) -> Result<Vec<String>, String> {
    for path in host_paths {
        if path
            .chars()
            .any(|character| matches!(character, '\0' | '\r' | '\n'))
        {
            return Err(
                "A staged Windows path contains a character that WSL cannot map safely.".into(),
            );
        }
        if !std::path::Path::new(path).is_absolute() {
            return Err(format!(
                "Only absolute Windows paths can cross into WSL2: {path}"
            ));
        }
    }
    let command = vec![
        "/bin/sh".into(),
        "-c".into(),
        WSLPATH_PROGRAM.to_string(),
    ];
    let mut input = host_paths.join("\n");
    input.push('\n');
    let output = run_wsl_with_input(Some(distribution), &command, input.as_bytes())?;
    if !output.status.success() {
        return Err(format!(
            "WSL2 path conversion failed: {}",
            combined_output(&output)
        ));
    }
    let mapped = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(|line| line.trim_end_matches('\r').to_string())
        .collect::<Vec<_>>();
    validate_mapped_paths(&mapped, host_paths.len())?;
    Ok(mapped)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_distribution_names_that_could_become_arguments() {
        assert!(valid_wsl_distribution("Ubuntu-24.04"));
        assert!(valid_wsl_distribution("Ubuntu 24.04"));
        assert!(!valid_wsl_distribution(""));
        assert!(!valid_wsl_distribution("Ubuntu\" --exec evil"));
        assert!(!valid_wsl_distribution("Ubuntu;rm"));
        assert!(!valid_wsl_distribution(&"u".repeat(129)));
    }

    #[test]
    fn runs_the_program_directly_instead_of_through_a_login_shell() {
        let command = vec!["/bin/sh".to_string(), "-c".to_string(), "true".to_string()];
        assert_eq!(
            wsl_command_args(Some("Ubuntu"), &command),
            vec!["--distribution", "Ubuntu", "--exec", "/bin/sh", "-c", "true"],
        );
        assert_eq!(
            wsl_command_args(None, &command),
            vec!["--exec", "/bin/sh", "-c", "true"],
        );
    }

    #[test]
    fn recognises_only_paths_wslpath_can_actually_map() {
        assert!(is_mappable_windows_path(r"C:\Users\bio\reads.fastq"));
        assert!(is_mappable_windows_path("D:/data/ref.fa"));
        // Not paths at all — the ordinary case, and the one that must never be mapped.
        assert!(!is_mappable_windows_path("mem"));
        assert!(!is_mappable_windows_path("-t"));
        assert!(!is_mappable_windows_path("4"));
        assert!(!is_mappable_windows_path("QUAL>20 && DP>10"));
        // Real paths wslpath has no answer for.
        assert!(!is_mappable_windows_path(r"\\server\share\ref.fa"));
        assert!(!is_mappable_windows_path(r"\\?\C:\Users\bio\reads.fastq"));
        assert!(!is_mappable_windows_path(r"reads.fastq"));
        // Anything that could split a line of the stdin protocol.
        assert!(!is_mappable_windows_path("C:\\data\nC:\\other"));
    }

    #[test]
    fn refuses_a_short_or_relative_mapping_rather_than_shifting_files() {
        assert!(validate_mapped_paths(&["/mnt/c/a".into(), "/mnt/c/b".into()], 2).is_ok());
        // One line short: without this check every later path would take the
        // place of the one before it.
        assert!(validate_mapped_paths(&["/mnt/c/a".into()], 2).is_err());
        assert!(validate_mapped_paths(&["mnt/c/a".into()], 1).is_err());
    }
}
