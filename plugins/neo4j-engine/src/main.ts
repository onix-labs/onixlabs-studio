// The Neo4j engine plugin's entry point (#1096): serves the database-engine protocol over standard
// streams.
import { serve } from '../../protocol/database/host';
import { Neo4jEngine } from './neo4j-engine';

serve(new Neo4jEngine());
