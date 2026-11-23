import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { FileService } from '@/server/services/file';
import type { MarketService } from '@/server/services/market';

import { probeCommand, readProbe, refuseDeliverable } from '../deliverable';
import { SandboxMiddlewareService } from '../service';
import type { SandboxProvider } from '../types';

const dir = mkdtempSync(path.join(tmpdir(), 'deliverable-'));

/** Writes a zip with the given entries, using the same Python the probe uses. */
const zipWith = (name: string, entries: string[]) => {
  const file = path.join(dir, name);
  const script = `import zipfile, sys\nwith zipfile.ZipFile(sys.argv[1], 'w') as z:\n  for e in sys.argv[2:]: z.writestr(e, '<x/>')`;
  execFileSync('python3', ['-c', script, file, ...entries]);
  return file;
};

/** Runs the probe against a real file, as the sandbox would. */
const probe = (file: string) => readProbe(execSync(probeCommand(file), { encoding: 'utf8' }))!;

const check = (file: string) => refuseDeliverable(file, probe(file));

describe('checking a file before it is handed over', () => {
  it('passes real documents', () => {
    expect(
      check(zipWith('deck.pptx', ['[Content_Types].xml', 'ppt/presentation.xml'])),
    ).toBeUndefined();
    expect(check(zipWith('notes.docx', ['word/document.xml']))).toBeUndefined();
    expect(check(zipWith('sheet.xlsx', ['xl/workbook.xml']))).toBeUndefined();

    const pdf = path.join(dir, 'report.pdf');
    writeFileSync(pdf, '%PDF-1.7\n%…\n');
    expect(check(pdf)).toBeUndefined();

    const csv = path.join(dir, 'data.csv');
    writeFileSync(csv, 'a,b\n1,2\n');
    expect(check(csv)).toBeUndefined();
  });

  it('refuses what is missing, empty, a folder, or not the document its name says', () => {
    expect(check(path.join(dir, 'nowhere.pptx'))).toMatch(/There is no file at/);
    expect(check(dir)).toMatch(/is a folder/);

    const empty = path.join(dir, 'empty.docx');
    writeFileSync(empty, '');
    expect(check(empty)).toMatch(/is empty \(0 bytes\)/);

    const text = path.join(dir, 'fake.xlsx');
    writeFileSync(text, 'not a workbook');
    expect(check(text)).toMatch(/not a valid Excel workbook \(\.xlsx\): it does not open as one/);

    expect(check(zipWith('word.pptx', ['word/document.xml']))).toMatch(
      /not a valid PowerPoint presentation .* has no ppt\/presentation\.xml/,
    );

    const pdf = path.join(dir, 'fake.pdf');
    writeFileSync(pdf, '<html></html>');
    expect(check(pdf)).toMatch(/not a valid PDF/);
  });

  it('copes with a path that has quotes and spaces in it', () => {
    const odd = zipWith("it's a deck.pptx", ['ppt/presentation.xml']);
    expect(check(odd)).toBeUndefined();
  });

  it('refuses before anything is uploaded, and exports when the file is fine', async () => {
    const answers: string[] = [];
    const provider = {
      callTool: async () => ({
        result: { exitCode: 0, stdout: answers.shift() ?? '' },
        success: true,
      }),
      capabilities: {
        backgroundCommands: true,
        exportFile: true,
        files: true,
        languages: ['python'],
        persistentSession: true,
        shell: true,
        skillScripts: true,
      },
      exportFileToUploadUrl: async () => ({ success: true }),
      kind: 'openbot',
    } satisfies SandboxProvider;
    let uploads = 0;
    const fileService = {
      createFileRecord: async () => ({ fileId: 'file-1', url: '/f/file-1' }),
      createPreSignedUpload: async () => {
        uploads += 1;
        return { url: 'https://uploads.example.com/put' };
      },
      getFileMetadata: async () => ({ contentLength: 9, contentType: 'application/pdf' }),
    } as unknown as FileService;
    const service = new SandboxMiddlewareService(provider, {
      fileService,
      marketService: {} as MarketService,
      topicId: 'topic-1',
      userId: 'user-1',
    });

    answers.push(JSON.stringify({ exists: true, head: '', isFile: true, size: 0 }));
    expect(await service.exportAndUploadFile('/workspace/deck.pptx', 'deck.pptx')).toEqual({
      error: {
        message: '/workspace/deck.pptx is empty (0 bytes). Generate it again, then export it.',
        name: 'DeliverableRefused',
      },
      filename: 'deck.pptx',
      success: false,
    });
    expect(uploads).toBe(0);

    answers.push(JSON.stringify({ exists: true, head: '255044462d312e37', isFile: true, size: 9 }));
    expect(await service.exportAndUploadFile('/workspace/r.pdf', 'r.pdf')).toMatchObject({
      fileId: 'file-1',
      success: true,
    });
    expect(uploads).toBe(1);
  });
});
