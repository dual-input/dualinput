//! The firewall rule that lets other pilots' connections reach the core. Adding it needs an administrator, and a pilot who
//! isn't one, prompted as the core first listens, gets block rules whatever they click, which win over allow rules. So the app
//! reads the rules, which needs no administrator, and when none allows the core or a block rule names it, runs itself with
//! the `runas` verb and `--fix-firewall`, which shows one UAC prompt, and that copy mends the rules and exits
//! (record/areas/install/01-installing-and-updating.md, "The firewall rule").

use std::path::Path;

use messages::desktop::Firewall;
use windows::Win32::Foundation::VARIANT_TRUE;
use windows::Win32::NetworkManagement::WindowsFirewall::{
    INetFwPolicy2, INetFwRule, INetFwRules, NET_FW_ACTION_ALLOW, NET_FW_IP_PROTOCOL_ANY,
    NET_FW_IP_PROTOCOL_UDP, NET_FW_PROFILE2_ALL, NET_FW_RULE_DIR_IN, NetFwPolicy2, NetFwRule,
};
use windows::Win32::System::Com::{
    CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoUninitialize,
};
use windows::Win32::System::Ole::IEnumVARIANT;
use windows::Win32::System::Variant::{VARIANT, VT_DISPATCH, VariantClear};
use windows::core::{BSTR, Interface};
use windows_sys::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
use windows_sys::Win32::System::Threading::{GetExitCodeProcess, INFINITE, WaitForSingleObject};
use windows_sys::Win32::UI::Shell::{SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW, ShellExecuteExW};
use windows_sys::Win32::UI::WindowsAndMessaging::SW_HIDE;

use crate::places::same_path;

/// The flag the app runs its elevated copy with.
pub const FIX_FLAG: &str = "--fix-firewall";
/// Our rule's name, as Windows' list of rules shows it.
const RULE: &str = "Dual Input";

/// One rule as far as the check reads it.
#[derive(Clone, Debug, PartialEq)]
pub struct Rule {
    pub program: String,
    pub allows: bool,
    pub inbound: bool,
    pub enabled: bool,
    /// UDP, or any protocol.
    pub udp: bool,
}

/// Whether the rules let the core take connections: one allows UDP into it, and none blocks it.
pub fn judge(rules: &[Rule], core: &Path) -> Firewall {
    let ours =
        |rule: &&Rule| rule.inbound && rule.enabled && same_path(Path::new(&rule.program), core);
    let blocked = rules.iter().filter(ours).any(|rule| !rule.allows);
    let allowed = rules
        .iter()
        .filter(ours)
        .any(|rule| rule.allows && rule.udp);
    if allowed && !blocked {
        Firewall::Allows
    } else {
        Firewall::Blocks
    }
}

/// COM on this thread for as long as this lives.
struct Com;

impl Com {
    fn start() -> Result<Self, String> {
        // SAFETY: COM is started on this thread and stopped when `Com` drops, on the same thread.
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }
            .ok()
            .map_err(|error| error.to_string())?;
        Ok(Self)
    }
}

impl Drop for Com {
    fn drop(&mut self) {
        // SAFETY: this thread started COM in `start`.
        unsafe { CoUninitialize() };
    }
}

fn rules_collection() -> Result<INetFwRules, String> {
    // SAFETY: COM runs on this thread, and the class and interface are Windows Firewall's own.
    unsafe {
        let policy: INetFwPolicy2 = CoCreateInstance(&NetFwPolicy2, None, CLSCTX_INPROC_SERVER)
            .map_err(|e| e.to_string())?;
        policy.Rules().map_err(|e| e.to_string())
    }
}

/// Every rule, as COM objects with what the check reads of each.
fn each_rule(rules: &INetFwRules) -> Result<Vec<(INetFwRule, Rule)>, String> {
    let mut all = Vec::new();
    // SAFETY: COM runs on this thread; each VARIANT the enumerator fills is cleared after it's read.
    unsafe {
        let walk: IEnumVARIANT = rules
            ._NewEnum()
            .map_err(|e| e.to_string())?
            .cast()
            .map_err(|e| e.to_string())?;
        loop {
            let mut item = [VARIANT::default()];
            let mut fetched = 0;
            if walk.Next(&mut item, &mut fetched).is_err() || fetched == 0 {
                break;
            }
            let read = (|| {
                let inner = &item[0].Anonymous.Anonymous;
                if inner.vt != VT_DISPATCH {
                    return None;
                }
                let rule: INetFwRule = (*inner.Anonymous.pdispVal).as_ref()?.cast().ok()?;
                let protocol = rule.Protocol().ok()?;
                let found = Rule {
                    program: rule
                        .ApplicationName()
                        .map(|name| name.to_string())
                        .unwrap_or_default(),
                    allows: rule.Action().ok()? == NET_FW_ACTION_ALLOW,
                    inbound: rule.Direction().ok()? == NET_FW_RULE_DIR_IN,
                    enabled: rule.Enabled().ok()? == VARIANT_TRUE,
                    udp: protocol == NET_FW_IP_PROTOCOL_UDP.0
                        || protocol == NET_FW_IP_PROTOCOL_ANY.0,
                };
                Some((rule, found))
            })();
            let _ = VariantClear(&mut item[0]);
            all.extend(read);
        }
    }
    Ok(all)
}

/// Reads the rules for `core`, which a program with no administrator did, all 896 of our development machine's (measured,
/// 2026-10-18, record/areas/install/results/2026-10-18-windows-and-msfs-facts.txt). It blocks, so it runs on a thread of its
/// own.
pub fn read(core: &Path) -> Result<Firewall, String> {
    let _com = Com::start()?;
    let rules = each_rule(&rules_collection()?)?;
    let found: Vec<Rule> = rules.into_iter().map(|(_, rule)| rule).collect();
    Ok(judge(&found, core))
}

/// What the elevated copy does: adds an inbound rule allowing UDP to `core`, by its whole path, on every network profile,
/// unless one is there, and deletes every block rule naming it. A rule is deleted by its name, which another rule can share,
/// so each block rule takes a name of its own first.
pub fn fix(core: &Path) -> Result<(), String> {
    let _com = Com::start()?;
    let rules = rules_collection()?;
    let found = each_rule(&rules)?;
    let mut allowed = false;
    for (n, (com, rule)) in found.iter().enumerate() {
        if !rule.inbound || !same_path(Path::new(&rule.program), core) {
            continue;
        }
        if rule.allows {
            allowed |= rule.enabled && rule.udp;
            continue;
        }
        let name = BSTR::from(format!("Dual Input block {} {n}", std::process::id()));
        // SAFETY: COM runs on this thread, and the rule came from the collection.
        unsafe {
            com.SetName(&name).map_err(|e| e.to_string())?;
            rules.Remove(&name).map_err(|e| e.to_string())?;
        }
    }
    if allowed {
        return Ok(());
    }
    // SAFETY: COM runs on this thread, and the class is Windows Firewall's rule.
    unsafe {
        let rule: INetFwRule =
            CoCreateInstance(&NetFwRule, None, CLSCTX_INPROC_SERVER).map_err(|e| e.to_string())?;
        rule.SetName(&BSTR::from(RULE)).map_err(|e| e.to_string())?;
        rule.SetApplicationName(&BSTR::from(core.to_string_lossy().as_ref()))
            .map_err(|e| e.to_string())?;
        rule.SetProtocol(NET_FW_IP_PROTOCOL_UDP.0)
            .map_err(|e| e.to_string())?;
        rule.SetDirection(NET_FW_RULE_DIR_IN)
            .map_err(|e| e.to_string())?;
        rule.SetAction(NET_FW_ACTION_ALLOW)
            .map_err(|e| e.to_string())?;
        rule.SetProfiles(NET_FW_PROFILE2_ALL.0)
            .map_err(|e| e.to_string())?;
        rule.SetEnabled(VARIANT_TRUE).map_err(|e| e.to_string())?;
        rules.Add(&rule).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Runs this program elevated with `--fix-firewall`, which shows the UAC prompt, and waits for it. It says whether the
/// rules were mended: a pilot who declines the prompt leaves them as they were. It blocks, so it runs on a thread of its
/// own.
pub fn run_elevated() -> bool {
    let Ok(program) = std::env::current_exe() else {
        return false;
    };
    let wide = |text: &str| -> Vec<u16> { text.encode_utf16().chain(std::iter::once(0)).collect() };
    let (verb, file, flag) = (
        wide("runas"),
        wide(&program.to_string_lossy()),
        wide(FIX_FLAG),
    );
    let mut info = SHELLEXECUTEINFOW {
        cbSize: size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS,
        lpVerb: verb.as_ptr(),
        lpFile: file.as_ptr(),
        lpParameters: flag.as_ptr(),
        nShow: SW_HIDE,
        ..Default::default()
    };
    // SAFETY: the strings are NUL-terminated and outlive the call, and `info` names its own size.
    if unsafe { ShellExecuteExW(&mut info) } == 0 || info.hProcess.is_null() {
        crate::log::line("the firewall's fix didn't run: the UAC prompt was declined or failed");
        return false;
    }
    let mut code = 1;
    // SAFETY: the process handle stays open until it's closed below.
    unsafe {
        if WaitForSingleObject(info.hProcess, INFINITE) == WAIT_OBJECT_0 {
            GetExitCodeProcess(info.hProcess, &mut code);
        }
        CloseHandle(info.hProcess);
    }
    if code != 0 {
        crate::log::line(&format!("the firewall's fix exited with {code}"));
    }
    code == 0
}

/// The elevated copy's whole run: it mends the rules for the core beside it and exits with 0, or with 1 and the error in the
/// log, which it opens itself, since it runs before the app's own start opens it.
pub fn fix_and_exit() -> ! {
    crate::log::start();
    let core = crate::places::core_program();
    match fix(&core) {
        Ok(()) => std::process::exit(0),
        Err(error) => {
            crate::log::line(&format!(
                "the firewall's rules for {} weren't mended: {error}",
                core.display()
            ));
            std::process::exit(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CORE: &str = r"C:\Users\Pilot\AppData\Local\DualInput\current\dualinput-core.exe";

    fn rule(program: &str, allows: bool) -> Rule {
        Rule {
            program: program.into(),
            allows,
            inbound: true,
            enabled: true,
            udp: true,
        }
    }

    #[test]
    fn an_allow_rule_for_the_core_allows_it_whatever_its_case() {
        let rules = [rule(&CORE.to_uppercase(), true)];
        assert_eq!(judge(&rules, Path::new(CORE)), Firewall::Allows);
    }

    #[test]
    fn no_rule_or_a_block_rule_blocks_it() {
        assert_eq!(judge(&[], Path::new(CORE)), Firewall::Blocks);
        let rules = [rule(CORE, true), rule(CORE, false)];
        assert_eq!(judge(&rules, Path::new(CORE)), Firewall::Blocks);
    }

    #[test]
    fn rules_that_dont_reach_the_core_say_nothing() {
        let mut outbound = rule(CORE, true);
        outbound.inbound = false;
        let mut off = rule(CORE, true);
        off.enabled = false;
        let mut tcp = rule(CORE, true);
        tcp.udp = false;
        let mut off_block = rule(CORE, false);
        off_block.enabled = false;
        for rules in [
            vec![outbound],
            vec![off],
            vec![tcp],
            vec![rule(r"C:\other.exe", true)],
        ] {
            assert_eq!(judge(&rules, Path::new(CORE)), Firewall::Blocks);
        }
        assert_eq!(
            judge(&[rule(CORE, true), off_block], Path::new(CORE)),
            Firewall::Allows
        );
    }

    #[test]
    fn the_rules_read_with_no_administrator() {
        assert_eq!(read(Path::new(CORE)), Ok(Firewall::Blocks));
    }
}
