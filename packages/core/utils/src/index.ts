// Convenience barrel. Prefer the explicit subpath (`@gonk/utils/fs`) in
// extension code so an unbundled Node consumer only loads what it names — see
// the note in `./fs`. The barrel exists for the bundled/typed-import case.
export * from "./fs.ts";
