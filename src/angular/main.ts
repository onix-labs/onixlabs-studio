import { bootstrapApplication } from '@angular/platform-browser';
import { config } from './config';
import { Root } from './components/root/root';

bootstrapApplication(Root, config).catch((error: unknown): void => {
  console.error(error);
});
