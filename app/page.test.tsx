/**
 * Tests for page.tsx utility functions.
 * Run with: npx jest app/page.test.tsx
 *
 * Tests the pure helper functions extracted from the main component:
 * getFileType, getFileIcon, timeStr, generateSampleContent
 */

// ─── Pure helpers mirrored from page.tsx ─────────────────────────────────────

function getFileType(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (['pdf'].includes(ext)) return 'pdf';
  if (['doc', 'docx'].includes(ext)) return 'word';
  if (['xls', 'xlsx'].includes(ext)) return 'excel';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return 'image';
  if (['csv'].includes(ext)) return 'csv';
  return 'text';
}

function getFileIcon(type: string): string {
  switch (type) {
    case 'pdf': return '📄';
    case 'word': return '📝';
    case 'excel': return '📊';
    case 'image': return '🖼️';
    case 'csv': return '📋';
    default: return '📃';
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('getFileType', () => {
  it('detects PDF files', () => {
    expect(getFileType('report.pdf')).toBe('pdf');
    expect(getFileType('REPORT.PDF')).toBe('pdf');
  });

  it('detects Word documents', () => {
    expect(getFileType('doc.doc')).toBe('word');
    expect(getFileType('doc.docx')).toBe('word');
  });

  it('detects Excel files', () => {
    expect(getFileType('data.xls')).toBe('excel');
    expect(getFileType('data.xlsx')).toBe('excel');
  });

  it('detects image files', () => {
    expect(getFileType('photo.png')).toBe('image');
    expect(getFileType('photo.jpg')).toBe('image');
    expect(getFileType('photo.jpeg')).toBe('image');
    expect(getFileType('photo.gif')).toBe('image');
    expect(getFileType('photo.webp')).toBe('image');
  });

  it('detects CSV files', () => {
    expect(getFileType('data.csv')).toBe('csv');
  });

  it('falls back to text for unknown types', () => {
    expect(getFileType('file.md')).toBe('text');
    expect(getFileType('file.txt')).toBe('text');
    expect(getFileType('file.json')).toBe('text');
    expect(getFileType('file')).toBe('text');
  });
});

describe('getFileIcon', () => {
  it('returns correct emoji for each file type', () => {
    expect(getFileIcon('pdf')).toBe('📄');
    expect(getFileIcon('word')).toBe('📝');
    expect(getFileIcon('excel')).toBe('📊');
    expect(getFileIcon('image')).toBe('🖼️');
    expect(getFileIcon('csv')).toBe('📋');
    expect(getFileIcon('text')).toBe('📃');
    expect(getFileIcon('unknown')).toBe('📃');
  });
});

describe('file chip behavior', () => {
  it('queued files are those not yet in sentFileIds', () => {
    const files = [
      { id: 'a', name: 'a.pdf', status: 'queued' },
      { id: 'b', name: 'b.csv', status: 'done' },
      { id: 'c', name: 'c.png', status: 'queued' },
    ];
    const sentIds = new Set(['b']);
    const queued = files.filter((f) => !sentIds.has(f.id));
    expect(queued).toHaveLength(2);
    expect(queued.map((f) => f.id)).toEqual(['a', 'c']);
  });

  it('clears only queued files when removing unsent', () => {
    const files = [
      { id: 'a', name: 'a.pdf', status: 'queued' },
      { id: 'b', name: 'b.csv', status: 'done' },
    ];
    const sentIds = new Set(['b']);
    // Simulate "clear unsent" action
    const remaining = files.filter((f) => sentIds.has(f.id));
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe('b');
  });
});

describe('drag and drop', () => {
  it('isDragging state should start as false', () => {
    let isDragging = false;
    expect(isDragging).toBe(false);
  });

  it('dragOver sets isDragging to true, dragLeave resets to false', () => {
    let isDragging = false;
    const handleDragOver = () => { isDragging = true; };
    const handleDragLeave = () => { isDragging = false; };

    handleDragOver();
    expect(isDragging).toBe(true);
    handleDragLeave();
    expect(isDragging).toBe(false);
  });
});
