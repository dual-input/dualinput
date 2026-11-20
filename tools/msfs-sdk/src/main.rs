//! Installs one version of the MSFS 2024 SDK, the headers and libraries our code for the
//! sim builds against.
//!
//! A commit has to build the same on every PC, so every build uses the SDK version
//! msfs-sdk.txt names. cargo-msfs, the tool that builds our WASM module, reads the SDK from
//! a folder of its own, but it installs only the newest SDK. So this program installs the
//! named version into that folder.
//!
//! It's cargo-msfs's `install_latest_sdk` with a version argument: it downloads that
//! version's installer, unpacks its files without running it, and writes `version.txt`
//! holding the version alone.
//!
//! ```text
//! dualinput-msfs-sdk <version> [--into <folder>]
//! ```
//!
//! `--into` installs into another folder, to try the program without touching the SDK
//! the builds use.
//!
//! Adapted from navigraph/cargo-msfs v1.1.0, `src/sdk.rs`, under its license:
//!
//! Copyright 2024 Navigraph
//!
//! Permission is hereby granted, free of charge, to any person obtaining a copy of this
//! software and associated documentation files (the "Software"), to deal in the Software
//! without restriction, including without limitation the rights to use, copy, modify,
//! merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
//! permit persons to whom the Software is furnished to do so, subject to the following
//! conditions:
//!
//! The above copyright notice and this permission notice shall be included in all copies
//! or substantial portions of the Software.
//!
//! THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
//! INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
//! PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
//! HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
//! CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR
//! THE USE OR OTHER DEALINGS IN THE SOFTWARE.

use std::{
    collections::HashMap,
    env, fs,
    io::{self, Cursor, Read, Write},
    path::{Path, PathBuf},
};

use anyhow::{Context, Result, bail};
use cab::Cabinet;
use msi::{Expr, Package, Row, Select};
use zip::ZipArchive;

/// This program needs an exact version's installer, and Microsoft's SDK listing links
/// only the newest two. Older installers are still served under this URL, such as
/// `1.7.3/MSFS2024_SDK_Core_Installer_1.7.3.zip` for 1.7.3. On 2026-10-18 all 10 versions
/// we tried, 0.9.3 to 1.8.1, were there. Nothing promises they stay (record/areas/build/log.md,
/// "The SDK's listing links only its newest two versions, and every older installer we tried
/// is still served").
const INSTALLERS: &str = "https://sdk.flightsimulator.com/msfs2024/files/installers";

/// The installer holds more than the SDK, and this program unpacks only this folder of
/// it, as cargo-msfs does. The leading `.\` comes from the MSI's own folder names, which
/// `directory_path` joins as they're spelled.
const EXTRACT_FROM: &str = ".\\MSFS 2024 SDK\\";

fn main() -> Result<()> {
    let mut args = env::args().skip(1);
    let version = args
        .next()
        .context("usage: dualinput-msfs-sdk <version> [--into <folder>]")?;
    let target = match (args.next().as_deref(), args.next()) {
        (None, _) => sdk_folder()?,
        (Some("--into"), Some(folder)) => PathBuf::from(folder),
        _ => bail!("usage: dualinput-msfs-sdk <version> [--into <folder>]"),
    };
    if !version
        .split('.')
        .all(|part| !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit()))
    {
        bail!("`{version}` isn't an SDK version such as 1.8.1");
    }
    install(&version, &target)?;
    println!("installed MSFS 2024 SDK {version} in {}", target.display());
    Ok(())
}

/// The folder cargo-msfs reads the 2024 SDK from. `sdkFolder` in tools/lib/sdk.ts and
/// `sdk_folder` in src/engines/simconnect-types/build.rs name the same folder, so change all
/// three together.
fn sdk_folder() -> Result<PathBuf> {
    let appdata = env::var_os("APPDATA").context("APPDATA isn't set")?;
    Ok(PathBuf::from(appdata)
        .join("cargo-msfs")
        .join("data")
        .join("msfs2024"))
}

fn install(version: &str, target: &Path) -> Result<()> {
    let zip_name = format!("MSFS2024_SDK_Core_Installer_{version}.zip");
    let url = format!("{INSTALLERS}/{version}/{zip_name}");
    let bytes = download(&url)?;
    let mut msi = open_installer(bytes, &zip_name)?;
    let files = file_paths(&mut msi)?;

    // Unpack into a sibling folder, then swap it in, so an unpack that fails partway
    // leaves the installed SDK as it was.
    let fresh = sibling(target, "new")?;
    let old = sibling(target, "old")?;
    for leftover in [&fresh, &old] {
        if leftover.exists() {
            fs::remove_dir_all(leftover)
                .with_context(|| format!("removing {}", leftover.display()))?;
        }
    }
    unpack(&mut msi, &files, &fresh)?;
    // After the unpack, so it replaces any version.txt the installer holds.
    fs::write(fresh.join("version.txt"), version)?;

    if target.exists() {
        fs::rename(target, &old).with_context(|| format!("moving {} aside", target.display()))?;
    }
    fs::rename(&fresh, target)
        .with_context(|| format!("moving the new SDK into {}", target.display()))?;
    if old.exists() {
        fs::remove_dir_all(&old)
            .with_context(|| format!("removing the old SDK at {}", old.display()))?;
    }
    Ok(())
}

fn download(url: &str) -> Result<Vec<u8>> {
    println!("downloading {url}");
    let mut response = reqwest::blocking::get(url)?
        .error_for_status()
        .with_context(|| format!("fetching {url}"))?;
    let total = response.content_length();
    let mut bytes = Vec::with_capacity(total.unwrap_or(0) as usize);
    let mut buf = vec![0u8; 1 << 16];
    let mut shown = 0;
    loop {
        let n = response.read(&mut buf)?;
        if n == 0 {
            break;
        }
        bytes.extend_from_slice(&buf[..n]);
        if let Some(total) = total {
            let tenths = bytes.len() as u64 * 10 / total.max(1);
            if tenths > shown {
                shown = tenths;
                println!("  {}%", tenths * 10);
            }
        }
    }
    Ok(bytes)
}

/// The MSI installer inside the zip. An MSI keeps its files in cabinets, compressed
/// archives usually stored inside the MSI itself. cargo-msfs also handles releases that
/// ship them as .cab files beside the MSI in the zip, so this adds each one to the MSI,
/// where `unpack` finds them.
fn open_installer(bytes: Vec<u8>, zip_name: &str) -> Result<Package<Cursor<Vec<u8>>>> {
    let mut zip =
        ZipArchive::new(Cursor::new(bytes)).with_context(|| format!("reading {zip_name}"))?;
    let names: Vec<String> = zip.file_names().map(str::to_owned).collect();
    let msi_name = names
        .iter()
        .find(|n| n.ends_with(".msi"))
        .context("no .msi in the installer's zip")?;
    let mut msi_bytes = Vec::new();
    zip.by_name(msi_name)?.read_to_end(&mut msi_bytes)?;
    let mut msi = Package::open(Cursor::new(msi_bytes))?;
    for cab in names.iter().filter(|n| n.ends_with(".cab")) {
        let stream_name = Path::new(cab)
            .file_name()
            .and_then(|n| n.to_str())
            .context("a CAB file's name isn't text")?
            .to_owned();
        let mut cab_bytes = Vec::new();
        zip.by_name(cab)?.read_to_end(&mut cab_bytes)?;
        msi.write_stream(&stream_name)?.write_all(&cab_bytes)?;
    }
    Ok(msi)
}

/// Each file's ID, mapped to its path in the installer. An MSI is a small database: its
/// `File` table lists each file by ID and name, the `Component` table gives each file's
/// folder, and the `Directory` table each folder's parent, so a file's path is its
/// folders' names joined from the root
/// (https://learn.microsoft.com/en-us/windows/win32/msi/database-tables).
fn file_paths(msi: &mut Package<Cursor<Vec<u8>>>) -> Result<HashMap<String, PathBuf>> {
    let query = Select::table("File")
        .inner_join(
            Select::table("Component"),
            Expr::col("Component.Component").eq(Expr::col("File.Component_")),
        )
        .columns(&["File.File", "File.FileName", "Component.Directory_"]);
    let files: Vec<Row> = msi.select_rows(query)?.collect();
    let directories: Vec<Row> = msi
        .select_rows(Select::table("Directory").columns(&[
            "Directory",
            "Directory_Parent",
            "DefaultDir",
        ]))?
        .collect();

    let mut paths = HashMap::new();
    for file in files {
        let id = file["File.File"].as_str().context("a file without an ID")?;
        let name = long_name(
            file["File.FileName"]
                .as_str()
                .context("a file without a name")?,
        );
        let folder = directory_path(
            file["Component.Directory_"]
                .as_str()
                .context("a file without a folder")?,
            &directories,
        )?;
        paths.insert(id.to_owned(), folder.join(name));
    }
    Ok(paths)
}

/// An MSI name field holds `short|long`, in the form of `PROGRA~1|Program Files`, or the
/// long name alone (https://learn.microsoft.com/en-us/windows/win32/msi/filename).
fn long_name(field: &str) -> &str {
    field.rsplit('|').next().unwrap_or(field)
}

fn directory_path(directory: &str, directories: &[Row]) -> Result<PathBuf> {
    let row = directories
        .iter()
        .find(|d| d["Directory"].as_str() == Some(directory))
        .with_context(|| format!("no Directory row `{directory}`"))?;
    // A root folder's parent is empty or the folder itself, and a root adds nothing to the
    // path (https://learn.microsoft.com/en-us/windows/win32/msi/directory-table).
    match row["Directory_Parent"].as_str() {
        Some(parent) if parent != directory => {
            let name = long_name(
                row["DefaultDir"]
                    .as_str()
                    .context("a folder without a name")?,
            );
            Ok(directory_path(parent, directories)?.join(name))
        }
        _ => Ok(PathBuf::new()),
    }
}

/// Writes every file under `EXTRACT_FROM` into `out`. Like cargo-msfs, it reads every
/// cabinet and looks each file it holds up in `files` to find where the file goes.
fn unpack(
    msi: &mut Package<Cursor<Vec<u8>>>,
    files: &HashMap<String, PathBuf>,
    out: &Path,
) -> Result<()> {
    let wanted = files
        .values()
        .filter(|path| path.starts_with(EXTRACT_FROM))
        .count();
    if wanted == 0 {
        bail!("the installer's File table holds no file under `{EXTRACT_FROM}`");
    }
    fs::create_dir_all(out)?;
    let mut written = 0;
    let streams: Vec<String> = msi.streams().collect();
    for stream_name in streams {
        let stream = msi.read_stream(&stream_name)?;
        // Not every stream is a cabinet, and cargo-msfs skips the others too. A cabinet
        // that fails to parse is skipped the same way, and the count below catches the
        // files it held.
        let Ok(mut cabinet) = Cabinet::new(stream) else {
            continue;
        };
        let ids: Vec<String> = cabinet
            .folder_entries()
            .flat_map(|f| f.file_entries())
            .map(|f| f.name().to_owned())
            .collect();
        for id in ids {
            let path = files
                .get(&id)
                .with_context(|| format!("cabinet file `{id}` isn't in the File table"))?;
            let Ok(relative) = path.strip_prefix(EXTRACT_FROM) else {
                continue;
            };
            let dest = out.join(relative);
            fs::create_dir_all(dest.parent().context("a file at the root")?)?;
            io::copy(&mut cabinet.read_file(&id)?, &mut fs::File::create(&dest)?)?;
            written += 1;
        }
    }
    if written != wanted {
        bail!(
            "wrote {written} of the {wanted} files the installer's File table puts under `{EXTRACT_FROM}`"
        );
    }
    Ok(())
}

fn sibling(target: &Path, suffix: &str) -> Result<PathBuf> {
    let name = target
        .file_name()
        .context("the target folder has no name")?
        .to_string_lossy();
    Ok(target.with_file_name(format!("{name}.{suffix}")))
}
