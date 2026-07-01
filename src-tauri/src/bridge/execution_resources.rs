const MAX_AUTO_THREADS: usize = 16;
const MAX_MANUAL_THREADS: usize = 128;

pub fn resolve_thread_count(requested: Option<usize>) -> usize {
    match requested {
        Some(value) if value > 0 => value.clamp(1, MAX_MANUAL_THREADS),
        _ => {
            let cores = std::thread::available_parallelism()
                .map(|n| n.get())
                .unwrap_or(2);
            let reserved = if cores > 1 { cores - 1 } else { 1 };
            reserved.clamp(1, MAX_AUTO_THREADS)
        }
    }
}
