// The PostgreSQL engine plugin's entry point (#1096): serves the database-engine protocol over standard
// streams.
import { serve } from '../../protocol/database/host';
import { PostgresEngine } from './postgres-engine';

serve(new PostgresEngine());
