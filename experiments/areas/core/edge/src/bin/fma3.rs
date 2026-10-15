//! Does `_set_FMA3_enable(0)` change what Rust's f64 math and QuickJS-ng's `Math`
//! compute, and do the two compute the same bits?

use rquickjs::{Context, Runtime};

extern "C" {
    fn _set_FMA3_enable(flag: i32) -> i32;
    fn _get_FMA3_enable() -> i32;
}

const N: usize = 200_000;

fn x(i: usize) -> f64 {
    i as f64 * 0.000_731 - 50.0
}

fn rust(out: &mut Vec<u64>) {
    out.clear();
    for i in 0..N {
        let x = x(i);
        for v in [x.sin(), x.cos(), x.tan(), (x / 10.0).exp(), (x.abs() + 1.0).ln(), (x.abs() + 1.0).powf(1.3), x.atan2(0.5)] {
            out.push(v.to_bits());
        }
    }
}

const JS: &str = "(n) => { const out = []; for (let i = 0; i < n; i++) { const x = i * 0.000731 - 50.0; \
    out.push(Math.sin(x), Math.cos(x), Math.tan(x), Math.exp(x / 10), Math.log(Math.abs(x) + 1), \
    Math.pow(Math.abs(x) + 1, 1.3), Math.atan2(x, 0.5)); } return out; }";

fn js(ctx: &Context, out: &mut Vec<u64>) {
    out.clear();
    ctx.with(|ctx| {
        let f: rquickjs::Function = ctx.eval(JS).unwrap();
        let values: Vec<f64> = f.call((N as f64,)).unwrap();
        out.extend(values.into_iter().map(f64::to_bits));
    });
}

fn differ(a: &[u64], b: &[u64]) -> usize {
    a.iter().zip(b).filter(|(x, y)| x != y).count()
}

/// FNV-1a over every result's bits, so two builds can compare what they computed.
fn hash(a: &[u64]) -> u64 {
    a.iter().flat_map(|v| v.to_le_bytes()).fold(0xcbf2_9ce4_8422_2325, |h, b| (h ^ b as u64).wrapping_mul(0x0000_0100_0000_01b3))
}

fn main() {
    let rt = Runtime::new().unwrap();
    let ctx = Context::full(&rt).unwrap();
    let (mut r_on, mut j_on, mut r_off, mut j_off, mut r_again) = (vec![], vec![], vec![], vec![], vec![]);

    let start = unsafe { _get_FMA3_enable() };
    println!("_get_FMA3_enable() at start: {start}");
    rust(&mut r_on);
    js(&ctx, &mut j_on);

    let set = unsafe { _set_FMA3_enable(0) };
    println!("_set_FMA3_enable(0) returned {set}; _get_FMA3_enable() now {}", unsafe { _get_FMA3_enable() });
    rust(&mut r_off);
    js(&ctx, &mut j_off);

    let back = unsafe { _set_FMA3_enable(start) };
    println!("_set_FMA3_enable({start}) returned {back}");
    rust(&mut r_again);

    let total = r_on.len();
    println!("{total} results each, from sin, cos, tan, exp, log, pow, and atan2 over {N} values");
    println!("Rust, FMA3 at start against off: {} differ", differ(&r_on, &r_off));
    println!("QuickJS-ng, FMA3 at start against off: {} differ", differ(&j_on, &j_off));
    println!("Rust against QuickJS-ng, FMA3 at start: {} differ", differ(&r_on, &j_on));
    println!("Rust against QuickJS-ng, FMA3 off: {} differ", differ(&r_off, &j_off));
    println!("Rust, at start against back on again: {} differ", differ(&r_on, &r_again));
    println!("hash of Rust's results with FMA3 at start: {:016x}", hash(&r_on));
    println!("hash of Rust's results with FMA3 off: {:016x}", hash(&r_off));
}
