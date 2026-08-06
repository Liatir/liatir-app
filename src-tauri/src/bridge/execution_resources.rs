//! How many threads a native tool (bwa, minimap2, …) is allowed to use.
//!
//! Centralised here so every tool makes the same decision: a bioinformatics run that saturates
//! every core makes the whole machine unusable while it works, which for a desktop app is a
//! worse outcome than finishing slightly slower.

/// Ceiling when Liatir chooses for the user. Beyond roughly this many threads these tools tend
/// to stop scaling anyway, so more would cost contention without buying speed.
const MAX_AUTO_THREADS: usize = 16;
/// Ceiling when the user chooses explicitly — deliberately high, since an expert on a big
/// workstation should not be second-guessed, but still bounded against a runaway value.
const MAX_MANUAL_THREADS: usize = 128;

/// Resolves the thread count for a tool run.
///
/// An explicit request is honoured (clamped to a sane range). Otherwise one core is left free
/// for the UI and the rest of the system, so the app stays responsive during a long run. A
/// non-positive request is treated as "no preference" rather than as an error.
pub fn resolve_thread_count(requested: Option<usize>) -> usize {
    match requested {
        Some(value) if value > 0 => value.clamp(1, MAX_MANUAL_THREADS),
        _ => {
            // Assume a dual-core machine if the core count cannot be determined: conservative,
            // and still leaves the reserved-core logic below meaningful.
            let cores = std::thread::available_parallelism()
                .map(|n| n.get())
                .unwrap_or(2);
            let reserved = if cores > 1 { cores - 1 } else { 1 };
            reserved.clamp(1, MAX_AUTO_THREADS)
        }
    }
}
