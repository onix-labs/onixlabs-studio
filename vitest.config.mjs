import { defineConfig } from 'vitest/config';

// Read by the Angular unit-test builder (`runnerConfig` in angular.json), merged over what the builder
// sets itself; everything else — includes, isolation, coverage — stays in angular.json.
export default defineConfig({
  test: {
    // ⛔ A quarter of the cores at most. Uncapped, Vitest starts one worker per core, and on a
    // many-core workstation a full run pins the whole machine while someone is working on it.
    // A GitHub runner is the exception: it has four cores and nobody working on it, and a quarter
    // of four is one worker — the whole suite in series. Only Actions sets GITHUB_ACTIONS, so no
    // local run ever takes this branch (`CI` is set by too many local tools to be trusted here).
    maxWorkers: process.env['GITHUB_ACTIONS'] === 'true' ? '100%' : '25%',
  },
});
