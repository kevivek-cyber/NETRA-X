"""
Attribution package initialization.
"""
from packages.attribution.fusion import LLRFusionEngine, load_mu_table
from packages.attribution.calibration import IsotonicCalibrator, sigmoid_llr_to_prob
from packages.attribution.decide import evaluate_attribution, compute_attribution, parse_evidence_row
# graph_embedding imports torch, which is an optional [neural] extra rather
# than a runtime dependency -- it is a ~2GB install and the deployment target is
# a 512MB Render instance that installs from pyproject. Importing it eagerly
# here made `packages.attribution` unimportable without torch, which took down
# the API itself (it reaches the engine through this package), bench.report,
# and the financial and reporting modules, neither of which needs torch at all.
#
# Same treatment as packages/stylometry: optional at the package boundary,
# raising only if a neural symbol is actually called.
try:
    from packages.attribution.graph_embedding import (
        Node2VecGraphEmbedder,
        LinkPredictor,
        fit_graph_embeddings,
        evaluate_graph_link,
    )
    GRAPH_EMBEDDING_AVAILABLE = True
except ImportError:  # pragma: no cover - depends on the install profile
    GRAPH_EMBEDDING_AVAILABLE = False

    def _graph_embedding_unavailable(*_args, **_kwargs):
        raise ImportError(
            "Graph embedding requires PyTorch, an optional extra. "
            "Install it with:  pip install -e .[neural]"
        )

    Node2VecGraphEmbedder = _graph_embedding_unavailable  # type: ignore[assignment]
    LinkPredictor = _graph_embedding_unavailable  # type: ignore[assignment]
    fit_graph_embeddings = _graph_embedding_unavailable  # type: ignore[assignment]
    evaluate_graph_link = _graph_embedding_unavailable  # type: ignore[assignment]
from packages.attribution.financial import (
    UTXOCoSpendingClusterer,
    FinancialAttributionEvaluator,
    build_utxo_clusters,
    evaluate_wallet_evidence,
)
from packages.attribution.neural_stylometry import NeuralStylometryEngine
from packages.attribution.reporting import (
    AttributionReportFormatter,
    build_waterfall_breakdown,
    format_ascii_waterfall,
    format_markdown_report,
)

__all__ = [
    "LLRFusionEngine",
    "load_mu_table",
    "IsotonicCalibrator",
    "sigmoid_llr_to_prob",
    "evaluate_attribution",
    "compute_attribution",
    "parse_evidence_row",
    "Node2VecGraphEmbedder",
    "LinkPredictor",
    "fit_graph_embeddings",
    "evaluate_graph_link",
    "GRAPH_EMBEDDING_AVAILABLE",
    "UTXOCoSpendingClusterer",
    "FinancialAttributionEvaluator",
    "build_utxo_clusters",
    "evaluate_wallet_evidence",
    "AttributionReportFormatter",
    "build_waterfall_breakdown",
    "format_ascii_waterfall",
    "format_markdown_report",
    "NeuralStylometryEngine",
]



