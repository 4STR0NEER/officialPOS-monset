import { api } from './api.ts';

/** Print a document through the system print dialog (A4, or a thermal printer installed as a system printer). */
export async function printDocument(userId: string, seq: number) {
  const { output, reprint } = await api.core.print(userId, seq, 'html');
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  frame.srcdoc = output as string;
  document.body.appendChild(frame);
  await new Promise((r) => (frame.onload = r));
  frame.contentWindow!.focus();
  frame.contentWindow!.print();
  setTimeout(() => frame.remove(), 1000);
  return reprint;
}
