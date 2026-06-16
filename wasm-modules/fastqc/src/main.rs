use std::{
    fs::File,
    io::{self, BufRead, BufReader},
};
use flate2::read::GzDecoder;

fn main() {
    let mut line = String::new();
    io::stdin().read_line(&mut line).ok();
    let line = line.trim();

    let payload: serde_json::Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(e) => die(&format!("payload parse error: {e}")),
    };

    if payload["fn"].as_str() != Some("run") {
        die(&format!("unknown fn: {}", payload["fn"]));
    }

    let args = &payload["args"];
    let file_path = match args["input"].as_str() {
        Some(s) => s,
        None => die("args.input required"),
    };
    let max_reads = args["maxReads"].as_u64().map(|n| n as usize);

    match run(file_path, max_reads) {
        Ok(json) => println!("{json}"),
        Err(e) => die(&e.to_string()),
    }
}

fn die(msg: &str) -> ! {
    eprintln!("{msg}");
    std::process::exit(1);
}

fn run(
    file_path: &str,
    max_reads: Option<usize>,
) -> Result<String, Box<dyn std::error::Error>> {
    let file = File::open(file_path)?;
    let mut buf = BufReader::new(file);

    // Detect gzip by magic bytes without consuming input
    let is_gz = {
        let peek = buf.fill_buf()?;
        peek.len() >= 2 && peek[0] == 0x1f && peek[1] == 0x8b
    };

    let result = if is_gz {
        parse_fastq(BufReader::new(GzDecoder::new(buf)), max_reads)?
    } else {
        parse_fastq(buf, max_reads)?
    };

    Ok(result.to_string())
}

fn parse_fastq<R: BufRead>(
    reader: R,
    max_reads: Option<usize>,
) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
    let mut read_count: u64 = 0;
    let mut total_bases: u64 = 0;
    let mut min_len: u64 = u64::MAX;
    let mut max_len: u64 = 0;
    let mut gc_bases: u64 = 0;
    let mut quality_sum: f64 = 0.0;
    let mut pos_sums: Vec<f64> = Vec::new();
    let mut pos_counts: Vec<u64> = Vec::new();

    let mut lines = reader.lines();

    'outer: loop {
        if let Some(limit) = max_reads {
            if read_count as usize >= limit {
                break;
            }
        }

        // Skip empty lines between records
        let header = loop {
            match lines.next() {
                Some(Ok(l)) if l.is_empty() => continue,
                Some(Ok(l)) => break l,
                Some(Err(e)) => return Err(Box::new(e)),
                None => break 'outer,
            }
        };

        if !header.starts_with('@') {
            return Err(format!(
                "expected '@' header, got: {:?}",
                &header[..header.len().min(40)]
            )
            .into());
        }

        let seq = next_line(&mut lines, "after header")?;
        let _plus = next_line(&mut lines, "after sequence")?;
        let qual = next_line(&mut lines, "after '+'")?;

        let len = seq.len() as u64;
        if len == 0 {
            continue;
        }

        read_count += 1;
        total_bases += len;
        if len < min_len {
            min_len = len;
        }
        if len > max_len {
            max_len = len;
        }

        for b in seq.bytes() {
            if matches!(b, b'G' | b'g' | b'C' | b'c') {
                gc_bases += 1;
            }
        }

        let n = len as usize;
        if pos_sums.len() < n {
            pos_sums.resize(n, 0.0);
            pos_counts.resize(n, 0);
        }

        // Phred+33 encoding: quality = ASCII - 33
        for (i, q) in qual.bytes().enumerate().take(n) {
            let score = q.saturating_sub(33) as f64;
            quality_sum += score;
            pos_sums[i] += score;
            pos_counts[i] += 1;
        }
    }

    if read_count == 0 {
        return Err("no reads found in file".into());
    }

    let mean_length = total_bases as f64 / read_count as f64;
    let mean_quality = quality_sum / total_bases as f64;
    let gc_content = gc_bases as f64 / total_bases as f64;

    let quality_per_position: Vec<f64> = pos_sums
        .iter()
        .zip(pos_counts.iter())
        .map(|(s, c)| {
            if *c > 0 {
                (s / *c as f64 * 10.0).round() / 10.0
            } else {
                0.0
            }
        })
        .collect();

    Ok(serde_json::json!({
        "readCount":           read_count,
        "totalBases":          total_bases,
        "meanLength":          round1(mean_length),
        "minLength":           if min_len == u64::MAX { 0 } else { min_len },
        "maxLength":           max_len,
        "meanQuality":         round1(mean_quality),
        "gcContent":           (gc_content * 10000.0).round() / 10000.0,
        "qualityPerPosition":  quality_per_position,
    }))
}

fn next_line<R: BufRead>(
    lines: &mut std::io::Lines<R>,
    ctx: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    match lines.next() {
        Some(Ok(l)) => Ok(l),
        Some(Err(e)) => Err(Box::new(e)),
        None => Err(format!("unexpected EOF {ctx}").into()),
    }
}

fn round1(v: f64) -> f64 {
    (v * 10.0).round() / 10.0
}
