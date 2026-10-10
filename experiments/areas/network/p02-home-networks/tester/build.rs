// Builds the deployment file into the program, so a friend's copy needs no settings: the
// stations' addresses and the certificate authority they present. `P02_DEPLOY` overrides the
// default path, which `deploy/` writes once the droplets exist.
fn main() {
    let src = std::env::var("P02_DEPLOY").unwrap_or_else(|_| {
        let dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
        format!("{dir}/../deploy/generated/deploy.json")
    });
    println!("cargo:rerun-if-env-changed=P02_DEPLOY");
    println!("cargo:rerun-if-changed={src}");
    let body = std::fs::read_to_string(&src)
        .unwrap_or_else(|e| panic!("can't read the deployment file {src}: {e}; run deploy/ first"));
    let out = std::path::Path::new(&std::env::var("OUT_DIR").unwrap()).join("deploy.json");
    std::fs::write(out, body).unwrap();

    // The version block Windows reads for the name in its Firewall prompt and the file's
    // properties; without it, the prompt shows the bare file name.
    #[cfg(windows)]
    {
        let mut r = winresource::WindowsResource::new();
        r.set("FileDescription", "Crosscheck network test");
        r.set("ProductName", "Crosscheck network test");
        r.set("CompanyName", "Crosscheck");
        r.set("OriginalFilename", "Crosscheck network test.exe");
        r.compile().expect("Windows resource compiler");
    }
}
