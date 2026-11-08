// The .NET test adapter's entry point: serves the test-adapter protocol over standard streams (#1353).
import { serve } from '../../protocol/testing/serve';
import { dotnetAdapter } from './adapter';

serve(dotnetAdapter);
