import { NotificationSeverity } from '@shared/angular/services/notifications/notifications';
import { Icon } from './icon';

/**
 * Resolves the icon a notification severity renders with, shared by every surface that shows a
 * notification (the toast stack, the status-strip notification centre) so a severity always wears
 * the same face.
 * @param severity The notification severity.
 * @returns Returns the severity's icon.
 */
export function severityIcon(severity: NotificationSeverity): Icon {
  switch (severity) {
    case 'success':
      return Icon.SUCCESS;
    case 'warning':
      return Icon.WARNING;
    case 'error':
      return Icon.ERROR;
    default:
      return Icon.INFO;
  }
}
