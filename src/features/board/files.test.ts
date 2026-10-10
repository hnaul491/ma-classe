import { describe, expect, it } from 'vitest';
import { droppedFile, hasUnstoredImages, isFileDrag, sceneFileIds } from './files';

const U1 = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';
const U2 = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const SHA1 = 'a94a8fe5ccb19ba61c4c0873d391e987982fbbd3';

describe('sceneFileIds', () => {
  it('lists each stored (uuid) image file id once', () => {
    const elements = [
      { id: '1', type: 'image', fileId: U1 },
      { id: '2', type: 'image', fileId: U2 },
      { id: '3', type: 'image', fileId: U1 },
      { id: '4', type: 'frame' },
      { id: '5', type: 'image', fileId: null },
    ];
    expect(sceneFileIds(elements)).toEqual([U1, U2]);
  });

  it('skips deleted elements and Excalidraw SHA-1 ids, which are never in the files table', () => {
    const elements = [
      { id: '1', type: 'image', fileId: U1, isDeleted: true },
      { id: '2', type: 'image', fileId: SHA1 },
      { id: '3', type: 'image', fileId: 'not-a-uuid' },
      { id: '4', type: 'image', fileId: U2 },
    ];
    expect(sceneFileIds(elements)).toEqual([U2]);
  });

  it('is empty for an empty scene', () => {
    expect(sceneFileIds([])).toEqual([]);
  });
});

describe('droppedFile', () => {
  const pdf = { name: 'a.pdf', type: 'application/pdf' };
  const png = { name: 'b.png', type: 'image/png' };

  it('takes the first file of a drop or paste', () => {
    expect(droppedFile([pdf, png])).toBe(pdf);
    expect(droppedFile([png])).toBe(png);
  });

  it('is null without files (a text or element paste goes to Excalidraw)', () => {
    expect(droppedFile([])).toBeNull();
    expect(droppedFile(null)).toBeNull();
    expect(droppedFile(undefined)).toBeNull();
  });
});

describe('hasUnstoredImages', () => {
  it('is true when pasted elements carry images that are not in our storage', () => {
    expect(hasUnstoredImages([{ type: 'rectangle' }, { type: 'image', fileId: SHA1 }])).toBe(true);
    expect(hasUnstoredImages([{ type: 'image', fileId: null }])).toBe(true);
  });

  it('is false for our own images and for elements without images', () => {
    expect(hasUnstoredImages([{ type: 'image', fileId: U1 }, { type: 'text' }])).toBe(false);
    expect(hasUnstoredImages([])).toBe(false);
  });
});

describe('isFileDrag', () => {
  it('is true only when the drag carries files', () => {
    expect(isFileDrag(['Files'])).toBe(true);
    expect(isFileDrag(['text/plain', 'Files'])).toBe(true);
    expect(isFileDrag(['text/plain', 'text/uri-list'])).toBe(false);
    expect(isFileDrag([])).toBe(false);
    expect(isFileDrag(undefined)).toBe(false);
  });
});
