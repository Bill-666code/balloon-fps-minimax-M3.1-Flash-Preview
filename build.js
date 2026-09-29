/* 把 index.html + src/*.js 打包成单文件 dist/balloon-fps.html */
const fs = require('fs');
const path = require('path');
const root = __dirname;
let html = fs.readFileSync(path.join(root, 'dev.html'), 'utf8');
const srcDir = path.join(root, 'src');
const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.js')).sort();
for (const f of files) {
  const code = fs.readFileSync(path.join(srcDir, f), 'utf8');
  const tag = `<script src="src/${f}"></script>`;
  if (!html.includes(tag)) { console.error('缺少标签:', tag); process.exit(1); }
  html = html.replace(tag, `<script>\n/* ===== ${f} ===== */\n${code}\n</script>`);
}
const banner = `<!--
  气球人爆破队 · BALLOON BUSTERS
  单文件版本：直接双击用浏览器打开即可游玩。
  所有贴图 / 角色 / 武器 / 地图 / 特效 / 音效 / 音乐均由代码生成，零外部素材。
-->`;
html = html.replace('<!DOCTYPE html>', '<!DOCTYPE html>\n' + banner);
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
// dist/balloon-fps.html —— 可下载的单文件成品
const out = path.join(root, 'dist', 'balloon-fps.html');
fs.writeFileSync(out, html);
// index.html —— GitHub Pages 入口（内容与单文件成品完全一致）
const page = path.join(root, 'index.html');
fs.writeFileSync(page, html);
console.log('打包完成 (' + files.length + ' 个模块, ' + (html.length / 1024).toFixed(1) + ' KB)');
console.log('  dist/balloon-fps.html  可下载的单文件');
console.log('  index.html              GitHub Pages 入口');
