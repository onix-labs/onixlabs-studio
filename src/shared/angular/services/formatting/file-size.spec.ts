import { formatFileSize } from './file-size';

describe('formatFileSize', () => {
  it('formatFileSize_usesBinaryUnits', () => {
    expect(formatFileSize(812)).toBe('812 B');
    expect(formatFileSize(12_698)).toBe('12 KB');
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});
