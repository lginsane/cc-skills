import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';

const DEFAULT = {
  width: 13.333,
  height: 7.5,
  colors: { primary: '1F4E79', background: 'FFFFFF', text: '1A1A1A', accent: '2E86AB' },
  fonts: { title: 'Microsoft YaHei', body: 'Microsoft YaHei' },
  degraded: false
};

export async function readTheme(templatePath) {
  if (!templatePath) return { ...DEFAULT, colors: { ...DEFAULT.colors }, fonts: { ...DEFAULT.fonts } };
  try {
    const zip = await JSZip.loadAsync(await readFile(templatePath));
    const themeFile = zip.file('ppt/theme/theme1.xml');
    if (!themeFile) throw new Error('no theme');
    const xml = await themeFile.async('string');
    const scheme = (xml.match(/<a:clrScheme[\s\S]*?<\/a:clrScheme>/) || [''])[0];
    const role = name => {
      const m = scheme.match(new RegExp(`<a:${name}>[\\s\\S]*?<a:srgbClr val="([0-9A-Fa-f]{6})"`));
      return m ? m[1] : undefined;
    };
    const fonts = [...xml.matchAll(/<a:latin typeface="([^"]*)"/g)].map(m => m[1]).filter(Boolean);
    let width = DEFAULT.width;
    let height = DEFAULT.height;
    const pres = zip.file('ppt/presentation.xml');
    if (pres) {
      const p = await pres.async('string');
      const m = p.match(/<p:sldSz cx="(\d+)" cy="(\d+)"/);
      if (m) {
        width = Math.round(Number(m[1]) / 914400 * 100) / 100;
        height = Math.round(Number(m[2]) / 914400 * 100) / 100;
      }
    }
    return {
      width,
      height,
      colors: {
        primary: role('dk2') || role('accent1') || DEFAULT.colors.primary,
        background: role('lt1') || DEFAULT.colors.background,
        text: role('dk1') || DEFAULT.colors.text,
        accent: role('accent1') || DEFAULT.colors.accent
      },
      fonts: { title: fonts[0] || DEFAULT.fonts.title, body: fonts[1] || fonts[0] || DEFAULT.fonts.body },
      degraded: false
    };
  } catch {
    return { ...DEFAULT, colors: { ...DEFAULT.colors }, fonts: { ...DEFAULT.fonts }, degraded: true };
  }
}
