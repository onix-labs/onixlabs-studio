import { DatabaseNodeIcon } from '@shared/api/database-engine-protocol';
import { Icon } from '@shared/angular/icons/icon';

/**
 * The glyph Studio draws for each meaning an engine may give a tree node. Engines name the meaning;
 * Studio picks the glyph, so every engine's tree reads in the same visual language.
 */
export const DATABASE_NODE_ICONS: Readonly<Record<DatabaseNodeIcon, Icon>> = {
  server: Icon.DATABASE_CONNECTION,
  database: Icon.DATABASE,
  schema: Icon.DATABASE_SCHEMA,
  folder: Icon.API_COLLECTION,
  table: Icon.DATABASE_TABLE,
  view: Icon.DATABASE_VIEW,
  column: Icon.DATABASE_COLUMN,
  key: Icon.DATABASE_KEY,
  index: Icon.DATABASE_INDEX,
  function: Icon.DATABASE_FUNCTION,
  trigger: Icon.DATABASE_TRIGGER,
  sequence: Icon.DATABASE_SEQUENCE,
  label: Icon.DATABASE_LABEL,
  relationship: Icon.DATABASE_RELATIONSHIP,
  property: Icon.DATABASE_PROPERTY,
  constraint: Icon.DATABASE_CONSTRAINT,
};
