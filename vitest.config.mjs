import { defineConfig } from 'vitest/config';

// Read by the Angular unit-test builder (`runnerConfig` in angular.json), merged over what the builder
// sets itself; everything else — includes, isolation, coverage — stays in angular.json.
export default defineConfig({
  test: {
    // ⛔ A quarter of the cores at most. Uncapped, Vitest starts one worker per core, and on a
    // many-core workstation a full run pins the whole machine while someone is working on it.
    maxWorkers: '25%',
  },
});
