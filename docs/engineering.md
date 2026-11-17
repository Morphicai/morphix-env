# Engineering and documentation conventions

This repository keeps its own implementation, contracts, tasks, and evidence. A standalone clone needs no parent-repo documents. Read this file first, then the relevant OpenSpec documents.

- Documents have owners, status, and scope. Verify current behavior against source code; put goals in plans/changes, history in archive.
- Fully checked task lists are not sufficient evidence of completion. Acceptance that involves login state, deployment, or client lifecycles stays open until actually verified. Diagnostics are not end-to-end tests; do not present frozen-data results as current quality.
- Stable requirements live in `openspec/specs`; full implementation changes in `openspec/changes`; ideas and rejected alternatives in `openspec/drafts`; completed scoped work is archived into dated directories.
- Before migrating documents, record the original commit and SHA-256, verify the copy, then fix links/indexes. Never keep a second authoritative copy. Bodies are singular; duplicates and meaningless artifacts may be deleted, but unique decisions and evidence are preserved.
- Required relative links must not escape the repository root; use canonical URLs for cross-repo context. Never reference personal absolute paths as team dependencies.
- Environment variables are checked by key name only; value editing and process injection go through mxenv. Never read or print `.env*` files, tokens, or personal corpora.
- Code changes are verified on a dedicated branch and merged through PRs. No unaudited pushes to `main`; never delete tests to make them pass. Documentation governance never authorizes product deployment, data writes, or secret changes by itself.
- Prompts stay short and on demand; do not copy package versions, tool counts, or user data into documents. Project skills carry only team-relevant workflows with a single shared body; MCP machine-specific credentials stay local, never in Git.

The user guide lives in [`guide/`](./guide/getting-started.md); visual assets and brand tokens in [`assets/`](./assets/README.md).
