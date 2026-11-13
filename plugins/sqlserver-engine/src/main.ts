// The SQL Server engine plugin's entry point (#1101): serves the database-engine protocol over standard
// streams.
import { serve } from '../../protocol/database/host';
import { SqlServerEngine } from './sqlserver-engine';

serve(new SqlServerEngine());
