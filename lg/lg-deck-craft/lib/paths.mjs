import path from 'node:path';

export function workDir(root, name) {
  return path.join(root, 'work', name);
}

export function artifact(workDir, name) {
  return path.join(workDir, name);
}
