/**
 * Checks a file the model asks to hand over before it is exported: it must be there, have
 * something in it, and, for an Office document or a PDF, be one, so a broken script does not end
 * up in front of the user as a download that will not open.
 */

/** Largest file handed over from the sandbox. */
export const DELIVERABLE_SIZE_LIMIT = 100 * 1024 * 1024;

/** The part every valid file of each Office format has. */
const MAIN_PARTS: Record<string, { name: string; part: string }> = {
  docx: { name: 'Word document', part: 'word/document.xml' },
  pptx: { name: 'PowerPoint presentation', part: 'ppt/presentation.xml' },
  xlsx: { name: 'Excel workbook', part: 'xl/workbook.xml' },
};

/** What the sandbox reports about the file (see `probeCommand`). */
export interface DeliverableProbe {
  exists: boolean;
  /** First bytes, hex */
  head?: string;
  isFile?: boolean;
  /** Which of the asked-for parts the zip holds */
  parts?: string[];
  size?: number;
  /** Whether it opens as a zip and every entry reads back */
  zipOk?: boolean;
}

const extensionOf = (filename: string) => filename.split('.').pop()?.toLowerCase() ?? '';

const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

const PROBE = `
import json, os, sys, zipfile
p, wanted = sys.argv[1], sys.argv[2:]
r = {"exists": os.path.exists(p), "isFile": os.path.isfile(p)}
if r["isFile"]:
    r["size"] = os.path.getsize(p)
    with open(p, "rb") as f:
        r["head"] = f.read(8).hex()
    if wanted:
        try:
            with zipfile.ZipFile(p) as z:
                names = set(z.namelist())
                r["parts"] = [n for n in wanted if n in names]
                r["zipOk"] = z.testzip() is None
        except Exception:
            r["zipOk"] = False
print(json.dumps(r))
`.trim();

/** A command that prints the probe as JSON; Python 3 is on the Market image and the cloud computer. */
export const probeCommand = (path: string) => {
  const part = MAIN_PARTS[extensionOf(path)]?.part;
  return `python3 -c ${quote(PROBE)} ${quote(path)}${part ? ` ${quote(part)}` : ''}`;
};

/** Why the file cannot be handed over, in words the model can act on; undefined when it can. */
export const refuseDeliverable = (path: string, probe: DeliverableProbe): string | undefined => {
  if (!probe.exists) return `There is no file at ${path}. Create it first, then export it.`;
  if (!probe.isFile) return `${path} is a folder, not a file. Export the file inside it.`;
  if (!probe.size) return `${path} is empty (0 bytes). Generate it again, then export it.`;
  if (probe.size > DELIVERABLE_SIZE_LIMIT) {
    return `${path} is larger than ${DELIVERABLE_SIZE_LIMIT / 1024 / 1024} MB and cannot be handed over.`;
  }

  const extension = extensionOf(path);
  const office = MAIN_PARTS[extension];
  if (office && (!probe.zipOk || !probe.parts?.includes(office.part))) {
    return `${path} is not a valid ${office.name} (.${extension}): it ${probe.zipOk ? `has no ${office.part}` : 'does not open as one'}. Fix the script that writes it, then export it again.`;
  }
  if (extension === 'pdf' && !probe.head?.startsWith('255044462d')) {
    return `${path} is not a valid PDF: it does not start with %PDF-. Generate it again, then export it.`;
  }
};

/** The probe's JSON line out of the command's output; undefined when it is not there. */
export const readProbe = (output: string): DeliverableProbe | undefined => {
  const line = output
    .trim()
    .split('\n')
    .findLast((candidate) => candidate.trim().startsWith('{'));
  if (!line) return;
  try {
    const parsed = JSON.parse(line) as DeliverableProbe;
    return typeof parsed.exists === 'boolean' ? parsed : undefined;
  } catch {
    return undefined;
  }
};
