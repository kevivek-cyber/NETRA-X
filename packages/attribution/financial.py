"""
financial.py — Cryptocurrency UTXO Co-Spending & Financial Evidence Clustering Module.

Provides UTXO multi-input co-spending cluster extraction, Monero (XMR) privacy analysis,
and Bayesian evidence evaluation for the FINANCIAL evidence family (family cap: 7.5).
"""

import re
from typing import List, Dict, Any, Optional, Set

from packages.common.types import EvidenceItem, EvidenceFamily


class UnionFind:
    """
    Disjoint Set Union (DSU) data structure with path compression.
    """

    def __init__(self):
        self.parent: Dict[str, str] = {}

    def find(self, i: str) -> str:
        if i not in self.parent:
            self.parent[i] = i
            return i
        if self.parent[i] == i:
            return i
        self.parent[i] = self.find(self.parent[i])
        return self.parent[i]

    def union(self, i: str, j: str):
        root_i = self.find(i)
        root_j = self.find(j)
        if root_i != root_j:
            # Deterministic lexicographical root assignment
            if root_i < root_j:
                self.parent[root_j] = root_i
            else:
                self.parent[root_i] = root_j


class UTXOCoSpendingClusterer:
    """
    Bitcoin UTXO multi-input co-spending cluster builder and Monero privacy classifier.
    """

    @staticmethod
    def build_utxo_clusters(transactions: List[Dict[str, Any]]) -> Dict[str, str]:
        """
        Applies the Common Input Ownership Heuristic to group Bitcoin UTXO input addresses
        into unified wallet clusters.
        
        Args:
            transactions: List of tx dictionaries containing 'inputs' and 'outputs' address lists.
            
        Returns:
            Dict mapping address -> cluster_id (e.g., 'cluster_btc_<root_address>').
        """
        uf = UnionFind()
        all_addresses: Set[str] = set()

        for tx in transactions:
            raw_inputs = tx.get("inputs", [])
            raw_outputs = tx.get("outputs", [])

            # Extract input address strings
            input_addrs: List[str] = []
            for inp in raw_inputs:
                addr = inp if isinstance(inp, str) else inp.get("address")
                if addr:
                    input_addrs.append(addr)
                    all_addresses.add(addr)

            # Extract output address strings
            for out in raw_outputs:
                addr = out if isinstance(out, str) else out.get("address")
                if addr:
                    all_addresses.add(addr)

            # Multi-input co-spending rule: merge all input addresses
            if len(input_addrs) >= 2:
                first_addr = input_addrs[0]
                for other_addr in input_addrs[1:]:
                    uf.union(first_addr, other_addr)

        # Build cluster mapping
        cluster_map: Dict[str, str] = {}
        for addr in all_addresses:
            root = uf.find(addr)
            cluster_map[addr] = f"cluster_btc_{root}"

        return cluster_map

    @staticmethod
    def trace_mixer_hops(
        transactions: List[Dict[str, Any]],
        start_address: str,
        max_hops: int = 5
    ) -> Dict[str, Any]:
        """
        Trace multi-input co-spending wallet hops and identify Bitcoin / Monero mixer service touchpoints.
        """
        visited_addresses = {start_address}
        queue = [(start_address, 0)]
        hops_trace = []
        mixer_touchpoints = []

        # Known mixer address patterns or tagged service addresses
        mixer_patterns = ["mixer", "tumbler", "coinjoin", "chipmixer", "blender", "wasabi", "samourai"]

        while queue:
            curr_addr, hop_count = queue.pop(0)
            if hop_count >= max_hops:
                continue

            for tx in transactions:
                inputs = tx.get("inputs", [])
                outputs = tx.get("outputs", [])

                if curr_addr in inputs:
                    for out_addr in outputs:
                        if out_addr not in visited_addresses:
                            visited_addresses.add(out_addr)
                            queue.append((out_addr, hop_count + 1))
                            is_mixer = any(p in out_addr.lower() for p in mixer_patterns)
                            if is_mixer:
                                mixer_touchpoints.append({"address": out_addr, "hop": hop_count + 1})

                            hops_trace.append({
                                "from_address": curr_addr,
                                "to_address": out_addr,
                                "txid": tx.get("txid", "tx_simulated"),
                                "hop_depth": hop_count + 1,
                                "is_mixer_hop": is_mixer
                            })

        return {
            "start_address": start_address,
            "total_addresses_reached": len(visited_addresses),
            "max_depth_searched": max_hops,
            "mixer_touchpoints_found": len(mixer_touchpoints),
            "mixer_touchpoints": mixer_touchpoints,
            "trace": hops_trace
        }

    @staticmethod
    def calculate_cluster_risk_score(
        cluster_id: str,
        transactions: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Calculate financial risk profile and mixer exposure score for a UTXO wallet cluster.
        """
        cluster_addresses = set()
        total_volume = 0.0
        mixer_hops_count = 0

        for tx in transactions:
            inputs = tx.get("inputs", [])
            outputs = tx.get("outputs", [])
            val = float(tx.get("amount_btc", 1.0))
            total_volume += val

            for addr in inputs + outputs:
                if cluster_id in addr or addr.startswith("cluster_"):
                    cluster_addresses.add(addr)
                if any(p in addr.lower() for p in ["mixer", "tumbler", "coinjoin", "wasabi"]):
                    mixer_hops_count += 1

        risk_score = min(1.0, (mixer_hops_count * 0.35) + (len(cluster_addresses) * 0.05))

        return {
            "cluster_id": cluster_id,
            "total_addresses": len(cluster_addresses),
            "estimated_volume_btc": round(total_volume, 4),
            "mixer_exposure_count": mixer_hops_count,
            "risk_score": round(risk_score, 2),
            "risk_level": "HIGH" if risk_score > 0.6 else "MEDIUM" if risk_score > 0.3 else "LOW"
        }

    @staticmethod
    def classify_monero_privacy_tx(tx_dict: Dict[str, Any]) -> Dict[str, Any]:
        """
        Evaluates Monero (XMR) stealth address structure, RingCT ring size, and key image hashes.
        
        Args:
            tx_dict: Dict containing 'address', 'ring_size', 'key_image', 'is_subaddress'.
            
        Returns:
            Dict containing privacy score, valid_stealth_address, and risk level.
        """
        address = str(tx_dict.get("address", ""))
        ring_size = int(tx_dict.get("ring_size", 0))
        key_image = str(tx_dict.get("key_image", ""))

        # Monero address validation: starts with '4' or '8', length 95 (or 106 integrated)
        valid_stealth = bool(re.match(r"^[48][0-9a-zA-B]{94,105}$", address))
        is_subaddress = address.startswith("8") if valid_stealth else False

        # RingCT default ring size evaluation
        if ring_size >= 16:
            privacy_score = 0.95
            risk_level = "LOW"
        elif ring_size >= 11:
            privacy_score = 0.85
            risk_level = "MEDIUM"
        elif ring_size > 0:
            privacy_score = 0.40
            risk_level = "HIGH"
        else:
            privacy_score = 0.10
            risk_level = "CRITICAL"

        return {
            "valid_stealth_address": valid_stealth,
            "is_subaddress": is_subaddress,
            "ring_size": ring_size,
            "key_image_present": bool(key_image),
            "privacy_score": privacy_score,
            "decoy_risk_level": risk_level,
        }


class FinancialAttributionEvaluator:
    """
    Bayesian evidence evaluator for FINANCIAL evidence family.
    """

    @staticmethod
    def evaluate_wallet_evidence(
        address_a: str,
        address_b: str,
        cluster_map: Optional[Dict[str, str]] = None,
        item_id: str = "ev_btc_wallet",
    ) -> EvidenceItem:
        """
        Evaluates direct address match or UTXO co-spending cluster match between two crypto addresses,
        returning a calibrated EvidenceItem for Bayesian fusion.
        """
        if not address_a or not address_b:
            return EvidenceItem(
                id=item_id,
                feature_name="btc_address_reuse",
                family=EvidenceFamily.FINANCIAL,
                dependence_group="wallet_cluster_btc",
                m_i=0.95,
                u_i=0.00001,
                llr=0.0,
                abstain=True,
                metadata={"reason": "Empty address provided"},
            )

        # 1. Direct address reuse
        if address_a == address_b:
            return EvidenceItem(
                id=item_id,
                feature_name="btc_address_reuse",
                family=EvidenceFamily.FINANCIAL,
                dependence_group="wallet_cluster_btc",
                m_i=0.95,
                u_i=0.00001,  # LLR ~ 11.46 (capped at 7.5)
                abstain=False,
                metadata={
                    "match_type": "DIRECT_ADDRESS_REUSE",
                    "address_a": address_a,
                    "address_b": address_b,
                },
            )

        # 2. Co-input transaction clustering
        if cluster_map:
            cluster_a = cluster_map.get(address_a)
            cluster_b = cluster_map.get(address_b)

            if cluster_a and cluster_b and cluster_a == cluster_b:
                return EvidenceItem(
                    id=item_id,
                    feature_name="btc_co_input_clustering",
                    family=EvidenceFamily.FINANCIAL,
                    dependence_group="wallet_cluster_btc",
                    m_i=0.90,
                    u_i=0.0001,  # LLR ~ 9.10 (capped at 7.5)
                    abstain=False,
                    metadata={
                        "match_type": "UTXO_CO_INPUT_CLUSTER_MATCH",
                        "cluster_id": cluster_a,
                        "address_a": address_a,
                        "address_b": address_b,
                    },
                )

        # 3. No match -> Abstain
        return EvidenceItem(
            id=item_id,
            feature_name="btc_co_input_clustering",
            family=EvidenceFamily.FINANCIAL,
            dependence_group="wallet_cluster_btc",
            m_i=0.90,
            u_i=0.0001,
            llr=0.0,
            abstain=True,
            metadata={
                "match_type": "NO_MATCH",
                "address_a": address_a,
                "address_b": address_b,
            },
        )


def build_utxo_clusters(transactions: List[Dict[str, Any]]) -> Dict[str, str]:
    """
    Helper function to build UTXO co-spending clusters from transaction list.
    """
    return UTXOCoSpendingClusterer.build_utxo_clusters(transactions)


def evaluate_wallet_evidence(
    address_a: str,
    address_b: str,
    cluster_map: Optional[Dict[str, str]] = None,
    item_id: str = "ev_btc_wallet",
) -> EvidenceItem:
    """
    Helper function to evaluate wallet evidence and emit a calibrated EvidenceItem.
    """
    return FinancialAttributionEvaluator.evaluate_wallet_evidence(
        address_a, address_b, cluster_map=cluster_map, item_id=item_id
    )
