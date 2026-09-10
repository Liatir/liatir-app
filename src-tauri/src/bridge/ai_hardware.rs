//! Shared native hardware probes used by AI Models and Runtime Box selection.
//!
//! Probing lives here so the compatibility UI and the installer observe the same machine facts.

use std::process::Command;

/// NVIDIA capability relevant to selecting a published CUDA Runtime Box.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct NvidiaCapability {
    pub driver_version: String,
}

/// Parses the first driver reported by `nvidia-smi` and rejects diagnostic/error text.
pub(crate) fn parse_nvidia_driver_output(output: &str) -> Option<NvidiaCapability> {
    let version = output
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())?;
    let components = version.split('.').collect::<Vec<_>>();
    if components.len() < 2
        || components.iter().any(|part| {
            part.is_empty() || !part.chars().all(|character| character.is_ascii_digit())
        })
    {
        return None;
    }
    Some(NvidiaCapability {
        driver_version: version.to_string(),
    })
}

/// Detects an NVIDIA driver capable of answering CUDA compatibility queries.
pub(crate) fn nvidia_capability() -> Option<NvidiaCapability> {
    let output = Command::new("nvidia-smi")
        .args([
            "--query-gpu=driver_version",
            "--format=csv,noheader,nounits",
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    parse_nvidia_driver_output(&String::from_utf8_lossy(&output.stdout))
}

/// Installed physical memory in bytes, or `None` when the native probe is unavailable.
pub(crate) fn total_memory_bytes() -> Option<u64> {
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("sysctl")
            .args(["-n", "hw.memsize"])
            .output()
            .ok()?;
        output
            .status
            .success()
            .then(|| {
                String::from_utf8_lossy(&output.stdout)
                    .trim()
                    .parse::<u64>()
                    .ok()
            })
            .flatten()
    }
    #[cfg(target_os = "linux")]
    {
        let text = std::fs::read_to_string("/proc/meminfo").ok()?;
        let kibibytes = text
            .lines()
            .find_map(|line| line.strip_prefix("MemTotal:"))
            .and_then(|rest| rest.split_whitespace().next())
            .and_then(|value| value.parse::<u64>().ok())?;
        Some(kibibytes * 1024)
    }
    #[cfg(target_os = "windows")]
    {
        let output = Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory",
            ])
            .output()
            .ok()?;
        output
            .status
            .success()
            .then(|| {
                String::from_utf8_lossy(&output.stdout)
                    .trim()
                    .parse::<u64>()
                    .ok()
            })
            .flatten()
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_box_parses_nvidia_driver_output_without_accepting_diagnostics() {
        assert_eq!(
            parse_nvidia_driver_output("590.48.01\n590.48.01\n"),
            Some(NvidiaCapability {
                driver_version: "590.48.01".to_string(),
            })
        );
        assert_eq!(parse_nvidia_driver_output("NVIDIA-SMI has failed"), None);
        assert_eq!(parse_nvidia_driver_output(""), None);
    }
}
