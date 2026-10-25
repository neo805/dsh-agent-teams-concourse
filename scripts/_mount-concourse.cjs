// 一次性挂载脚本（留档）：把 dsh-agent-teams-concourse 登记进指定 profile 的 bundles。
//
// 用法：
//   node scripts/_mount-concourse.cjs web desktop
//   DSH_HOME=/path/to/.dsh node scripts/_mount-concourse.cjs web
//
// 说明：
//  · profile 根目录取 $DSH_HOME（缺省 ~/.dsh），不写死任何机器路径。
//  · 只改 profile 的 package.json（把包名追加进 dsh.profile.bundles），不动 cordis.patch.yml。
//  · 正式安装请走技能 Skill_DSH-Plugin-Safe-Install（含备份与体检），本脚本仅供一次性登记留档。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dshHome = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh');
const profiles = process.argv.slice(2);
if (profiles.length === 0) {
  console.error('用法：node scripts/_mount-concourse.cjs <profile...>');
  process.exit(2);
}

for (const prof of profiles) {
  const file = path.join(dshHome, 'profiles', prof, 'package.json');
  if (!fs.existsSync(file)) {
    console.error(`[mount] 跳过 ${prof}：找不到 ${file}`);
    continue;
  }
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  const bundles = json?.dsh?.profile?.bundles;
  if (!Array.isArray(bundles)) {
    console.error(`[mount] 跳过 ${prof}：package.json 里没有 dsh.profile.bundles 数组`);
    continue;
  }
  if (bundles.includes('dsh-agent-teams-concourse')) {
    console.log(`[mount] ${prof}：已登记，未改动（bundles ${bundles.length}）`);
    continue;
  }
  bundles.push('dsh-agent-teams-concourse');
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
  console.log(`[mount] ${prof}：已登记（bundles ${bundles.length}）`);
}
