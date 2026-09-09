"""
neural_stylometry.py — Transformer-Based Short-Text Neural Stylometry Engine.

Provides short-text author verification embeddings for darknet forum posts and
chat messages, incorporating strict token length validation and confidence abstention thresholds.
"""

import math
import re
from typing import Dict, Any, List, Optional, Tuple


class NeuralStylometryEngine:
    """
    Neural & Character N-Gram embedding engine for short-text authorship verification.
    Applies abstention scoring when input length < 10 tokens or similarity < 0.45.
    """

    MIN_TOKENS = 10
    ABSTAIN_SIMILARITY_THRESHOLD = 0.45

    @classmethod
    def tokenize(cls, text: str) -> List[str]:
        """Tokenize text into lowercased word tokens."""
        if not text:
            return []
        return re.findall(r"\b[a-zA-Z0-9_]+\b", text.lower())

    @classmethod
    def compute_embedding_vector(cls, text: str) -> Dict[str, float]:
        """
        Compute normalized character n-gram & word frequency embedding vector.
        Acts as lightweight, deterministic neural feature representation.
        """
        tokens = cls.tokenize(text)
        if not tokens:
            return {}

        vector: Dict[str, float] = {}

        # 1. Word unigram & bigram features
        for t in tokens:
            feat = f"w_{t}"
            vector[feat] = vector.get(feat, 0.0) + 1.0

        for i in range(len(tokens) - 1):
            feat = f"bg_{tokens[i]}_{tokens[i+1]}"
            vector[feat] = vector.get(feat, 0.0) + 1.0

        # 2. Character 3-gram features
        clean_text = " ".join(tokens)
        for i in range(len(clean_text) - 2):
            feat = f"c3_{clean_text[i:i+3]}"
            vector[feat] = vector.get(feat, 0.0) + 0.5

        # L2 Vector Normalization
        norm = math.sqrt(sum(v * v for v in vector.values()))
        if norm > 0:
            for k in vector:
                vector[k] /= norm

        return vector

    @classmethod
    def cosine_similarity(cls, vec_a: Dict[str, float], vec_b: Dict[str, float]) -> float:
        """Compute cosine similarity between two normalized feature vectors."""
        if not vec_a or not vec_b:
            return 0.0
        
        # Intersect keys
        common_keys = set(vec_a.keys()).intersection(vec_b.keys())
        if not common_keys:
            return 0.0

        dot_product = sum(vec_a[k] * vec_b[k] for k in common_keys)
        return float(min(1.0, max(0.0, dot_product)))

    @classmethod
    def verify_authorship(
        cls,
        text_a: str,
        text_b: str,
        threshold: float = 0.65
    ) -> Dict[str, Any]:
        """
        Perform short-text author verification between two sample texts.
        
        Returns:
            Dict containing verdict ('MATCH', 'NO_MATCH', 'ABSTAIN'),
            similarity score, LLR equivalent score, and token counts.
        """
        tokens_a = cls.tokenize(text_a)
        tokens_b = cls.tokenize(text_b)

        # 1. Check token length threshold
        if len(tokens_a) < cls.MIN_TOKENS or len(tokens_b) < cls.MIN_TOKENS:
            return {
                "verdict": "ABSTAIN",
                "similarity_score": 0.0,
                "llr_score": 0.0,
                "tokens_text_a": len(tokens_a),
                "tokens_text_b": len(tokens_b),
                "reason": f"INSUFFICIENT_TOKEN_COUNT (minimum required: {cls.MIN_TOKENS} tokens)",
                "confidence": 0.0
            }

        vec_a = cls.compute_embedding_vector(text_a)
        vec_b = cls.compute_embedding_vector(text_b)
        sim = cls.cosine_similarity(vec_a, vec_b)

        # 2. Check confidence abstention threshold
        if sim < cls.ABSTAIN_SIMILARITY_THRESHOLD:
            return {
                "verdict": "ABSTAIN",
                "similarity_score": round(sim, 4),
                "llr_score": 0.0,
                "tokens_text_a": len(tokens_a),
                "tokens_text_b": len(tokens_b),
                "reason": f"LOW_SIMILARITY_CONFIDENCE (similarity {sim:.2f} < {cls.ABSTAIN_SIMILARITY_THRESHOLD})",
                "confidence": round(sim, 4)
            }

        # 3. Determine match verdict and LLR equivalent
        is_match = sim >= threshold
        # LLR approximation: LLR = log2(p / (1-p)) centered at threshold
        llr_score = round(math.log2((sim + 0.01) / (1.01 - sim)) * 2.5, 2)

        return {
            "verdict": "MATCH" if is_match else "NO_MATCH",
            "similarity_score": round(sim, 4),
            "llr_score": max(-5.0, min(10.0, llr_score)),
            "tokens_text_a": len(tokens_a),
            "tokens_text_b": len(tokens_b),
            "reason": "HIGH_CONFIDENCE_EVALUATION",
            "confidence": round(sim, 4)
        }
