# ADR-0008: Result serialization — canonical EJSON envelopes

- Status: Accepted (validated by S5: full BSON corpus round-trip)
- Context: BSON fidelity across 3 process boundaries; relaxed/canonical display; large documents.
- Options: EJSON strings; raw BSON bytes over MessagePort; structured clone with type tags.
- Decision: **Canonical EJSON via the `bson` library on the wire** (`EjsonEnvelope { ejson, byteSize, truncated }`); renderer parses with the same bson package for typed rendering (badges, real Dates) and re-renders relaxed OR canonical. Per-document preview cap 256 KB (+ explicit full-value fetch op), per-page budget 8 MB; circular/non-serializable JS values (Trusted Mode) degrade to an `$mongogOpaque` inspect-style preview instead of throwing. Raw-BSON-over-port kept as a documented optimization.
- Consequences: one serialization point (runtime), one parse point (renderer); copy-as-EJSON both modes; lossy plain-JSON copy carries a UI warning.
- Risks: serialization cost on very large docs. Revisit: >30% of page latency at 1 MB docs → binary BSON channel spike.
