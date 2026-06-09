import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Represents the root component of the ONIXLabs Studio application.
 */
@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  /**
   * Gets the product title displayed in the application shell.
   */
  protected readonly title: string = 'ONIXLabs Studio';

  /**
   * Gets the product tagline displayed beneath the title.
   */
  protected readonly tagline: string = 'A modern cross-platform integrated development environment';
}
