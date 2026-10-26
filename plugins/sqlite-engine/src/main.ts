// The SQLite engine plugin's entry point (#1095). The same bundle serves two roles: started plainly it is
// the plugin, serving the database-engine protocol over standard streams; started with the runner
// argument it is one session's query runner, a process of its own so a long query can be killed.
import { serve } from './host';
import { SqliteEngine } from './sqlite-engine';
import { RUNNER_ARGUMENT, serveAsRunner } from './sqlite-runner';

if (process.argv.includes(RUNNER_ARGUMENT)) {
  serveAsRunner();
} else {
  serve(new SqliteEngine(__filename));
}
