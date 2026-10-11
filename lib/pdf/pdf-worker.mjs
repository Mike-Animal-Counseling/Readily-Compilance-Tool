import { parentPort, workerData } from 'node:worker_threads';
import PDFParser from 'pdf2json';
try {
  const parser = new PDFParser();
  parser.on('pdfParser_dataError', () => { parentPort.postMessage({ error: 'Invalid PDF' }); });
  parser.on('pdfParser_dataReady', data => {
    if (!data.Pages || data.Pages.length > 30 || JSON.stringify(data.Pages).length > 5000000) parentPort.postMessage({ error: 'PDF exceeds processing limits' });
    else parentPort.postMessage({ data: { Pages: data.Pages } });
  });
  // Some PDF readers inspect backing buffers; do not expose a pooled slab.
  if (typeof workerData?.pdfBase64 !== 'string' || workerData.pdfBase64.length > 2796204) throw new Error('PDF exceeds input limits');
  const decoded = Buffer.from(workerData.pdfBase64, 'base64');
  if (decoded.length > 2 * 1024 * 1024 || decoded.subarray(0, 5).toString() !== '%PDF-') throw new Error('Invalid PDF');
  const input = Buffer.alloc(decoded.length);
  input.set(decoded);
  parser.parseBuffer(input);
} catch { parentPort.postMessage({ error: 'Invalid PDF' }); }
