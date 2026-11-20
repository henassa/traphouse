import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const out = '_site';
await rm(out, { recursive: true, force: true });
await mkdir(out);

// vgui.css : Greensteam en clair, Blacksteam en sombre. On le range dans un @layer "vgui"
// déclaré avant ceux de Tailwind, pour que nos utilitaires passent toujours devant.
async function theme(name) {
  await cp(`vendor/vgui/${name}`, `${out}/vgui/${name}`, { recursive: true, filter: (f) => !f.endsWith('.css') });
  const css = await readFile(`vendor/vgui/${name}/${name}.css`, 'utf8');
  return css
    .replace(/url\("?([a-z_0-9]+\.png)"?\)/g, `url("vgui/${name}/$1")`)
    .replace(/\.DownloadButton[^}]*}/g, '');
}
const vgui = `@layer vgui, theme, components, utilities;
@layer vgui {
@media not (prefers-color-scheme: dark) {
${await theme('greensteam')}
}
@media (prefers-color-scheme: dark) {
${await theme('blacksteam')}
}
}
`;
await writeFile(`${out}/vgui.css`, vgui);
await cp('vendor/vgui/LICENSE', `${out}/vgui/LICENSE`);

execFileSync('npx', ['@tailwindcss/cli', '-i', 'src/styles.css', '-o', `${out}/app.css`, '--minify'], { stdio: 'inherit' });

await cp('src/index.html', `${out}/index.html`);
await cp('src/js', `${out}/js`, { recursive: true });
for (const f of ['icon-32.png', 'icon-64.png', 'icon-180.png']) await cp(`src/${f}`, `${out}/${f}`);
await cp('src/img', `${out}/img`, { recursive: true });
// Liste des emblèmes Premier / MM déposés dans src/img/ranks, pour que le site sache lesquels existent.
const ranks = (await readdir('src/img/ranks')).filter((f) => /^(premier-[1-7]|mm-([1-9]|1[0-8]))\.(png|webp|svg)$/.test(f));
await writeFile(`${out}/img/ranks/index.json`, JSON.stringify(ranks));
// data/ n'existe que pendant le workflow (créé par fetch.mjs).
if (existsSync('data')) await cp('data', `${out}/data`, { recursive: true });
await cp('demo', `${out}/demo`, { recursive: true });
