import JSZip from 'jszip';

const background =
  '<p:bg><p:bgPr><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>';
const run =
  '<a:defRPr sz="5200" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:latin typeface="Arial"/></a:defRPr>';
const paragraphs =
  `<a:defPPr algn="ctr">${run}</a:defPPr>` +
  Array.from(
    { length: 9 },
    (_, i) =>
      `<a:lvl${i + 1}pPr marL="0" indent="0" algn="ctr"><a:buNone/>${run}</a:lvl${i + 1}pPr>`,
  ).join('');

/**
 * PptxGenJS 4 emits an additional blank layout and a master whose colour map and
 * text defaults are fixed internally. Its public master API configures the named
 * layout, but cannot configure those defaults. Correct only these generated parts,
 * retaining all relationships, shapes, geometry and slide text untouched.
 */
export async function finishPresentationPackage(data: Uint8Array): Promise<Buffer> {
  const zip = await JSZip.loadAsync(data);
  for (const file of Object.values(zip.files)) {
    if (
      /^ppt\/(slideMasters\/slideMaster\d+|slideLayouts\/slideLayout\d+)\.xml$/.test(file.name)
    ) {
      let xml = await file.async('string');
      xml = xml
        .replace(/<p:bg>[\s\S]*?<\/p:bg>/g, '')
        .replace(/<p:cSld\b[^>]*>/, (tag) => tag + background);
      xml = xml.replace(/bg1="lt1" tx1="dk1"/g, 'bg1="dk1" tx1="lt1"');
      xml = xml.replace(
        /<p:txStyles>[\s\S]*?<\/p:txStyles>/,
        `<p:txStyles><p:titleStyle>${paragraphs}</p:titleStyle><p:bodyStyle>${paragraphs}</p:bodyStyle><p:otherStyle>${paragraphs}</p:otherStyle></p:txStyles>`,
      );
      zip.file(file.name, xml);
    } else if (file.name === 'ppt/presentation.xml') {
      const xml = await file.async('string');
      zip.file(
        file.name,
        xml.replace(
          /<p:defaultTextStyle>[\s\S]*?<\/p:defaultTextStyle>/,
          `<p:defaultTextStyle>${paragraphs}</p:defaultTextStyle>`,
        ),
      );
    }
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
