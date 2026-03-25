import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REGISTRY_PATH = 'C:/Users/willl/My Drive/AI/_System/project-registry.md';
const OUTPUT_PATH = path.join(__dirname, '../src/assets/projects.json');

if (process.env.CI) {
  console.log('CI environment detected — skipping registry sync (using existing src/assets/projects.json)');
  process.exit(0);
}

console.log('Syncing project registry...');

try {
  const content = fs.readFileSync(REGISTRY_PATH, 'utf-8');
  const lines = content.split('\n');
  
  const projects = [];
  let currentProject = null;
  let inArchived = false;
  
  for (const line of lines) {
    if (line.includes('## Archived Projects')) {
        inArchived = true;
    }
    if (inArchived) continue;

    if (line.startsWith('### ')) {
      if (currentProject) projects.push(currentProject);
      currentProject = { name: line.replace('### ', '').trim() };
    } else if (line.startsWith('- **') && currentProject) {
      const match = line.match(/- \*\*([^*]+):\*\* (.*)/);
      if (match) {
        const key = match[1].trim().toLowerCase().replace(' ', '_');
        currentProject[key] = match[2].trim();
      }
    }
  }
  if (currentProject && !inArchived) projects.push(currentProject);
  
  const dir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(projects, null, 2));
  console.log(`✅ Successfully synced ${projects.length} active/standing/tab projects to src/assets/projects.json`);
} catch (e) {
  if (e.code === 'ENOENT') {
    console.warn("⚠️ Registry file not found (expected in CI/CD). Using previously committed projects.json or creating empty array.");
    if (!fs.existsSync(OUTPUT_PATH)) {
      const dir = path.dirname(OUTPUT_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(OUTPUT_PATH, "[]");
    }
  } else {
    console.error("❌ Failed to sync registry:", e.message);
  }
}
