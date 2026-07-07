# Examples & test fixtures

`fixtures/` contains hand-written Spine JSON files (target format **4.2**) used by unit tests
in `@spine-editor/core` for round-trip (parse → serialize → compare) compatibility testing.

Important: do **not** commit official Spine example assets (spineboy, raptor, …) here — they are
owned by Esoteric Software and licensed under the Spine license. All fixtures in this directory
must be original, hand-written files. To verify real-world compatibility, test exported files
locally against a Spine runtime in a game project instead.
