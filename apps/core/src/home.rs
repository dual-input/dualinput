//! Keeping the pilot's home folder's path, which names their Windows account, out of every
//! recording and log, since a pilot sends both to us in a bug report.

use std::path::PathBuf;

use windows_sys::Win32::Globalization::{GetACP, WideCharToMultiByte};

/// The home folder's path as the core may meet it in an input's bytes.
///
/// The sim names an aircraft in the Community folder, and the flight file, by paths under
/// the home folder, and it sent `AircraftLoaded`'s path lowercased
/// (record/areas/recording/01-recording-and-bug-reports.md, "The home folder's path"). So
/// the path is looked for in UTF-8 and in the system's ANSI code page, which SimConnect's
/// strings use, each as written and lowercased.
pub struct Home {
    real: Option<String>,
    /// Each form's bytes, longest first, so a longer form is hidden before a shorter one
    /// could hide part of it.
    forms: Vec<Vec<u8>>,
}

impl Home {
    /// The home folder `%USERPROFILE%` names, which is how Windows gives it to a program.
    pub fn from_environment() -> Home {
        match std::env::var("USERPROFILE") {
            Ok(path) if !path.is_empty() => Home::new(&path),
            _ => Home::none(),
        }
    }

    pub fn new(path: &str) -> Home {
        let mut forms = Vec::new();
        for text in [path.to_string(), path.to_lowercase()] {
            forms.push(text.as_bytes().to_vec());
            forms.extend(ansi(&text));
        }
        forms.sort_by_key(|form| std::cmp::Reverse(form.len()));
        forms.dedup();
        Home {
            real: Some(path.to_string()),
            forms,
        }
    }

    /// Hides nothing, for a test.
    pub fn none() -> Home {
        Home {
            real: None,
            forms: Vec::new(),
        }
    }

    /// The forms of the path that UTF-8 text holds, for the log.
    pub fn text_forms(&self) -> impl Iterator<Item = &str> {
        self.forms
            .iter()
            .filter_map(|form| std::str::from_utf8(form).ok())
    }

    /// Replaces each form of the path in `bytes` with a run of `~` the same number of bytes
    /// long, so a SimConnect record keeps its size and every string in it keeps its place.
    pub fn hide(&self, bytes: &mut [u8]) {
        for form in &self.forms {
            let mut i = 0;
            while i + form.len() <= bytes.len() {
                if bytes[i..i + form.len()] == form[..] {
                    bytes[i..i + form.len()].fill(b'~');
                    i += form.len();
                } else {
                    i += 1;
                }
            }
        }
    }

    /// The real path of a file that an output names, where a path from an input starts
    /// with a run of `~` that `hide` put in place of the home folder's path.
    pub fn reveal(&self, path: &str) -> PathBuf {
        if let Some(real) = &self.real {
            for form in &self.forms {
                let placeholder = "~".repeat(form.len());
                if let Some(rest) = path.strip_prefix(&placeholder)
                    && (rest.is_empty() || rest.starts_with(['\\', '/']))
                {
                    return PathBuf::from(format!("{real}{rest}"));
                }
            }
        }
        PathBuf::from(path)
    }
}

/// `text` in the system's ANSI code page, or `None` where the code page can't hold it, since
/// then no string in that code page can hold the path either.
fn ansi(text: &str) -> Option<Vec<u8>> {
    let wide: Vec<u16> = text.encode_utf16().collect();
    let length = i32::try_from(wide.len()).ok()?;
    let mut used_default = 0;
    // SAFETY: the first call reads `length` UTF-16 units from `wide` and writes nothing, and
    // returns the size the second call writes into `bytes`.
    unsafe {
        let size = WideCharToMultiByte(
            GetACP(),
            0,
            wide.as_ptr(),
            length,
            std::ptr::null_mut(),
            0,
            std::ptr::null(),
            &mut used_default,
        );
        if size <= 0 || used_default != 0 {
            return None;
        }
        let mut bytes = vec![0u8; size as usize];
        WideCharToMultiByte(
            GetACP(),
            0,
            wide.as_ptr(),
            length,
            bytes.as_mut_ptr(),
            size,
            std::ptr::null(),
            std::ptr::null_mut(),
        );
        Some(bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hides_the_path_as_written_and_lowercased_keeping_every_length() {
        let home = Home::new(r"C:\Users\Pilot");
        let mut bytes = br"a C:\Users\Pilot\x and c:\users\pilot\y, not C:\Users\Pilots".to_vec();
        let length = bytes.len();
        home.hide(&mut bytes);
        assert_eq!(bytes.len(), length);
        assert_eq!(
            bytes,
            br"a ~~~~~~~~~~~~~~\x and ~~~~~~~~~~~~~~\y, not ~~~~~~~~~~~~~~s".to_vec()
        );
    }

    #[test]
    fn reveals_the_real_path_behind_the_placeholder() {
        let home = Home::new(r"C:\Users\Pilot");
        assert_eq!(
            home.reveal(r"~~~~~~~~~~~~~~\flight.flt"),
            PathBuf::from(r"C:\Users\Pilot\flight.flt")
        );
        assert_eq!(home.reveal("settings.json"), PathBuf::from("settings.json"));
        assert_eq!(
            home.reveal(r"~~~~~~~~~~~~~~~\x"),
            PathBuf::from(r"~~~~~~~~~~~~~~~\x")
        );
    }
}
