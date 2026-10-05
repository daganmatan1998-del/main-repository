import { flushSave, buildDoc } from './autosave';
import { buildProjectFile, PROJECT_FILE_EXT } from '../project/projectFile';
import { downloadBlob, safeFilename } from './exporters';
import { toast } from '../state/uiStore';

export async function exportCurrentProject() {
  try {
    await flushSave(false);
    const doc = buildDoc(false);
    if (!doc) return;
    const blob = await buildProjectFile(doc);
    downloadBlob(blob, `${safeFilename(doc.name)}${PROJECT_FILE_EXT}`);
    toast('success', 'Project exported', 'Open it from the home screen with “Import project”, on any computer.');
  } catch (e) {
    toast('error', 'Export failed', (e as Error).message);
  }
}
