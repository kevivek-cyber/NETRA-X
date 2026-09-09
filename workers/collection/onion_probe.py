"""
NETRA-X OnionProbe Passive Scanner Engine
Scans onion services passively for infrastructure leaks (favicon mmh3, server-status, TLS cert, headers).
"""

import base64
import hashlib
from typing import Dict, Any, Optional
import mmh3


class OnionProbeEngine:
    """Passive probing engine for darknet onion service infrastructure footprinting."""

    @staticmethod
    def inspect_favicon(favicon_bytes: bytes) -> Dict[str, Any]:
        """Compute MurmurHash3 favicon integer hash for Shodan clearnet pivot matching."""
        if not favicon_bytes:
            return {"mmh3_hash": 0, "sha256": "", "shodan_query": ""}
        
        b64_encoded = base64.encodebytes(favicon_bytes).decode("utf-8")
        mmh3_val = mmh3.hash(b64_encoded)
        sha256_val = hashlib.sha256(favicon_bytes).hexdigest()

        return {
            "mmh3_hash": mmh3_val,
            "sha256": sha256_val,
            "shodan_query": f"http.favicon.hash:{mmh3_val}"
        }

    @staticmethod
    def inspect_server_status(raw_html: str) -> Dict[str, Any]:
        """Detect Apache / Nginx / Lighttpd status page exposure."""
        if not raw_html:
            return {"server_status_exposed": False, "leak_type": "NONE"}

        exposed = ("Apache Server Status" in raw_html) or ("Nginx Status" in raw_html) or ("<title>Apache Status</title>" in raw_html)
        return {
            "server_status_exposed": exposed,
            "leak_type": "APACHE_SERVER_STATUS" if exposed else "NONE"
        }

    @staticmethod
    def inspect_headers(headers_dict: Dict[str, str]) -> Dict[str, Any]:
        """Extract server banners, X-Powered-By, and proxy headers."""
        headers_dict = {k.lower(): v for k, v in (headers_dict or {}).items()}
        return {
            "server_banner": headers_dict.get("server", "Unknown"),
            "x_powered_by": headers_dict.get("x-powered-by", "Unknown"),
            "via_proxy": headers_dict.get("via", "")
        }

    @staticmethod
    def inspect_tls_cert(cert_pem: str) -> Dict[str, Any]:
        """Parse or hash TLS certificate details for clearnet SSL/TLS correlation."""
        if not cert_pem:
            return {"sha256_fingerprint": "", "has_tls": False}

        cert_bytes = cert_pem.strip().encode("utf-8")
        sha256_fp = hashlib.sha256(cert_bytes).hexdigest()

        # Extract Common Name (CN) / Subject if formatted in PEM text
        cn_value = "Unknown"
        if "CN=" in cert_pem:
            try:
                cn_value = cert_pem.split("CN=")[1].split("\n")[0].split("/")[0].strip()
            except Exception:
                pass

        return {
            "has_tls": True,
            "sha256_fingerprint": sha256_fp,
            "common_name": cn_value,
            "raw_sha256": sha256_fp,
            "shodan_query": f"ssl.cert.sha256:{sha256_fp}"
        }

    @classmethod
    def probe_onion_target(
        cls,
        target_url: str,
        html_content: str = "",
        favicon_bytes: Optional[bytes] = None,
        headers_dict: Optional[Dict[str, str]] = None,
        tls_cert_pem: Optional[str] = None
    ) -> Dict[str, Any]:
        """Execute full passive infrastructure footprinting suite on target inputs."""
        favicon_res = cls.inspect_favicon(favicon_bytes or b"")
        status_res = cls.inspect_server_status(html_content or "")
        headers_res = cls.inspect_headers(headers_dict or {})
        tls_res = cls.inspect_tls_cert(tls_cert_pem or "")

        leaks_found = []
        if favicon_res.get("mmh3_hash"):
            leaks_found.append(f"FAVICON_MMH3_{favicon_res['mmh3_hash']}")
        if status_res.get("server_status_exposed"):
            leaks_found.append("SERVER_STATUS_PAGE_EXPOSED")
        if tls_res.get("has_tls"):
            leaks_found.append(f"TLS_CERT_{tls_res['sha256_fingerprint'][:16]}")
        if headers_res.get("server_banner") != "Unknown":
            leaks_found.append(f"SERVER_BANNER_{headers_res['server_banner']}")

        return {
            "target_url": target_url,
            "favicon": favicon_res,
            "server_status": status_res,
            "headers": headers_res,
            "tls_cert": tls_res,
            "total_leaks_found": len(leaks_found),
            "leaks": leaks_found
        }
