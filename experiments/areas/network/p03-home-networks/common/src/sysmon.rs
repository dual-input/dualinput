//! The PC's side of the record: CPU and memory each second, the network adapters and Wi-Fi
//! signal every 10s and on every change Windows reports, sleep and resume, and the Windows
//! version. It records no SSID, BSSID, MAC address, or file path, because the consent screen
//! names none of them.

#[cfg(not(windows))]
use serde_json::json;

#[cfg(not(windows))]
use crate::rawlog::RawLog;

#[cfg(windows)]
pub use win::*;

#[cfg(not(windows))]
pub fn start_monitors(_log: RawLog) {}
#[cfg(not(windows))]
pub fn keep_awake(_on: bool) {}
#[cfg(not(windows))]
pub fn tune_process() {}
#[cfg(not(windows))]
pub fn snapshot(log: &RawLog) {
    log.rec("system", json!({"os": std::env::consts::OS}));
}
#[cfg(not(windows))]
pub fn gateways() -> Vec<std::net::IpAddr> {
    Vec::new()
}

#[cfg(windows)]
mod win {
    use std::ffi::c_void;
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
    use std::sync::OnceLock;
    use std::sync::mpsc;
    use std::time::Duration;

    use serde_json::{Value, json};
    use windows_sys::Win32::Foundation::{FILETIME, HANDLE};
    use windows_sys::Win32::NetworkManagement::IpHelper::*;
    use windows_sys::Win32::NetworkManagement::WiFi::*;
    use windows_sys::Win32::Networking::WinSock::{
        AF_INET, AF_INET6, AF_UNSPEC, SOCKADDR, SOCKADDR_IN, SOCKADDR_IN6, SOCKADDR_INET,
    };
    use windows_sys::Win32::System::Power::*;
    use windows_sys::Win32::System::Registry::*;
    use windows_sys::Win32::System::SystemInformation::*;
    use windows_sys::Win32::System::Threading::*;

    use crate::rawlog::RawLog;

    static LOG: OnceLock<RawLog> = OnceLock::new();
    static AWAKE: OnceLock<mpsc::Sender<bool>> = OnceLock::new();

    fn ft(f: &FILETIME) -> u64 {
        ((f.dwHighDateTime as u64) << 32) | f.dwLowDateTime as u64
    }

    unsafe fn wstr(p: *const u16) -> String {
        if p.is_null() {
            return String::new();
        }
        let mut n = 0;
        // SAFETY: the caller passes a NUL-terminated wide string from Windows.
        unsafe {
            while *p.add(n) != 0 {
                n += 1;
            }
            String::from_utf16_lossy(std::slice::from_raw_parts(p, n))
        }
    }

    fn wbuf(s: &[u16]) -> String {
        let n = s.iter().position(|&c| c == 0).unwrap_or(s.len());
        String::from_utf16_lossy(&s[..n])
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    unsafe fn sockaddr_ip(sa: *const SOCKADDR) -> Option<IpAddr> {
        if sa.is_null() {
            return None;
        }
        // SAFETY: Windows hands a SOCKADDR whose family says which struct it is.
        unsafe {
            match (*sa).sa_family {
                AF_INET => {
                    let s = &*(sa as *const SOCKADDR_IN);
                    Some(IpAddr::V4(Ipv4Addr::from(s.sin_addr.S_un.S_addr.to_ne_bytes())))
                }
                AF_INET6 => {
                    let s = &*(sa as *const SOCKADDR_IN6);
                    Some(IpAddr::V6(Ipv6Addr::from(s.sin6_addr.u.Byte)))
                }
                _ => None,
            }
        }
    }

    unsafe fn sockaddr_inet_ip(sa: &SOCKADDR_INET) -> Option<IpAddr> {
        // SAFETY: si_family overlaps both variants' family field.
        unsafe { sockaddr_ip(sa as *const SOCKADDR_INET as *const SOCKADDR) }
    }

    /// Keeps Windows from sleeping while the probe runs, and lets it sleep again after.
    /// `SetThreadExecutionState` holds only while the thread that called it lives, so one
    /// thread of our own makes every call.
    pub fn keep_awake(on: bool) {
        let tx = AWAKE.get_or_init(|| {
            let (tx, rx) = mpsc::channel::<bool>();
            std::thread::spawn(move || {
                for on in rx {
                    let flags = if on { ES_CONTINUOUS | ES_SYSTEM_REQUIRED } else { ES_CONTINUOUS };
                    // SAFETY: plain call with flags.
                    unsafe { SetThreadExecutionState(flags) };
                }
            });
            tx
        });
        let _ = tx.send(on);
    }

    /// Asks Windows for 1ms timer resolution and opts out of power throttling, so the 20ms
    /// audio stream goes out every 20ms. Windows' default tick is 15.6ms, and Windows 11 can
    /// ignore a background process's resolution request unless it opts out.
    pub fn tune_process() {
        // SAFETY: plain calls; the state struct outlives the call.
        unsafe {
            windows_sys::Win32::Media::timeBeginPeriod(1);
            let state = PROCESS_POWER_THROTTLING_STATE {
                Version: PROCESS_POWER_THROTTLING_CURRENT_VERSION,
                ControlMask: PROCESS_POWER_THROTTLING_EXECUTION_SPEED
                    | PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION,
                StateMask: 0,
            };
            SetProcessInformation(
                GetCurrentProcess(),
                ProcessPowerThrottling,
                &state as *const _ as *const c_void,
                std::mem::size_of::<PROCESS_POWER_THROTTLING_STATE>() as u32,
            );
        }
    }

    fn reg_str(sub: &str, name: &str) -> Option<String> {
        let (sub, name) = (wide(sub), wide(name));
        let mut buf = vec![0u16; 512];
        let mut size = (buf.len() * 2) as u32;
        // SAFETY: the buffer and its size in bytes are valid for the call.
        let r = unsafe {
            RegGetValueW(
                HKEY_LOCAL_MACHINE,
                sub.as_ptr(),
                name.as_ptr(),
                RRF_RT_REG_SZ,
                std::ptr::null_mut(),
                buf.as_mut_ptr() as *mut c_void,
                &mut size,
            )
        };
        (r == 0).then(|| wbuf(&buf))
    }

    fn reg_dword(sub: &str, name: &str) -> Option<u32> {
        let (sub, name) = (wide(sub), wide(name));
        let mut v: u32 = 0;
        let mut size = 4u32;
        // SAFETY: as above, for one DWORD.
        let r = unsafe {
            RegGetValueW(
                HKEY_LOCAL_MACHINE,
                sub.as_ptr(),
                name.as_ptr(),
                RRF_RT_REG_DWORD,
                std::ptr::null_mut(),
                &mut v as *mut u32 as *mut c_void,
                &mut size,
            )
        };
        (r == 0).then_some(v)
    }

    pub fn windows_version() -> Value {
        let mut v: OSVERSIONINFOW = unsafe { std::mem::zeroed() };
        v.dwOSVersionInfoSize = std::mem::size_of::<OSVERSIONINFOW>() as u32;
        // SAFETY: the struct's size field is set as the call requires.
        unsafe { windows_sys::Wdk::System::SystemServices::RtlGetVersion(&mut v) };
        let key = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion";
        let mut si: SYSTEM_INFO = unsafe { std::mem::zeroed() };
        // SAFETY: writes one struct.
        unsafe { GetNativeSystemInfo(&mut si) };
        json!({
            "major": v.dwMajorVersion, "minor": v.dwMinorVersion, "build": v.dwBuildNumber,
            "ubr": reg_dword(key, "UBR"),
            "display_version": reg_str(key, "DisplayVersion"),
            "product": reg_str(key, "ProductName"),
            "edition": reg_str(key, "EditionID"),
            "cpus": si.dwNumberOfProcessors,
        })
    }

    /// Every adapter Windows reports, with its addresses and gateways. It leaves out MAC
    /// addresses.
    pub fn adapters() -> Value {
        let flags = GAA_FLAG_INCLUDE_GATEWAYS | GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST | GAA_FLAG_SKIP_DNS_SERVER;
        let mut size: u32 = 32 * 1024;
        let mut buf: Vec<u64>;
        loop {
            buf = vec![0u64; (size as usize).div_ceil(8)];
            // SAFETY: the buffer holds `size` bytes, aligned for the structs.
            let r = unsafe {
                GetAdaptersAddresses(
                    AF_UNSPEC as u32,
                    flags,
                    std::ptr::null(),
                    buf.as_mut_ptr() as *mut IP_ADAPTER_ADDRESSES_LH,
                    &mut size,
                )
            };
            if r == 111 {
                continue;
            }
            if r != 0 {
                return json!({"error": r});
            }
            break;
        }
        let mut out = Vec::new();
        let mut p = buf.as_ptr() as *const IP_ADAPTER_ADDRESSES_LH;
        while !p.is_null() {
            // SAFETY: walking the linked list Windows filled in.
            let a = unsafe { &*p };
            let mut addrs = Vec::new();
            let mut u = a.FirstUnicastAddress;
            while !u.is_null() {
                let ua = unsafe { &*u };
                if let Some(ip) = unsafe { sockaddr_ip(ua.Address.lpSockaddr) } {
                    addrs.push(json!({
                        "ip": ip.to_string(), "prefix": ua.OnLinkPrefixLength,
                        "prefix_origin": ua.PrefixOrigin, "suffix_origin": ua.SuffixOrigin,
                        "dad": ua.DadState, "valid_s": ua.ValidLifetime, "preferred_s": ua.PreferredLifetime,
                    }));
                }
                u = ua.Next;
            }
            let mut gws = Vec::new();
            let mut g = a.FirstGatewayAddress;
            while !g.is_null() {
                let ga = unsafe { &*g };
                if let Some(ip) = unsafe { sockaddr_ip(ga.Address.lpSockaddr) } {
                    gws.push(ip.to_string());
                }
                g = ga.Next;
            }
            out.push(json!({
                "if_index": unsafe { a.Anonymous1.Anonymous.IfIndex },
                "name": unsafe { wstr(a.FriendlyName) },
                "description": unsafe { wstr(a.Description) },
                "if_type": a.IfType, "oper_status": a.OperStatus,
                "tx_bps": a.TransmitLinkSpeed, "rx_bps": a.ReceiveLinkSpeed,
                "mtu": a.Mtu, "v4_metric": a.Ipv4Metric, "v6_metric": a.Ipv6Metric,
                "tunnel_type": a.TunnelType, "connection_type": a.ConnectionType,
                "addrs": addrs, "gateways": gws,
            }));
            p = a.Next;
        }
        Value::Array(out)
    }

    pub fn gateways() -> Vec<IpAddr> {
        let mut out = Vec::new();
        if let Value::Array(list) = adapters() {
            for a in list {
                if a["oper_status"] != 1 {
                    continue;
                }
                if let Some(g) = a["gateways"].as_array() {
                    for x in g {
                        if let Some(ip) = x.as_str().and_then(|s| s.parse().ok()) {
                            out.push(ip);
                        }
                    }
                }
            }
        }
        out
    }

    /// The gateway's hardware vendor, from the first 3 bytes of its MAC address, which name the
    /// maker and not the device.
    pub fn gateway_ouis() -> Value {
        let gws = gateways();
        let mut table: *mut MIB_IPNET_TABLE2 = std::ptr::null_mut();
        // SAFETY: Windows allocates the table, and FreeMibTable releases it below.
        if unsafe { GetIpNetTable2(AF_UNSPEC, &mut table) } != 0 || table.is_null() {
            return Value::Null;
        }
        let mut out = Vec::new();
        unsafe {
            let n = (*table).NumEntries as usize;
            let rows = std::slice::from_raw_parts((*table).Table.as_ptr(), n);
            for r in rows {
                if let Some(ip) = sockaddr_inet_ip(&r.Address) {
                    if gws.contains(&ip) && r.PhysicalAddressLength >= 3 {
                        let m = &r.PhysicalAddress;
                        out.push(json!({"gateway": ip.to_string(), "oui": format!("{:02x}:{:02x}:{:02x}", m[0], m[1], m[2])}));
                    }
                }
            }
            FreeMibTable(table as *const c_void);
        }
        Value::Array(out)
    }

    /// Signal quality (0 to 100), RSSI in dBm, PHY type, rates, and channel for each Wi-Fi
    /// interface; Windows 11 may refuse these without the location permission, and the error
    /// goes in the record.
    pub fn wifi() -> Value {
        let mut ver = 0u32;
        let mut h: HANDLE = std::ptr::null_mut();
        // SAFETY: plain open; closed at the end.
        let r = unsafe { WlanOpenHandle(2, std::ptr::null(), &mut ver, &mut h) };
        if r != 0 {
            return json!({"error": r});
        }
        let mut out = Vec::new();
        unsafe {
            let mut list: *mut WLAN_INTERFACE_INFO_LIST = std::ptr::null_mut();
            if WlanEnumInterfaces(h, std::ptr::null(), &mut list) == 0 && !list.is_null() {
                let n = (*list).dwNumberOfItems as usize;
                let infos = std::slice::from_raw_parts((*list).InterfaceInfo.as_ptr(), n);
                for info in infos {
                    let mut o = serde_json::Map::new();
                    o.insert("description".into(), json!(wbuf(&info.strInterfaceDescription)));
                    o.insert("state".into(), json!(info.isState));
                    let mut size = 0u32;
                    let mut data: *mut c_void = std::ptr::null_mut();
                    let r = WlanQueryInterface(h, &info.InterfaceGuid, wlan_intf_opcode_current_connection, std::ptr::null(), &mut size, &mut data, std::ptr::null_mut());
                    if r == 0 && !data.is_null() {
                        let c = &*(data as *const WLAN_CONNECTION_ATTRIBUTES);
                        let a = &c.wlanAssociationAttributes;
                        o.insert("signal_quality".into(), json!(a.wlanSignalQuality));
                        o.insert("phy".into(), json!(a.dot11PhyType));
                        o.insert("rx_kbps".into(), json!(a.ulRxRate));
                        o.insert("tx_kbps".into(), json!(a.ulTxRate));
                        o.insert("bss_type".into(), json!(a.dot11BssType));
                        WlanFreeMemory(data);
                    } else {
                        o.insert("connection_error".into(), json!(r));
                    }
                    let mut data: *mut c_void = std::ptr::null_mut();
                    let r = WlanQueryInterface(h, &info.InterfaceGuid, wlan_intf_opcode_rssi, std::ptr::null(), &mut size, &mut data, std::ptr::null_mut());
                    if r == 0 && !data.is_null() {
                        o.insert("rssi_dbm".into(), json!(*(data as *const i32)));
                        WlanFreeMemory(data);
                    } else {
                        o.insert("rssi_error".into(), json!(r));
                    }
                    let mut data: *mut c_void = std::ptr::null_mut();
                    let r = WlanQueryInterface(h, &info.InterfaceGuid, wlan_intf_opcode_channel_number, std::ptr::null(), &mut size, &mut data, std::ptr::null_mut());
                    if r == 0 && !data.is_null() {
                        o.insert("channel".into(), json!(*(data as *const u32)));
                        WlanFreeMemory(data);
                    }
                    out.push(Value::Object(o));
                }
                WlanFreeMemory(list as *const c_void);
            }
            WlanCloseHandle(h, std::ptr::null());
        }
        Value::Array(out)
    }

    /// Runs a console command with no window and returns its output.
    fn quiet(cmd: &str, args: &[&str]) -> String {
        use std::os::windows::process::CommandExt;
        std::process::Command::new(cmd)
            .args(args)
            .creation_flags(0x0800_0000)
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
            .unwrap_or_else(|e| format!("error: {e}"))
    }

    /// Windows Firewall's state and the rules it holds for this program, with the program's
    /// path, which holds the user's folder name, replaced by `<exe>`.
    pub fn firewall() -> Value {
        let exe = std::env::current_exe().map(|p| p.display().to_string()).unwrap_or_default();
        let state = quiet("netsh", &["advfirewall", "show", "allprofiles", "state"]);
        let rules = quiet("netsh", &["advfirewall", "firewall", "show", "rule", "name=all", "verbose"]);
        // netsh may print the path in other letter case than current_exe, so the match and the
        // replacement both ignore case, line by line.
        let mut ours = Vec::new();
        if !exe.is_empty() {
            let lower = exe.to_lowercase();
            for block in rules.split("\r\n\r\n") {
                if block.to_lowercase().contains(&lower) {
                    let cleaned: Vec<String> = block
                        .lines()
                        .map(|l| if l.to_lowercase().contains(&lower) { l.to_lowercase().replace(&lower, "<exe>") } else { l.to_string() })
                        .collect();
                    ours.push(cleaned.join("\r\n"));
                }
            }
        }
        let profile = quiet(
            "powershell",
            &["-NoProfile", "-Command", "Get-NetConnectionProfile | Select-Object InterfaceIndex,NetworkCategory,IPv4Connectivity,IPv6Connectivity | ConvertTo-Json -Compress"],
        );
        json!({"state": state, "rules": ours, "profile": profile.trim()})
    }

    /// Whether the Windows Time service runs and what it last synced to, which decides whether
    /// the system clock recorded beside the counter is steered at all.
    pub fn time_service() -> Value {
        json!({
            "status": quiet("w32tm", &["/query", "/status", "/verbose"]),
            "service": quiet("sc", &["query", "w32time"]),
        })
    }

    pub fn snapshot(log: &RawLog) {
        log.rec("system", json!({"windows": windows_version()}));
        log.rec("net", json!({"why": "start", "adapters": adapters(), "wifi": wifi(), "gateway_oui": gateway_ouis()}));
    }

    unsafe extern "system" fn on_if_change(_ctx: *const c_void, row: *const MIB_IPINTERFACE_ROW, ty: MIB_NOTIFICATION_TYPE) {
        if let Some(log) = LOG.get() {
            let (idx, fam) = if row.is_null() { (0, 0) } else { unsafe { ((*row).InterfaceIndex, (*row).Family) } };
            log.rec("netchange", json!({"what": "interface", "type": ty, "if_index": idx, "family": fam}));
        }
    }

    unsafe extern "system" fn on_addr_change(_ctx: *const c_void, row: *const MIB_UNICASTIPADDRESS_ROW, ty: MIB_NOTIFICATION_TYPE) {
        if let Some(log) = LOG.get() {
            let (ip, idx) = if row.is_null() {
                (None, 0)
            } else {
                unsafe { (sockaddr_inet_ip(&(*row).Address).map(|i| i.to_string()), (*row).InterfaceIndex) }
            };
            log.rec("netchange", json!({"what": "address", "type": ty, "ip": ip, "if_index": idx}));
        }
    }

    unsafe extern "system" fn on_power(_ctx: *const c_void, ty: u32, _setting: *const c_void) -> u32 {
        if let Some(log) = LOG.get() {
            let what = match ty {
                4 => "suspend",
                7 => "resume_by_user",
                0x12 => "resume_automatic",
                0x0a => "power_status_change",
                _ => "other",
            };
            log.rec("power", json!({"type": ty, "what": what}));
        }
        0
    }

    /// Starts the samplers and registers for network-change and sleep notices, which Windows
    /// calls on threads of its own.
    pub fn start_monitors(log: RawLog) {
        let _ = LOG.set(log.clone());
        unsafe {
            let mut h1: HANDLE = std::ptr::null_mut();
            let r1 = NotifyIpInterfaceChange(AF_UNSPEC, Some(on_if_change), std::ptr::null(), false, &mut h1);
            let mut h2: HANDLE = std::ptr::null_mut();
            let r2 = NotifyUnicastIpAddressChange(AF_UNSPEC, Some(on_addr_change), std::ptr::null(), false, &mut h2);
            let params = Box::leak(Box::new(DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS {
                Callback: Some(on_power),
                Context: std::ptr::null_mut(),
            }));
            let mut h3: *mut c_void = std::ptr::null_mut();
            let r3 = PowerRegisterSuspendResumeNotification(
                2,
                params as *mut DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS as HANDLE,
                &mut h3,
            );
            log.rec("monitors", json!({"if_change": r1, "addr_change": r2, "power": r3}));
        }
        std::thread::Builder::new()
            .name("sysmon".into())
            .spawn(move || sampler(log))
            .ok();
    }

    fn sampler(log: RawLog) {
        let mut prev: Option<(u64, u64, u64, u64, u64)> = None;
        let mut tick: u64 = 0;
        let mut last = std::time::Instant::now();
        loop {
            std::thread::sleep(Duration::from_secs(1));
            let gap = last.elapsed();
            last = std::time::Instant::now();
            if gap > Duration::from_secs(3) {
                log.rec("stall", json!({"gap_ms": gap.as_millis() as u64}));
            }
            let (mut i, mut k, mut u) = unsafe { (std::mem::zeroed::<FILETIME>(), std::mem::zeroed::<FILETIME>(), std::mem::zeroed::<FILETIME>()) };
            let (mut pc, mut pe, mut pk, mut pu) = unsafe { (std::mem::zeroed::<FILETIME>(), std::mem::zeroed::<FILETIME>(), std::mem::zeroed::<FILETIME>(), std::mem::zeroed::<FILETIME>()) };
            let mut m: MEMORYSTATUSEX = unsafe { std::mem::zeroed() };
            m.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
            // SAFETY: each call writes its own structs.
            unsafe {
                GetSystemTimes(&mut i, &mut k, &mut u);
                GetProcessTimes(GetCurrentProcess(), &mut pc, &mut pe, &mut pk, &mut pu);
                GlobalMemoryStatusEx(&mut m);
            }
            let now = (ft(&i), ft(&k), ft(&u), ft(&pk), ft(&pu));
            if let Some(p) = prev {
                let idle = now.0.saturating_sub(p.0) as f64;
                let total = (now.1.saturating_sub(p.1) + now.2.saturating_sub(p.2)) as f64;
                let ours = (now.3.saturating_sub(p.3) + now.4.saturating_sub(p.4)) as f64;
                let cpu = if total > 0.0 { 100.0 * (total - idle) / total } else { 0.0 };
                let own = if total > 0.0 { 100.0 * ours / total } else { 0.0 };
                log.rec("load", json!({
                    "cpu_pct": (cpu * 10.0).round() / 10.0, "own_cpu_pct": (own * 10.0).round() / 10.0,
                    "mem_pct": m.dwMemoryLoad, "mem_avail_mb": m.ullAvailPhys / (1 << 20), "mem_total_mb": m.ullTotalPhys / (1 << 20),
                }));
            }
            prev = Some(now);
            tick += 1;
            if tick % 10 == 0 {
                log.rec("net", json!({"why": "periodic", "adapters": adapters(), "wifi": wifi()}));
            }
        }
    }
}
