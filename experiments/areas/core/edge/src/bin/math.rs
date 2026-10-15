//! Calls Rust's f64 functions on a value the compiler can't fold, so the release
//! build's imports show which C runtime functions they reach.

fn main() {
    let x: f64 = std::env::args().count() as f64 * 0.37;
    println!(
        "{} {} {} {} {} {} {}",
        x.sin(),
        x.cos(),
        x.tan(),
        x.exp(),
        x.ln(),
        x.powf(1.3),
        x.atan2(0.5)
    );
}
