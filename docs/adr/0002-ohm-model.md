# OHM catalog and `.ohm` extension

Studio authors harnesses with a fixed piece catalog (Agent, Gate, HITL, Skill, Signal) plus Connections (McpServer, Tool) and Provider binds (1..N with primary/fallback and optional task routing). The portable artifact is the **OHarness Model** file extension `.ohm`, replacing `.oharness`. skills-framework Agile is the dogfood preset that proves the catalog.

## Consequences

- Canvas vocabulary is harness-domain, not generic LLM-pipeline nodes (input/llm/router/…).
- MCP lives in Connections as a tool source bound to Agents, not as a flow peer of Gate/HITL.
- Runtime and docs accept `.ohm` as canonical; `.oharness` remains readable during migration.
