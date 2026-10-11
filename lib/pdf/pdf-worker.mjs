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
  const input = Buffer.alloc(workerData.length);
  input.set(workerData);
  parser.parseBuffer(input);
} catch { parentPort.postMessage({ error: 'Invalid PDF' }); }
