//! A STUN Binding request and the parts of a response we read (RFC 5389), written by hand so
//! the raw bytes of each answer can go in the file.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};

const MAGIC_COOKIE: u32 = 0x2112_A442;

pub fn binding_request(txid: [u8; 12]) -> [u8; 20] {
    let mut b = [0u8; 20];
    b[0..2].copy_from_slice(&0x0001u16.to_be_bytes());
    b[4..8].copy_from_slice(&MAGIC_COOKIE.to_be_bytes());
    b[8..20].copy_from_slice(&txid);
    b
}

#[derive(Debug, Default, Clone)]
pub struct Response {
    pub txid: [u8; 12],
    pub mapped: Option<SocketAddr>,
    pub other_address: Option<SocketAddr>,
    pub response_origin: Option<SocketAddr>,
    pub software: Option<String>,
}

pub fn parse_response(b: &[u8]) -> Option<Response> {
    if b.len() < 20 || u16::from_be_bytes([b[0], b[1]]) != 0x0101 {
        return None;
    }
    if u32::from_be_bytes(b[4..8].try_into().ok()?) != MAGIC_COOKIE {
        return None;
    }
    let len = u16::from_be_bytes([b[2], b[3]]) as usize;
    let mut r = Response { txid: b[8..20].try_into().ok()?, ..Default::default() };
    let end = (20 + len).min(b.len());
    let mut i = 20;
    while i + 4 <= end {
        let ty = u16::from_be_bytes([b[i], b[i + 1]]);
        let alen = u16::from_be_bytes([b[i + 2], b[i + 3]]) as usize;
        let v = &b[i + 4..(i + 4 + alen).min(end)];
        match ty {
            0x0020 | 0x8020 => r.mapped = xor_addr(v, &b[4..20]).or(r.mapped),
            0x0001 => {
                if r.mapped.is_none() {
                    r.mapped = plain_addr(v)
                }
            }
            0x802c => r.other_address = plain_addr(v),
            0x802b => r.response_origin = plain_addr(v),
            0x8022 => r.software = Some(String::from_utf8_lossy(v).into_owned()),
            _ => {}
        }
        i += 4 + ((alen + 3) & !3);
    }
    Some(r)
}

fn plain_addr(v: &[u8]) -> Option<SocketAddr> {
    if v.len() < 8 {
        return None;
    }
    let port = u16::from_be_bytes([v[2], v[3]]);
    match v[1] {
        1 => Some(SocketAddr::new(IpAddr::V4(Ipv4Addr::new(v[4], v[5], v[6], v[7])), port)),
        2 if v.len() >= 20 => {
            let a: [u8; 16] = v[4..20].try_into().ok()?;
            Some(SocketAddr::new(IpAddr::V6(Ipv6Addr::from(a)), port))
        }
        _ => None,
    }
}

// `cookie_txid` is the 16 bytes of magic cookie and transaction ID an IPv6 address is XORed
// with; an IPv4 address uses only the cookie's 4.
fn xor_addr(v: &[u8], cookie_txid: &[u8]) -> Option<SocketAddr> {
    if v.len() < 8 {
        return None;
    }
    let port = u16::from_be_bytes([v[2], v[3]]) ^ (MAGIC_COOKIE >> 16) as u16;
    match v[1] {
        1 => {
            let mut a = [0u8; 4];
            for k in 0..4 {
                a[k] = v[4 + k] ^ cookie_txid[k];
            }
            Some(SocketAddr::new(IpAddr::V4(Ipv4Addr::from(a)), port))
        }
        2 if v.len() >= 20 => {
            let mut a = [0u8; 16];
            for k in 0..16 {
                a[k] = v[4 + k] ^ cookie_txid[k];
            }
            Some(SocketAddr::new(IpAddr::V6(Ipv6Addr::from(a)), port))
        }
        _ => None,
    }
}

/// The station's answer: a Binding success response carrying XOR-MAPPED-ADDRESS.
pub fn binding_response(req: &[u8], from: SocketAddr) -> Option<Vec<u8>> {
    if req.len() < 20 || u16::from_be_bytes([req[0], req[1]]) != 0x0001 {
        return None;
    }
    if u32::from_be_bytes(req[4..8].try_into().ok()?) != MAGIC_COOKIE {
        return None;
    }
    let cookie_txid = &req[4..20];
    let mut attr = Vec::new();
    let port = from.port() ^ (MAGIC_COOKIE >> 16) as u16;
    match from.ip() {
        IpAddr::V4(ip) => {
            attr.extend_from_slice(&[0, 1]);
            attr.extend_from_slice(&port.to_be_bytes());
            for (k, o) in ip.octets().iter().enumerate() {
                attr.push(o ^ cookie_txid[k]);
            }
        }
        IpAddr::V6(ip) => {
            attr.extend_from_slice(&[0, 2]);
            attr.extend_from_slice(&port.to_be_bytes());
            for (k, o) in ip.octets().iter().enumerate() {
                attr.push(o ^ cookie_txid[k]);
            }
        }
    }
    let mut b = Vec::with_capacity(24 + attr.len());
    b.extend_from_slice(&0x0101u16.to_be_bytes());
    b.extend_from_slice(&((4 + attr.len()) as u16).to_be_bytes());
    b.extend_from_slice(&req[4..20]);
    b.extend_from_slice(&0x0020u16.to_be_bytes());
    b.extend_from_slice(&(attr.len() as u16).to_be_bytes());
    b.extend_from_slice(&attr);
    Some(b)
}

pub fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}
