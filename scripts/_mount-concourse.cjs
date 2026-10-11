// 一次性脚本：把 dsh-agent-teams-concourse 登记进 web/desktop profile 的 bundles。
const fs = require('node:fs');
for (const prof of ['web', 'desktop']) {
  const p = `C:/Users/KEI.NEO/.dsh/profiles/${prof}/package.json`;
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  const b = j.dsh.profile.bundles;
  if (!b.includes('dsh-agent-teams-concourse')) b.push('dsh-agent-teams-concourse');
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
  console.log(prof, 'bundles total', b.length);
}
