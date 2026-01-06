---
title: "Context Manifold Experiment: Reproducible Evaluation of Hybrid Graph--Vector Retrieval for Code Intelligence"
tags:
  - retrieval-augmented generation
  - code search
  - software engineering
  - graph algorithms
  - information retrieval
authors:
  - name: John Schmotzer
    affiliation: 1
affiliations:
  - name: Independent Researcher
    index: 1
date: "2026-01-06"
bibliography: paper.bib
---

# Summary

This repository provides a fully reproducible experiment harness for evaluating **Context Manifold**, a hybrid retrieval approach that combines vector similarity with explicit program-graph structure (e.g., call edges) to produce dependency-aware context bundles for code intelligence workflows.

The harness runs an A/B comparison between vector-only retrieval and hybrid graph--vector retrieval, computes retrieval metrics (including dependency-coverage style measures), and generates a publication-ready report with tables and CSV exports. The system is designed to make hybrid retrieval *inspectable and reproducible* using local infrastructure components and deterministic scripts.

# Statement of need

Code-oriented retrieval is commonly implemented as vector similarity search over embedded code chunks. While effective for many repositories, vector-only retrieval can under-represent structural dependencies that matter for answering questions about behavior, call paths, and cross-module coupling.

The Context Manifold Experiment fills a practical need for the research and practitioner community: a lightweight, open experiment harness that (i) builds the structural artifacts required for graph-augmented retrieval, (ii) runs a standardized A/B experiment, and (iii) produces a report suitable for inclusion in technical writeups. It supports rapid iteration on hybrid retrieval parameters (e.g., neighborhood radius and hybrid weighting) and enables auditing of when graph augmentation helps and when it does not.

# Software design

## Architecture

The experiment harness comprises three phases:

1. **Setup.**
   - Clone a curated set of repositories (configured in `data/repositories.json`).
   - Parse/analyze repositories to identify candidate symbols/functions.
   - Build a program-structure graph (FalkorDB) and a semantic embedding index (ChromaDB).

2. **Run.**
   - For each task, execute vector-only retrieval and hybrid graph--vector retrieval.
   - Record per-task retrieval outcomes and derived metrics.

3. **Analyze.**
   - Aggregate results by repository and category.
   - Produce summary statistics and a publication-ready report.

## Reproducibility recipe

```bash
# Prereqs: Docker (with docker compose), Git, Python 3.10+.

# 1) Start local infrastructure (FalkorDB + ChromaDB)
cd docker
docker compose up -d
cd ..

# 2) Create and activate a virtual environment (recommended)
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

# 3) Install dependencies
pip install -r requirements.txt

# 4) Configure credentials
export OPENAI_API_KEY="sk-..."  # required for embeddings

# Optional: override hosts/ports (defaults shown)
# export FALKORDB_HOST=localhost
# export FALKORDB_PORT=6379
# export CHROMADB_HOST=localhost
# export CHROMADB_PORT=8000

# 5) Run the experiment end-to-end (setup + run + analyze)
python scripts/run_experiment.py --phase all

# 6) Generate the publication report (tables + CSV exports)
python scripts/generate_report.py

# Outputs are written under ./results/
# - results/REPORT.md
# - results/results_full.csv
# - results/results_by_repo.csv
```

## Outputs

After a successful run, the harness produces:
- `results/REPORT.md`: publication-ready report with tables and summary findings.
- `results/results_full.csv`: per-task results.
- `results/results_by_repo.csv`: aggregated results by repository.

# Quality control

The experiment is implemented as deterministic scripts with explicit configuration defaults in `src/config.py`. The repository is intended to be CI-friendly; users can pin dependency versions and run the end-to-end pipeline in containerized environments. This manuscript is intended to be compiled via the Open Journals draft action workflow used by JOSS submissions. [@openjournals_draft_action]

# Empirical evaluation (brief)

The harness is designed to surface heterogeneous effects across repository types and structural regimes. In the accompanying report, call-edge density is used as a practical cohort-level correlate for when hybrid retrieval is likely to help.

![Edge density vs. observed change in dependency coverage (ΔDC) on representative repositories.](figures/edge_density_vs_delta.png)

# AI usage disclosure

Generative AI tools may be used by downstream consumers of retrieved context; however, the experiment harness itself evaluates retrieval outcomes independent of any particular language model generation loop. If authors use generative AI to assist code or manuscript edits, they should disclose that usage here per journal guidelines.

# Acknowledgements

(Optional.)

# References
