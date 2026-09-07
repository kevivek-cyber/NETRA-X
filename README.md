# NETRA-X: Dark Web Threat Actor Intelligence & Attribution Platform

> **SEE BEYOND. UNMASK THE REAL.**  
> *Authorized Research / Law-Enforcement Oriented / Defensive Use Only*  
> Built for **Smart India Hackathon 2026 — Problem Statement SIH26151** (NTRO).

NETRA-X is an evidence-driven Cyber Threat Intelligence (CTI) & Attribution Operating System. It transforms fragmented dark-web observations (onion services, forum handles, PGP key fingerprints, cryptocurrency wallets, server misconfigurations, and stylometric patterns) into a connected knowledge graph and evidence-backed attribution hypotheses with calibrated posterior confidence, complete provenance, and mandatory analyst review.

---

## 🏛️ Core Methodological Philosophy

- **COLLECT EVERYTHING PASSIVELY & LEGALLY**
- **TRUST NOTHING BLINDLY**
- **PRESERVE EVERYTHING IMMUTABLY (SHA-256)**
- **CORRELATE INDEPENDENTLY ACROSS FAMILIES**
- **MODEL UNCERTAINTY VIA ISOTONIC CALIBRATION**
- **EXPOSE CONTRADICTIONS FIRST-CLASS**
- **AI ASSISTS — MANDATORY ANALYST DECIDES**

---

## 🚀 Key Features

1. **Immutable Evidence Ledger & Provenance**: Every assertion carries source URI, collection timestamp, collector version, raw artifact SHA-256 hash, and extraction method.
2. **Log-Likelihood Ratio (LLR) Attribution Engine**: Multi-evidence fusion using $LLR_i = \ln(m_i / u_i)$, dependence discounting ($\lambda=0.25$), and evidence family contribution caps (`Exact Identity`: 10.0, `Financial`: 7.5, `Infrastructure`: 5.0, `Content/NLP`: 5.0, `Stylometry`: 3.0, `Temporal`: 2.0, `Semantic`: 2.0).
3. **First-Class Contradiction Subsystem**: Mutually exclusive signals (e.g. Temporal Impossibility, PGP Key Conflicts) subtract penalties $W_c$ without capping or dampening.
4. **Isotonic Calibration & Decision Policy**: Maps raw LLR scores into calibrated probabilities $P(H_1 \mid E) \in [0, 1]$ categorizing confidence into High ($\ge 0.85$), Medium ($0.50-0.84$), and Insufficient ($<0.50$).
5. **Interactive Cytoscape.js Knowledge Graph**: Property graph projection mapping `Actor`, `Alias`, `Account`, `PGPKey`, `Wallet`, `OnionService`, and `Server` nodes.
6. **Evidence Waterfall UI**: Stacked contribution breakdown displaying every supporting and contradictory evidence item with reliability weights and raw artifact references.
7. **Cryptographic SHA-256 Audit Log**: Append-only hash-chained audit trail (`payload_hash`, `prev_hash`) ensuring tamper-evident accountability.
8. **Signed ReportLab PDF & STIX 2.1 Export**: One-click generation of evidence-backed CTI case reports and STIX 2.1 JSON bundles.
9. **Constrained AI Copilot**: Grounded assistant answering strictly from authoritative ledger rows.

---

## 🏗️ Repository Architecture

```
netra-x/
├── apps/
│   ├── web/                   # Next.js 14+ / TypeScript / Tailwind CSS / Cytoscape.js
│   └── api/                   # FastAPI modular monolith (Python 3.11+, SQLAlchemy Async, Pydantic)
├── workers/
│   ├── extraction/            # spaCy NER + Regex + PGP/Wallet parsers + faststylometry + mmh3
│   ├── graph/                 # Async Neo4j graph projection consumer
│   └── attribution/           # LLR scoring & contradiction calculation
├── packages/
│   ├── schemas/               # Shared Pydantic models & JSON schemas
│   ├── graph/                 # Neo4j Cypher queries & projection logic
│   ├── copilot/               # Grounded Copilot assistant and ledger lookup tools
│   ├── stylometry/            # Burrows' Delta z-scores & neural encoder
│   └── evidence/              # Evidence Model, LLR formulas, family caps, calibration
├── seed/                      # Deterministic synthetic seed pipeline (python -m seed.generator, python -m seed.network)
├── tests/                     # Unit, integration, and E2E hero acceptance tests
├── docker-compose.yml         # Service orchestration (Postgres 16, Neo4j 5, Redis 7, MinIO, API, Web)
└── Makefile                   # System operational shortcuts (`make setup`, `make seed`, `make test`)
```

---

## 🛠️ How to Run

### Prerequisites
- Python 3.11+
- Node.js 18+ / npm

### Quick Start (Standalone / Offline Local Mode)

1. **Install Dependencies**:
   ```bash
   python -m pip install -e .[dev]
   cd apps/web && npm install && cd ../..
   ```

2. **Initialize Database & Seed Network**:
   ```bash
   python -m seed.generator
   python -m seed.network
   ```

3. **Run Unit & E2E Acceptance Tests**:
   ```bash
   python -m pytest tests/
   ```

4. **Launch Backend API & Web Frontend**:
   - **Start API Backend**:
     ```bash
     python -m uvicorn apps.api.main:app --port 8000 --reload
     ```
   - **Start Next.js Frontend**:
     ```bash
     cd apps/web && npm run dev
     ```

5. **Open Browser**:
   - Web UI: `http://localhost:3000`
   - **Login**: `analyst@netra-x.local` / `AnalystPass2026!`

### Packaged Desktop App (fully local, no Docker/cloud)

For a local-first Windows app that starts the API and UI for you and stores
its database under your user profile, see **[DESKTOP.md](DESKTOP.md)**.
