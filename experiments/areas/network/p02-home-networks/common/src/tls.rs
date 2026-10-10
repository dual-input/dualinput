//! TLS setups: our own certificate authority for the stations and relays, and for the QUIC
//! link through the UDP forwarder, a peer's throwaway certificate that the tester doesn't
//! check, since the probe needs neither secrecy nor proof of who answered.

use std::sync::Arc;
use std::time::Duration;

use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::{CryptoProvider, verify_tls12_signature, verify_tls13_signature};
use rustls::pki_types::{CertificateDer, PrivateKeyDer, ServerName, UnixTime};
use rustls::{DigitallySignedStruct, SignatureScheme};

pub fn provider() -> Arc<CryptoProvider> {
    Arc::new(rustls::crypto::ring::default_provider())
}

pub fn client_with_ca(ca: CertificateDer<'static>) -> anyhow::Result<rustls::ClientConfig> {
    let mut roots = rustls::RootCertStore::empty();
    roots.add(ca)?;
    Ok(rustls::ClientConfig::builder_with_provider(provider())
        .with_safe_default_protocol_versions()?
        .with_root_certificates(roots)
        .with_no_client_auth())
}

pub fn http_client(ca: CertificateDer<'static>, timeout: Duration) -> anyhow::Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .tls_backend_preconfigured(client_with_ca(ca)?)
        .timeout(timeout)
        .connect_timeout(Duration::from_secs(10))
        .build()?)
}

#[derive(Debug)]
struct AnyCert(Arc<CryptoProvider>);

impl ServerCertVerifier for AnyCert {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }
    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls12_signature(message, cert, dss, &self.0.signature_verification_algorithms)
    }
    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls13_signature(message, cert, dss, &self.0.signature_verification_algorithms)
    }
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.0.signature_verification_algorithms.supported_schemes()
    }
}

pub fn noq_client(alpn: &[u8], transport: Arc<noq::TransportConfig>) -> anyhow::Result<noq::ClientConfig> {
    let p = provider();
    let mut c = rustls::ClientConfig::builder_with_provider(p.clone())
        .with_protocol_versions(&[&rustls::version::TLS13])?
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(AnyCert(p)))
        .with_no_client_auth();
    c.alpn_protocols = vec![alpn.to_vec()];
    let q = noq::crypto::rustls::QuicClientConfig::try_from(c)?;
    let mut cfg = noq::ClientConfig::new(Arc::new(q));
    cfg.transport_config(transport);
    Ok(cfg)
}

pub fn noq_server(alpn: &[u8], transport: Arc<noq::TransportConfig>) -> anyhow::Result<noq::ServerConfig> {
    let ck = rcgen::generate_simple_self_signed(vec!["p02-peer".to_string()])?;
    let cert = CertificateDer::from(ck.cert.der().to_vec());
    let key = PrivateKeyDer::try_from(ck.signing_key.serialize_der())
        .map_err(|e| anyhow::anyhow!("key: {e}"))?;
    let mut c = rustls::ServerConfig::builder_with_provider(provider())
        .with_protocol_versions(&[&rustls::version::TLS13])?
        .with_no_client_auth()
        .with_single_cert(vec![cert], key)?;
    c.alpn_protocols = vec![alpn.to_vec()];
    c.max_early_data_size = 0;
    let q = noq::crypto::rustls::QuicServerConfig::try_from(c)?;
    let mut cfg = noq::ServerConfig::with_crypto(Arc::new(q));
    cfg.transport_config(transport);
    Ok(cfg)
}
