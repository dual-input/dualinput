//! How late tokio's sleep wakes on Windows, at the system's default timer
//! resolution and after timeBeginPeriod(1), and whether a chain of deadlines
//! drifts.

use std::time::{Duration, Instant};

#[link(name = "winmm")]
extern "system" {
    fn timeBeginPeriod(u: u32) -> u32;
}

async fn measure(label: &str) {
    for ms in [1u64, 2, 5, 10, 16, 20, 50, 200] {
        let n = if ms >= 50 { 20 } else { 60 };
        let mut late: Vec<f64> = vec![];
        for _ in 0..n {
            let t = Instant::now();
            tokio::time::sleep(Duration::from_millis(ms)).await;
            late.push(t.elapsed().as_secs_f64() * 1e3 - ms as f64);
        }
        late.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let p = |q: f64| late[((q * late.len() as f64).ceil() as usize).clamp(1, late.len()) - 1];
        println!("{label}\tsleep {ms}ms\t{n} runs\tlate by p50 {:.2}ms\tp99 {:.2}ms\tmax {:.2}ms", p(0.5), p(0.99), late[late.len() - 1]);
    }
    let start = Instant::now();
    let mut next = tokio::time::Instant::now();
    for _ in 0..40 {
        next += Duration::from_millis(50);
        tokio::time::sleep_until(next).await;
    }
    println!("{label}\t40 deadlines 50ms apart took {:.1}ms", start.elapsed().as_secs_f64() * 1e3);
}

#[tokio::main(flavor = "multi_thread", worker_threads = 2)]
async fn main() {
    measure("tokio, default resolution").await;
    let r = unsafe { timeBeginPeriod(1) };
    println!("timeBeginPeriod(1) returned {r}");
    measure("tokio, after timeBeginPeriod(1)").await;
}
