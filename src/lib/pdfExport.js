/**
 * pdfExport — shared "make a PDF from a DOM element" helper.
 *
 * Why this exists
 * ---------------
 * Capacitor WKWebView (iOS) does not honour `window.print()` — calling
 * it does nothing visible on the device. Both the Accident report and
 * the Vehicle Check report were using window.print() as their
 * "download" action, so users on TestFlight reported "Download does
 * nothing". This module renders the report element to a PNG via
 * html2canvas, packs it (paginated if tall) into a jsPDF document,
 * and either:
 *   • on native (iOS/Android Capacitor): writes the PDF to the
 *     Documents folder and opens the native share/save sheet so the
 *     user can save to Files / send via WhatsApp / etc.
 *   • on web: triggers a normal Blob URL download.
 *
 * The DOM element passed in must already be rendered and visible
 * (offscreen elements with display:none don't paint to canvas).
 * Callers typically pass the on-screen preview element, NOT the
 * @media-print-only hidden element.
 */

import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { isNative, shareContent } from './capacitor';

/**
 * Render an element to a multi-page A4 PDF and download/share it.
 *
 * @param {HTMLElement} el       — element to capture
 * @param {string}      filename — suggested filename (without extension)
 * @returns {Promise<boolean>}     true on success
 */
export async function exportElementToPdf(el, filename = 'report') {
  if (!el) {
    console.warn('exportElementToPdf: no element passed');
    return false;
  }

  try {
    // Render the element to canvas at 2x for crisp output. Background
    // is explicit white because some report elements rely on the page
    // background.
    const canvas = await html2canvas(el, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
      windowWidth: el.scrollWidth,
      windowHeight: el.scrollHeight,
    });

    // A4 portrait: 210 x 297 mm. We render the captured PNG at the
    // page's full width and let it span as many pages as needed by
    // shifting the Y offset on each page.
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const imgW  = pageW;
    const imgH  = (canvas.height * imgW) / canvas.width;

    let heightLeft = imgH;
    let position   = 0;

    const imgData = canvas.toDataURL('image/png');
    pdf.addImage(imgData, 'PNG', 0, position, imgW, imgH);
    heightLeft -= pageH;

    while (heightLeft > 0) {
      position = heightLeft - imgH;          // negative offset shifts the next page
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, position, imgW, imgH);
      heightLeft -= pageH;
    }

    const fname = `${filename}.pdf`;

    if (isNative) {
      // Native: get the PDF as a base64 string, write to a temp file
      // and share. Capacitor Filesystem accepts base64 directly via
      // the data URI prefix.
      const dataUri = pdf.output('datauristring');
      // dataUri shape: data:application/pdf;filename=...;base64,XXXX
      const base64 = dataUri.split(';base64,').pop();
      try {
        const { Filesystem, Directory } = await import('@capacitor/filesystem');
        await Filesystem.writeFile({
          path: fname,
          data: base64,
          directory: Directory.Cache,
        });
        const uri = await Filesystem.getUri({
          path: fname,
          directory: Directory.Cache,
        });
        // Capacitor Share supports a `files` array on iOS 14+ / Android
        // 6+ — passes the file URI to the system share sheet.
        const { Share } = await import('@capacitor/share');
        await Share.share({
          title: filename,
          url: uri.uri,
          dialogTitle: 'שמור או שתף את הדוח',
        });
        return true;
      } catch (e) {
        // Fallback for older Capacitor versions: share just the title
        // text. Better than nothing, but the user won't get the PDF.
        console.warn('exportElementToPdf native share failed, falling back to text share:', e);
        await shareContent({ title: filename, text: `${filename} נשמר באפליקציה.` });
        return false;
      }
    }

    // Web: trigger a Blob URL download.
    pdf.save(fname);
    return true;
  } catch (err) {
    console.error('exportElementToPdf failed:', err);
    return false;
  }
}

/**
 * Render an element to a Word-compatible .doc file (HTML inside an
 * MS Word MIME wrapper). Opens cleanly in Microsoft Word, Google
 * Docs, and LibreOffice. Lets users edit the report after export —
 * which was the user's stated reason for wanting Word format.
 *
 * No new dependencies needed: .doc has supported HTML-based payloads
 * since Word 2000. Compatible everywhere a real .docx would open.
 *
 * @param {HTMLElement} el       — element to capture
 * @param {string}      filename — suggested filename (without extension)
 * @returns {Promise<boolean>}
 */
export async function exportElementToWord(el, filename = 'report') {
  if (!el) {
    console.warn('exportElementToWord: no element passed');
    return false;
  }
  try {
    // Collect all <style> tags + the element's own computed styles
    // so the .doc preserves the layout. Word's HTML parser handles
    // basic CSS (font, color, padding, table styling).
    const styleTags = Array.from(document.querySelectorAll('style'))
      .map(s => s.outerHTML).join('');
    const inner = el.outerHTML;

    const html = `<!doctype html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>${filename}</title>
${styleTags}
</head>
<body dir="rtl" lang="he">${inner}</body>
</html>`;

    // Word recognises this exact MIME — the file extension .doc seals
    // the deal for the OS to launch Word as the default opener.
    const blob = new Blob(['﻿' + html], {
      type: 'application/msword;charset=utf-8',
    });
    const fname = `${filename}.doc`;

    if (isNative) {
      try {
        const { Filesystem, Directory } = await import('@capacitor/filesystem');
        // Convert blob → base64 for Capacitor Filesystem.
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(String(reader.result).split(',')[1] || '');
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        await Filesystem.writeFile({
          path: fname,
          data: base64,
          directory: Directory.Cache,
        });
        const uri = await Filesystem.getUri({
          path: fname,
          directory: Directory.Cache,
        });
        const { Share } = await import('@capacitor/share');
        await Share.share({
          title: filename,
          url: uri.uri,
          dialogTitle: 'שמור או שתף את הדוח (Word)',
        });
        return true;
      } catch (e) {
        console.warn('exportElementToWord native share failed:', e);
        await shareContent({ title: filename, text: `${filename} נשמר באפליקציה.` });
        return false;
      }
    }

    // Web: standard anchor-click download.
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fname;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return true;
  } catch (err) {
    console.error('exportElementToWord failed:', err);
    return false;
  }
}
