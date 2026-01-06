---
title: "CV-Git: AI-Native Version Control with Knowledge Graph and Semantic Code Search"
tags:
  - software engineering
  - knowledge graphs
  - semantic search
  - static analysis
  - developer tools
authors:
  - name: John Schmotzer
    affiliation: 1
affiliations:
  - name: Control Vector / Independent
    index: 1
date: "2026-01-06"
bibliography: paper.bib
---

# Summary

CV-Git is a command-line tool that wraps Git with repository-aware intelligence: it builds a code knowledge graph, supports semantic search over code, and exposes AI-assisted commands for explanation, change planning, and review. The system is designed to help developers navigate and modify large codebases by combining (i) structural understanding derived from parsing and graph extraction and (ii) semantic retrieval via embeddings.

In practice, CV-Git provides a workflow where a developer initializes a repository, synchronizes code into a graph+vector substrate, and then uses `cv find` and related commands to locate relevant code and relationships (e.g., call paths) quickly. The project targets polyglot repositories and supports multiple languages through Tree-sitter based parsing and graph construction.

# Statement of need

Modern software projects are increasingly large, polyglot, and dependency-dense. Developers spend significant time (a) locating relevant code, (b) tracing execution paths and call relationships, and (c) establishing the context needed to make safe changes. Traditional text search and standard Git workflows do not provide *semantic retrieval* or *first-class structural navigation* across language boundaries.

CV-Git is intended to fill this gap by providing:
1. **Structural context** via an explicit knowledge graph, including call graph extraction and symbol relationships such as imports/exports and inheritance.
2. **Semantic search** across repositories using vector embeddings for natural-language queries.
3. **Action-oriented CLI workflows** that integrate these capabilities into standard developer loops (search, explain, review).

This combination is particularly valuable when dependency structure matters (e.g., “what calls this function?”, “what is the execution path from A to B?”), and when developers need fast, explainable retrieval rather than purely generative assistance.

# Software design

## Architecture

CV-Git is organized as a CLI-centric system with two primary data substrates:

- **Knowledge graph store.** Code is parsed and relationships are stored in a graph database to enable dependency queries such as call relationships, paths, dead-code detection, and cyclic dependency discovery.
- **Vector store.** Code chunks are embedded and indexed for similarity search, enabling natural language queries over code.

At a high level, a typical workflow is:
1. Install CV-Git and start required services (graph DB and vector DB).
2. Run `cv init` in a target repository.
3. Run `cv sync` to build/refresh the knowledge graph and semantic index.
4. Use retrieval and analysis commands such as `cv find`, `cv explain`, and `cv graph ...` to navigate code and dependencies.

## Key features

CV-Git provides:
- multi-language parsing and graph extraction (e.g., TypeScript/JavaScript, Python, Go, Rust, Java),
- call graph extraction and related graph queries,
- semantic search with embeddings and a dedicated vector database,
- optional AI-powered commands (explain, do, review) that can be enabled with API keys.

## Quality control

The repository includes automated tests and a build pipeline. This JOSS paper is compiled via the Open Journals draft action GitHub workflow in `.github/workflows/draft-pdf.yml`.

# Research impact statement

CV-Git is designed as research-enabling infrastructure for code intelligence workflows, supporting reproducible indexing (graph + vector), inspectable retrieval, and dependency-aware navigation. Near-term impact is expected through:
- easier repository comprehension and dependency tracing,
- faster iteration on refactors and feature work in large codebases,
- a practical foundation for evaluating retrieval and graph-augmented approaches to code assistance.

(Authors should expand this section with concrete evidence such as external adopters, downstream publications, benchmark results, or usage metrics as they become available.)

# AI usage disclosure

(Choose one and delete the other.)

**Option A (no generative AI used):** No generative AI tools were used in developing the software, preparing documentation, or writing this manuscript.

**Option B (generative AI used):** Generative AI tools were used to assist portions of software development and/or documentation and manuscript drafting. All AI-assisted outputs were reviewed by the authors, validated via automated tests where applicable, and manually inspected for correctness.

# Acknowledgements

(Optional.)

# References
